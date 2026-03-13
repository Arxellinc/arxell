import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { createRemoteJWKSet, jwtVerify } from "jose";
import pg from "pg";
import Stripe from "stripe";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_BUSINESS_ANALYST",
  "APP_ORIGIN",
  "AUTH_JWKS_URL",
  "AUTH_ISSUER",
  "AUTH_AUDIENCE",
  "AUTH_REQUIRED_ORG_ID"
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    // Keep startup strict to avoid insecure partial config in production.
    throw new Error(`Missing required env var: ${key}`);
  }
}

const {
  DATABASE_URL,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_BUSINESS_ANALYST,
  STRIPE_PRICE_COMMERCIAL_LICENSE = "",
  APP_ORIGIN,
  AUTH_JWKS_URL,
  AUTH_ISSUER,
  AUTH_AUDIENCE,
  AUTH_REQUIRED_ORG_ID,
  AUTH_REQUIRE_EMAIL_VERIFIED = "true",
  ALLOW_LIVE_TEST_DISCOUNTS = "false",
  TEST_PROMO_CODE_ALLOWLIST = "",
  NODE_ENV = "development",
  PORT = "3000"
} = process.env;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" });
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: NODE_ENV === "production" ? { rejectUnauthorized: false } : false });
const app = express();

app.use(helmet());
app.use(cors({ origin: APP_ORIGIN, credentials: false }));

const oidcIssuer = AUTH_ISSUER.split(",").map((v) => v.trim()).filter(Boolean);
const oidcAudience = AUTH_AUDIENCE.split(",").map((v) => v.trim()).filter(Boolean);
const jwks = createRemoteJWKSet(new URL(AUTH_JWKS_URL));

function parseAllowList(value) {
  return new Set(
    value
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
}

const promoCodeAllowList = parseAllowList(TEST_PROMO_CODE_ALLOWLIST);

function readBearer(req) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

async function decodeUserToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: oidcIssuer.length === 1 ? oidcIssuer[0] : oidcIssuer,
      audience: oidcAudience.length === 1 ? oidcAudience[0] : oidcAudience,
      clockTolerance: 5
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    const email =
      typeof payload.email === "string"
        ? payload.email
        : typeof payload.upn === "string"
          ? payload.upn
          : null;
    const emailVerified = payload.email_verified;
    const orgId =
      typeof payload.org_id === "string"
        ? payload.org_id
        : payload.org && typeof payload.org === "object" && typeof payload.org.id === "string"
          ? payload.org.id
          : null;
    if (!sub || !email) return null;
    if (orgId !== AUTH_REQUIRED_ORG_ID) return null;
    if (
      AUTH_REQUIRE_EMAIL_VERIFIED === "true" &&
      emailVerified !== true &&
      emailVerified !== "true" &&
      emailVerified !== 1
    ) {
      return null;
    }
    return { sub, email, org_id: orgId };
  } catch {
    return null;
  }
}

async function getOrCreateUser(auth) {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `select id, email, stripe_customer_id from premium_users where external_subject = $1 limit 1`,
      [auth.sub]
    );
    if (existing.rowCount > 0) return existing.rows[0];

    const customer = await stripe.customers.create({ email: auth.email, metadata: { external_subject: auth.sub } });
    const inserted = await client.query(
      `insert into premium_users (external_subject, email, stripe_customer_id)
       values ($1, $2, $3)
       returning id, email, stripe_customer_id`,
      [auth.sub, auth.email, customer.id]
    );
    return inserted.rows[0];
  } finally {
    client.release();
  }
}

async function getBusinessEntitlement(userId) {
  const { rows } = await pool.query(
    `select active, quota_limit, quota_used, period_end_iso
     from entitlements
     where user_id = $1 and tool_key = 'business_analyst'
     limit 1`,
    [userId]
  );
  if (rows.length === 0) {
    return { tool_key: "business_analyst", active: false, quota_limit: 5, quota_used: 0, period_end_iso: null };
  }
  return { tool_key: "business_analyst", ...rows[0] };
}

async function getCommercialEntitlement(userId) {
  const { rows } = await pool.query(
    `select active, quota_limit, quota_used, period_end_iso
     from entitlements
     where user_id = $1 and tool_key = 'commercial_license'
     limit 1`,
    [userId]
  );
  if (rows.length === 0) {
    return { tool_key: "commercial_license", active: false, quota_limit: 1, quota_used: 0, period_end_iso: null };
  }
  return { tool_key: "commercial_license", ...rows[0] };
}

function mapSubscriptionToToolKey(subscription) {
  const linePriceIds = (subscription.items?.data ?? [])
    .map((item) => item?.price?.id)
    .filter((value) => typeof value === "string");
  if (linePriceIds.includes(STRIPE_PRICE_BUSINESS_ANALYST)) return "business_analyst";
  if (STRIPE_PRICE_COMMERCIAL_LICENSE && linePriceIds.includes(STRIPE_PRICE_COMMERCIAL_LICENSE)) return "commercial_license";
  return "business_analyst";
}

