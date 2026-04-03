import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { writeJsonLineToFile } from "./logger.js";
import {
  type PipelineDefinition,
  type QueueTaskRecord,
  type PipelineRunRecord,
  type RunEventRecord,
  type TaskQueueRecord,
} from "./types.js";

type SqliteRow = {
  run_id: string;
  payload: string;
};

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getDefaultDatabasePath(): string {
  return path.resolve(process.cwd(), "data", "pipeline.db");
}

function runSqlite(
  dbPath: string,
  sql: string,
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync("sqlite3", [dbPath], {
    encoding: "utf-8",
    input: sql,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const errorMessage =
    result.error instanceof Error ? result.error.message : result.error ? String(result.error) : "";
  const stderr = [result.stderr ?? "", errorMessage].filter((item) => item.length > 0).join("\n");

  return {
    stdout: result.stdout ?? "",
    stderr,
    status: result.status ?? 1,
  };
}

export class SqliteRunStore {
  private readonly dbPath: string;

  constructor(dbPath = getDefaultDatabasePath()) {
    this.dbPath = dbPath;
    ensureDir(path.dirname(this.dbPath));
    this.initialize();
  }

  save(run: PipelineRunRecord): void {
    const payload = escapeSqlString(JSON.stringify(run));
    const sql = `
      INSERT INTO pipeline_runs (run_id, pipeline_id, pipeline_name, status, started_at, ended_at, payload)
      VALUES ('${escapeSqlString(run.runId)}', '${escapeSqlString(run.pipelineId)}', '${escapeSqlString(run.pipelineName)}', '${escapeSqlString(run.status)}', '${escapeSqlString(run.startedAt)}', ${run.endedAt ? `'${escapeSqlString(run.endedAt)}'` : "NULL"}, '${payload}')
      ON CONFLICT(run_id) DO UPDATE SET
        pipeline_id=excluded.pipeline_id,
        pipeline_name=excluded.pipeline_name,
        status=excluded.status,
        started_at=excluded.started_at,
        ended_at=excluded.ended_at,
        payload=excluded.payload;
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to save run ${run.runId}: ${result.stderr.trim()}`);
    }
  }

  list(): PipelineRunRecord[] {
    const sql = `
      SELECT json_object('run_id', run_id, 'payload', payload)
      FROM pipeline_runs
      ORDER BY started_at DESC;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to list runs: ${result.stderr.trim()}`);
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SqliteRow)
      .map((row) => JSON.parse(row.payload) as PipelineRunRecord);
  }

  get(runId: string): PipelineRunRecord | undefined {
    const sql = `
      SELECT json_object('run_id', run_id, 'payload', payload)
      FROM pipeline_runs
      WHERE run_id = '${escapeSqlString(runId)}'
      LIMIT 1;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to get run ${runId}: ${result.stderr.trim()}`);
    }

    const line = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);

    if (!line) return undefined;
    const row = JSON.parse(line) as SqliteRow;
    return JSON.parse(row.payload) as PipelineRunRecord;
  }

  has(runId: string): boolean {
    return this.get(runId) !== undefined;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  private initialize(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS pipeline_runs (
        run_id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        pipeline_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_started_at ON pipeline_runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id);
      CREATE TABLE IF NOT EXISTS run_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        node_id TEXT,
        node_name TEXT,
        payload TEXT,
        FOREIGN KEY(run_id) REFERENCES pipeline_runs(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, event_id ASC);
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to initialize run store: ${result.stderr.trim()}`);
    }
  }
}

export class SqlitePipelineStore {
  private readonly dbPath: string;

  constructor(dbPath = getDefaultDatabasePath()) {
    this.dbPath = dbPath;
    ensureDir(path.dirname(this.dbPath));
    this.initialize();
  }

  save(definition: PipelineDefinition): void {
    const payload = escapeSqlString(JSON.stringify(definition));
    const description =
      definition.description !== undefined
        ? `'${escapeSqlString(definition.description)}'`
        : "NULL";
    const sql = `
      INSERT INTO pipeline_definitions (pipeline_id, pipeline_name, description, payload, updated_at)
      VALUES ('${escapeSqlString(definition.id)}', '${escapeSqlString(definition.name)}', ${description}, '${payload}', datetime('now'))
      ON CONFLICT(pipeline_id) DO UPDATE SET
        pipeline_name=excluded.pipeline_name,
        description=excluded.description,
        payload=excluded.payload,
        updated_at=datetime('now');
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to save pipeline ${definition.id}: ${result.stderr.trim()}`);
    }
  }

  list(): PipelineDefinition[] {
    const sql = `
      SELECT json_object('pipeline_id', pipeline_id, 'payload', payload)
      FROM pipeline_definitions
      ORDER BY updated_at DESC, pipeline_id ASC;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to list pipelines: ${result.stderr.trim()}`);
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SqliteRow)
      .map((row) => JSON.parse(row.payload) as PipelineDefinition);
  }

  get(pipelineId: string): PipelineDefinition | undefined {
    const sql = `
      SELECT json_object('pipeline_id', pipeline_id, 'payload', payload)
      FROM pipeline_definitions
      WHERE pipeline_id = '${escapeSqlString(pipelineId)}'
      LIMIT 1;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to get pipeline ${pipelineId}: ${result.stderr.trim()}`);
    }

    const line = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);

    if (!line) return undefined;
    const row = JSON.parse(line) as SqliteRow;
    return JSON.parse(row.payload) as PipelineDefinition;
  }

  delete(pipelineId: string): boolean {
    const sql = `
      DELETE FROM pipeline_definitions
      WHERE pipeline_id = '${escapeSqlString(pipelineId)}';
      SELECT changes();
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to delete pipeline ${pipelineId}: ${result.stderr.trim()}`);
    }

    const lines = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const changes = Number(lines.at(-1) ?? "0");
    return changes > 0;
  }

  private initialize(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS pipeline_definitions (
        pipeline_id TEXT PRIMARY KEY,
        pipeline_name TEXT NOT NULL,
        description TEXT,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_definitions_updated_at ON pipeline_definitions(updated_at DESC);
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to initialize pipeline store: ${result.stderr.trim()}`);
    }
  }
}

