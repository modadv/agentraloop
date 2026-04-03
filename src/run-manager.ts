import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { logError, logInfo } from "./logger.js";
import { runPipeline, type RuntimeControl } from "./runtime.js";
import { loadPipelineDefinition } from "./schema.js";
import { SqlitePipelineStore, SqliteRunEventStore, SqliteRunStore, SqliteTaskQueueStore } from "./store.js";
import {
  type CommitSummary,
  type ModelProfile,
  type PipelineDefinition,
  type PipelineExecutionRequest,
  type PipelineRunConfig,
  type PipelineRunRecord,
  type PipelineRunRequest,
  type QueueTaskCreateRequest,
  type QueueTaskRecord,
  type QueueTaskReorderRequest,
  type QueueTaskUpdateRequest,
  type RunControlState,
  type TaskQueueRecord,
  type WorkspaceRepoContext,
} from "./types.js";

type ManagedRun = {
  record: PipelineRunRecord;
  requestedControlState: RunControlState;
  activeInvocation:
    | {
        nodeId: string;
        nodeName: string;
        provider: PipelineDefinition["nodes"][number]["provider"];
        model: string;
        abortController: AbortController;
      }
    | null;
  waiter: {
    promise: Promise<void>;
    resolve: () => void;
  } | null;
  task: Promise<void> | null;
};

type ManagerDefaults = {
  userId?: string;
  pipelinePath: string;
  pipelineCwd: string;
  modelProfile: ModelProfile;
  databasePath?: string;
  eventLogPath?: string;
};

type RunManagerDependencies = {
  loadPipelineDefinition?: typeof loadPipelineDefinition;
  runPipeline?: typeof runPipeline;
  runStore?: Pick<SqliteRunStore, "save" | "list" | "get" | "getDatabasePath">;
  pipelineStore?: Pick<SqlitePipelineStore, "save" | "list" | "get" | "delete">;
  eventStore?: Pick<SqliteRunEventStore, "append" | "listForRun">;
  taskQueueStore?: Pick<
    SqliteTaskQueueStore,
    "saveQueue" | "listQueues" | "getQueue" | "saveTask" | "listTasks" | "getTask" | "deleteTask"
  >;
};

function normalizeWorkspaceKey(workspacePath: string): string {
  const normalized = path.win32.normalize(workspacePath).replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  return (trimmed || "/").toLowerCase();
}

function isAbsoluteFilesystemPath(filePath: string): boolean {
  return path.isAbsolute(filePath) || /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath);
}

export class WorkspaceConflictError extends Error {
  constructor(
    readonly workspacePath: string,
    readonly conflictingRunId: string,
    readonly conflictingPipelineId: string,
  ) {
    super(
      `Workspace is already in use: ${workspacePath} (run ${conflictingRunId}, pipeline ${conflictingPipelineId}).`,
    );
    this.name = "WorkspaceConflictError";
  }
}

function createWaiter(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function finalizeConfig(
  defaults: ManagerDefaults,
  request: PipelineRunRequest = {},
): PipelineRunConfig {
  const pipelinePath = request.pipelinePath ?? defaults.pipelinePath;
  const pipelineCwd = request.pipelineCwd ?? defaults.pipelineCwd;
  const modelProfile = request.modelProfile ?? defaults.modelProfile;
  const taskTitle = request.taskTitle?.trim() || undefined;
  const taskPrompt = request.taskPrompt?.trim() || undefined;

  return {
    userId: request.userId ?? defaults.userId,
    pipelinePath: isAbsoluteFilesystemPath(pipelinePath)
      ? pipelinePath
      : path.resolve(process.cwd(), pipelinePath),
    pipelineCwd: isAbsoluteFilesystemPath(pipelineCwd)
      ? pipelineCwd
      : path.resolve(process.cwd(), pipelineCwd),
    modelProfile,
    queueId: request.queueId,
    taskId: request.taskId,
    taskTitle,
    taskPrompt,
  };
}

function runGitCommand(workspacePath: string, args: string[]): string | undefined {
  const result = spawnSync("git", ["-C", workspacePath, ...args], {
    encoding: "utf-8",
    windowsHide: true,
  });

  if ((result.status ?? 1) !== 0) {
    return undefined;
  }

  return result.stdout?.trim() || undefined;
}

export function inspectWorkspaceGitContext(
  workspacePath: string,
): WorkspaceRepoContext {
  const repoUrl = runGitCommand(workspacePath, ["remote", "get-url", "origin"]);
  const branch = runGitCommand(workspacePath, ["branch", "--show-current"]);
  const rawLog = runGitCommand(workspacePath, [
    "log",
    "--max-count=5",
    "--pretty=format:%H%x1f%s%x1f%cI",
  ]);

  const recentCommits: CommitSummary[] =
    rawLog
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [sha, summary, committedAt] = line.split("\u001f");
        if (!sha || !summary || !committedAt) return null;
        return { sha, summary, committedAt };
      })
      .filter((item): item is CommitSummary => item !== null) ?? [];

  return {
    repoUrl,
    branch,
    recentCommits,
  };
}

