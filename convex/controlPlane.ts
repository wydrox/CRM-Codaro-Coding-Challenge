import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_ORGANIZATION_ID = "default-org";
const DEFAULT_USER_ID = "default-user";

const orgScopeV = { organization_id: v.string() };

const agentV = v.object({
  id: v.string(),
  name: v.string(),
  role: v.string(),
  host: v.string(),
  supervisor_id: v.union(v.string(), v.null()),
  status: v.string(),
  capabilities: v.array(v.string()),
  last_heartbeat_at: v.string(),
  load: v.union(v.number(), v.null()),
  queue_depth: v.union(v.number(), v.null()),
  current_task_id: v.union(v.string(), v.null()),
  created_at: v.string(),
  updated_at: v.string(),
  version: v.number()
});

const taskV = v.object({
  id: v.string(),
  title: v.string(),
  description: v.union(v.string(), v.null()),
  assigned_agent_id: v.union(v.string(), v.null()),
  status: v.string(),
  progress: v.number(),
  priority: v.string(),
  metadata: v.any(),
  created_at: v.string(),
  updated_at: v.string(),
  started_at: v.union(v.string(), v.null()),
  finished_at: v.union(v.string(), v.null()),
  version: v.number()
});

const taskEventV = v.object({
  id: v.string(),
  task_id: v.string(),
  agent_id: v.union(v.string(), v.null()),
  type: v.string(),
  message: v.union(v.string(), v.null()),
  payload: v.any(),
  created_at: v.string()
});

const commandV = v.object({
  id: v.string(),
  agent_id: v.string(),
  type: v.string(),
  payload: v.any(),
  status: v.string(),
  created_by: v.string(),
  acked_by: v.union(v.string(), v.null()),
  ack_message: v.union(v.string(), v.null()),
  expires_at: v.union(v.string(), v.null()),
  created_at: v.string(),
  updated_at: v.string()
});

const alertV = v.object({
  id: v.string(),
  severity: v.string(),
  type: v.string(),
  entity_type: v.string(),
  entity_id: v.string(),
  message: v.string(),
  status: v.string(),
  created_at: v.string(),
  updated_at: v.string()
});

function nowIso() {
  return new Date().toISOString();
}

function rowToAgent(row: any) {
  const createdAt = row.created_at ?? row.updated_at ?? row.source_updated_at ?? new Date(0).toISOString();
  const updatedAt = row.updated_at ?? row.source_updated_at ?? createdAt;
  const version = row.version ?? row.source_version ?? 1;
  return {
    id: row.agent_id,
    name: row.name,
    role: row.role,
    host: row.host,
    supervisor_id: row.supervisor_id,
    status: row.status,
    capabilities: row.capabilities,
    last_heartbeat_at: row.last_heartbeat_at,
    load: row.load,
    queue_depth: row.queue_depth,
    current_task_id: row.current_task_id,
    created_at: createdAt,
    updated_at: updatedAt,
    version
  };
}

