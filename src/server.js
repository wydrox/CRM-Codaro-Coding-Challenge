import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  convexAckCommand,
  convexBootstrapDefaultTenant,
  convexAddTaskEvent,
  convexBackendConfigured,
  convexCreateAgent,
  convexCreateApiKey,
  convexCreateAlert,
  convexCreateCommand,
  convexCreateTask,
  convexGetAgent,
  convexGetAlert,
  convexGetCommand,
  convexGetTask,
  convexHeartbeatAgent,
  convexListAgents,
  convexListApiKeys,
  convexListAlerts,
  convexListCommands,
  convexListTaskEvents,
  convexListTasks,
  convexPatchAgent,
  convexPatchAlertStatus,
  convexPatchTask,
  convexResolveApiKey,
  convexRevokeApiKey,
  convexRotateApiKey,
  runWithConvexContext
} from "./convexBackend.js";

const app = express();
app.use(express.json());

function loadDotEnv() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadDotEnv();

const DATA_BACKEND = (process.env.DATA_BACKEND || "convex").toLowerCase();
if (DATA_BACKEND !== "convex") {
  throw new Error("Only Convex backend is supported. Set DATA_BACKEND=convex.");
}

const HEARTBEAT_OFFLINE_SEC = Number(process.env.HEARTBEAT_OFFLINE_SEC || "35");
const PORT = Number(process.env.PORT || "8080");
const HOST = process.env.HOST || "127.0.0.1";
const CONVEX_SYNC_TOKEN = process.env.CONVEX_SYNC_TOKEN || "";
if (!CONVEX_SYNC_TOKEN) {
  throw new Error("CONVEX_SYNC_TOKEN is required.");
}

const AGENT_STATUSES = new Set(["online", "idle", "busy", "blocked", "offline", "error"]);
const AGENT_ROLES = new Set(["worker", "supervisor", "orchestrator"]);
const TASK_STATUSES = new Set(["queued", "running", "blocked", "done", "failed", "cancelled"]);
const TASK_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const COMMAND_TYPES = new Set(["pause", "resume", "cancel_task", "restart", "sync"]);
const COMMAND_STATUSES = new Set(["queued", "delivered", "acked", "failed", "expired"]);
const ALERT_SEVERITIES = new Set(["info", "warn", "critical"]);
const ALERT_STATUSES = new Set(["open", "ack", "closed"]);

const FINAL_TASK_STATUSES = new Set(["done", "failed", "cancelled"]);
const ALLOWED_TRANSITIONS = {
  queued: new Set(["running", "cancelled"]),
  running: new Set(["blocked", "done", "failed", "cancelled"]),
  blocked: new Set(["running", "failed", "cancelled"]),
  done: new Set([]),
  failed: new Set([]),
  cancelled: new Set([])
};

function nowIso() {
  return new Date().toISOString();
}

function extractApiKey(req) {
  const value = req.header("x-api-key");
  if (typeof value !== "string") return "";
  return value.trim();
}

function errorResponse(res, status, code, message, details = {}) {
  return res.status(status).json({ error: { code, message, details } });
}

app.use("/api/v1", async (req, res, next) => {
  try {
    const rawKey = extractApiKey(req);
    if (!rawKey) return errorResponse(res, 401, "UNAUTHORIZED", "Missing X-API-Key header");
    const auth = await convexResolveApiKey(rawKey);
    if (!auth) return errorResponse(res, 401, "UNAUTHORIZED", "Invalid API key");
    req.auth = auth;
    return runWithConvexContext(auth, next);
  } catch (err) {
    return next(err);
  }
});

function parsePaging(query) {
  const limitRaw = Number(query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offsetRaw = Number(query.offset ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  return { limit, offset };
}

function validateSetValue(value, allowed, fieldName) {
  if (value !== undefined && !allowed.has(value)) {
    return `${fieldName} must be one of: ${Array.from(allowed).join(", ")}`;
  }
  return null;
}

function effectiveStatus(agentRow) {
  const last = new Date(agentRow.last_heartbeat_at).getTime();
  const deltaSec = (Date.now() - last) / 1000;
  if (deltaSec > HEARTBEAT_OFFLINE_SEC) return "offline";
  return agentRow.status;
}

function mapAgent(row) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    host: row.host,
    supervisor_id: row.supervisor_id,
    status: effectiveStatus(row),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
    last_heartbeat_at: row.last_heartbeat_at,
    load: row.load,
    queue_depth: row.queue_depth,
    current_task_id: row.current_task_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    version: row.version
  };
}

