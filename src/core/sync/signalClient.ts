import { useSyncStore } from "../../store/syncStore";
import { applyLocalSyncSnapshot, collectLocalSyncSnapshot } from "./localStateSync";

let socket: WebSocket | null = null;
let activeSession = 0;
let localDeviceId: string | null = null;

interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
}

interface PeerLink {
  peerId: string;
  pc: RTCPeerConnection;
  channel: RTCDataChannel | null;
  initiator: boolean;
}

const peerLinks = new Map<string, PeerLink>();
let rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
};

function toWsUrl(base: string, token: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  const withWs = trimmed
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:");
  const separator = withWs.includes("?") ? "&" : "?";
  return `${withWs}/ws${separator}token=${encodeURIComponent(token)}`;
}

export function disconnectSyncSignal() {
  activeSession += 1;
  localDeviceId = null;
  if (socket) {
    try {
      socket.close();
    } catch {
      // no-op
    }
  }
  socket = null;
  closeAllPeerLinks();
  useSyncStore.getState().setConnectionState("idle", null);
  useSyncStore.getState().resetPeers();
}

function sendSignal(type: string, toDeviceId: string, payload: unknown, sessionId?: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type,
      to_device_id: toDeviceId,
      session_id: sessionId ?? null,
      payload,
    })
  );
}

function makeSessionId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
}

function closePeerLink(peerId: string) {
  const link = peerLinks.get(peerId);
  if (!link) return;
  try {
    link.channel?.close();
  } catch {
    // no-op
  }
  try {
    link.pc.close();
  } catch {
    // no-op
  }
  peerLinks.delete(peerId);
}

function closeAllPeerLinks() {
  for (const peerId of [...peerLinks.keys()]) {
    closePeerLink(peerId);
  }
}

function sendData(link: PeerLink, message: unknown) {
  if (!link.channel || link.channel.readyState !== "open") return;
  link.channel.send(JSON.stringify(message));
}

function onDataMessage(link: PeerLink, raw: string) {
  let message: any;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  const type = typeof message?.type === "string" ? message.type : "";
  if (type === "sync.request") {
    const snapshot = collectLocalSyncSnapshot();
    sendData(link, { type: "sync.snapshot", payload: snapshot });
    return;
  }

  if (type === "sync.snapshot" || type === "sync.delta") {
    const applied = applyLocalSyncSnapshot(message?.payload ?? null);
    if (applied) {
      useSyncStore.getState().setLastSyncAt(new Date().toISOString());
      sendData(link, { type: "sync.ack", at: new Date().toISOString() });
    }
  }
}

function attachDataChannel(link: PeerLink, channel: RTCDataChannel) {
  link.channel = channel;
  channel.onopen = () => {
    sendData(link, { type: "sync.request", at: new Date().toISOString() });
  };
  channel.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    onDataMessage(link, event.data);
  };
  channel.onerror = () => {
    useSyncStore.getState().setConnectionState("error", "Sync data channel error.");
  };
}

function createPeerLink(peerId: string, initiator: boolean): PeerLink {
  const existing = peerLinks.get(peerId);
  if (existing) return existing;

  const pc = new RTCPeerConnection(rtcConfig);
  const link: PeerLink = { peerId, pc, channel: null, initiator };
  peerLinks.set(peerId, link);

  pc.onicecandidate = (event) => {
    if (!event.candidate) return;
    sendSignal("signal.ice", peerId, { candidate: event.candidate });
  };

  pc.ondatachannel = (event) => {
    attachDataChannel(link, event.channel);
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") {
      closePeerLink(peerId);
    }
  };

  if (initiator) {
    const channel = pc.createDataChannel("arx-sync");
    attachDataChannel(link, channel);
    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendSignal("signal.offer", peerId, { sdp: pc.localDescription });
      } catch {
        closePeerLink(peerId);
      }
    })();
  }

  return link;
}

async function handleSignalOffer(fromDeviceId: string, payload: any) {
  const remote = payload?.sdp;
  if (!remote) return;
  const link = createPeerLink(fromDeviceId, false);
  try {
    await link.pc.setRemoteDescription(new RTCSessionDescription(remote));
    const answer = await link.pc.createAnswer();
    await link.pc.setLocalDescription(answer);
    sendSignal("signal.answer", fromDeviceId, { sdp: link.pc.localDescription });
  } catch {
    closePeerLink(fromDeviceId);
  }
}

async function handleSignalAnswer(fromDeviceId: string, payload: any) {
  const remote = payload?.sdp;
  if (!remote) return;
  const link = peerLinks.get(fromDeviceId);
  if (!link) return;
  try {
    await link.pc.setRemoteDescription(new RTCSessionDescription(remote));
  } catch {
    closePeerLink(fromDeviceId);
  }
}