function rowToTask(row: any) {
  return {
    id: row.task_id,
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

function rowToTaskEvent(row: any) {
  return {
    id: row.event_id,
    task_id: row.task_id,
    agent_id: row.agent_id,
    type: row.type,
    message: row.message,
    payload: row.payload ?? {},
    created_at: row.created_at
  };
}

function rowToCommand(row: any) {
  return {
    id: row.command_id,
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

function rowToAlert(row: any) {
  return {
    id: row.alert_id,
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

function rowToApiKeyMeta(row: any) {
  return {
    key_id: row.key_id,
    user_id: row.user_id,
    name: row.name,
    prefix: row.prefix,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    expires_at: row.expires_at
  };
}

async function sha256Hex(input: string) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function buildRawApiKey() {
  return `ak_${randomHex(16)}${randomHex(16)}`;
}

function apiKeyPrefix(rawKey: string) {
  return rawKey.slice(0, 12);
}

async function findOrgUser(ctx: any, organizationId: string, userId: string) {
  return ctx.db.query("users").withIndex("by_org_user", (q: any) => q.eq("organization_id", organizationId).eq("user_id", userId)).first();
}

export const getAgent = query({
  args: { ...orgScopeV, agent_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("agents").withIndex("by_org_agent_id", (q) => q.eq("organization_id", args.organization_id).eq("agent_id", args.agent_id)).first();
    return row ? rowToAgent(row) : null;
  }
});

export const listAgents = query({
  args: { ...orgScopeV },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("agents").withIndex("by_org_agent_id", (q) => q.eq("organization_id", args.organization_id)).collect();
    return rows.map(rowToAgent);
  }
});

export const createAgent = mutation({
  args: { ...orgScopeV, agent: agentV },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("agents").withIndex("by_org_agent_id", (q) => q.eq("organization_id", args.organization_id).eq("agent_id", args.agent.id)).first();
    if (existing) throw new Error("AGENT_EXISTS");
    await ctx.db.insert("agents", {
      organization_id: args.organization_id,
      agent_id: args.agent.id,
      name: args.agent.name,
      role: args.agent.role,
      host: args.agent.host,
      supervisor_id: args.agent.supervisor_id,
      status: args.agent.status,
      capabilities: args.agent.capabilities,
      last_heartbeat_at: args.agent.last_heartbeat_at,
      load: args.agent.load,
      queue_depth: args.agent.queue_depth,
      current_task_id: args.agent.current_task_id,
      created_at: args.agent.created_at,
      updated_at: args.agent.updated_at,
      version: args.agent.version
    });
    return args.agent;
  }
});

export const patchAgent = mutation({
  args: {
    ...orgScopeV,
    agent_id: v.string(),
    patch: v.object({
      name: v.optional(v.string()),
      role: v.optional(v.string()),
      host: v.optional(v.string()),
      supervisor_id: v.optional(v.union(v.string(), v.null())),
      status: v.optional(v.string()),
      capabilities: v.optional(v.array(v.string())),
      load: v.optional(v.union(v.number(), v.null())),
      queue_depth: v.optional(v.union(v.number(), v.null())),
      current_task_id: v.optional(v.union(v.string(), v.null()))
    }),
    has_supervisor_id: v.boolean(),
    has_current_task_id: v.boolean(),
    updated_at: v.string()
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("agents").withIndex("by_org_agent_id", (q) => q.eq("organization_id", args.organization_id).eq("agent_id", args.agent_id)).first();
    if (!row) return null;

    const next = {
      name: args.patch.name ?? row.name,
      role: args.patch.role ?? row.role,
      host: args.patch.host ?? row.host,
      supervisor_id: args.has_supervisor_id ? args.patch.supervisor_id ?? null : row.supervisor_id,
      status: args.patch.status ?? row.status,
      capabilities: args.patch.capabilities ?? row.capabilities,
      load: args.patch.load === undefined ? row.load : args.patch.load,
      queue_depth: args.patch.queue_depth === undefined ? row.queue_depth : args.patch.queue_depth,
      current_task_id: args.has_current_task_id ? args.patch.current_task_id ?? null : row.current_task_id,
      updated_at: args.updated_at,
      version: (row.version ?? 1) + 1
    };

    await ctx.db.patch(row._id, next);
    return rowToAgent({ ...row, ...next });
  }
});

export const upsertAgentHeartbeat = mutation({
  args: {
    ...orgScopeV,
    agent_id: v.string(),
    payload: v.object({
      name: v.optional(v.string()),
      role: v.string(),
      host: v.string(),
      supervisor_id: v.union(v.string(), v.null()),
      capabilities: v.array(v.string()),
      status: v.string(),
      load: v.union(v.number(), v.null()),
      queue_depth: v.union(v.number(), v.null()),
      current_task_id: v.union(v.string(), v.null())
    }),
    ts: v.string()
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("agents").withIndex("by_org_agent_id", (q) => q.eq("organization_id", args.organization_id).eq("agent_id", args.agent_id)).first();
    if (!row) {
      const created = {
        id: args.agent_id,
        name: args.payload.name ?? `agent-${args.agent_id}`,
        role: args.payload.role,
        host: args.payload.host,
        supervisor_id: args.payload.supervisor_id,
        status: args.payload.status,
        capabilities: args.payload.capabilities,
        last_heartbeat_at: args.ts,
        load: args.payload.load,
        queue_depth: args.payload.queue_depth,
        current_task_id: args.payload.current_task_id,
        created_at: args.ts,
        updated_at: args.ts,
        version: 1
      };
      await ctx.db.insert("agents", {
        organization_id: args.organization_id,
        agent_id: created.id,
        name: created.name,
        role: created.role,
        host: created.host,
        supervisor_id: created.supervisor_id,
        status: created.status,
        capabilities: created.capabilities,
        last_heartbeat_at: created.last_heartbeat_at,
        load: created.load,
        queue_depth: created.queue_depth,
        current_task_id: created.current_task_id,
        created_at: created.created_at,
        updated_at: created.updated_at,
        version: created.version
      });
      return { agent: created, created: true };
    }

    const next = {
      name: args.payload.name ?? row.name,
      role: args.payload.role,
      host: args.payload.host,
      supervisor_id: args.payload.supervisor_id,
      status: args.payload.status,
      capabilities: args.payload.capabilities,
      last_heartbeat_at: args.ts,
      load: args.payload.load,
      queue_depth: args.payload.queue_depth,
      current_task_id: args.payload.current_task_id,
      updated_at: args.ts,
      version: (row.version ?? 1) + 1
    };
    await ctx.db.patch(row._id, next);
    return { agent: rowToAgent({ ...row, ...next }), created: false };
  }
});

export const listTasks = query({
  args: { ...orgScopeV },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("tasks").withIndex("by_org_task_id", (q) => q.eq("organization_id", args.organization_id)).collect();
    return rows.map(rowToTask);
  }
});

export const getTask = query({
  args: { ...orgScopeV, task_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("tasks").withIndex("by_org_task_id", (q) => q.eq("organization_id", args.organization_id).eq("task_id", args.task_id)).first();
    return row ? rowToTask(row) : null;
  }
});

export const createTask = mutation({
  args: { ...orgScopeV, task: taskV },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tasks").withIndex("by_org_task_id", (q) => q.eq("organization_id", args.organization_id).eq("task_id", args.task.id)).first();
    if (existing) throw new Error("TASK_EXISTS");
    await ctx.db.insert("tasks", {
      organization_id: args.organization_id,
      task_id: args.task.id,
      title: args.task.title,
      description: args.task.description,
      assigned_agent_id: args.task.assigned_agent_id,
      status: args.task.status,
      progress: args.task.progress,
      priority: args.task.priority,
      metadata: args.task.metadata,
      created_at: args.task.created_at,
      updated_at: args.task.updated_at,
      started_at: args.task.started_at,
      finished_at: args.task.finished_at,
      version: args.task.version
    });
    return args.task;
  }
});

export const patchTask = mutation({
  args: {
    ...orgScopeV,
    task_id: v.string(),
    patch: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.union(v.string(), v.null())),
      assigned_agent_id: v.optional(v.union(v.string(), v.null())),
      status: v.optional(v.string()),
      progress: v.optional(v.number()),
      priority: v.optional(v.string()),
      metadata: v.optional(v.any()),
      started_at: v.optional(v.union(v.string(), v.null())),
      finished_at: v.optional(v.union(v.string(), v.null()))
    }),
    has_description: v.boolean(),
    has_assigned_agent_id: v.boolean(),
    updated_at: v.string()
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("tasks").withIndex("by_org_task_id", (q) => q.eq("organization_id", args.organization_id).eq("task_id", args.task_id)).first();
    if (!row) return null;
    const next = {
      title: args.patch.title ?? row.title,
      description: args.has_description ? args.patch.description ?? null : row.description,
      assigned_agent_id: args.has_assigned_agent_id ? args.patch.assigned_agent_id ?? null : row.assigned_agent_id,
      status: args.patch.status ?? row.status,
      progress: args.patch.progress ?? row.progress,
      priority: args.patch.priority ?? row.priority,
      metadata: args.patch.metadata ?? row.metadata,
      started_at: args.patch.started_at === undefined ? row.started_at : args.patch.started_at,
      finished_at: args.patch.finished_at === undefined ? row.finished_at : args.patch.finished_at,
      updated_at: args.updated_at,
      version: row.version + 1
    };
    await ctx.db.patch(row._id, next);
    return rowToTask({ ...row, ...next });
  }
});

