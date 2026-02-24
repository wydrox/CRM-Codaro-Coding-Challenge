import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  organizations: defineTable({
    organization_id: v.string(),
    name: v.string(),
    created_at: v.string(),
    updated_at: v.string()
  }).index("by_organization_id", ["organization_id"]),

  users: defineTable({
    user_id: v.string(),
    organization_id: v.string(),
    email: v.union(v.string(), v.null()),
    name: v.string(),
    status: v.string(),
    created_at: v.string(),
    updated_at: v.string()
  })
    .index("by_user_id", ["user_id"])
    .index("by_org_user", ["organization_id", "user_id"]),

  api_keys: defineTable({
    key_id: v.string(),
    organization_id: v.string(),
    user_id: v.string(),
    name: v.string(),
    prefix: v.string(),
    secret_hash: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
    last_used_at: v.union(v.string(), v.null()),
    revoked_at: v.union(v.string(), v.null()),
    expires_at: v.union(v.string(), v.null())
  })
    .index("by_key_id", ["key_id"])
    .index("by_secret_hash", ["secret_hash"])
    .index("by_org_user", ["organization_id", "user_id"])
    .index("by_org_active", ["organization_id", "revoked_at"]),

  agents: defineTable({
    organization_id: v.string(),
    agent_id: v.string(),
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
    created_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
    version: v.optional(v.number()),
    source_version: v.optional(v.number()),
    source_updated_at: v.optional(v.string()),
    mirrored_at: v.optional(v.string())
  })
    .index("by_org_agent_id", ["organization_id", "agent_id"])
    .index("by_org_status", ["organization_id", "status"])
    .index("by_org_supervisor", ["organization_id", "supervisor_id"]),

  agent_events: defineTable({
    organization_id: v.string(),
    event_type: v.string(),
    sent_at: v.string(),
    received_at: v.string(),
    agent_id: v.string(),
    payload: v.any()
  }).index("by_org_agent_id", ["organization_id", "agent_id"]),

  agent_snapshots: defineTable({
    organization_id: v.string(),
    sent_at: v.string(),
    received_at: v.string(),
    count: v.number(),
    payload: v.any()
  }).index("by_org_sent_at", ["organization_id", "sent_at"]),

  tasks: defineTable({
    organization_id: v.string(),
    task_id: v.string(),
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
  })
    .index("by_org_task_id", ["organization_id", "task_id"])
    .index("by_org_task_status", ["organization_id", "status"])
    .index("by_org_task_agent", ["organization_id", "assigned_agent_id"]),

  task_events: defineTable({
    organization_id: v.string(),
    event_id: v.string(),
    task_id: v.string(),
    agent_id: v.union(v.string(), v.null()),
    type: v.string(),
    message: v.union(v.string(), v.null()),
    payload: v.any(),
    created_at: v.string()
  })
    .index("by_org_event_id", ["organization_id", "event_id"])
    .index("by_org_task_created", ["organization_id", "task_id", "created_at"]),

  commands: defineTable({
    organization_id: v.string(),
    command_id: v.string(),
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
  })
    .index("by_org_command_id", ["organization_id", "command_id"])
    .index("by_org_command_agent_status", ["organization_id", "agent_id", "status"]),

  alerts: defineTable({
    organization_id: v.string(),
    alert_id: v.string(),
    severity: v.string(),
    type: v.string(),
    entity_type: v.string(),
    entity_id: v.string(),
    message: v.string(),
    status: v.string(),
    created_at: v.string(),
    updated_at: v.string()
  })
    .index("by_org_alert_id", ["organization_id", "alert_id"])
    .index("by_org_alert_status", ["organization_id", "status"])
    .index("by_org_alert_entity", ["organization_id", "entity_type", "entity_id"])
});
