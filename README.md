# CRM Codaro Coding Challenge

# Control Plane API (JS)

Pełne API control plane dla agentów OpenClaw na jednym urządzeniu (MacMini), bez UI.

## Setup Instructions (GitHub)

### 1. Prerequisites
- `Node.js >= 20`
- `npm >= 10`
- `git`

### 2. Clone repository
```bash
git clone git@github.com:wydrox/CRM-Codaro-Coding-Challenge.git
cd CRM-Codaro-Coding-Challenge
```

### 3. Install dependencies
```bash
npm install
```

### 4. Configure environment
Utwórz plik `.env` (opcjonalnie, wartości domyślne działają od razu):
```bash
PORT=8080
HOST=127.0.0.1
DATABASE_URL=./control_plane.db
HEARTBEAT_OFFLINE_SEC=35
```

### 5. Run locally (development)
```bash
npm run dev
```

### 6. Run in production mode
```bash
npm start
```

### 7. Smoke test
```bash
curl http://127.0.0.1:8080/health/live
curl http://127.0.0.1:8080/health/ready
```

Oczekiwane odpowiedzi:
- `{"status":"ok"}`
- `{"status":"ready"}`

### 8. OpenClaw integration (agent auto-registration)
Po starcie agenta w OpenClaw wywołuj heartbeat:
```bash
curl -X POST http://127.0.0.1:8080/api/v1/agents/<agent_id>/heartbeat \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Worker 1",
    "role": "worker",
    "status": "busy",
    "capabilities": ["javascript"],
    "supervisor_id": null
  }'
```

Agent pojawi się automatycznie w Control Plane bez ręcznego `POST /agents`.

## Runtime configuration
Domyślne ustawienia:
- `PORT=8080`
- `HOST=127.0.0.1`
- `DATABASE_URL=./control_plane.db`
- `HEARTBEAT_OFFLINE_SEC=35`

## API Endpoints

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

## Quick Examples

### 1) Auto-register agent by heartbeat

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

### 2) Create task

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

### 3) Operational overview

```bash
curl http://127.0.0.1:8080/api/v1/overview
```
