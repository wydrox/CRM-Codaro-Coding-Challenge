import { AsyncLocalStorage } from "node:async_hooks";

const requestContext = new AsyncLocalStorage();

function getBaseUrl() {
  return process.env.CONVEX_BACKEND_URL || process.env.CONVEX_SYNC_URL || "";
}

function getApiPath() {
  return process.env.CONVEX_API_PATH || "/control-plane-api";
}

function getToken() {
  return process.env.CONVEX_SYNC_TOKEN || "";
}

function getTimeoutMs() {
  return Number(process.env.CONVEX_SYNC_TIMEOUT_MS || "5000");
}

function endpointUrl() {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return "";
  }
  const path = getApiPath();
  return `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

function timeoutSignal(ms) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

function contextPayload() {
  const ctx = requestContext.getStore();
  if (!ctx?.organization_id) return {};
  return {
    organization_id: ctx.organization_id,
    user_id: ctx.user_id,
    key_id: ctx.key_id
  };
}

async function callConvex(op, payload = {}) {
  const url = endpointUrl();
  if (!url) {
    throw new Error("Convex backend URL is not configured");
  }

  const headers = {
    "Content-Type": "application/json"
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ op, ...contextPayload(), ...payload }),
    signal: timeoutSignal(getTimeoutMs())
  });

  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { raw: bodyText };
  }

  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : `Convex backend call failed (${response.status})`;
    throw new Error(message);
  }

  return body;
}

export function runWithConvexContext(ctx, fn) {
  return requestContext.run(ctx, fn);
}

export function convexBackendConfigured() {
  return endpointUrl().length > 0;
}

export async function convexResolveApiKey(rawKey) {
  const result = await callConvex("resolve_api_key_context", { raw_key: rawKey });
  return result.auth ?? null;
}

export async function convexBootstrapDefaultTenant(seedApiKey = null) {
  return callConvex("bootstrap_default_tenant", { seed_api_key: seedApiKey });
}

export async function convexCreateApiKey(userId, name, expiresAt) {
  return callConvex("create_api_key", {
    user_id: userId,
    name,
    expires_at: expiresAt ?? null
  });
}

export async function convexListApiKeys(userId) {
  const result = await callConvex("list_api_keys", { user_id: userId });
  return result.keys ?? [];
}

export async function convexRotateApiKey(userId, keyId) {
  return callConvex("rotate_api_key", {
    user_id: userId,
    key_id: keyId
  });
}

export async function convexRevokeApiKey(userId, keyId) {
  const result = await callConvex("revoke_api_key", {
    user_id: userId,
    key_id: keyId
  });
  return result.key ?? null;
}

export async function convexListAgents() {
  const result = await callConvex("list_agents");
  return result.agents ?? [];
}

export async function convexGetAgent(agentId) {
  const result = await callConvex("get_agent", { agent_id: agentId });
  return result.agent ?? null;
}

export async function convexCreateAgent(agent) {
  const result = await callConvex("create_agent", { agent });
  return result.agent;
}

export async function convexPatchAgent(agentId, patch, options) {
  const result = await callConvex("patch_agent", {
    agent_id: agentId,
    patch,
    has_supervisor_id: options.has_supervisor_id,
    has_current_task_id: options.has_current_task_id,
    updated_at: options.updated_at
  });
  return result.agent ?? null;
}

export async function convexHeartbeatAgent(agentId, payload, ts) {
  return callConvex("heartbeat_agent", {
    agent_id: agentId,
    payload,
    ts
  });
}

export async function convexListTasks() {
  const result = await callConvex("list_tasks");
  return result.tasks ?? [];
}

export async function convexGetTask(taskId) {
  const result = await callConvex("get_task", { task_id: taskId });
  return result.task ?? null;
}

export async function convexCreateTask(task) {
  const result = await callConvex("create_task", { task });
  return result.task;
}

export async function convexPatchTask(taskId, patch, options) {
  const result = await callConvex("patch_task", {
    task_id: taskId,
    patch,
    has_description: options.has_description,
    has_assigned_agent_id: options.has_assigned_agent_id,
    updated_at: options.updated_at
  });
  return result.task ?? null;
}

export async function convexListTaskEvents(taskId) {
  const result = await callConvex("list_task_events", { task_id: taskId });
  return result.events ?? [];
}

export async function convexAddTaskEvent(event) {
  const result = await callConvex("add_task_event", { event });
  return result.event;
}

export async function convexListCommands() {
  const result = await callConvex("list_commands");
  return result.commands ?? [];
}

export async function convexGetCommand(commandId) {
  const result = await callConvex("get_command", { command_id: commandId });
  return result.command ?? null;
}

export async function convexCreateCommand(command) {
  const result = await callConvex("create_command", { command });
  return result.command;
}

export async function convexAckCommand(commandId, ackedBy, ackMessage, status, updatedAt) {
  const result = await callConvex("ack_command", {
    command_id: commandId,
    acked_by: ackedBy,
    ack_message: ackMessage,
    status,
    updated_at: updatedAt
  });
  return result.command ?? null;
}

export async function convexListAlerts() {
  const result = await callConvex("list_alerts");
  return result.alerts ?? [];
}

export async function convexGetAlert(alertId) {
  const result = await callConvex("get_alert", { alert_id: alertId });
  return result.alert ?? null;
}

export async function convexCreateAlert(alert) {
  const result = await callConvex("create_alert", { alert });
  return result.alert;
}

export async function convexPatchAlertStatus(alertId, status, updatedAt) {
  const result = await callConvex("patch_alert_status", {
    alert_id: alertId,
    status,
    updated_at: updatedAt
  });
  return result.alert ?? null;
}