export const listTaskEvents = query({
  args: { ...orgScopeV, task_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("task_events").withIndex("by_org_task_created", (q) => q.eq("organization_id", args.organization_id).eq("task_id", args.task_id)).collect();
    return rows.map(rowToTaskEvent);
  }
});

export const addTaskEvent = mutation({
  args: { ...orgScopeV, event: taskEventV },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("task_events").withIndex("by_org_event_id", (q) => q.eq("organization_id", args.organization_id).eq("event_id", args.event.id)).first();
    if (existing) throw new Error("TASK_EVENT_EXISTS");
    await ctx.db.insert("task_events", {
      organization_id: args.organization_id,
      event_id: args.event.id,
      task_id: args.event.task_id,
      agent_id: args.event.agent_id,
      type: args.event.type,
      message: args.event.message,
      payload: args.event.payload,
      created_at: args.event.created_at
    });
    return args.event;
  }
});

export const listCommands = query({
  args: { ...orgScopeV },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("commands").withIndex("by_org_command_id", (q) => q.eq("organization_id", args.organization_id)).collect();
    return rows.map(rowToCommand);
  }
});

export const getCommand = query({
  args: { ...orgScopeV, command_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("commands").withIndex("by_org_command_id", (q) => q.eq("organization_id", args.organization_id).eq("command_id", args.command_id)).first();
    return row ? rowToCommand(row) : null;
  }
});

