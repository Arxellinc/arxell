# arx premium api

Railway-hosted API for premium tool billing and entitlement checks.

## Endpoints

- `GET /health`
- `GET /entitlements/me`
- `POST /billing/create-checkout-session`
- `POST /usage/business-analyst/report-start`
- `POST /billing/webhook/stripe`

## Required env vars

- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_BUSINESS_ANALYST`
- `APP_ORIGIN`

Auth (preferred):

- `AUTH_JWKS_URL`
- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_REQUIRED_ORG_ID`
- `AUTH_REQUIRE_EMAIL_VERIFIED` (`true` by default)

## Local run

```bash
npm install
npm start
```

Use a real OIDC bearer token in the app Premium modal (`Access token`).

## Database bootstrap

Run `sql/001_init.sql` against your Railway Postgres instance.