async function requireAuth(req, res, next) {
  const token = readBearer(req);
  const auth = await decodeUserToken(token);
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

app.post("/billing/webhook/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    res.status(400).send(`Webhook Error: ${error.message}`);
    return;
  }

  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.deleted"
  ) {
    const subscription =
      event.type === "checkout.session.completed"
        ? await stripe.subscriptions.retrieve(event.data.object.subscription)
        : event.data.object;

    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
    const active = ["trialing", "active", "past_due"].includes(subscription.status);
    const periodEndIso = new Date(subscription.current_period_end * 1000).toISOString();
    const toolKey = mapSubscriptionToToolKey(subscription);
    const quotaLimit = toolKey === "commercial_license" ? 1 : 5;

    const { rows } = await pool.query(`select id from premium_users where stripe_customer_id = $1 limit 1`, [customerId]);
    if (rows.length > 0) {
      const userId = rows[0].id;
      await pool.query(
        `insert into entitlements (user_id, tool_key, active, quota_limit, quota_used, period_end_iso)
         values ($1, $2, $3, $4, 0, $5)
         on conflict (user_id, tool_key)
         do update set
           active = excluded.active,
           quota_limit = excluded.quota_limit,
           quota_used = case
             when entitlements.period_end_iso::date <> excluded.period_end_iso::date then 0
             else entitlements.quota_used
           end,
           period_end_iso = excluded.period_end_iso`,
        [userId, toolKey, active, quotaLimit, periodEndIso]
      );
    }
  }

  res.json({ received: true });
});

app.use(express.json({ limit: "1mb" }));

app.get("/entitlements/me", requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.auth);
  const business = await getBusinessEntitlement(user.id);
  const commercial = await getCommercialEntitlement(user.id);
  res.json({ entitlements: [business, commercial] });
});

app.post("/billing/create-checkout-session", requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.auth);
  const requestedTool = req.body?.tool === "commercial_license" ? "commercial_license" : "business_analyst";
  const requestedPromoCode = requestedTool === "business_analyst" && typeof req.body?.promo_code === "string"
    ? req.body.promo_code.trim()
    : "";
  const targetPrice = requestedTool === "commercial_license" ? STRIPE_PRICE_COMMERCIAL_LICENSE : STRIPE_PRICE_BUSINESS_ANALYST;
  if (!targetPrice) {
    res.status(503).json({ error: "Selected checkout plan is not configured yet." });
    return;
  }

  let discounts;
  if (requestedPromoCode) {
    if (ALLOW_LIVE_TEST_DISCOUNTS !== "true") {
      res.status(403).json({ error: "Promo codes are disabled." });
      return;
    }
    if (!promoCodeAllowList.has(requestedPromoCode.toLowerCase())) {
      res.status(403).json({ error: "Promo code is not allowlisted." });
      return;
    }

    const codeList = await stripe.promotionCodes.list({
      code: requestedPromoCode,
      active: true,
      limit: 1
    });
    const promotionCodeId = codeList.data[0]?.id;
    if (!promotionCodeId) {
      res.status(400).json({ error: "Promo code is invalid or inactive." });
      return;
    }
    discounts = [{ promotion_code: promotionCodeId }];
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: user.stripe_customer_id,
    line_items: [{ price: targetPrice, quantity: 1 }],
    success_url: `${APP_ORIGIN}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_ORIGIN}/billing/cancelled`,
    metadata: { tool_key: requestedTool },
    discounts
  });
  res.json({ checkout_url: session.url });
});

app.get("/licensing/commercial/status", requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.auth);
  const entitlement = await getCommercialEntitlement(user.id);
  res.json({
    entitlement: {
      ...entitlement,
      plan: "commercial_license_monthly",
      price_label: "$49/mo",
    },
  });
});

app.post("/licensing/commercial/create-checkout-session", requireAuth, async (req, res) => {
  if (!STRIPE_PRICE_COMMERCIAL_LICENSE) {
    res.status(503).json({ error: "Commercial license price is not configured." });
    return;
  }
  const user = await getOrCreateUser(req.auth);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: user.stripe_customer_id,
    line_items: [{ price: STRIPE_PRICE_COMMERCIAL_LICENSE, quantity: 1 }],
    success_url: `${APP_ORIGIN}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_ORIGIN}/billing/cancelled`,
    metadata: { tool_key: "commercial_license" },
  });
  res.json({ checkout_url: session.url });
});

app.post("/usage/business-analyst/report-start", requireAuth, async (req, res) => {
  const user = await getOrCreateUser(req.auth);
  const entitlement = await getBusinessEntitlement(user.id);
  const remaining = Math.max(0, Number(entitlement.quota_limit) - Number(entitlement.quota_used));

  if (!entitlement.active || remaining < 1) {
    res.status(402).json({
      allowed: false,
      reason: entitlement.active ? "quota_exhausted" : "inactive_subscription",
      entitlement
    });
    return;
  }

  await pool.query(
    `update entitlements
     set quota_used = quota_used + 1
     where user_id = $1 and tool_key = 'business_analyst'`,
    [user.id]
  );

  const updated = await getBusinessEntitlement(user.id);
  res.json({ allowed: true, entitlement: updated });
});

app.listen(Number(PORT), () => {
  // eslint-disable-next-line no-console
  console.log(`arx-premium-api listening on ${PORT}`);
});
