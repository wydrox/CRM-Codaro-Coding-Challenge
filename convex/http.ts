import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function extractBearer(req: Request) {
  const value = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!value.startsWith("Bearer ")) return "";
  return value.slice("Bearer ".length).trim();
}

function requireSyncToken(req: Request) {
  const expected = process.env.CONVEX_SYNC_TOKEN || "";
  if (!expected) return false;
  return extractBearer(req) === expected;
}

http.route({
  path: "/control-plane-sync",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!requireSyncToken(req)) return json({ error: "Unauthorized" }, 401);
    const body = await req.json();

    if (body?.type === "agent_status") {
      await ctx.runMutation(api.controlPlane.ingestAgentStatus, {
        organization_id: body.organization_id ?? "default-org",
        event_type: body.event_type,
        sent_at: body.sent_at,
        agent: body.agent
      });
      return json({ ok: true });
    }

    if (body?.type === "agents_snapshot") {
      await ctx.runMutation(api.controlPlane.ingestAgentsSnapshot, {
        organization_id: body.organization_id ?? "default-org",
        sent_at: body.sent_at,
        agents: body.agents
      });
      return json({ ok: true, count: body.agents?.length ?? 0 });
    }

    return json({ error: "Unsupported payload type" }, 400);
  })
});

http.route({
  path: "/control-plane-api",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!requireSyncToken(req)) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const op = body?.op;
    const organizationId = body?.organization_id;

    if (op === "resolve_api_key_context") {
      const auth = await ctx.runMutation(api.controlPlane.resolveApiKeyContext, { raw_key: body.raw_key });
      return json({ auth });
    }

    if (op === "bootstrap_default_tenant") {
      const result = await ctx.runMutation(api.controlPlane.bootstrapDefaultTenant, {
        seed_api_key: body.seed_api_key ?? null
      });
      return json(result);
    }

    if (!organizationId) {
      return json({ error: "organization_id is required" }, 400);
    }

    if (op === "list_agents") {
      const agents = await ctx.runQuery(api.controlPlane.listAgents, { organization_id: organizationId });
      return json({ agents });
    }

    if (op === "get_agent") {
      const agent = await ctx.runQuery(api.controlPlane.getAgent, { organization_id: organizationId, agent_id: body.agent_id });
      return json({ agent });
    }

    if (op === "create_agent") {
      const agent = await ctx.runMutation(api.controlPlane.createAgent, { organization_id: organizationId, agent: body.agent });
      return json({ agent });
    }

    if (op === "patch_agent") {
      const agent = await ctx.runMutation(api.controlPlane.patchAgent, {
        organization_id: organizationId,
        agent_id: body.agent_id,
        patch: body.patch,
        has_supervisor_id: body.has_supervisor_id,
        has_current_task_id: body.has_current_task_id,
        updated_at: body.updated_at
      });
      return json({ agent });
    }

    if (op === "heartbeat_agent") {
      const result = await ctx.runMutation(api.controlPlane.upsertAgentHeartbeat, {
        organization_id: organizationId,
        agent_id: body.agent_id,
        payload: body.payload,
        ts: body.ts
      });
      return json(result);
    }

    if (op === "list_tasks") {
      const tasks = await ctx.runQuery(api.controlPlane.listTasks, { organization_id: organizationId });
      return json({ tasks });
    }

    if (op === "get_task") {
      const task = await ctx.runQuery(api.controlPlane.getTask, { organization_id: organizationId, task_id: body.task_id });
      return json({ task });
    }

    if (op === "create_task") {
      const task = await ctx.runMutation(api.controlPlane.createTask, { organization_id: organizationId, task: body.task });
      return json({ task });
    }

    if (op === "patch_task") {
      const task = await ctx.runMutation(api.controlPlane.patchTask, {
        organization_id: organizationId,
        task_id: body.task_id,
        patch: body.patch,
        has_description: body.has_description,
        has_assigned_agent_id: body.has_assigned_agent_id,
        updated_at: body.updated_at
      });
      return json({ task });
    }

    if (op === "list_task_events") {
      const events = await ctx.runQuery(api.controlPlane.listTaskEvents, {
        organization_id: organizationId,
        task_id: body.task_id
      });
      return json({ events });
    }

    if (op === "add_task_event") {
      const event = await ctx.runMutation(api.controlPlane.addTaskEvent, {
        organization_id: organizationId,
        event: body.event
      });
      return json({ event });
    }

    if (op === "list_commands") {
      const commands = await ctx.runQuery(api.controlPlane.listCommands, { organization_id: organizationId });
      return json({ commands });
    }

    if (op === "get_command") {
      const command = await ctx.runQuery(api.controlPlane.getCommand, {
        organization_id: organizationId,
        command_id: body.command_id
      });
      return json({ command });
    }

    if (op === "create_command") {
      const command = await ctx.runMutation(api.controlPlane.createCommand, {
        organization_id: organizationId,
        command: body.command
      });
      return json({ command });
    }

    if (op === "ack_command") {
      const command = await ctx.runMutation(api.controlPlane.ackCommand, {
        organization_id: organizationId,
        command_id: body.command_id,
        acked_by: body.acked_by,
        ack_message: body.ack_message,
        status: body.status,
        updated_at: body.updated_at
      });
      return json({ command });
    }

    if (op === "list_alerts") {
      const alerts = await ctx.runQuery(api.controlPlane.listAlerts, { organization_id: organizationId });
      return json({ alerts });
    }

    if (op === "get_alert") {
      const alert = await ctx.runQuery(api.controlPlane.getAlert, {
        organization_id: organizationId,
        alert_id: body.alert_id
      });
      return json({ alert });
    }

    if (op === "create_alert") {
      const alert = await ctx.runMutation(api.controlPlane.createAlert, {
        organization_id: organizationId,
        alert: body.alert
      });
      return json({ alert });
    }

    if (op === "patch_alert_status") {
      const alert = await ctx.runMutation(api.controlPlane.patchAlertStatus, {
        organization_id: organizationId,
        alert_id: body.alert_id,
        status: body.status,
        updated_at: body.updated_at
      });
      return json({ alert });
    }

    if (op === "create_api_key") {
      const result = await ctx.runMutation(api.controlPlane.createApiKey, {
        organization_id: organizationId,
        user_id: body.user_id,
        name: body.name,
        expires_at: body.expires_at
      });
      return json(result);
    }

    if (op === "list_api_keys") {
      const keys = await ctx.runQuery(api.controlPlane.listApiKeys, {
        organization_id: organizationId,
        user_id: body.user_id
      });
      return json({ keys });
    }

    if (op === "rotate_api_key") {
      const result = await ctx.runMutation(api.controlPlane.rotateApiKey, {
        organization_id: organizationId,
        user_id: body.user_id,
        key_id: body.key_id
      });
      return json(result);
    }

    if (op === "revoke_api_key") {
      const key = await ctx.runMutation(api.controlPlane.revokeApiKey, {
        organization_id: organizationId,
        user_id: body.user_id,
        key_id: body.key_id
      });
      return json({ key });
    }

    return json({ error: "Unsupported operation" }, 400);
  })
});

export default http;
