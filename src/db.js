import sqlite3 from "sqlite3";
import { open } from "sqlite";

const databaseUrl = process.env.DATABASE_URL || "./control_plane.db";

async function ensureColumn(db, table, column, definition) {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  const hasColumn = rows.some((r) => r.name === column);
  if (!hasColumn) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function createDb() {
  const db = await open({
    filename: databaseUrl,
    driver: sqlite3.Database
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'worker',
      host TEXT NOT NULL DEFAULT 'openclaw-macmini',
      supervisor_id TEXT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'online',
      capabilities TEXT NOT NULL DEFAULT '[]',
      last_heartbeat_at TEXT NOT NULL,
      load REAL NULL,
      queue_depth INTEGER NULL,
      current_task_id TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_agents_supervisor ON agents(supervisor_id);
    CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
    CREATE INDEX IF NOT EXISTS idx_agents_heartbeat ON agents(last_heartbeat_at);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NULL,
      assigned_agent_id TEXT NULL REFERENCES agents(id),
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      priority TEXT NOT NULL DEFAULT 'normal',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT NULL,
      finished_at TEXT NULL,
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(assigned_agent_id);

    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      agent_id TEXT NULL REFERENCES agents(id),
      type TEXT NOT NULL,
      message TEXT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at);

    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      created_by TEXT NOT NULL DEFAULT 'operator',
      acked_by TEXT NULL,
      ack_message TEXT NULL,
      expires_at TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_commands_agent_status ON commands(agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_commands_created_at ON commands(created_at);

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
    CREATE INDEX IF NOT EXISTS idx_alerts_entity ON alerts(entity_type, entity_id);
  `);

  await ensureColumn(db, "agents", "version", "INTEGER NOT NULL DEFAULT 1");
  await ensureColumn(db, "tasks", "started_at", "TEXT NULL");
  await ensureColumn(db, "tasks", "finished_at", "TEXT NULL");
  await ensureColumn(db, "tasks", "version", "INTEGER NOT NULL DEFAULT 1");

  return db;
}
