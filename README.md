# Control Plane API (Convex-only)

API control plane dla agentów OpenClaw, działające wyłącznie na Convex (bez SQLite).

## Setup

1. Zainstaluj zależności:

```bash
npm install
```

2. Skonfiguruj `.env`:

```bash
DATA_BACKEND=convex
PORT=8080
HOST=127.0.0.1
HEARTBEAT_OFFLINE_SEC=35
CONVEX_SYNC_URL=https://hearty-chinchilla-856.eu-west-1.convex.site
CONVEX_API_PATH=/control-plane-api
CONVEX_SYNC_PATH=/control-plane-sync
CONVEX_SYNC_TOKEN=change-me-strong-token
CONVEX_SYNC_TIMEOUT_MS=5000
```

3. Uruchom API:

```bash
npm start
```

Przy pierwszym uruchomieniu serwer bootstrappuje domyślną organizację/użytkownika i może wypisać jednorazowy klucz API w logu (`Bootstrap API key ...`).

## Auth

Każde żądanie do `/api/v1/*` wymaga nagłówka:

```http
X-API-Key: <twoj_klucz>
```

`/health/*` nie wymaga auth.

## OpenClaw heartbeat

OpenClaw powinien wysyłać heartbeat:

- `POST http://127.0.0.1:8080/api/v1/agents/{agent_id}/heartbeat`
- `Content-Type: application/json`
- interwał: np. `10s`

Body:

```json
{
  "name": "{agent_name}",
  "role": "{agent_role}",
  "status": "busy",
  "capabilities": ["openclaw"],
  "supervisor_id": null
}
```

## Endpointy dostępne

- `POST /api/v1/agents`
- `GET /api/v1/agents`
- `GET /api/v1/agents/:agentId`
- `PATCH /api/v1/agents/:agentId`
- `POST /api/v1/agents/:agentId/heartbeat`
- `GET /api/v1/agents/:agentId/children`
- `GET /api/v1/agents/tree`
- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId`
- `POST /api/v1/tasks/:taskId/events`
- `GET /api/v1/tasks/:taskId/events`
- `POST /api/v1/agents/:agentId/commands`
- `GET /api/v1/agents/:agentId/commands`
- `GET /api/v1/commands`
- `POST /api/v1/commands/:commandId/ack`
- `POST /api/v1/alerts`
- `GET /api/v1/alerts`
- `POST /api/v1/alerts/:alertId/ack`
- `POST /api/v1/alerts/:alertId/close`
- `GET /api/v1/overview`
- `POST /api/v1/convex/sync/agents`
- `POST /api/v1/auth/api-keys`
- `GET /api/v1/auth/api-keys`
- `POST /api/v1/auth/api-keys/:keyId/rotate`
- `POST /api/v1/auth/api-keys/:keyId/revoke`
- `GET /health/live`
- `GET /health/ready`

## Convex files

Pliki Convex w repo:

- `convex/schema.ts`
- `convex/controlPlane.ts`
- `convex/http.ts`

Po zmianach w `convex/` wypchnij je:

```bash
npx convex dev --once
```
