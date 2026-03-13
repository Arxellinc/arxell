import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { v4 as uuidv4 } from "uuid";
import { WebSocketServer } from "ws";

const REQUIRED_ENV = ["AUTH_JWKS_URL", "AUTH_ISSUER", "AUTH_AUDIENCE", "AUTH_REQUIRED_ORG_ID"];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}

const {
  PORT = "3000",
  APP_ORIGIN = "*",
  AUTH_JWKS_URL,
  AUTH_ISSUER,
  AUTH_AUDIENCE,
  AUTH_REQUIRED_ORG_ID,
  AUTH_REQUIRE_EMAIL_VERIFIED = "true",
  TURN_SHARED_SECRET = "",
  TURN_URLS = "",
  TURN_TTL_SECONDS = "3600",
} = process.env;

const allowedOrigins = APP_ORIGIN.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const oidcIssuer = AUTH_ISSUER.split(",").map((v) => v.trim()).filter(Boolean);
const oidcAudience = AUTH_AUDIENCE.split(",").map((v) => v.trim()).filter(Boolean);
const jwks = createRemoteJWKSet(new URL(AUTH_JWKS_URL));

async function verifyToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: oidcIssuer.length === 1 ? oidcIssuer[0] : oidcIssuer,
      audience: oidcAudience.length === 1 ? oidcAudience[0] : oidcAudience,
      clockTolerance: 5,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    const orgId =
      typeof payload.org_id === "string"
        ? payload.org_id
        : payload.org && typeof payload.org === "object" && typeof payload.org.id === "string"
          ? payload.org.id
          : null;
    const emailVerified = payload.email_verified;

    if (!sub || !email || orgId !== AUTH_REQUIRED_ORG_ID) return null;
    if (
      AUTH_REQUIRE_EMAIL_VERIFIED === "true" &&
      emailVerified !== true &&
      emailVerified !== "true" &&
      emailVerified !== 1
    ) {
      return null;
    }

    return { sub, email, orgId };
  } catch {
    return null;
  }
}

function readBearer(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS policy"));
    },
    credentials: false,
  })
);
app.use(express.json({ limit: "1mb" }));