export const createCommand = mutation({
  args: { ...orgScopeV, command: commandV },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("commands").withIndex("by_org_command_id", (q) => q.eq("organization_id", args.organization_id).eq("command_id", args.command.id)).first();
    if (existing) throw new Error("COMMAND_EXISTS");
    await ctx.db.insert("commands", {
      organization_id: args.organization_id,
      command_id: args.command.id,
      agent_id: args.command.agent_id,
      type: args.command.type,
      payload: args.command.payload,
      status: args.command.status,
      created_by: args.command.created_by,
      acked_by: args.command.acked_by,
      ack_message: args.command.ack_message,
      expires_at: args.command.expires_at,
      created_at: args.command.created_at,
      updated_at: args.command.updated_at
    });
    return args.command;
  }
});

export const ackCommand = mutation({
  args: {
    ...orgScopeV,
    command_id: v.string(),
    acked_by: v.string(),
    ack_message: v.union(v.string(), v.null()),
    status: v.string(),
    updated_at: v.string()
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("commands").withIndex("by_org_command_id", (q) => q.eq("organization_id", args.organization_id).eq("command_id", args.command_id)).first();
    if (!row) return null;
    const next = {
      status: args.status,
      acked_by: args.acked_by,
      ack_message: args.ack_message,
      updated_at: args.updated_at
    };
    await ctx.db.patch(row._id, next);
    return rowToCommand({ ...row, ...next });
  }
});

export const listAlerts = query({
  args: { ...orgScopeV },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("alerts").withIndex("by_org_alert_id", (q) => q.eq("organization_id", args.organization_id)).collect();
    return rows.map(rowToAlert);
  }
});

export const getAlert = query({
  args: { ...orgScopeV, alert_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("alerts").withIndex("by_org_alert_id", (q) => q.eq("organization_id", args.organization_id).eq("alert_id", args.alert_id)).first();
    return row ? rowToAlert(row) : null;
  }
});

export const createAlert = mutation({
  args: { ...orgScopeV, alert: alertV },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("alerts").withIndex("by_org_alert_id", (q) => q.eq("organization_id", args.organization_id).eq("alert_id", args.alert.id)).first();
    if (existing) throw new Error("ALERT_EXISTS");
    await ctx.db.insert("alerts", {
      organization_id: args.organization_id,
      alert_id: args.alert.id,
      severity: args.alert.severity,
      type: args.alert.type,
      entity_type: args.alert.entity_type,
      entity_id: args.alert.entity_id,
      message: args.alert.message,
      status: args.alert.status,
      created_at: args.alert.created_at,
      updated_at: args.alert.updated_at
    });
    return args.alert;
  }
});

export const patchAlertStatus = mutation({
  args: {
    ...orgScopeV,
    alert_id: v.string(),
    status: v.string(),
    updated_at: v.string()
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("alerts").withIndex("by_org_alert_id", (q) => q.eq("organization_id", args.organization_id).eq("alert_id", args.alert_id)).first();
    if (!row) return null;
    const next = { status: args.status, updated_at: args.updated_at };
    await ctx.db.patch(row._id, next);
    return rowToAlert({ ...row, ...next });
  }
});