async function handleSignalIce(fromDeviceId: string, payload: any) {
  const candidate = payload?.candidate;
  if (!candidate) return;
  const link = peerLinks.get(fromDeviceId) ?? createPeerLink(fromDeviceId, false);
  try {
    await link.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch {
    // ignore transient candidate ordering errors
  }
}

async function fetchTurnCredentials(baseUrl: string, token: string): Promise<TurnCredentials | null> {
  try {
    const response = await fetch(`${baseUrl}/turn/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<TurnCredentials>;
    if (!Array.isArray(data.urls) || !data.username || !data.credential) return null;
    return {
      urls: data.urls,
      username: data.username,
      credential: data.credential,
    };
  } catch {
    return null;
  }
}

function reconcilePeers(peers: Array<{ device_id: string }>) {
  if (!localDeviceId) return;

  const peerIds = peers.map((peer) => peer.device_id).filter((id) => id && id !== localDeviceId);

  for (const peerId of peerIds) {
    if (peerLinks.has(peerId)) continue;
    const shouldInitiate = localDeviceId.localeCompare(peerId) < 0;
    createPeerLink(peerId, shouldInitiate);
  }

  const activePeerSet = new Set(peerIds);
  for (const peerId of [...peerLinks.keys()]) {
    if (!activePeerSet.has(peerId)) {
      closePeerLink(peerId);
    }
  }
}

export function connectSyncSignal(params: {
  signalServerUrl: string;
  token: string;
  deviceId: string;
  appVersion: string;
}) {
  const { signalServerUrl, token, deviceId, appVersion } = params;
  if (!signalServerUrl.trim() || !token.trim() || !deviceId.trim()) {
    useSyncStore.getState().setConnectionState("error", "Missing sync configuration or auth token.");
    return;
  }

  activeSession += 1;
  const sessionId = activeSession;
  localDeviceId = deviceId;

  if (socket) {
    try {
      socket.close();
    } catch {
      // no-op
    }
    socket = null;
  }

  useSyncStore.getState().setConnectionState("connecting", null);

  const wsUrl = toWsUrl(signalServerUrl, token);
  const ws = new WebSocket(wsUrl);
  socket = ws;

  ws.onopen = () => {
    if (sessionId !== activeSession) return;
    useSyncStore.getState().setConnectionState("connected", null);
    void (async () => {
      const turn = await fetchTurnCredentials(signalServerUrl, token);
      rtcConfig = turn
        ? {
            iceServers: [
              { urls: ["stun:stun.l.google.com:19302"] },
              { urls: turn.urls, username: turn.username, credential: turn.credential },
            ],
          }
        : {
            iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
          };
    })();
    ws.send(
      JSON.stringify({
        type: "presence.announce",
        device_id: deviceId,
        platform: "desktop",
        app_version: appVersion,
      })
    );
  };

  ws.onmessage = (event) => {
    if (sessionId !== activeSession) return;
    let message: any;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message?.type === "presence.update" && Array.isArray(message.peers)) {
      const peers = message.peers.filter((peer: any) => peer?.device_id && peer.device_id !== localDeviceId);
      useSyncStore.getState().setPeers(peers);
      reconcilePeers(peers);
      return;
    }

    const fromDeviceId = typeof message?.from_device_id === "string" ? message.from_device_id : null;
    if (!fromDeviceId) return;

    if (message?.type === "signal.offer") {
      void handleSignalOffer(fromDeviceId, message?.payload);
      return;
    }
    if (message?.type === "signal.answer") {
      void handleSignalAnswer(fromDeviceId, message?.payload);
      return;
    }
    if (message?.type === "signal.ice") {
      void handleSignalIce(fromDeviceId, message?.payload);
      return;
    }
    if (message?.type === "sync.request" || message?.type === "sync.delta") {
      // Fallback path if peers choose websocket relay instead of data channel.
      const targetLink = peerLinks.get(fromDeviceId);
      if (targetLink?.channel?.readyState === "open") return;
      if (message.type === "sync.request") {
        const snapshot = collectLocalSyncSnapshot();
        sendSignal("sync.delta", fromDeviceId, snapshot, makeSessionId("sync"));
      } else {
        const applied = applyLocalSyncSnapshot(message?.payload ?? null);
        if (applied) useSyncStore.getState().setLastSyncAt(new Date().toISOString());
      }
    }
  };

  ws.onerror = () => {
    if (sessionId !== activeSession) return;
    useSyncStore.getState().setConnectionState("error", "Sync signaling connection error.");
  };

  ws.onclose = () => {
    if (sessionId !== activeSession) return;
    socket = null;
    useSyncStore.getState().setConnectionState("idle", null);
  };
}
