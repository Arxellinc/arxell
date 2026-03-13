# Railway Premium Setup (Live)

## Deployed project

- Railway project: `arx-premium-cloud`
- Environment: `production`

## Live services

- `premium-api`
- `Postgres`
- `Redis`
- `landing-web`

## Public URLs

- Premium API: `https://premium-api-production-2732.up.railway.app`
- Landing web: `https://landing-web-production-172c.up.railway.app`

## Premium API endpoints

- `GET /health`
- `GET /entitlements/me`
- `POST /billing/create-checkout-session`
- `POST /usage/business-analyst/report-start`
- `POST /billing/webhook/stripe`

## Database schema

Initialized from:

- `cloud/premium-api/sql/001_init.sql`

Tables:

- `premium_users`
- `entitlements`

## Required environment variables (premium-api)

- `DATABASE_URL`
- `APP_ORIGIN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BUSINESS_ANALYST`

Preferred auth (production-grade):

- `AUTH_JWKS_URL`
- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_REQUIRED_ORG_ID`
- `AUTH_REQUIRE_EMAIL_VERIFIED=true`

## Remaining production steps

1. In Stripe, create product/price for Business Analyst: `$29/month` with usage policy `5 reports/month` (quota enforced in app server).
2. Replace placeholder Railway vars:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_BUSINESS_ANALYST`
3. In Stripe webhook settings, add endpoint:
   - `https://premium-api-production-2732.up.railway.app/billing/webhook/stripe`
   Subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Set `APP_ORIGIN` to your real app/site origin(s).
5. Configure identity provider (OIDC) and set `AUTH_*` variables in Railway. After this, premium API will verify bearer JWTs against issuer/audience/JWKS.
6. In the desktop app premium modal:
   - set `Backend URL` to `https://premium-api-production-2732.up.railway.app`
   - use a real OIDC access token from your auth provider.

## Premium Catalog CSV

- Exported: `docs/19_premium_tool_catalog.csv`

## Security notes

- OIDC bearer token verification support is now in `cloud/premium-api/src/index.js` (issuer + audience + JWKS).
- Keep all Stripe secrets only in Railway variables; never ship them in client code.