async function requireAuth(req, res, next) {
  const auth = await verifyToken(readBearer(req));
  if (!auth) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.auth = auth;
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/turn/credentials", requireAuth, (req, res) => {
  if (!TURN_SHARED_SECRET || !TURN_URLS.trim()) {
    res.status(503).json({ error: "TURN is not configured." });
    return;
  }

  const ttlSeconds = Math.max(60, Math.min(86400, Number(TURN_TTL_SECONDS) || 3600));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${exp}:${req.auth.sub}`;
  const credential = crypto.createHmac("sha1", TURN_SHARED_SECRET).update(username).digest("base64");
  const urls = TURN_URLS.split(",").map((v) => v.trim()).filter(Boolean);

  res.json({
    username,
    credential,
    ttl_seconds: ttlSeconds,
    urls,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const connections = new Map();
const userIndex = new Map();
const deviceIndex = new Map();

function send(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(message));
}

function addToUserIndex(sub, connectionId) {
  const set = userIndex.get(sub) ?? new Set();
  set.add(connectionId);
  userIndex.set(sub, set);
}

function removeFromUserIndex(sub, connectionId) {
  const set = userIndex.get(sub);
  if (!set) return;
  set.delete(connectionId);
  if (set.size === 0) userIndex.delete(sub);
}

function userConnections(sub) {
  const set = userIndex.get(sub);
  if (!set) return [];
  return [...set].map((id) => connections.get(id)).filter(Boolean);
}

function broadcastPresence(sub) {
  const peers = userConnections(sub)
    .filter((conn) => conn.deviceId)
    .map((conn) => ({
      device_id: conn.deviceId,
      connected_at: conn.connectedAt,
      last_seen: conn.lastSeen,
      meta: conn.meta,
    }));

  for (const conn of userConnections(sub)) {
    send(conn.ws, { type: "presence.update", peers });
  }
}

function cleanupConnection(connectionId) {
  const conn = connections.get(connectionId);
  if (!conn) return;

  connections.delete(connectionId);
  removeFromUserIndex(conn.auth.sub, connectionId);

  if (conn.deviceId && deviceIndex.get(conn.deviceId) === connectionId) {
    deviceIndex.delete(conn.deviceId);
  }

  broadcastPresence(conn.auth.sub);
}

wss.on("connection", (ws, connectionMeta) => {
  const connectionId = uuidv4();
  const conn = {
    id: connectionId,
    ws,
    auth: connectionMeta.auth,
    connectedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    deviceId: null,
    meta: {},
  };
  connections.set(connectionId, conn);
  addToUserIndex(conn.auth.sub, connectionId);

  send(ws, {
    type: "hello",
    connection_id: connectionId,
    required: ["presence.announce"],
  });

  ws.on("message", (raw) => {
    conn.lastSeen = new Date().toISOString();

    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      send(ws, { type: "error", code: "bad_json", message: "Invalid JSON." });
      return;
    }

    const type = typeof message?.type === "string" ? message.type : "";

    if (type === "ping") {
      send(ws, { type: "pong", at: new Date().toISOString() });
      return;
    }

    if (type === "presence.announce") {
      const deviceId = typeof message?.device_id === "string" ? message.device_id.trim() : "";
      if (!deviceId) {
        send(ws, { type: "error", code: "missing_device_id", message: "device_id is required." });
        return;
      }

      const existingOwner = deviceIndex.get(deviceId);
      if (existingOwner && existingOwner !== connectionId) {
        const existingConn = connections.get(existingOwner);
        if (existingConn && existingConn.auth.sub === conn.auth.sub) {
          send(existingConn.ws, { type: "session.replaced", reason: "same_device_id_reconnected" });
          existingConn.ws.close(4001, "session replaced");
          cleanupConnection(existingOwner);
        }
      }

      conn.deviceId = deviceId;
      conn.meta = {
        platform: typeof message?.platform === "string" ? message.platform : null,
        app_version: typeof message?.app_version === "string" ? message.app_version : null,
      };
      deviceIndex.set(deviceId, connectionId);

      send(ws, { type: "presence.ack", device_id: deviceId });
      broadcastPresence(conn.auth.sub);
      return;
    }

    if (!["signal.offer", "signal.answer", "signal.ice", "sync.request", "sync.delta"].includes(type)) {
      send(ws, { type: "error", code: "unsupported_type", message: "Unsupported message type." });
      return;
    }

    if (!conn.deviceId) {
      send(ws, { type: "error", code: "presence_required", message: "Send presence.announce first." });
      return;
    }

    const toDeviceId = typeof message?.to_device_id === "string" ? message.to_device_id.trim() : "";
    if (!toDeviceId) {
      send(ws, { type: "error", code: "missing_target", message: "to_device_id is required." });
      return;
    }

    const targetConnectionId = deviceIndex.get(toDeviceId);
    const target = targetConnectionId ? connections.get(targetConnectionId) : null;
    if (!target) {
      send(ws, { type: "relay.nack", reason: "target_offline", to_device_id: toDeviceId });
      return;
    }

    if (target.auth.sub !== conn.auth.sub || target.auth.orgId !== conn.auth.orgId) {
      send(ws, { type: "relay.nack", reason: "forbidden_target", to_device_id: toDeviceId });
      return;
    }

    send(target.ws, {
      type,
      session_id: typeof message?.session_id === "string" ? message.session_id : null,
      from_device_id: conn.deviceId,
      to_device_id: toDeviceId,
      payload: message?.payload ?? null,
      at: new Date().toISOString(),
    });

    send(ws, {
      type: "relay.ack",
      relayed_type: type,
      to_device_id: toDeviceId,
      at: new Date().toISOString(),
    });
  });

  ws.on("close", () => {
    cleanupConnection(connectionId);
  });

  ws.on("error", () => {
    cleanupConnection(connectionId);
  });
});

server.on("upgrade", async (req, socket, head) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\\r\\n\\r\\n");
      socket.destroy();
      return;
    }

    const queryToken = url.searchParams.get("token");
    const headerToken = readBearer(req);
    const auth = await verifyToken(queryToken || headerToken);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\\r\\n\\r\\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, { auth });
    });
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\\r\\n\\r\\n");
    socket.destroy();
  }
});

server.listen(Number(PORT), () => {
  // eslint-disable-next-line no-console
  console.log(`arx-sync-signal listening on ${PORT}`);
});