function mapTask(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assigned_agent_id: row.assigned_agent_id,
    status: row.status,
    progress: row.progress,
    priority: row.priority,
    metadata: row.metadata ?? {},
    created_at: row.created_at,
    updated_at: row.updated_at,
    started_at: row.started_at,
    finished_at: row.finished_at,
    version: row.version
  };
}

function mapTaskEvent(row) {
  return {
    id: row.id,
    task_id: row.task_id,
    agent_id: row.agent_id,
    type: row.type,
    message: row.message,
    payload: row.payload ?? {},
    created_at: row.created_at
  };
}

function mapCommand(row) {
  return {
    id: row.id,
    agent_id: row.agent_id,
    type: row.type,
    payload: row.payload ?? {},
    status: row.status,
    created_by: row.created_by,
    acked_by: row.acked_by,
    ack_message: row.ack_message,
    expires_at: row.expires_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapAlert(row) {
  return {
    id: row.id,
    severity: row.severity,
    type: row.type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    message: row.message,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function buildTree(agentRows) {
  const nodes = new Map();
  const roots = [];
  for (const row of agentRows) {
    nodes.set(row.id, {
      id: row.id,
      name: row.name,
      status: effectiveStatus(row),
      supervisor_id: row.supervisor_id,
      children: []
    });
  }
  for (const row of agentRows) {
    const node = nodes.get(row.id);
    if (row.supervisor_id && nodes.has(row.supervisor_id)) nodes.get(row.supervisor_id).children.push(node);
    else roots.push(node);
  }
  return roots;
}

async function agentExists(agentId) {
  if (!agentId) return false;
  return Boolean(await convexGetAgent(agentId));
}

function validateAgentCreate(body) {
  const payload = {
    id: body.id,
    name: body.name,
    role: body.role ?? "worker",
    host: body.host ?? "openclaw-macmini",
    supervisor_id: body.supervisor_id ?? null,
    status: body.status ?? "online",
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : []
  };
  if (typeof payload.id !== "string" || payload.id.length < 1) return { error: "id is required string" };
  if (typeof payload.name !== "string" || payload.name.length < 1) return { error: "name is required string" };
  if (typeof payload.host !== "string") return { error: "host must be a string" };
  if (payload.supervisor_id !== null && typeof payload.supervisor_id !== "string") return { error: "supervisor_id must be null or string" };
  if (!Array.isArray(payload.capabilities) || payload.capabilities.some((c) => typeof c !== "string")) return { error: "capabilities must be array of strings" };
  const roleError = validateSetValue(payload.role, AGENT_ROLES, "role");
  if (roleError) return { error: roleError };
  const statusError = validateSetValue(payload.status, AGENT_STATUSES, "status");
  if (statusError) return { error: statusError };
  return { payload };
}

function validateAgentPatch(body) {
  const payload = {
    name: body.name,
    role: body.role,
    host: body.host,
    supervisor_id: Object.prototype.hasOwnProperty.call(body, "supervisor_id") ? body.supervisor_id : undefined,
    status: body.status,
    capabilities: body.capabilities,
    load: body.load,
    queue_depth: body.queue_depth,
    current_task_id: Object.prototype.hasOwnProperty.call(body, "current_task_id") ? body.current_task_id : undefined
  };
  if (payload.name !== undefined && typeof payload.name !== "string") return { error: "name must be string" };
  if (payload.host !== undefined && typeof payload.host !== "string") return { error: "host must be string" };
  if (payload.supervisor_id !== undefined && payload.supervisor_id !== null && typeof payload.supervisor_id !== "string") return { error: "supervisor_id must be null or string" };
  if (payload.current_task_id !== undefined && payload.current_task_id !== null && typeof payload.current_task_id !== "string") return { error: "current_task_id must be null or string" };
  if (payload.capabilities !== undefined && (!Array.isArray(payload.capabilities) || payload.capabilities.some((c) => typeof c !== "string"))) return { error: "capabilities must be array of strings" };
  if (payload.load !== undefined && payload.load !== null && typeof payload.load !== "number") return { error: "load must be null or number" };
  if (payload.queue_depth !== undefined && payload.queue_depth !== null && !Number.isInteger(payload.queue_depth)) return { error: "queue_depth must be null or integer" };
  const roleError = validateSetValue(payload.role, AGENT_ROLES, "role");
  if (roleError) return { error: roleError };
  const statusError = validateSetValue(payload.status, AGENT_STATUSES, "status");
  if (statusError) return { error: statusError };
  return { payload };
}

function validateHeartbeat(body) {
  const payload = {
    name: body.name,
    role: body.role ?? "worker",
    host: body.host ?? "openclaw-macmini",
    supervisor_id: body.supervisor_id ?? null,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : [],
    status: body.status ?? "online",
    load: body.load ?? null,
    queue_depth: body.queue_depth ?? null,
    current_task_id: body.current_task_id ?? null
  };
  if (payload.name !== undefined && typeof payload.name !== "string") return { error: "name must be string" };
  if (typeof payload.host !== "string") return { error: "host must be string" };
  if (payload.supervisor_id !== null && typeof payload.supervisor_id !== "string") return { error: "supervisor_id must be null or string" };
  if (!Array.isArray(payload.capabilities) || payload.capabilities.some((c) => typeof c !== "string")) return { error: "capabilities must be array of strings" };
  if (payload.load !== null && typeof payload.load !== "number") return { error: "load must be null or number" };
  if (payload.queue_depth !== null && !Number.isInteger(payload.queue_depth)) return { error: "queue_depth must be null or integer" };
  if (payload.current_task_id !== null && typeof payload.current_task_id !== "string") return { error: "current_task_id must be null or string" };
  const roleError = validateSetValue(payload.role, AGENT_ROLES, "role");
  if (roleError) return { error: roleError };
  const statusError = validateSetValue(payload.status, AGENT_STATUSES, "status");
  if (statusError) return { error: statusError };
  return { payload };
}

function validateTaskCreate(body) {
  const payload = {
    id: body.id ?? randomUUID(),
    title: body.title,
    description: body.description ?? null,
    assigned_agent_id: body.assigned_agent_id ?? null,
    status: body.status ?? "queued",
    progress: body.progress ?? 0,
    priority: body.priority ?? "normal",
    metadata: body.metadata ?? {}
  };
  if (typeof payload.id !== "string" || payload.id.length < 1) return { error: "id must be string" };
  if (typeof payload.title !== "string" || payload.title.length < 1) return { error: "title is required string" };
  if (payload.description !== null && typeof payload.description !== "string") return { error: "description must be null or string" };
  if (payload.assigned_agent_id !== null && typeof payload.assigned_agent_id !== "string") return { error: "assigned_agent_id must be null or string" };
  if (!Number.isInteger(payload.progress) || payload.progress < 0 || payload.progress > 100) return { error: "progress must be integer 0..100" };
  const statusError = validateSetValue(payload.status, TASK_STATUSES, "status");
  if (statusError) return { error: statusError };
  const priorityError = validateSetValue(payload.priority, TASK_PRIORITIES, "priority");
  if (priorityError) return { error: priorityError };
  return { payload };
}

function validateTaskPatch(body) {
  const payload = {
    title: body.title,
    description: Object.prototype.hasOwnProperty.call(body, "description") ? body.description : undefined,
    assigned_agent_id: Object.prototype.hasOwnProperty.call(body, "assigned_agent_id") ? body.assigned_agent_id : undefined,
    status: body.status,
    progress: body.progress,
    priority: body.priority,
    metadata: body.metadata
  };
  if (payload.title !== undefined && (typeof payload.title !== "string" || !payload.title)) return { error: "title must be non-empty string" };
  if (payload.description !== undefined && payload.description !== null && typeof payload.description !== "string") return { error: "description must be null or string" };
  if (payload.assigned_agent_id !== undefined && payload.assigned_agent_id !== null && typeof payload.assigned_agent_id !== "string") return { error: "assigned_agent_id must be null or string" };
  if (payload.progress !== undefined && (!Number.isInteger(payload.progress) || payload.progress < 0 || payload.progress > 100)) return { error: "progress must be integer 0..100" };
  const statusError = validateSetValue(payload.status, TASK_STATUSES, "status");
  if (statusError) return { error: statusError };
  const priorityError = validateSetValue(payload.priority, TASK_PRIORITIES, "priority");
  if (priorityError) return { error: priorityError };
  return { payload };
}

function validateTaskEventCreate(body) {
  const payload = {
    id: body.id ?? randomUUID(),
    agent_id: body.agent_id ?? null,
    type: body.type,
    message: body.message ?? null,
    payload: body.payload ?? {}
  };
  if (typeof payload.id !== "string" || !payload.id) return { error: "id must be string" };
  if (payload.agent_id !== null && typeof payload.agent_id !== "string") return { error: "agent_id must be null or string" };
  if (typeof payload.type !== "string" || !payload.type) return { error: "type is required string" };
  if (payload.message !== null && typeof payload.message !== "string") return { error: "message must be null or string" };
  return { payload };
}

function validateCommandCreate(body) {
  const payload = {
    id: body.id ?? randomUUID(),
    type: body.type,
    payload: body.payload ?? {},
    created_by: body.created_by ?? "operator",
    expires_at: body.expires_at ?? null
  };
  if (typeof payload.id !== "string" || !payload.id) return { error: "id must be string" };
  const typeError = validateSetValue(payload.type, COMMAND_TYPES, "type");
  if (typeError) return { error: typeError };
  if (typeof payload.created_by !== "string" || !payload.created_by) return { error: "created_by must be string" };
  if (payload.expires_at !== null && typeof payload.expires_at !== "string") return { error: "expires_at must be null or ISO string" };
  return { payload };
}

function validateCommandAck(body) {
  const payload = {
    acked_by: body.acked_by ?? "agent",
    ack_message: body.ack_message ?? null,
    status: body.status ?? "acked"
  };
  if (typeof payload.acked_by !== "string" || !payload.acked_by) return { error: "acked_by must be string" };
  if (payload.ack_message !== null && typeof payload.ack_message !== "string") return { error: "ack_message must be null or string" };
  const statusError = validateSetValue(payload.status, COMMAND_STATUSES, "status");
  if (statusError) return { error: statusError };
  return { payload };
}

function validateAlertCreate(body) {
  const payload = {
    id: body.id ?? randomUUID(),
    severity: body.severity,
    type: body.type,
    entity_type: body.entity_type,
    entity_id: body.entity_id,
    message: body.message
  };
  if (typeof payload.id !== "string" || !payload.id) return { error: "id must be string" };
  const sevError = validateSetValue(payload.severity, ALERT_SEVERITIES, "severity");
  if (sevError) return { error: sevError };
  if (typeof payload.type !== "string" || !payload.type) return { error: "type is required string" };
  if (typeof payload.entity_type !== "string" || !payload.entity_type) return { error: "entity_type is required string" };
  if (typeof payload.entity_id !== "string" || !payload.entity_id) return { error: "entity_id is required string" };
  if (typeof payload.message !== "string" || !payload.message) return { error: "message is required string" };
  return { payload };
}

function validateApiKeyCreate(body) {
  const payload = {
    name: body.name ?? "API Key",
    expires_at: Object.prototype.hasOwnProperty.call(body, "expires_at") ? body.expires_at : undefined
  };
  if (typeof payload.name !== "string" || payload.name.length < 1) return { error: "name must be non-empty string" };
  if (payload.expires_at !== undefined && payload.expires_at !== null && typeof payload.expires_at !== "string") return { error: "expires_at must be null or ISO string" };
  return { payload };
}

app.post("/api/v1/auth/api-keys", async (req, res) => {
  const { payload, error } = validateApiKeyCreate(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  const result = await convexCreateApiKey(req.auth.user_id, payload.name, payload.expires_at);
  return res.status(201).json({ key: result.key, raw_key: result.raw_key });
});

app.get("/api/v1/auth/api-keys", async (req, res) => {
  const keys = await convexListApiKeys(req.auth.user_id);
  return res.json(keys);
});

app.post("/api/v1/auth/api-keys/:keyId/rotate", async (req, res) => {
  const result = await convexRotateApiKey(req.auth.user_id, req.params.keyId);
  if (!result) return errorResponse(res, 404, "API_KEY_NOT_FOUND", "API key not found");
  return res.json({ key: result.key, raw_key: result.raw_key });
});

app.post("/api/v1/auth/api-keys/:keyId/revoke", async (req, res) => {
  const key = await convexRevokeApiKey(req.auth.user_id, req.params.keyId);
  if (!key) return errorResponse(res, 404, "API_KEY_NOT_FOUND", "API key not found");
  return res.json({ key });
});

app.post("/api/v1/agents", async (req, res) => {
  const { payload, error } = validateAgentCreate(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (payload.supervisor_id && !(await agentExists(payload.supervisor_id))) return errorResponse(res, 400, "INVALID_SUPERVISOR", "supervisor_id does not exist");
  if (await agentExists(payload.id)) return errorResponse(res, 409, "AGENT_EXISTS", "Agent already exists");
  const ts = nowIso();
  const created = await convexCreateAgent({
    id: payload.id,
    name: payload.name,
    role: payload.role,
    host: payload.host,
    supervisor_id: payload.supervisor_id,
    status: payload.status,
    capabilities: payload.capabilities,
    last_heartbeat_at: ts,
    load: null,
    queue_depth: null,
    current_task_id: null,
    created_at: ts,
    updated_at: ts,
    version: 1
  });
  return res.status(201).json(mapAgent(created));
});

app.get("/api/v1/agents", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  let rows = await convexListAgents();
  if (req.query.status) rows = rows.filter((row) => row.status === String(req.query.status));
  if (req.query.role) rows = rows.filter((row) => row.role === String(req.query.role));
  if (req.query.host) rows = rows.filter((row) => row.host === String(req.query.host));
  if (Object.prototype.hasOwnProperty.call(req.query, "supervisor_id")) {
    rows = req.query.supervisor_id === "null"
      ? rows.filter((row) => row.supervisor_id === null)
      : rows.filter((row) => row.supervisor_id === String(req.query.supervisor_id));
  }
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return res.json(rows.slice(offset, offset + limit).map(mapAgent));
});

app.get("/api/v1/agents/tree", async (_req, res) => {
  const rows = await convexListAgents();
  return res.json(buildTree(rows));
});

app.get("/api/v1/agents/:agentId", async (req, res) => {
  const row = await convexGetAgent(req.params.agentId);
  if (!row) return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  return res.json(mapAgent(row));
});

app.patch("/api/v1/agents/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const existing = await convexGetAgent(agentId);
  if (!existing) return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  const { payload, error } = validateAgentPatch(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (payload.supervisor_id === agentId) return errorResponse(res, 400, "INVALID_SUPERVISOR", "Agent cannot supervise itself");
  if (payload.supervisor_id && !(await agentExists(payload.supervisor_id))) return errorResponse(res, 400, "INVALID_SUPERVISOR", "supervisor_id does not exist");

  const updated = await convexPatchAgent(agentId, payload, {
    has_supervisor_id: Object.prototype.hasOwnProperty.call(req.body, "supervisor_id"),
    has_current_task_id: Object.prototype.hasOwnProperty.call(req.body, "current_task_id"),
    updated_at: nowIso()
  });
  if (!updated) return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  return res.json(mapAgent(updated));
});

app.post("/api/v1/agents/:agentId/heartbeat", async (req, res) => {
  const { agentId } = req.params;
  const { payload, error } = validateHeartbeat(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (payload.supervisor_id && !(await agentExists(payload.supervisor_id))) return errorResponse(res, 400, "INVALID_SUPERVISOR", "supervisor_id does not exist");
  const result = await convexHeartbeatAgent(agentId, payload, nowIso());
  return res.json(mapAgent(result.agent));
});

app.get("/api/v1/agents/:agentId/children", async (req, res) => {
  const exists = await convexGetAgent(req.params.agentId);
  if (!exists) return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  const rows = await convexListAgents();
  return res.json(rows.filter((row) => row.supervisor_id === req.params.agentId).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map(mapAgent));
});

app.post("/api/v1/tasks", async (req, res) => {
  const { payload, error } = validateTaskCreate(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (payload.assigned_agent_id && !(await agentExists(payload.assigned_agent_id))) return errorResponse(res, 400, "AGENT_NOT_FOUND", "assigned_agent_id does not exist");
  if (await convexGetTask(payload.id)) return errorResponse(res, 409, "TASK_EXISTS", "Task already exists");

  const ts = nowIso();
  const task = await convexCreateTask({
    id: payload.id,
    title: payload.title,
    description: payload.description,
    assigned_agent_id: payload.assigned_agent_id,
    status: payload.status,
    progress: payload.progress,
    priority: payload.priority,
    metadata: payload.metadata,
    created_at: ts,
    updated_at: ts,
    started_at: payload.status === "running" ? ts : null,
    finished_at: FINAL_TASK_STATUSES.has(payload.status) ? ts : null,
    version: 1
  });

  await convexAddTaskEvent({
    id: randomUUID(),
    task_id: task.id,
    agent_id: task.assigned_agent_id,
    type: "status_changed",
    message: `Task created with status ${task.status}`,
    payload: { status: task.status, progress: task.progress },
    created_at: ts
  });

  return res.status(201).json(mapTask(task));
});

app.get("/api/v1/tasks", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  let tasks = await convexListTasks();
  if (req.query.status) tasks = tasks.filter((t) => t.status === String(req.query.status));
  if (req.query.assigned_agent_id) tasks = tasks.filter((t) => t.assigned_agent_id === String(req.query.assigned_agent_id));
  if (req.query.priority) tasks = tasks.filter((t) => t.priority === String(req.query.priority));
  if (req.query.supervisor_id) {
    const agents = await convexListAgents();
    const childIds = new Set(agents.filter((a) => a.supervisor_id === String(req.query.supervisor_id)).map((a) => a.id));
    tasks = tasks.filter((t) => t.assigned_agent_id && childIds.has(t.assigned_agent_id));
  }
  tasks.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  return res.json(tasks.slice(offset, offset + limit).map(mapTask));
});

app.get("/api/v1/tasks/:taskId", async (req, res) => {
  const task = await convexGetTask(req.params.taskId);
  if (!task) return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  return res.json(mapTask(task));
});

app.patch("/api/v1/tasks/:taskId", async (req, res) => {
  const existing = await convexGetTask(req.params.taskId);
  if (!existing) return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  const { payload, error } = validateTaskPatch(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (payload.assigned_agent_id && !(await agentExists(payload.assigned_agent_id))) return errorResponse(res, 400, "AGENT_NOT_FOUND", "assigned_agent_id does not exist");
  if (payload.status && !ALLOWED_TRANSITIONS[existing.status]?.has(payload.status)) {
    return errorResponse(res, 409, "INVALID_TASK_TRANSITION", `Invalid transition from ${existing.status} to ${payload.status}`);
  }

  const ts = nowIso();
  const nextStatus = payload.status ?? existing.status;
  const updated = await convexPatchTask(req.params.taskId, {
    title: payload.title,
    description: payload.description,
    assigned_agent_id: payload.assigned_agent_id,
    status: nextStatus,
    progress: payload.progress,
    priority: payload.priority,
    metadata: payload.metadata,
    started_at: existing.started_at ?? (nextStatus === "running" ? ts : null),
    finished_at: FINAL_TASK_STATUSES.has(nextStatus) ? (existing.finished_at ?? ts) : null
  }, {
    has_description: Object.prototype.hasOwnProperty.call(req.body, "description"),
    has_assigned_agent_id: Object.prototype.hasOwnProperty.call(req.body, "assigned_agent_id"),
    updated_at: ts
  });
  if (!updated) return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");

  await convexAddTaskEvent({
    id: randomUUID(),
    task_id: updated.id,
    agent_id: updated.assigned_agent_id,
    type: "status_changed",
    message: `Task updated to status ${updated.status}`,
    payload: { status: updated.status, progress: updated.progress },
    created_at: ts
  });

  return res.json(mapTask(updated));
});

app.post("/api/v1/tasks/:taskId/events", async (req, res) => {
  const task = await convexGetTask(req.params.taskId);
  if (!task) return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  const { payload, error } = validateTaskEventCreate(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (payload.agent_id && !(await agentExists(payload.agent_id))) return errorResponse(res, 400, "AGENT_NOT_FOUND", "agent_id does not exist");
  const event = await convexAddTaskEvent({
    id: payload.id,
    task_id: req.params.taskId,
    agent_id: payload.agent_id,
    type: payload.type,
    message: payload.message,
    payload: payload.payload,
    created_at: nowIso()
  });
  return res.status(201).json(mapTaskEvent(event));
});

app.get("/api/v1/tasks/:taskId/events", async (req, res) => {
  const task = await convexGetTask(req.params.taskId);
  if (!task) return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  const events = await convexListTaskEvents(req.params.taskId);
  return res.json(events.map(mapTaskEvent));
});

app.post("/api/v1/agents/:agentId/commands", async (req, res) => {
  const agent = await convexGetAgent(req.params.agentId);
  if (!agent) return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  const { payload, error } = validateCommandCreate(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (await convexGetCommand(payload.id)) return errorResponse(res, 409, "COMMAND_EXISTS", "Command already exists");
  const ts = nowIso();
  const command = await convexCreateCommand({
    id: payload.id,
    agent_id: req.params.agentId,
    type: payload.type,
    payload: payload.payload,
    status: "queued",
    created_by: payload.created_by,
    acked_by: null,
    ack_message: null,
    expires_at: payload.expires_at,
    created_at: ts,
    updated_at: ts
  });
  return res.status(201).json(mapCommand(command));
});

app.get("/api/v1/agents/:agentId/commands", async (req, res) => {
  const agent = await convexGetAgent(req.params.agentId);
  if (!agent) return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  const { limit, offset } = parsePaging(req.query);
  let commands = await convexListCommands();
  commands = commands.filter((c) => c.agent_id === req.params.agentId);
  if (req.query.status) commands = commands.filter((c) => c.status === String(req.query.status));
  commands.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return res.json(commands.slice(offset, offset + limit).map(mapCommand));
});

app.get("/api/v1/commands", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  let commands = await convexListCommands();
  if (req.query.agent_id) commands = commands.filter((c) => c.agent_id === String(req.query.agent_id));
  if (req.query.status) commands = commands.filter((c) => c.status === String(req.query.status));
  if (req.query.type) commands = commands.filter((c) => c.type === String(req.query.type));
  commands.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return res.json(commands.slice(offset, offset + limit).map(mapCommand));
});

app.post("/api/v1/commands/:commandId/ack", async (req, res) => {
  const command = await convexGetCommand(req.params.commandId);
  if (!command) return errorResponse(res, 404, "COMMAND_NOT_FOUND", "Command not found");
  const { payload, error } = validateCommandAck(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  const updated = await convexAckCommand(req.params.commandId, payload.acked_by, payload.ack_message, payload.status, nowIso());
  if (!updated) return errorResponse(res, 404, "COMMAND_NOT_FOUND", "Command not found");
  return res.json(mapCommand(updated));
});

app.post("/api/v1/alerts", async (req, res) => {
  const { payload, error } = validateAlertCreate(req.body);
  if (error) return errorResponse(res, 400, "VALIDATION_ERROR", error);
  if (await convexGetAlert(payload.id)) return errorResponse(res, 409, "ALERT_EXISTS", "Alert already exists");
  const ts = nowIso();
  const alert = await convexCreateAlert({
    id: payload.id,
    severity: payload.severity,
    type: payload.type,
    entity_type: payload.entity_type,
    entity_id: payload.entity_id,
    message: payload.message,
    status: "open",
    created_at: ts,
    updated_at: ts
  });
  return res.status(201).json(mapAlert(alert));
});

app.get("/api/v1/alerts", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  let alerts = await convexListAlerts();
  if (req.query.status) alerts = alerts.filter((a) => a.status === String(req.query.status));
  if (req.query.severity) alerts = alerts.filter((a) => a.severity === String(req.query.severity));
  if (req.query.type) alerts = alerts.filter((a) => a.type === String(req.query.type));
  alerts.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return res.json(alerts.slice(offset, offset + limit).map(mapAlert));
});

app.post("/api/v1/alerts/:alertId/ack", async (req, res) => {
  const alert = await convexGetAlert(req.params.alertId);
  if (!alert) return errorResponse(res, 404, "ALERT_NOT_FOUND", "Alert not found");
  if (alert.status === "closed") return errorResponse(res, 409, "ALERT_ALREADY_CLOSED", "Closed alert cannot be acknowledged");
  const updated = await convexPatchAlertStatus(req.params.alertId, "ack", nowIso());
  return res.json(mapAlert(updated));
});

app.post("/api/v1/alerts/:alertId/close", async (req, res) => {
  const alert = await convexGetAlert(req.params.alertId);
  if (!alert) return errorResponse(res, 404, "ALERT_NOT_FOUND", "Alert not found");
  const updated = await convexPatchAlertStatus(req.params.alertId, "closed", nowIso());
  return res.json(mapAlert(updated));
});

app.get("/api/v1/overview", async (_req, res) => {
  const agents = await convexListAgents();
  const tasks = await convexListTasks();
  const alerts = await convexListAlerts();

  const activeTasks = tasks
    .filter((task) => ["queued", "running", "blocked"].includes(task.status))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      progress: task.progress,
      assigned_agent_id: task.assigned_agent_id,
      priority: task.priority,
      updated_at: task.updated_at
    }));

  let online = 0;
  let offline = 0;
  for (const row of agents) {
    if (effectiveStatus(row) === "offline") offline += 1;
    else online += 1;
  }

  let running = 0;
  let blocked = 0;
  for (const task of activeTasks) {
    if (task.status === "running") running += 1;
    if (task.status === "blocked") blocked += 1;
  }

  const openAlerts = alerts.filter((a) => a.status === "open");
  const criticalOpenAlerts = openAlerts.filter((a) => a.severity === "critical");

  return res.json({
    snapshot_at: nowIso(),
    agents_tree: buildTree(agents),
    active_tasks: activeTasks,
    aggregates: {
      agents_online: online,
      agents_offline: offline,
      tasks_active: activeTasks.length,
      tasks_running: running,
      tasks_blocked: blocked,
      alerts_open: openAlerts.length,
      alerts_critical: criticalOpenAlerts.length,
      heartbeat_offline_threshold_sec: HEARTBEAT_OFFLINE_SEC
    }
  });
});

app.post("/api/v1/convex/sync/agents", async (_req, res) => {
  const agents = await convexListAgents();
  return res.json({
    convex_sync_enabled: convexBackendConfigured(),
    agents_count: agents.length,
    result: { skipped: true, reason: "convex_is_primary_backend" }
  });
});

app.get("/health/live", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await convexBootstrapDefaultTenant(null);
    return res.json({ status: "ready" });
  } catch {
    return errorResponse(res, 503, "CONVEX_NOT_READY", "Convex backend not ready");
  }
});

async function start() {
  const bootstrap = await convexBootstrapDefaultTenant(process.env.BOOTSTRAP_API_KEY || null);
  if (bootstrap?.created_api_key) {
    // eslint-disable-next-line no-console
    console.log(`Bootstrap API key (store safely): ${bootstrap.created_api_key}`);
  }

  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`Control Plane API (convex) listening on ${HOST}:${PORT}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start Control Plane API", err);
  process.exit(1);
});