export const createApiKey = mutation({
  args: {
    ...orgScopeV,
    user_id: v.string(),
    name: v.string(),
    expires_at: v.optional(v.union(v.string(), v.null()))
  },
  handler: async (ctx, args) => {
    const user = await findOrgUser(ctx, args.organization_id, args.user_id);
    if (!user) throw new Error("USER_NOT_FOUND");

    const rawKey = buildRawApiKey();
    const secretHash = await sha256Hex(rawKey);
    const ts = nowIso();
    const keyId = crypto.randomUUID();
    const row = {
      key_id: keyId,
      organization_id: args.organization_id,
      user_id: args.user_id,
      name: args.name,
      prefix: apiKeyPrefix(rawKey),
      secret_hash: secretHash,
      created_at: ts,
      updated_at: ts,
      last_used_at: null,
      revoked_at: null,
      expires_at: args.expires_at ?? null
    };
    await ctx.db.insert("api_keys", row);
    return { raw_key: rawKey, key: rowToApiKeyMeta(row) };
  }
});

export const listApiKeys = query({
  args: { ...orgScopeV, user_id: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("api_keys").withIndex("by_org_user", (q) => q.eq("organization_id", args.organization_id).eq("user_id", args.user_id)).collect();
    rows.sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
    return rows.map(rowToApiKeyMeta);
  }
});

export const rotateApiKey = mutation({
  args: { ...orgScopeV, user_id: v.string(), key_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("api_keys").withIndex("by_key_id", (q) => q.eq("key_id", args.key_id)).first();
    if (!row || row.organization_id !== args.organization_id || row.user_id !== args.user_id) return null;
    if (row.revoked_at) return null;

    const rawKey = buildRawApiKey();
    const secretHash = await sha256Hex(rawKey);
    const next = {
      secret_hash: secretHash,
      prefix: apiKeyPrefix(rawKey),
      updated_at: nowIso(),
      last_used_at: null
    };
    await ctx.db.patch(row._id, next);
    return { raw_key: rawKey, key: rowToApiKeyMeta({ ...row, ...next }) };
  }
});

export const revokeApiKey = mutation({
  args: { ...orgScopeV, user_id: v.string(), key_id: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query("api_keys").withIndex("by_key_id", (q) => q.eq("key_id", args.key_id)).first();
    if (!row || row.organization_id !== args.organization_id || row.user_id !== args.user_id) return null;
    if (row.revoked_at) return rowToApiKeyMeta(row);

    const next = { revoked_at: nowIso(), updated_at: nowIso() };
    await ctx.db.patch(row._id, next);
    return rowToApiKeyMeta({ ...row, ...next });
  }
});

export const resolveApiKeyContext = mutation({
  args: { raw_key: v.string() },
  handler: async (ctx, args) => {
    const hash = await sha256Hex(args.raw_key);
    const row = await ctx.db.query("api_keys").withIndex("by_secret_hash", (q) => q.eq("secret_hash", hash)).first();
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return null;

    await ctx.db.patch(row._id, { last_used_at: nowIso() });
    return {
      organization_id: row.organization_id,
      user_id: row.user_id,
      key_id: row.key_id
    };
  }
});

