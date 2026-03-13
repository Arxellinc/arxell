# arx sync-signal

WebSocket signaling service for ARX free-tier P2P sync coordination.

## What it does

- Authenticates clients using Clerk OIDC JWTs.
- Tracks per-user device presence.
- Relays signaling payloads between devices in the same user/org.
- Issues TURN credentials for NAT traversal (when configured).

## What it does not do

- Does not store chat/project content.
- Does not decrypt or inspect end-to-end encrypted sync payloads.

## Endpoints

- `GET /health`
- `POST /turn/credentials` (Bearer auth required)
- `WS /ws?token=<bearer_token>`

## Required env vars

- `AUTH_JWKS_URL`
- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_REQUIRED_ORG_ID`

## Optional env vars

- `APP_ORIGIN` (default `*`)
- `AUTH_REQUIRE_EMAIL_VERIFIED` (default `true`)
- `TURN_SHARED_SECRET`
- `TURN_URLS` (comma-separated)
- `TURN_TTL_SECONDS` (default `3600`)

## Run locally

```bash
npm install
npm start
```

## Minimal protocol

Client should first send:

```json
{ "type": "presence.announce", "device_id": "device-123", "platform": "desktop" }
```

Relay messages:

- `signal.offer`
- `signal.answer`
- `signal.ice`
- `sync.request`
- `sync.delta`

with `to_device_id`, optional `session_id`, and `payload`.
