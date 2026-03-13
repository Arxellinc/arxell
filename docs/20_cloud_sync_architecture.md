# Cloud Sync Architecture (Phase 1)

## Goals

- Free tier: P2P sync coordination only (no server-side plaintext storage).
- Commercial tier: encrypted cloud sync storage (future phase).

## Implemented in this phase

### 1. `cloud/sync-signal`

A new Railway-deployable signaling service with:

- OIDC JWT auth via Clerk JWKS (`AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`).
- Org restriction (`AUTH_REQUIRED_ORG_ID`).
- Presence tracking per authenticated user.
- Signal relay for device-to-device messages:
  - `signal.offer`
  - `signal.answer`
  - `signal.ice`
  - `sync.request`
  - `sync.delta`
- TURN credential endpoint:
  - `POST /turn/credentials` using `TURN_SHARED_SECRET` + `TURN_URLS`.

### 2. Frontend sync state skeleton

`src/store/syncStore.ts` provides:

- Persistent `deviceId`.
- `mode`: `off | p2p | cloud`.
- Signal server URL config.
- Peer presence state.
- Connection status and last sync timestamps.

## Next phases

1. Add UI controls for sync mode, linked devices, and connection status.
2. Implement WebSocket signaling client + WebRTC data channel transport.
3. Implement encrypted op-log replication (`chat`, `projects`, `tasks`, `notes`).
4. Add commercial encrypted cloud storage path and license-gated mode switch.
