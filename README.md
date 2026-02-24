# CRM Codaro Coding Challenge

# Control Plane API (JS)

Pełne API control plane dla agentów OpenClaw na jednym urządzeniu (MacMini), bez UI.

## Uruchomienie

```bash
npm install
npm run dev
```

Domyślne ustawienia:
- `PORT=8080`
- `HOST=127.0.0.1`
- `DATABASE_URL=./control_plane.db`
- `HEARTBEAT_OFFLINE_SEC=35`

## Endpointy

### Agents
- `POST /api/v1/agents`
- `GET /api/v1/agents`
- `GET /api/v1/agents/:agentId`
- `PATCH /api/v1/agents/:agentId`
- `POST /api/v1/agents/:agentId/heartbeat` (auto-register/upsert)
- `GET /api/v1/agents/:agentId/children`
- `GET /api/v1/agents/tree`

### Tasks
- `POST /api/v1/tasks`
- `GET /api/v1/tasks`
- `GET /api/v1/tasks/:taskId`
- `PATCH /api/v1/tasks/:taskId`
- `POST /api/v1/tasks/:taskId/events`
- `GET /api/v1/tasks/:taskId/events`

### Commands
- `POST /api/v1/agents/:agentId/commands`
- `GET /api/v1/agents/:agentId/commands`
- `GET /api/v1/commands`
- `POST /api/v1/commands/:commandId/ack`

### Alerts
- `POST /api/v1/alerts`
- `GET /api/v1/alerts`
- `POST /api/v1/alerts/:alertId/ack`
- `POST /api/v1/alerts/:alertId/close`

### Operational View / Health
- `GET /api/v1/overview`
- `GET /health/live`
- `GET /health/ready`

## Przykłady

### 1) Auto-rejestracja agenta po heartbeat

```bash
curl -X POST http://127.0.0.1:8080/api/v1/agents/agent-1/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Code Worker 1",
    "role": "worker",
    "status": "busy",
    "capabilities": ["javascript", "refactor"],
    "queue_depth": 2
  }'
```

### 2) Utworzenie taska

```bash
curl -X POST http://127.0.0.1:8080/api/v1/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Analyze repository",
    "assigned_agent_id": "agent-1",
    "status": "queued",
    "priority": "high"
  }'
```

### 3) Widok operacyjny

```bash
curl http://127.0.0.1:8080/api/v1/overview
```
