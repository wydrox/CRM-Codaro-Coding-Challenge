import express from "express";
import { randomUUID } from "node:crypto";
import { createDb } from "./db.js";

const app = express();
app.use(express.json());

const HEARTBEAT_OFFLINE_SEC = Number(process.env.HEARTBEAT_OFFLINE_SEC || "35");
const PORT = Number(process.env.PORT || "8080");
const HOST = process.env.HOST || "127.0.0.1";

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

const db = await createDb();

function nowIso() {
  return new Date().toISOString();
}

function okJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function errorResponse(res, status, code, message, details = {}) {
  return res.status(status).json({
    error: {
      code,
      message,
      details
    }
  });
}

function parsePaging(query) {
  const limitRaw = Number(query.limit ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offsetRaw = Number(query.offset ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  return { limit, offset };
}

function effectiveStatus(agentRow) {
  const now = Date.now();
  const last = new Date(agentRow.last_heartbeat_at).getTime();
  const deltaSec = (now - last) / 1000;
  if (deltaSec > HEARTBEAT_OFFLINE_SEC) {
    return "offline";
  }
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
    capabilities: okJson(row.capabilities, []),
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
    metadata: okJson(row.metadata, {}),
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
    payload: okJson(row.payload, {}),
    created_at: row.created_at
  };
}

function mapCommand(row) {
  return {
    id: row.id,
    agent_id: row.agent_id,
    type: row.type,
    payload: okJson(row.payload, {}),
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
    if (row.supervisor_id && nodes.has(row.supervisor_id)) {
      nodes.get(row.supervisor_id).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

async function agentExists(agentId) {
  if (!agentId) {
    return false;
  }
  const row = await db.get("SELECT id FROM agents WHERE id = ?", [agentId]);
  return Boolean(row);
}

function validateSetValue(value, allowed, fieldName) {
  if (value !== undefined && !allowed.has(value)) {
    return `${fieldName} must be one of: ${Array.from(allowed).join(", ")}`;
  }
  return null;
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

  if (payload.name !== undefined && typeof payload.name !== "string") {
    return { error: "name must be a string" };
  }
  if (typeof payload.host !== "string") {
    return { error: "host must be a string" };
  }
  if (payload.supervisor_id !== null && typeof payload.supervisor_id !== "string") {
    return { error: "supervisor_id must be null or string" };
  }
  if (!Array.isArray(payload.capabilities) || payload.capabilities.some((c) => typeof c !== "string")) {
    return { error: "capabilities must be array of strings" };
  }
  if (payload.load !== null && typeof payload.load !== "number") {
    return { error: "load must be null or number" };
  }
  if (payload.queue_depth !== null && !Number.isInteger(payload.queue_depth)) {
    return { error: "queue_depth must be null or integer" };
  }
  if (payload.current_task_id !== null && typeof payload.current_task_id !== "string") {
    return { error: "current_task_id must be null or string" };
  }

  const roleError = validateSetValue(payload.role, AGENT_ROLES, "role");
  if (roleError) {
    return { error: roleError };
  }
  const statusError = validateSetValue(payload.status, AGENT_STATUSES, "status");
  if (statusError) {
    return { error: statusError };
  }

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

  if (typeof payload.id !== "string") {
    return { error: "id must be a string" };
  }
  if (typeof payload.title !== "string" || payload.title.trim() === "") {
    return { error: "title is required" };
  }
  if (payload.description !== null && typeof payload.description !== "string") {
    return { error: "description must be null or string" };
  }
  if (payload.assigned_agent_id !== null && typeof payload.assigned_agent_id !== "string") {
    return { error: "assigned_agent_id must be null or string" };
  }
  if (!Number.isInteger(payload.progress) || payload.progress < 0 || payload.progress > 100) {
    return { error: "progress must be integer in range 0..100" };
  }
  if (payload.metadata === null || typeof payload.metadata !== "object" || Array.isArray(payload.metadata)) {
    return { error: "metadata must be an object" };
  }

  const statusError = validateSetValue(payload.status, TASK_STATUSES, "status");
  if (statusError) {
    return { error: statusError };
  }
  const priorityError = validateSetValue(payload.priority, TASK_PRIORITIES, "priority");
  if (priorityError) {
    return { error: priorityError };
  }

  return { payload };
}

function validateTaskPatch(body) {
  const payload = {
    title: body.title,
    description: body.description,
    assigned_agent_id: Object.prototype.hasOwnProperty.call(body, "assigned_agent_id")
      ? body.assigned_agent_id
      : undefined,
    status: body.status,
    progress: body.progress,
    priority: body.priority,
    metadata: body.metadata
  };

  if (payload.title !== undefined && (typeof payload.title !== "string" || payload.title.trim() === "")) {
    return { error: "title must be non-empty string" };
  }
  if (
    payload.description !== undefined &&
    payload.description !== null &&
    typeof payload.description !== "string"
  ) {
    return { error: "description must be null or string" };
  }
  if (
    payload.assigned_agent_id !== undefined &&
    payload.assigned_agent_id !== null &&
    typeof payload.assigned_agent_id !== "string"
  ) {
    return { error: "assigned_agent_id must be null or string" };
  }
  if (payload.progress !== undefined && (!Number.isInteger(payload.progress) || payload.progress < 0 || payload.progress > 100)) {
    return { error: "progress must be integer in range 0..100" };
  }
  if (
    payload.metadata !== undefined &&
    (payload.metadata === null || typeof payload.metadata !== "object" || Array.isArray(payload.metadata))
  ) {
    return { error: "metadata must be an object" };
  }

  const statusError = validateSetValue(payload.status, TASK_STATUSES, "status");
  if (statusError) {
    return { error: statusError };
  }
  const priorityError = validateSetValue(payload.priority, TASK_PRIORITIES, "priority");
  if (priorityError) {
    return { error: priorityError };
  }

  return { payload };
}

function validateTaskEvent(body) {
  const payload = {
    agent_id: body.agent_id ?? null,
    type: body.type,
    message: body.message ?? null,
    payload: body.payload ?? {}
  };

  if (payload.agent_id !== null && typeof payload.agent_id !== "string") {
    return { error: "agent_id must be null or string" };
  }
  if (typeof payload.type !== "string" || payload.type.trim() === "") {
    return { error: "type is required" };
  }
  if (payload.message !== null && typeof payload.message !== "string") {
    return { error: "message must be null or string" };
  }
  if (payload.payload === null || typeof payload.payload !== "object" || Array.isArray(payload.payload)) {
    return { error: "payload must be object" };
  }

  return { payload };
}

function validateCommandCreate(body) {
  const payload = {
    type: body.type,
    payload: body.payload ?? {},
    created_by: body.created_by ?? "operator",
    expires_at: body.expires_at ?? null
  };

  const typeError = validateSetValue(payload.type, COMMAND_TYPES, "type");
  if (typeError) {
    return { error: typeError };
  }
  if (payload.payload === null || typeof payload.payload !== "object" || Array.isArray(payload.payload)) {
    return { error: "payload must be object" };
  }
  if (typeof payload.created_by !== "string" || payload.created_by.trim() === "") {
    return { error: "created_by must be non-empty string" };
  }
  if (payload.expires_at !== null && Number.isNaN(Date.parse(payload.expires_at))) {
    return { error: "expires_at must be ISO datetime or null" };
  }

  return { payload };
}

function validateCommandAck(body) {
  const payload = {
    status: body.status ?? "acked",
    acked_by: body.acked_by ?? "agent",
    message: body.message ?? null
  };

  if (!new Set(["acked", "failed", "expired"]).has(payload.status)) {
    return { error: "status must be one of: acked, failed, expired" };
  }
  if (typeof payload.acked_by !== "string" || payload.acked_by.trim() === "") {
    return { error: "acked_by must be non-empty string" };
  }
  if (payload.message !== null && typeof payload.message !== "string") {
    return { error: "message must be null or string" };
  }

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

  if (typeof payload.id !== "string") {
    return { error: "id must be string" };
  }
  const severityError = validateSetValue(payload.severity, ALERT_SEVERITIES, "severity");
  if (severityError) {
    return { error: severityError };
  }
  if (typeof payload.type !== "string" || payload.type.trim() === "") {
    return { error: "type is required" };
  }
  if (typeof payload.entity_type !== "string" || payload.entity_type.trim() === "") {
    return { error: "entity_type is required" };
  }
  if (typeof payload.entity_id !== "string" || payload.entity_id.trim() === "") {
    return { error: "entity_id is required" };
  }
  if (typeof payload.message !== "string" || payload.message.trim() === "") {
    return { error: "message is required" };
  }

  return { payload };
}

function validateAgentCreate(body) {
  const payload = {
    id: body.id ?? randomUUID(),
    name: body.name,
    role: body.role ?? "worker",
    host: body.host ?? "openclaw-macmini",
    supervisor_id: body.supervisor_id ?? null,
    status: body.status ?? "online",
    capabilities: body.capabilities ?? []
  };

  if (typeof payload.id !== "string") {
    return { error: "id must be string" };
  }
  if (typeof payload.name !== "string" || payload.name.trim() === "") {
    return { error: "name is required" };
  }
  if (typeof payload.host !== "string") {
    return { error: "host must be string" };
  }
  if (payload.supervisor_id !== null && typeof payload.supervisor_id !== "string") {
    return { error: "supervisor_id must be null or string" };
  }
  if (!Array.isArray(payload.capabilities) || payload.capabilities.some((v) => typeof v !== "string")) {
    return { error: "capabilities must be array of strings" };
  }

  const roleError = validateSetValue(payload.role, AGENT_ROLES, "role");
  if (roleError) {
    return { error: roleError };
  }
  const statusError = validateSetValue(payload.status, AGENT_STATUSES, "status");
  if (statusError) {
    return { error: statusError };
  }

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
    current_task_id: Object.prototype.hasOwnProperty.call(body, "current_task_id")
      ? body.current_task_id
      : undefined
  };

  if (payload.name !== undefined && (typeof payload.name !== "string" || payload.name.trim() === "")) {
    return { error: "name must be non-empty string" };
  }
  if (payload.host !== undefined && typeof payload.host !== "string") {
    return { error: "host must be string" };
  }
  if (payload.supervisor_id !== undefined && payload.supervisor_id !== null && typeof payload.supervisor_id !== "string") {
    return { error: "supervisor_id must be null or string" };
  }
  if (
    payload.capabilities !== undefined &&
    (!Array.isArray(payload.capabilities) || payload.capabilities.some((v) => typeof v !== "string"))
  ) {
    return { error: "capabilities must be array of strings" };
  }
  if (payload.load !== undefined && payload.load !== null && typeof payload.load !== "number") {
    return { error: "load must be null or number" };
  }
  if (
    payload.queue_depth !== undefined &&
    payload.queue_depth !== null &&
    !Number.isInteger(payload.queue_depth)
  ) {
    return { error: "queue_depth must be null or integer" };
  }
  if (
    payload.current_task_id !== undefined &&
    payload.current_task_id !== null &&
    typeof payload.current_task_id !== "string"
  ) {
    return { error: "current_task_id must be null or string" };
  }

  const roleError = validateSetValue(payload.role, AGENT_ROLES, "role");
  if (roleError) {
    return { error: roleError };
  }
  const statusError = validateSetValue(payload.status, AGENT_STATUSES, "status");
  if (statusError) {
    return { error: statusError };
  }

  return { payload };
}

async function maybeCreateAgentErrorAlert(agentRow) {
  if (agentRow.status !== "error") {
    return;
  }

  const existing = await db.get(
    "SELECT id FROM alerts WHERE type = 'agent_error' AND entity_type = 'agent' AND entity_id = ? AND status = 'open'",
    [agentRow.id]
  );
  if (existing) {
    return;
  }

  const ts = nowIso();
  await db.run(
    `
      INSERT INTO alerts (id, severity, type, entity_type, entity_id, message, status, created_at, updated_at)
      VALUES (?, 'warn', 'agent_error', 'agent', ?, ?, 'open', ?, ?)
    `,
    [randomUUID(), agentRow.id, `Agent ${agentRow.id} reported error state`, ts, ts]
  );
}

async function maybeCreateTaskFailedAlert(taskRow) {
  if (taskRow.status !== "failed") {
    return;
  }

  const existing = await db.get(
    "SELECT id FROM alerts WHERE type = 'task_failed' AND entity_type = 'task' AND entity_id = ? AND status = 'open'",
    [taskRow.id]
  );
  if (existing) {
    return;
  }

  const ts = nowIso();
  await db.run(
    `
      INSERT INTO alerts (id, severity, type, entity_type, entity_id, message, status, created_at, updated_at)
      VALUES (?, 'critical', 'task_failed', 'task', ?, ?, 'open', ?, ?)
    `,
    [randomUUID(), taskRow.id, `Task ${taskRow.id} failed`, ts, ts]
  );
}

app.post("/api/v1/agents", async (req, res) => {
  const { payload, error } = validateAgentCreate(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  if (payload.supervisor_id && !(await agentExists(payload.supervisor_id))) {
    return errorResponse(res, 400, "INVALID_SUPERVISOR", "supervisor_id does not exist");
  }

  const ts = nowIso();
  try {
    await db.run(
      `
      INSERT INTO agents (
        id, name, role, host, supervisor_id, status, capabilities,
        last_heartbeat_at, load, queue_depth, current_task_id, created_at, updated_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, 1)
      `,
      [
        payload.id,
        payload.name,
        payload.role,
        payload.host,
        payload.supervisor_id,
        payload.status,
        JSON.stringify(payload.capabilities),
        ts,
        ts,
        ts
      ]
    );
  } catch {
    return errorResponse(res, 409, "AGENT_EXISTS", "Agent already exists");
  }

  const row = await db.get("SELECT * FROM agents WHERE id = ?", [payload.id]);
  return res.status(201).json(mapAgent(row));
});

app.get("/api/v1/agents", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  const conditions = [];
  const params = [];

  if (req.query.status) {
    conditions.push("status = ?");
    params.push(String(req.query.status));
  }
  if (req.query.role) {
    conditions.push("role = ?");
    params.push(String(req.query.role));
  }
  if (req.query.host) {
    conditions.push("host = ?");
    params.push(String(req.query.host));
  }
  if (Object.prototype.hasOwnProperty.call(req.query, "supervisor_id")) {
    if (req.query.supervisor_id === "null") {
      conditions.push("supervisor_id IS NULL");
    } else {
      conditions.push("supervisor_id = ?");
      params.push(String(req.query.supervisor_id));
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.all(
    `SELECT * FROM agents ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return res.json(rows.map(mapAgent));
});

app.get("/api/v1/agents/:agentId", async (req, res) => {
  const row = await db.get("SELECT * FROM agents WHERE id = ?", [req.params.agentId]);
  if (!row) {
    return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  }
  return res.json(mapAgent(row));
});

app.patch("/api/v1/agents/:agentId", async (req, res) => {
  const { agentId } = req.params;
  const existing = await db.get("SELECT * FROM agents WHERE id = ?", [agentId]);
  if (!existing) {
    return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  }

  const { payload, error } = validateAgentPatch(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  if (payload.supervisor_id === agentId) {
    return errorResponse(res, 400, "INVALID_SUPERVISOR", "Agent cannot supervise itself");
  }
  if (payload.supervisor_id && !(await agentExists(payload.supervisor_id))) {
    return errorResponse(res, 400, "INVALID_SUPERVISOR", "supervisor_id does not exist");
  }

  const ts = nowIso();
  await db.run(
    `
      UPDATE agents
      SET
        name = COALESCE(?, name),
        role = COALESCE(?, role),
        host = COALESCE(?, host),
        supervisor_id = CASE WHEN ? IS NULL AND ? THEN NULL WHEN ? IS NULL THEN supervisor_id ELSE ? END,
        status = COALESCE(?, status),
        capabilities = COALESCE(?, capabilities),
        load = CASE WHEN ? IS NULL THEN load ELSE ? END,
        queue_depth = CASE WHEN ? IS NULL THEN queue_depth ELSE ? END,
        current_task_id = CASE WHEN ? THEN ? ELSE current_task_id END,
        updated_at = ?,
        version = version + 1
      WHERE id = ?
    `,
    [
      payload.name ?? null,
      payload.role ?? null,
      payload.host ?? null,
      payload.supervisor_id,
      payload.supervisor_id === null && Object.prototype.hasOwnProperty.call(req.body, "supervisor_id") ? 1 : 0,
      payload.supervisor_id,
      payload.supervisor_id,
      payload.status ?? null,
      payload.capabilities ? JSON.stringify(payload.capabilities) : null,
      payload.load,
      payload.load,
      payload.queue_depth,
      payload.queue_depth,
      Object.prototype.hasOwnProperty.call(req.body, "current_task_id") ? 1 : 0,
      payload.current_task_id,
      ts,
      agentId
    ]
  );

  const row = await db.get("SELECT * FROM agents WHERE id = ?", [agentId]);
  await maybeCreateAgentErrorAlert(row);
  return res.json(mapAgent(row));
});

app.post("/api/v1/agents/:agentId/heartbeat", async (req, res) => {
  const { agentId } = req.params;
  const { payload, error } = validateHeartbeat(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  if (payload.supervisor_id && !(await agentExists(payload.supervisor_id))) {
    return errorResponse(res, 400, "INVALID_SUPERVISOR", "supervisor_id does not exist");
  }

  const existing = await db.get("SELECT * FROM agents WHERE id = ?", [agentId]);
  const ts = nowIso();

  if (!existing) {
    await db.run(
      `
        INSERT INTO agents (
          id, name, role, host, supervisor_id, status, capabilities,
          last_heartbeat_at, load, queue_depth, current_task_id, created_at, updated_at, version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        agentId,
        payload.name || `agent-${agentId}`,
        payload.role,
        payload.host,
        payload.supervisor_id,
        payload.status,
        JSON.stringify(payload.capabilities),
        ts,
        payload.load,
        payload.queue_depth,
        payload.current_task_id,
        ts,
        ts
      ]
    );
  } else {
    await db.run(
      `
        UPDATE agents
        SET
          name = COALESCE(?, name),
          role = ?,
          host = ?,
          supervisor_id = ?,
          status = ?,
          capabilities = ?,
          last_heartbeat_at = ?,
          load = ?,
          queue_depth = ?,
          current_task_id = ?,
          updated_at = ?,
          version = version + 1
        WHERE id = ?
      `,
      [
        payload.name ?? null,
        payload.role,
        payload.host,
        payload.supervisor_id,
        payload.status,
        JSON.stringify(payload.capabilities),
        ts,
        payload.load,
        payload.queue_depth,
        payload.current_task_id,
        ts,
        agentId
      ]
    );
  }

  const row = await db.get("SELECT * FROM agents WHERE id = ?", [agentId]);
  await maybeCreateAgentErrorAlert(row);
  return res.json(mapAgent(row));
});

app.get("/api/v1/agents/:agentId/children", async (req, res) => {
  const exists = await db.get("SELECT id FROM agents WHERE id = ?", [req.params.agentId]);
  if (!exists) {
    return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  }
  const rows = await db.all("SELECT * FROM agents WHERE supervisor_id = ? ORDER BY created_at ASC", [
    req.params.agentId
  ]);
  return res.json(rows.map(mapAgent));
});

app.get("/api/v1/agents/tree", async (_req, res) => {
  const rows = await db.all("SELECT * FROM agents");
  return res.json(buildTree(rows));
});

app.post("/api/v1/tasks", async (req, res) => {
  const { payload, error } = validateTaskCreate(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  if (payload.assigned_agent_id && !(await agentExists(payload.assigned_agent_id))) {
    return errorResponse(res, 400, "AGENT_NOT_FOUND", "assigned_agent_id does not exist");
  }

  const ts = nowIso();
  const startedAt = payload.status === "running" ? ts : null;
  const finishedAt = FINAL_TASK_STATUSES.has(payload.status) ? ts : null;

  try {
    await db.run(
      `
      INSERT INTO tasks (
        id, title, description, assigned_agent_id, status, progress, priority, metadata,
        created_at, updated_at, started_at, finished_at, version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        payload.id,
        payload.title,
        payload.description,
        payload.assigned_agent_id,
        payload.status,
        payload.progress,
        payload.priority,
        JSON.stringify(payload.metadata),
        ts,
        ts,
        startedAt,
        finishedAt
      ]
    );
  } catch {
    return errorResponse(res, 409, "TASK_EXISTS", "Task already exists");
  }

  await db.run(
    `INSERT INTO task_events (id, task_id, agent_id, type, message, payload, created_at)
     VALUES (?, ?, ?, 'status_changed', ?, ?, ?)` ,
    [
      randomUUID(),
      payload.id,
      payload.assigned_agent_id,
      `Task created with status ${payload.status}`,
      JSON.stringify({ status: payload.status, progress: payload.progress }),
      ts
    ]
  );

  const row = await db.get("SELECT * FROM tasks WHERE id = ?", [payload.id]);
  await maybeCreateTaskFailedAlert(row);
  return res.status(201).json(mapTask(row));
});

app.get("/api/v1/tasks", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  const conditions = [];
  const params = [];

  if (req.query.status) {
    conditions.push("status = ?");
    params.push(String(req.query.status));
  }
  if (req.query.assigned_agent_id) {
    conditions.push("assigned_agent_id = ?");
    params.push(String(req.query.assigned_agent_id));
  }
  if (req.query.priority) {
    conditions.push("priority = ?");
    params.push(String(req.query.priority));
  }
  if (req.query.supervisor_id) {
    conditions.push("assigned_agent_id IN (SELECT id FROM agents WHERE supervisor_id = ?)");
    params.push(String(req.query.supervisor_id));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.all(
    `SELECT * FROM tasks ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return res.json(rows.map(mapTask));
});

app.get("/api/v1/tasks/:taskId", async (req, res) => {
  const row = await db.get("SELECT * FROM tasks WHERE id = ?", [req.params.taskId]);
  if (!row) {
    return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  }
  return res.json(mapTask(row));
});

app.patch("/api/v1/tasks/:taskId", async (req, res) => {
  const { taskId } = req.params;
  const existing = await db.get("SELECT * FROM tasks WHERE id = ?", [taskId]);
  if (!existing) {
    return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  }

  const { payload, error } = validateTaskPatch(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  if (payload.assigned_agent_id && !(await agentExists(payload.assigned_agent_id))) {
    return errorResponse(res, 400, "AGENT_NOT_FOUND", "assigned_agent_id does not exist");
  }

  if (payload.status && !ALLOWED_TRANSITIONS[existing.status].has(payload.status)) {
    return errorResponse(
      res,
      409,
      "TASK_INVALID_TRANSITION",
      `Cannot move task from ${existing.status} to ${payload.status}`
    );
  }

  const nextStatus = payload.status ?? existing.status;
  const ts = nowIso();

  const startedAt = existing.started_at ?? (nextStatus === "running" ? ts : null);
  const finishedAt = FINAL_TASK_STATUSES.has(nextStatus) ? ts : null;

  await db.run(
    `
      UPDATE tasks
      SET
        title = COALESCE(?, title),
        description = CASE WHEN ? IS NULL AND ? THEN NULL WHEN ? IS NULL THEN description ELSE ? END,
        assigned_agent_id = CASE WHEN ? IS NULL AND ? THEN NULL WHEN ? IS NULL THEN assigned_agent_id ELSE ? END,
        status = COALESCE(?, status),
        progress = CASE WHEN ? IS NULL THEN progress ELSE ? END,
        priority = COALESCE(?, priority),
        metadata = COALESCE(?, metadata),
        started_at = ?,
        finished_at = ?,
        updated_at = ?,
        version = version + 1
      WHERE id = ?
    `,
    [
      payload.title ?? null,
      payload.description,
      Object.prototype.hasOwnProperty.call(req.body, "description") ? 1 : 0,
      payload.description,
      payload.description,
      payload.assigned_agent_id,
      Object.prototype.hasOwnProperty.call(req.body, "assigned_agent_id") ? 1 : 0,
      payload.assigned_agent_id,
      payload.assigned_agent_id,
      nextStatus,
      payload.progress,
      payload.progress,
      payload.priority ?? null,
      payload.metadata !== undefined ? JSON.stringify(payload.metadata) : null,
      startedAt,
      finishedAt,
      ts,
      taskId
    ]
  );

  const updated = await db.get("SELECT * FROM tasks WHERE id = ?", [taskId]);

  const eventPayload = {
    status: updated.status,
    progress: updated.progress,
    updated_fields: Object.keys(req.body)
  };
  await db.run(
    `INSERT INTO task_events (id, task_id, agent_id, type, message, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)` ,
    [
      randomUUID(),
      taskId,
      updated.assigned_agent_id,
      payload.status ? "status_changed" : "progress",
      payload.status
        ? `Task status changed to ${updated.status}`
        : `Task progress updated to ${updated.progress}`,
      JSON.stringify(eventPayload),
      ts
    ]
  );

  await maybeCreateTaskFailedAlert(updated);
  return res.json(mapTask(updated));
});

app.post("/api/v1/tasks/:taskId/events", async (req, res) => {
  const { taskId } = req.params;
  const task = await db.get("SELECT id FROM tasks WHERE id = ?", [taskId]);
  if (!task) {
    return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  }

  const { payload, error } = validateTaskEvent(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  if (payload.agent_id && !(await agentExists(payload.agent_id))) {
    return errorResponse(res, 400, "AGENT_NOT_FOUND", "agent_id does not exist");
  }

  const eventId = randomUUID();
  const ts = nowIso();
  await db.run(
    `INSERT INTO task_events (id, task_id, agent_id, type, message, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [eventId, taskId, payload.agent_id, payload.type, payload.message, JSON.stringify(payload.payload), ts]
  );

  const row = await db.get("SELECT * FROM task_events WHERE id = ?", [eventId]);
  return res.status(201).json(mapTaskEvent(row));
});

app.get("/api/v1/tasks/:taskId/events", async (req, res) => {
  const task = await db.get("SELECT id FROM tasks WHERE id = ?", [req.params.taskId]);
  if (!task) {
    return errorResponse(res, 404, "TASK_NOT_FOUND", "Task not found");
  }

  const { limit, offset } = parsePaging(req.query);
  const rows = await db.all(
    "SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
    [req.params.taskId, limit, offset]
  );

  return res.json(rows.map(mapTaskEvent));
});

app.post("/api/v1/agents/:agentId/commands", async (req, res) => {
  const { agentId } = req.params;
  if (!(await agentExists(agentId))) {
    return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  }

  const { payload, error } = validateCommandCreate(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  const commandId = randomUUID();
  const ts = nowIso();
  await db.run(
    `
      INSERT INTO commands (
        id, agent_id, type, payload, status, created_by, acked_by, ack_message, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'queued', ?, NULL, NULL, ?, ?, ?)
    `,
    [commandId, agentId, payload.type, JSON.stringify(payload.payload), payload.created_by, payload.expires_at, ts, ts]
  );

  const row = await db.get("SELECT * FROM commands WHERE id = ?", [commandId]);
  return res.status(201).json(mapCommand(row));
});

app.get("/api/v1/agents/:agentId/commands", async (req, res) => {
  const { agentId } = req.params;
  if (!(await agentExists(agentId))) {
    return errorResponse(res, 404, "AGENT_NOT_FOUND", "Agent not found");
  }

  const { limit, offset } = parsePaging(req.query);
  const params = [agentId];
  let where = "WHERE agent_id = ?";

  if (req.query.status) {
    const status = String(req.query.status);
    if (!COMMAND_STATUSES.has(status)) {
      return errorResponse(res, 400, "VALIDATION_ERROR", "Invalid command status filter");
    }
    where += " AND status = ?";
    params.push(status);
  }

  const rows = await db.all(
    `SELECT * FROM commands ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return res.json(rows.map(mapCommand));
});

app.get("/api/v1/commands", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  const conditions = [];
  const params = [];

  if (req.query.status) {
    const status = String(req.query.status);
    if (!COMMAND_STATUSES.has(status)) {
      return errorResponse(res, 400, "VALIDATION_ERROR", "Invalid command status filter");
    }
    conditions.push("status = ?");
    params.push(status);
  }

  if (req.query.agent_id) {
    conditions.push("agent_id = ?");
    params.push(String(req.query.agent_id));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.all(
    `SELECT * FROM commands ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return res.json(rows.map(mapCommand));
});

app.post("/api/v1/commands/:commandId/ack", async (req, res) => {
  const { commandId } = req.params;
  const command = await db.get("SELECT * FROM commands WHERE id = ?", [commandId]);
  if (!command) {
    return errorResponse(res, 404, "COMMAND_NOT_FOUND", "Command not found");
  }

  const { payload, error } = validateCommandAck(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  if (command.status !== "queued" && command.status !== "delivered") {
    return errorResponse(res, 409, "COMMAND_ALREADY_FINAL", "Command is already in final state");
  }

  const ts = nowIso();
  await db.run(
    `
      UPDATE commands
      SET status = ?, acked_by = ?, ack_message = ?, updated_at = ?
      WHERE id = ?
    `,
    [payload.status, payload.acked_by, payload.message, ts, commandId]
  );

  const updated = await db.get("SELECT * FROM commands WHERE id = ?", [commandId]);
  return res.json(mapCommand(updated));
});

app.post("/api/v1/alerts", async (req, res) => {
  const { payload, error } = validateAlertCreate(req.body);
  if (error) {
    return errorResponse(res, 400, "VALIDATION_ERROR", error);
  }

  const ts = nowIso();
  try {
    await db.run(
      `
      INSERT INTO alerts (id, severity, type, entity_type, entity_id, message, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
      `,
      [payload.id, payload.severity, payload.type, payload.entity_type, payload.entity_id, payload.message, ts, ts]
    );
  } catch {
    return errorResponse(res, 409, "ALERT_EXISTS", "Alert already exists");
  }

  const row = await db.get("SELECT * FROM alerts WHERE id = ?", [payload.id]);
  return res.status(201).json(mapAlert(row));
});

app.get("/api/v1/alerts", async (req, res) => {
  const { limit, offset } = parsePaging(req.query);
  const conditions = [];
  const params = [];

  if (req.query.status) {
    const status = String(req.query.status);
    if (!ALERT_STATUSES.has(status)) {
      return errorResponse(res, 400, "VALIDATION_ERROR", "Invalid alert status filter");
    }
    conditions.push("status = ?");
    params.push(status);
  }
  if (req.query.severity) {
    const severity = String(req.query.severity);
    if (!ALERT_SEVERITIES.has(severity)) {
      return errorResponse(res, 400, "VALIDATION_ERROR", "Invalid alert severity filter");
    }
    conditions.push("severity = ?");
    params.push(severity);
  }
  if (req.query.type) {
    conditions.push("type = ?");
    params.push(String(req.query.type));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await db.all(
    `SELECT * FROM alerts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return res.json(rows.map(mapAlert));
});

app.post("/api/v1/alerts/:alertId/ack", async (req, res) => {
  const alert = await db.get("SELECT * FROM alerts WHERE id = ?", [req.params.alertId]);
  if (!alert) {
    return errorResponse(res, 404, "ALERT_NOT_FOUND", "Alert not found");
  }

  if (alert.status === "closed") {
    return errorResponse(res, 409, "ALERT_ALREADY_CLOSED", "Closed alert cannot be acknowledged");
  }

  const ts = nowIso();
  await db.run("UPDATE alerts SET status = 'ack', updated_at = ? WHERE id = ?", [ts, req.params.alertId]);
  const row = await db.get("SELECT * FROM alerts WHERE id = ?", [req.params.alertId]);
  return res.json(mapAlert(row));
});

app.post("/api/v1/alerts/:alertId/close", async (req, res) => {
  const alert = await db.get("SELECT * FROM alerts WHERE id = ?", [req.params.alertId]);
  if (!alert) {
    return errorResponse(res, 404, "ALERT_NOT_FOUND", "Alert not found");
  }

  const ts = nowIso();
  await db.run("UPDATE alerts SET status = 'closed', updated_at = ? WHERE id = ?", [
    ts,
    req.params.alertId
  ]);
  const row = await db.get("SELECT * FROM alerts WHERE id = ?", [req.params.alertId]);
  return res.json(mapAlert(row));
});

app.get("/api/v1/overview", async (_req, res) => {
  const agents = await db.all("SELECT * FROM agents");
  const activeTasks = await db.all(
    "SELECT id, title, status, progress, assigned_agent_id, priority, updated_at FROM tasks WHERE status IN ('queued', 'running', 'blocked') ORDER BY updated_at DESC"
  );

  const alertsOpen = await db.get("SELECT COUNT(*) AS count FROM alerts WHERE status = 'open'");
  const criticalAlerts = await db.get(
    "SELECT COUNT(*) AS count FROM alerts WHERE status = 'open' AND severity = 'critical'"
  );

  let online = 0;
  let offline = 0;
  let running = 0;
  let blocked = 0;

  for (const row of agents) {
    if (effectiveStatus(row) === "offline") {
      offline += 1;
    } else {
      online += 1;
    }
  }

  for (const task of activeTasks) {
    if (task.status === "running") {
      running += 1;
    }
    if (task.status === "blocked") {
      blocked += 1;
    }
  }

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
      alerts_open: alertsOpen.count,
      alerts_critical: criticalAlerts.count,
      heartbeat_offline_threshold_sec: HEARTBEAT_OFFLINE_SEC
    }
  });
});

app.get("/health/live", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await db.get("SELECT 1 as ok");
    return res.json({ status: "ready" });
  } catch {
    return errorResponse(res, 503, "DB_NOT_READY", "Database not ready");
  }
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Control Plane API listening on ${HOST}:${PORT}`);
});