export class RunManager {
  private readonly store: Pick<SqliteRunStore, "save" | "list" | "get" | "getDatabasePath">;
  private readonly pipelineStore: Pick<SqlitePipelineStore, "save" | "list" | "get" | "delete">;
  private readonly eventStore: Pick<SqliteRunEventStore, "append" | "listForRun">;
  private readonly taskQueueStore: Pick<
    SqliteTaskQueueStore,
    "saveQueue" | "listQueues" | "getQueue" | "saveTask" | "listTasks" | "getTask" | "deleteTask"
  >;
  private readonly managedRuns = new Map<string, ManagedRun>();
  private readonly dispatchingQueues = new Set<string>();
  private readonly loadPipelineDefinitionFn: typeof loadPipelineDefinition;
  private readonly runPipelineFn: typeof runPipeline;

  constructor(
    private readonly defaults: ManagerDefaults,
    dependencies: RunManagerDependencies = {},
  ) {
    this.store = dependencies.runStore ?? new SqliteRunStore(defaults.databasePath);
    this.pipelineStore = dependencies.pipelineStore ?? new SqlitePipelineStore(defaults.databasePath);
    this.eventStore =
      dependencies.eventStore ??
      new SqliteRunEventStore(defaults.databasePath, defaults.eventLogPath);
    this.taskQueueStore = dependencies.taskQueueStore ?? new SqliteTaskQueueStore(defaults.databasePath);
    this.loadPipelineDefinitionFn = dependencies.loadPipelineDefinition ?? loadPipelineDefinition;
    this.runPipelineFn = dependencies.runPipeline ?? runPipeline;
  }