export const bootstrapDefaultTenant = mutation({
  args: { seed_api_key: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const ts = nowIso();
    const org = await ctx.db.query("organizations").withIndex("by_organization_id", (q) => q.eq("organization_id", DEFAULT_ORGANIZATION_ID)).first();
    if (!org) {
      await ctx.db.insert("organizations", {
        organization_id: DEFAULT_ORGANIZATION_ID,
        name: "Default Organization",
        created_at: ts,
        updated_at: ts
      });
    }

    const user = await findOrgUser(ctx, DEFAULT_ORGANIZATION_ID, DEFAULT_USER_ID);
    if (!user) {
      await ctx.db.insert("users", {
        user_id: DEFAULT_USER_ID,
        organization_id: DEFAULT_ORGANIZATION_ID,
        email: null,
        name: "Default User",
        status: "active",
        created_at: ts,
        updated_at: ts
      });
    }

    const tables = ["agents", "tasks", "task_events", "commands", "alerts", "agent_events", "agent_snapshots"];
    for (const tableName of tables) {
      const rows = await ctx.db.query(tableName as any).collect();
      for (const row of rows) {
        if (!row.organization_id) {
          await ctx.db.patch(row._id, { organization_id: DEFAULT_ORGANIZATION_ID });
        }
      }
    }

    const userKeys = await ctx.db.query("api_keys").withIndex("by_org_user", (q) => q.eq("organization_id", DEFAULT_ORGANIZATION_ID).eq("user_id", DEFAULT_USER_ID)).collect();
    const hasActiveKey = userKeys.some((row: any) => {
      if (row.revoked_at) return false;
      if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return false;
      return true;
    });
    if (hasActiveKey) {
      return { organization_id: DEFAULT_ORGANIZATION_ID, user_id: DEFAULT_USER_ID, created_api_key: null };
    }

    const rawKey = args.seed_api_key || buildRawApiKey();
    const secretHash = await sha256Hex(rawKey);
    await ctx.db.insert("api_keys", {
      key_id: crypto.randomUUID(),
      organization_id: DEFAULT_ORGANIZATION_ID,
      user_id: DEFAULT_USER_ID,
      name: "Bootstrap Key",
      prefix: apiKeyPrefix(rawKey),
      secret_hash: secretHash,
      created_at: ts,
      updated_at: ts,
      last_used_at: null,
      revoked_at: null,
      expires_at: null
    });

    return { organization_id: DEFAULT_ORGANIZATION_ID, user_id: DEFAULT_USER_ID, created_api_key: rawKey };
  }
});

export const ingestAgentStatus = mutation({
  args: {
    ...orgScopeV,
    event_type: v.string(),
    sent_at: v.string(),
    agent: agentV
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("agents").withIndex("by_org_agent_id", (q) => q.eq("organization_id", args.organization_id).eq("agent_id", args.agent.id)).first();
    const doc = {
      organization_id: args.organization_id,
      agent_id: args.agent.id,
      name: args.agent.name,
      role: args.agent.role,
      host: args.agent.host,
      supervisor_id: args.agent.supervisor_id,
      status: args.agent.status,
      capabilities: args.agent.capabilities,
      last_heartbeat_at: args.agent.last_heartbeat_at,
      load: args.agent.load,
      queue_depth: args.agent.queue_depth,
      current_task_id: args.agent.current_task_id,
      created_at: args.agent.created_at,
      updated_at: args.agent.updated_at,
      version: args.agent.version
    };
    if (!existing) await ctx.db.insert("agents", doc);
    else await ctx.db.patch(existing._id, doc);

    await ctx.db.insert("agent_events", {
      organization_id: args.organization_id,
      event_type: args.event_type,
      sent_at: args.sent_at,
      received_at: nowIso(),
      agent_id: args.agent.id,
      payload: args
    });

    return { ok: true };
  }
});

export const ingestAgentsSnapshot = mutation({
  args: { ...orgScopeV, sent_at: v.string(), agents: v.array(agentV) },
  handler: async (ctx, args) => {
    for (const agent of args.agents) {
      const existing = await ctx.db.query("agents").withIndex("by_org_agent_id", (q) => q.eq("organization_id", args.organization_id).eq("agent_id", agent.id)).first();
      const doc = {
        organization_id: args.organization_id,
        agent_id: agent.id,
        name: agent.name,
        role: agent.role,
        host: agent.host,
        supervisor_id: agent.supervisor_id,
        status: agent.status,
        capabilities: agent.capabilities,
        last_heartbeat_at: agent.last_heartbeat_at,
        load: agent.load,
        queue_depth: agent.queue_depth,
        current_task_id: agent.current_task_id,
        created_at: agent.created_at,
        updated_at: agent.updated_at,
        version: agent.version
      };
      if (!existing) await ctx.db.insert("agents", doc);
      else await ctx.db.patch(existing._id, doc);
    }
    await ctx.db.insert("agent_snapshots", {
      organization_id: args.organization_id,
      sent_at: args.sent_at,
      received_at: nowIso(),
      count: args.agents.length,
      payload: args
    });
    return { ok: true, count: args.agents.length };
  }
});