export class SqliteRunEventStore {
  private readonly dbPath: string;
  private readonly mirrorLogPath?: string;

  constructor(dbPath = getDefaultDatabasePath(), mirrorLogPath?: string) {
    this.dbPath = dbPath;
    this.mirrorLogPath = mirrorLogPath;
    ensureDir(path.dirname(this.dbPath));
    this.initialize();
  }

  append(event: RunEventRecord): void {
    const payload =
      event.payload !== undefined ? `'${escapeSqlString(JSON.stringify(event.payload))}'` : "NULL";
    const nodeId = event.nodeId ? `'${escapeSqlString(event.nodeId)}'` : "NULL";
    const nodeName = event.nodeName ? `'${escapeSqlString(event.nodeName)}'` : "NULL";
    const sql = `
      INSERT INTO run_events (run_id, timestamp, event_type, node_id, node_name, payload)
      VALUES (
        '${escapeSqlString(event.runId)}',
        '${escapeSqlString(event.timestamp)}',
        '${escapeSqlString(event.type)}',
        ${nodeId},
        ${nodeName},
        ${payload}
      );
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to append run event for ${event.runId}: ${result.stderr.trim()}`);
    }

    if (this.mirrorLogPath) {
      try {
        writeJsonLineToFile(this.mirrorLogPath, {
          timestamp: event.timestamp,
          runId: event.runId,
          type: event.type,
          nodeId: event.nodeId,
          nodeName: event.nodeName,
          payload: event.payload ?? {},
        });
      } catch {
        // Keep runtime alive even if mirrored user log fails.
      }
    }
  }

  listForRun(runId: string): RunEventRecord[] {
    const sql = `
      SELECT json_object(
        'runId', run_id,
        'timestamp', timestamp,
        'type', event_type,
        'nodeId', node_id,
        'nodeName', node_name,
        'payload', payload
      )
      FROM run_events
      WHERE run_id = '${escapeSqlString(runId)}'
      ORDER BY event_id ASC;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to list run events for ${runId}: ${result.stderr.trim()}`);
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .map((row) => ({
        runId: String(row.runId),
        timestamp: String(row.timestamp),
        type: String(row.type) as RunEventRecord["type"],
        nodeId: row.nodeId ? String(row.nodeId) : undefined,
        nodeName: row.nodeName ? String(row.nodeName) : undefined,
        payload:
          typeof row.payload === "string" && row.payload.length > 0
            ? (JSON.parse(String(row.payload)) as Record<string, unknown>)
            : undefined,
      }));
  }

  private initialize(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS run_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        event_type TEXT NOT NULL,
        node_id TEXT,
        node_name TEXT,
        payload TEXT,
        FOREIGN KEY(run_id) REFERENCES pipeline_runs(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id, event_id ASC);
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to initialize run event store: ${result.stderr.trim()}`);
    }
  }
}

export class SqliteTaskQueueStore {
  private readonly dbPath: string;

  constructor(dbPath = getDefaultDatabasePath()) {
    this.dbPath = dbPath;
    ensureDir(path.dirname(this.dbPath));
    this.initialize();
  }

  saveQueue(queue: TaskQueueRecord): void {
    const payload = escapeSqlString(JSON.stringify(queue));
    const sql = `
      INSERT INTO task_queues (queue_id, user_id, pipeline_id, queue_name, status, updated_at, payload)
      VALUES (
        '${escapeSqlString(queue.queueId)}',
        '${escapeSqlString(queue.userId)}',
        '${escapeSqlString(queue.pipelineId)}',
        '${escapeSqlString(queue.name)}',
        '${escapeSqlString(queue.status)}',
        '${escapeSqlString(queue.updatedAt)}',
        '${payload}'
      )
      ON CONFLICT(queue_id) DO UPDATE SET
        user_id=excluded.user_id,
        pipeline_id=excluded.pipeline_id,
        queue_name=excluded.queue_name,
        status=excluded.status,
        updated_at=excluded.updated_at,
        payload=excluded.payload;
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to save queue ${queue.queueId}: ${result.stderr.trim()}`);
    }
  }

  listQueues(): TaskQueueRecord[] {
    const sql = `
      SELECT json_object('queue_id', queue_id, 'payload', payload)
      FROM task_queues
      ORDER BY updated_at DESC, queue_id ASC;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to list task queues: ${result.stderr.trim()}`);
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SqliteRow)
      .map((row) => JSON.parse(row.payload) as TaskQueueRecord);
  }

  getQueue(queueId: string): TaskQueueRecord | undefined {
    const sql = `
      SELECT json_object('queue_id', queue_id, 'payload', payload)
      FROM task_queues
      WHERE queue_id = '${escapeSqlString(queueId)}'
      LIMIT 1;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to get queue ${queueId}: ${result.stderr.trim()}`);
    }

    const line = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);

    if (!line) return undefined;
    const row = JSON.parse(line) as SqliteRow;
    return JSON.parse(row.payload) as TaskQueueRecord;
  }

  saveTask(task: QueueTaskRecord): void {
    const payload = escapeSqlString(JSON.stringify(task));
    const sql = `
      INSERT INTO queue_tasks (
        task_id, user_id, queue_id, pipeline_id, title, status, position, updated_at, run_id, payload
      )
      VALUES (
        '${escapeSqlString(task.taskId)}',
        '${escapeSqlString(task.userId)}',
        '${escapeSqlString(task.queueId)}',
        '${escapeSqlString(task.pipelineId)}',
        '${escapeSqlString(task.title)}',
        '${escapeSqlString(task.status)}',
        ${task.position},
        '${escapeSqlString(task.updatedAt)}',
        ${task.runId ? `'${escapeSqlString(task.runId)}'` : "NULL"},
        '${payload}'
      )
      ON CONFLICT(task_id) DO UPDATE SET
        user_id=excluded.user_id,
        queue_id=excluded.queue_id,
        pipeline_id=excluded.pipeline_id,
        title=excluded.title,
        status=excluded.status,
        position=excluded.position,
        updated_at=excluded.updated_at,
        run_id=excluded.run_id,
        payload=excluded.payload;
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to save task ${task.taskId}: ${result.stderr.trim()}`);
    }
  }

  listTasks(queueId?: string): QueueTaskRecord[] {
    const whereClause = queueId
      ? `WHERE queue_id = '${escapeSqlString(queueId)}'`
      : "";
    const sql = `
      SELECT json_object('task_id', task_id, 'payload', payload)
      FROM queue_tasks
      ${whereClause}
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'queued' THEN 1
          WHEN 'failed' THEN 2
          WHEN 'canceled' THEN 3
          ELSE 4
        END,
        position ASC,
        updated_at DESC,
        task_id ASC;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to list queue tasks: ${result.stderr.trim()}`);
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SqliteRow)
      .map((row) => JSON.parse(row.payload) as QueueTaskRecord);
  }

  getTask(taskId: string): QueueTaskRecord | undefined {
    const sql = `
      SELECT json_object('task_id', task_id, 'payload', payload)
      FROM queue_tasks
      WHERE task_id = '${escapeSqlString(taskId)}'
      LIMIT 1;
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to get task ${taskId}: ${result.stderr.trim()}`);
    }

    const line = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => item.length > 0);

    if (!line) return undefined;
    const row = JSON.parse(line) as SqliteRow;
    return JSON.parse(row.payload) as QueueTaskRecord;
  }

  deleteTask(taskId: string): boolean {
    const sql = `
      DELETE FROM queue_tasks
      WHERE task_id = '${escapeSqlString(taskId)}';
      SELECT changes();
    `;
    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to delete task ${taskId}: ${result.stderr.trim()}`);
    }

    const lines = result.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return Number(lines.at(-1) ?? "0") > 0;
  }

  private initialize(): void {
    const sql = `
      CREATE TABLE IF NOT EXISTS task_queues (
        queue_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        pipeline_id TEXT NOT NULL,
        queue_name TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_queues_pipeline_id ON task_queues(pipeline_id);
      CREATE TABLE IF NOT EXISTS queue_tasks (
        task_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        queue_id TEXT NOT NULL,
        pipeline_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        position INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        run_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queue_tasks_queue_id ON queue_tasks(queue_id, status, position ASC);
      CREATE INDEX IF NOT EXISTS idx_queue_tasks_run_id ON queue_tasks(run_id);
    `;

    const result = runSqlite(this.dbPath, sql);
    if (result.status !== 0) {
      throw new Error(`Failed to initialize task queue store: ${result.stderr.trim()}`);
    }
  }
}