  listRuns(): PipelineRunRecord[] {
    const storedRuns = this.store.list();
    const runMap = new Map(storedRuns.map((run) => [run.runId, run]));
    for (const [runId, managedRun] of this.managedRuns.entries()) {
      runMap.set(runId, managedRun.record);
    }
    return [...runMap.values()].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  getRun(runId: string): PipelineRunRecord | undefined {
    return this.managedRuns.get(runId)?.record ?? this.store.get(runId);
  }

  getDatabasePath(): string {
    return this.store.getDatabasePath();
  }

  listRunEvents(runId: string) {
    return this.eventStore.listForRun(runId);
  }

  listPipelines(): PipelineDefinition[] {
    return this.pipelineStore.list();
  }

  getPipeline(pipelineId: string): PipelineDefinition | undefined {
    return this.pipelineStore.get(pipelineId);
  }

  listQueues(): TaskQueueRecord[] {
    this.syncQueuesWithPipelines();
    return this.taskQueueStore
      .listQueues()
      .filter((queue) => queue.userId === (this.defaults.userId ?? queue.userId))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  getQueue(queueId: string): TaskQueueRecord | undefined {
    this.syncQueuesWithPipelines();
    return this.taskQueueStore.getQueue(queueId);
  }

  listQueueTasks(queueId: string): QueueTaskRecord[] {
    this.ensureQueueForPipeline(queueId);
    return this.taskQueueStore.listTasks(queueId);
  }

  enqueueTask(request: QueueTaskCreateRequest): QueueTaskRecord {
    const pipelineId = request.pipelineId ?? request.queueId;
    if (!pipelineId) {
      throw new Error("Task creation requires pipelineId or queueId.");
    }

    const queue = this.ensureQueueForPipeline(pipelineId);
    const tasks = this.taskQueueStore.listTasks(queue.queueId);
    const maxPosition = tasks.reduce((max, task) => Math.max(max, task.position), -1);
    const now = new Date().toISOString();
    const task: QueueTaskRecord = {
      taskId: randomUUID(),
      userId: request.userId ?? this.defaults.userId ?? queue.userId,
      queueId: queue.queueId,
      pipelineId: queue.pipelineId,
      title: request.title.trim(),
      prompt: request.prompt.trim(),
      status: "queued",
      position: maxPosition + 1,
      pipelineCwd: request.pipelineCwd
        ? isAbsoluteFilesystemPath(request.pipelineCwd)
          ? request.pipelineCwd
          : path.resolve(process.cwd(), request.pipelineCwd)
        : this.defaults.pipelineCwd,
      modelProfile: request.modelProfile ?? this.defaults.modelProfile,
      createdAt: now,
      updatedAt: now,
    };

    this.taskQueueStore.saveTask(task);
    void this.dispatchQueue(queue.queueId);
    return task;
  }

  updateTask(taskId: string, patch: QueueTaskUpdateRequest): QueueTaskRecord {
    const existing = this.taskQueueStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (existing.status !== "queued") {
      throw new Error(`Only queued tasks can be edited. Task ${taskId} is ${existing.status}.`);
    }

    const updated: QueueTaskRecord = {
      ...existing,
      title: patch.title?.trim() || existing.title,
      prompt: patch.prompt?.trim() || existing.prompt,
      updatedAt: new Date().toISOString(),
    };
    this.taskQueueStore.saveTask(updated);
    return updated;
  }

  deleteTask(taskId: string): boolean {
    const existing = this.taskQueueStore.getTask(taskId);
    if (!existing) {
      throw new Error(`Task not found: ${taskId}`);
    }
    if (existing.status !== "queued") {
      throw new Error(`Only queued tasks can be removed. Task ${taskId} is ${existing.status}.`);
    }
    return this.taskQueueStore.deleteTask(taskId);
  }

  reorderQueue(queueId: string, request: QueueTaskReorderRequest): QueueTaskRecord[] {
    const queue = this.ensureQueueForPipeline(queueId);
    const queuedTasks = this.taskQueueStore
      .listTasks(queue.queueId)
      .filter((task) => task.status === "queued")
      .sort((left, right) => left.position - right.position);

    const currentIds = queuedTasks.map((task) => task.taskId).sort();
    const requestedIds = [...request.taskIds].sort();
    if (currentIds.length !== requestedIds.length || currentIds.some((id, index) => id !== requestedIds[index])) {
      throw new Error("Queue reorder request must include exactly the queued task ids for this queue.");
    }

    const taskMap = new Map(queuedTasks.map((task) => [task.taskId, task]));
    const reordered = request.taskIds.map((taskId, index) => {
      const task = taskMap.get(taskId);
      if (!task) {
        throw new Error(`Task not found during reorder: ${taskId}`);
      }
      const updated: QueueTaskRecord = {
        ...task,
        position: index,
        updatedAt: new Date().toISOString(),
      };
      this.taskQueueStore.saveTask(updated);
      return updated;
    });

    return reordered;
  }

  pauseQueue(queueId: string): TaskQueueRecord {
    const queue = this.ensureQueueForPipeline(queueId);
    const updated: TaskQueueRecord = {
      ...queue,
      status: "paused",
      updatedAt: new Date().toISOString(),
    };
    this.taskQueueStore.saveQueue(updated);
    return updated;
  }

  resumeQueue(queueId: string): TaskQueueRecord {
    const queue = this.ensureQueueForPipeline(queueId);
    const updated: TaskQueueRecord = {
      ...queue,
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    this.taskQueueStore.saveQueue(updated);
    void this.dispatchQueue(queueId);
    return updated;
  }

  getPipelineForRun(runId: string): PipelineDefinition | undefined {
    const run = this.store.get(runId);
    if (!run) return undefined;

    const persistedPrefix = "db://pipelines/";
    if (run.config.pipelinePath.startsWith(persistedPrefix)) {
      const pipelineId = run.config.pipelinePath.slice(persistedPrefix.length);
      return this.pipelineStore.get(pipelineId);
    }

    return this.loadPipelineDefinitionFn(run.config.pipelinePath);
  }

  savePipeline(definition: PipelineDefinition): void {
    this.pipelineStore.save(definition);
  }

  deletePipeline(pipelineId: string): boolean {
    return this.pipelineStore.delete(pipelineId);
  }

  seedPipelineFromFile(filePath: string): PipelineDefinition {
    const definition = this.loadPipelineDefinitionFn(filePath);
    this.pipelineStore.save(definition);
    return definition;
  }

  createRun(request: PipelineExecutionRequest = {}): PipelineRunRecord {
    const { config: baseConfig, definition } = this.resolveExecutionTarget(request);
    const config = { ...baseConfig };
    const conflictingRun = this.findActiveWorkspaceConflict(config.pipelineCwd);
    if (conflictingRun) {
      throw new WorkspaceConflictError(
        config.pipelineCwd,
        conflictingRun.record.runId,
        conflictingRun.record.pipelineId,
      );
    }
    Object.assign(config, inspectWorkspaceGitContext(config.pipelineCwd));
    const runId = randomUUID();

    const record: PipelineRunRecord = {
      runId,
      pipelineId: definition.id,
      pipelineName: definition.name,
      status: "pending",
      startedAt: new Date().toISOString(),
      controlState: "running",
      config,
      nodeRuns: [],
    };

    const managedRun: ManagedRun = {
      record,
      requestedControlState: "running",
      activeInvocation: null,
      waiter: null,
      task: null,
    };

    this.store.save(record);
    this.eventStore.append({
      runId,
      timestamp: new Date().toISOString(),
      type: "run_created",
      payload: {
        pipelineId: definition.id,
        pipelineName: definition.name,
        pipelinePath: config.pipelinePath,
        pipelineCwd: config.pipelineCwd,
        modelProfile: config.modelProfile,
        queueId: config.queueId,
        taskId: config.taskId,
        taskTitle: config.taskTitle,
        hasTaskPrompt: Boolean(config.taskPrompt),
        repoUrl: config.repoUrl,
        branch: config.branch,
        recentCommitCount: config.recentCommits?.length ?? 0,
      },
    });
    this.managedRuns.set(runId, managedRun);

    managedRun.task = this.executeRun(runId, definition, config);

    logInfo("run_manager.run.created", {
      runId,
      pipelineId: definition.id,
        pipelinePath: config.pipelinePath,
        pipelineCwd: config.pipelineCwd,
        queueId: config.queueId,
        taskId: config.taskId,
        taskTitle: config.taskTitle,
      });

    return record;
  }

  pauseRun(runId: string): PipelineRunRecord {
    const managedRun = this.requireManagedRun(runId);
    if (managedRun.record.status === "completed" || managedRun.record.status === "failed" || managedRun.record.status === "canceled") {
      throw new Error(`Run ${runId} is already finished.`);
    }

    managedRun.requestedControlState = "pause_requested";
    if (managedRun.record.status === "pending") {
      managedRun.record.status = "paused";
      managedRun.record.controlState = "paused";
    } else {
      managedRun.record.controlState = "pause_requested";
    }
    this.eventStore.append({
      runId,
      timestamp: new Date().toISOString(),
      type: "run_paused",
      payload: {
        requested: true,
        currentStatus: managedRun.record.status,
      },
    });
    this.store.save(managedRun.record);
    return managedRun.record;
  }

  resumeRun(runId: string): PipelineRunRecord {
    const managedRun = this.requireManagedRun(runId);
    if (managedRun.record.status === "completed" || managedRun.record.status === "failed" || managedRun.record.status === "canceled") {
      throw new Error(`Run ${runId} is already finished.`);
    }

    managedRun.requestedControlState = "running";
    if (managedRun.record.status === "paused") {
      managedRun.record.status = "running";
    }
    managedRun.record.controlState = "running";
    managedRun.waiter?.resolve();
    managedRun.waiter = null;
    this.eventStore.append({
      runId,
      timestamp: new Date().toISOString(),
      type: "run_resumed",
      payload: {
        currentStatus: managedRun.record.status,
      },
    });
    this.store.save(managedRun.record);
    return managedRun.record;
  }

  cancelRun(runId: string): PipelineRunRecord {
    const managedRun = this.requireManagedRun(runId);
    if (managedRun.record.status === "completed" || managedRun.record.status === "failed" || managedRun.record.status === "canceled") {
      throw new Error(`Run ${runId} is already finished.`);
    }

    managedRun.requestedControlState = "cancel_requested";
    this.eventStore.append({
      runId,
      timestamp: new Date().toISOString(),
      type: "run_cancel_requested",
      payload: {
        currentStatus: managedRun.record.status,
      },
    });
    if (managedRun.record.status === "pending" || managedRun.record.status === "paused") {
      managedRun.record.status = "canceled";
      managedRun.record.controlState = undefined;
      managedRun.record.endedAt = new Date().toISOString();
      managedRun.waiter?.resolve();
      managedRun.waiter = null;
      this.store.save(managedRun.record);
      this.eventStore.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "run_canceled",
        payload: {
          currentStatus: managedRun.record.status,
        },
      });
      this.finalizeTaskFromRun(managedRun.record.config, "canceled");
    } else {
      managedRun.record.status = "canceling";
      managedRun.record.controlState = "cancel_requested";
      this.store.save(managedRun.record);
    }
    return managedRun.record;
  }

  retryRun(runId: string): PipelineRunRecord {
    const existing = this.store.get(runId);
    if (!existing) {
      throw new Error(`Run not found: ${runId}`);
    }
    if (existing.status !== "failed" && existing.status !== "canceled" && existing.status !== "completed") {
      throw new Error(`Run ${runId} is not retryable in status ${existing.status}.`);
    }
    const persistedPrefix = "db://pipelines/";
    if (existing.config.pipelinePath.startsWith(persistedPrefix)) {
      return this.createRun({
        userId: existing.config.userId,
        pipelineId: existing.config.pipelinePath.slice(persistedPrefix.length),
        pipelineCwd: existing.config.pipelineCwd,
        modelProfile: existing.config.modelProfile,
        taskTitle: existing.config.taskTitle,
        taskPrompt: existing.config.taskPrompt,
        repoUrl: existing.config.repoUrl,
        branch: existing.config.branch,
        recentCommits: existing.config.recentCommits,
      });
    }
    return this.createRun(existing.config);
  }

  dispatchQueues(): void {
    this.kickQueues();
  }

  private syncQueuesWithPipelines(): void {
    const now = new Date().toISOString();
    for (const pipeline of this.pipelineStore.list()) {
      const existing = this.taskQueueStore.getQueue(pipeline.id);
      if (
        existing &&
        existing.userId === (this.defaults.userId ?? existing.userId) &&
        existing.pipelineId === pipeline.id &&
        existing.name === pipeline.name
      ) {
        continue;
      }
      const queue: TaskQueueRecord = {
        queueId: pipeline.id,
        userId: this.defaults.userId ?? "admin",
        pipelineId: pipeline.id,
        name: pipeline.name,
        status: existing?.status ?? "active",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      this.taskQueueStore.saveQueue(queue);
    }
  }

  private ensureQueueForPipeline(pipelineId: string): TaskQueueRecord {
    this.syncQueuesWithPipelines();
    const queue = this.taskQueueStore.getQueue(pipelineId);
    if (!queue) {
      throw new Error(`Queue not found for pipeline: ${pipelineId}`);
    }
    return queue;
  }

  private async dispatchQueue(queueId: string): Promise<void> {
    if (this.dispatchingQueues.has(queueId)) {
      return;
    }

    this.dispatchingQueues.add(queueId);
    try {
      const queue = this.ensureQueueForPipeline(queueId);
      if (queue.status !== "active") {
        return;
      }

      const tasks = this.taskQueueStore.listTasks(queue.queueId);
      if (tasks.some((task) => task.status === "running")) {
        return;
      }

      const nextTask = tasks
        .filter((task) => task.status === "queued")
        .sort((left, right) => left.position - right.position || left.createdAt.localeCompare(right.createdAt))[0];

      if (!nextTask) {
        return;
      }

      let runRecord: PipelineRunRecord;
      try {
        runRecord = this.createRun({
          userId: nextTask.userId,
          pipelineId: nextTask.pipelineId,
          pipelineCwd: nextTask.pipelineCwd ?? this.defaults.pipelineCwd,
          modelProfile: nextTask.modelProfile ?? this.defaults.modelProfile,
          queueId: nextTask.queueId,
          taskId: nextTask.taskId,
          taskTitle: nextTask.title,
          taskPrompt: nextTask.prompt,
        });
      } catch (error) {
        if (error instanceof WorkspaceConflictError) {
          return;
        }
        throw error;
      }

      this.taskQueueStore.saveTask({
        ...nextTask,
        status: "running",
        runId: runRecord.runId,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } finally {
      this.dispatchingQueues.delete(queueId);
    }
  }

  private kickQueues(): void {
    for (const queue of this.listQueues()) {
      void this.dispatchQueue(queue.queueId);
    }
  }

  private finalizeTaskFromRun(config: PipelineRunConfig, runStatus: PipelineRunRecord["status"]): void {
    if (!config.taskId) {
      this.kickQueues();
      return;
    }

    const task = this.taskQueueStore.getTask(config.taskId);
    if (task) {
      const status =
        runStatus === "completed"
          ? "completed"
          : runStatus === "canceled"
            ? "canceled"
            : "failed";
      this.taskQueueStore.saveTask({
        ...task,
        status,
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
    }

    this.kickQueues();
  }

  private resolveExecutionTarget(
    request: PipelineExecutionRequest,
  ): { config: PipelineRunConfig; definition: PipelineDefinition } {
    if (request.pipelineId) {
      const definition = this.pipelineStore.get(request.pipelineId);
      if (!definition) {
        throw new Error(`Pipeline not found: ${request.pipelineId}`);
      }
      const config = finalizeConfig(this.defaults, request);
      config.pipelinePath = `db://pipelines/${definition.id}`;
      return { config, definition };
    }

    const config = finalizeConfig(this.defaults, request);
    const definition = this.loadPipelineDefinitionFn(config.pipelinePath);
    return { config, definition };
  }

  private async executeRun(
    runId: string,
    definition: ReturnType<typeof loadPipelineDefinition>,
    config: PipelineRunConfig,
  ): Promise<void> {
    const managedRun = this.requireManagedRun(runId);
    if (managedRun.requestedControlState === "pause_requested") {
      managedRun.record.status = "paused";
      managedRun.record.controlState = "paused";
      this.store.save(managedRun.record);
    } else if (managedRun.requestedControlState === "cancel_requested") {
      managedRun.record.status = "canceled";
      managedRun.record.controlState = "cancel_requested";
      managedRun.record.endedAt = new Date().toISOString();
      this.store.save(managedRun.record);
      return;
    } else {
      managedRun.record.status = "running";
      managedRun.record.controlState = "running";
      this.store.save(managedRun.record);
    }

    const control: RuntimeControl = {
      getControlState: () => managedRun.requestedControlState,
      waitIfPaused: async () => {
        if (managedRun.requestedControlState !== "pause_requested") return;
        managedRun.requestedControlState = "paused";
        managedRun.record.controlState = "paused";
        managedRun.record.status = "paused";
        this.store.save(managedRun.record);
        managedRun.waiter = createWaiter();
        await managedRun.waiter.promise;
      },
      shouldCancel: () => managedRun.requestedControlState === "cancel_requested",
      createAbortController: ({ nodeId, nodeName, provider, model }) => {
        const abortController = new AbortController();
        managedRun.activeInvocation = {
          nodeId,
          nodeName,
          provider,
          model,
          abortController,
        };
        return abortController;
      },
      clearAbortController: (nodeId) => {
        if (managedRun.activeInvocation?.nodeId === nodeId) {
          managedRun.activeInvocation = null;
        }
      },
    };

    try {
      const finalRecord = await this.runPipelineFn({
        definition,
        config,
        control,
        existingRunId: runId,
        eventSink: this.eventStore,
        onUpdate: (updatedRun) => {
          managedRun.record = updatedRun;
          this.store.save(updatedRun);
        },
      });
      if (
        finalRecord.status === "completed" ||
        finalRecord.status === "failed" ||
        finalRecord.status === "canceled"
      ) {
        finalRecord.controlState = undefined;
      }
      this.store.save(finalRecord);
      managedRun.record = finalRecord;
      this.finalizeTaskFromRun(config, finalRecord.status);
      logInfo("run_manager.run.finished", {
        runId,
        status: finalRecord.status,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      managedRun.record.status = "failed";
      managedRun.record.endedAt = new Date().toISOString();
      managedRun.record.controlState = undefined;
      this.store.save(managedRun.record);
      this.eventStore.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "run_failed",
        payload: {
          error: message,
        },
      });
      this.finalizeTaskFromRun(config, "failed");
      logError("run_manager.run.crashed", { runId, error: message });
    } finally {
      managedRun.activeInvocation = null;
      managedRun.waiter?.resolve();
      managedRun.waiter = null;
      managedRun.task = null;
    }
  }

  async gracefulShutdown(reason = "Server shutdown requested.", timeoutMs = 10000): Promise<void> {
    const activeRuns = [...this.managedRuns.values()].filter(
      (managedRun) =>
        managedRun.record.status !== "completed" &&
        managedRun.record.status !== "failed" &&
        managedRun.record.status !== "canceled",
    );

    for (const managedRun of activeRuns) {
      managedRun.requestedControlState = "cancel_requested";
      managedRun.record.controlState = "cancel_requested";
      if (managedRun.record.status === "pending" || managedRun.record.status === "paused") {
        managedRun.record.status = "canceled";
        managedRun.record.endedAt = new Date().toISOString();
      } else if (managedRun.record.status === "running") {
        managedRun.record.status = "canceling";
      }
      this.store.save(managedRun.record);
      this.eventStore.append({
        runId: managedRun.record.runId,
        timestamp: new Date().toISOString(),
        type: "run_cancel_requested",
        payload: {
          reason,
          source: "graceful_shutdown",
          nodeId: managedRun.activeInvocation?.nodeId,
        },
      });
      managedRun.activeInvocation?.abortController.abort(reason);
      managedRun.waiter?.resolve();
    }

    const tasks = activeRuns
      .map((managedRun) => managedRun.task)
      .filter((task): task is Promise<void> => Boolean(task));

    if (tasks.length === 0) {
      return;
    }

    await Promise.race([
      Promise.allSettled(tasks).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private requireManagedRun(runId: string): ManagedRun {
    const run = this.managedRuns.get(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    return run;
  }

  private findActiveWorkspaceConflict(workspacePath: string): ManagedRun | undefined {
    const workspaceKey = normalizeWorkspaceKey(workspacePath);
    for (const managedRun of this.managedRuns.values()) {
      const status = managedRun.record.status;
      if (status === "completed" || status === "failed" || status === "canceled") {
        continue;
      }
      if (normalizeWorkspaceKey(managedRun.record.config.pipelineCwd) === workspaceKey) {
        return managedRun;
      }
    }
    return undefined;
  }
}
