import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import {
  toValidationIssueView,
  toPipelineGraph,
  toPipelineSummary,
  toRunDetail,
  toRunEventView,
  toRunGraph,
  toRunSummary,
  toQueueTaskView,
  toTaskQueueView,
  toUserView,
} from "./api-contract.js";
import { logError, logInfo } from "./logger.js";
import { resolvePackagePath } from "./package-paths.js";
import { checkProviderAvailability } from "./providers/index.js";
import {
  pipelineGraphDraftToDefinition,
  PipelineValidationError,
  validatePipelineDefinition,
  validatePipelineDefinitionDetailed,
} from "./schema.js";
import { loadPipelineDefinition } from "./schema.js";
import { inspectWorkspaceGitContext, RunManager, WorkspaceConflictError } from "./run-manager.js";
import { JsonUserStore, createUserProfile } from "./user-store.js";
import {
  type ModelProfile,
  type PipelineCreateRequest,
  type PipelineExecutionRequest,
  type PipelineGraphSaveRequest,
  type PipelineUpdateRequest,
  type QueueTaskCreateRequest,
  type QueueTaskReorderRequest,
  type QueueTaskUpdateRequest,
  type UserCreateRequest,
  type UserProfile,
} from "./types.js";

export type ServerConfig = {
  port: number;
  pipelinePath: string;
  pipelineDirectories: string[];
  pipelineCwd: string;
  modelProfile: ModelProfile;
  databasePath: string;
  publicDir: string;
  serverLockPath: string;
  usersRootDir: string;
  usersFilePath: string;
  defaultUserId: string;
};

export function createConfig(): ServerConfig {
  const cwd = process.cwd();
  const projectPipelineDir = path.resolve(cwd, "pipelines");
  const userPipelineDir = path.resolve(os.homedir(), ".agentraloop", "pipelines");
  const localDefaultPipeline = path.resolve(projectPipelineDir, "default.pipeline.json");
  const bundledDefaultPipeline = resolvePackagePath("pipelines", "default.pipeline.json");
  const defaultWorkspace = path.resolve(
    cwd,
    process.env.PIPELINE_CWD ?? "runtime-workspaces/default",
  );
  return {
    port: Number(process.env.PORT ?? 8787),
    pipelinePath: process.env.PIPELINE_PATH
      ? path.resolve(cwd, process.env.PIPELINE_PATH)
      : existsSync(localDefaultPipeline)
        ? localDefaultPipeline
        : bundledDefaultPipeline,
    pipelineDirectories: [projectPipelineDir, userPipelineDir],
    pipelineCwd: defaultWorkspace,
    modelProfile: (process.env.PIPELINE_MODEL_PROFILE as ModelProfile | undefined) ?? "standard",
    databasePath: path.resolve(cwd, process.env.PIPELINE_DB_PATH ?? "data/pipeline.db"),
    publicDir: process.env.AGENTRALOOP_PUBLIC_DIR
      ? path.resolve(cwd, process.env.AGENTRALOOP_PUBLIC_DIR)
      : resolvePackagePath("public", "app"),
    serverLockPath: path.resolve(
      cwd,
      process.env.PIPELINE_SERVER_LOCK_PATH ?? "data/server.lock.json",
    ),
    usersRootDir: path.resolve(cwd, process.env.AGENTRALOOP_USERS_ROOT ?? "users"),
    usersFilePath: path.resolve(cwd, process.env.AGENTRALOOP_USERS_FILE ?? "data/users.json"),
    defaultUserId: process.env.AGENTRALOOP_DEFAULT_USER_ID ?? "admin",
  };
}

type ServerInstanceLockRecord = {
  pid: number;
  port: number;
  cwd: string;
  acquiredAt: string;
};

type ServerInstanceLock = {
  lockPath: string;
  release: () => void;
};

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireServerInstanceLock(config: ServerConfig): ServerInstanceLock {
  const lockPath = config.serverLockPath;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const record: ServerInstanceLockRecord = {
    pid: process.pid,
    port: config.port,
    cwd: process.cwd(),
    acquiredAt: new Date().toISOString(),
  };

  const writeRecord = (): void => {
    fs.writeFileSync(lockPath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: "utf-8",
      flag: "wx",
    });
  };

  try {
    writeRecord();
  } catch (error) {
    const withCode = error as NodeJS.ErrnoException;
    if (withCode.code !== "EEXIST") {
      throw error;
    }

    let existing: ServerInstanceLockRecord | null = null;
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as ServerInstanceLockRecord;
    } catch {
      existing = null;
    }

    if (existing && isProcessAlive(existing.pid)) {
      throw new Error(
        `Another agentraloop server instance is already running (pid ${existing.pid}, port ${existing.port}, lock ${lockPath}).`,
      );
    }

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Ignore stale lock cleanup failures and let retry surface the real error.
    }

    writeRecord();
  }

  const release = (): void => {
    try {
      if (!fs.existsSync(lockPath)) {
        return;
      }

      const current = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as Partial<ServerInstanceLockRecord>;
      if (current.pid !== process.pid) {
        return;
      }

      fs.unlinkSync(lockPath);
    } catch {
      // Ignore lock cleanup failures on shutdown.
    }
  };

  return { lockPath, release };
}

export function listPipelineFiles(directories: string[]): string[] {
  const files = new Set<string>();

  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".json")) continue;
      files.add(path.join(directory, entry.name));
    }
  }

  return [...files].sort((left, right) => left.localeCompare(right));
}

export function collectSeedPipelineFiles(config: ServerConfig): string[] {
  const files = new Set<string>();
  if (existsSync(config.pipelinePath)) {
    files.add(config.pipelinePath);
  }
  for (const filePath of listPipelineFiles(config.pipelineDirectories)) {
    files.add(filePath);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function seedPipelineDirectories(manager: RunManager, config: ServerConfig): void {
  const seeded: string[] = [];
  const failed: Array<{ filePath: string; error: string }> = [];

  for (const filePath of collectSeedPipelineFiles(config)) {
    try {
      manager.seedPipelineFromFile(filePath);
      seeded.push(filePath);
    } catch (error) {
      failed.push({
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logInfo("server.pipeline.seed.completed", {
    count: seeded.length,
    directories: config.pipelineDirectories,
    seeded,
    failed,
  });
}

function getUserScopedPipelineDirectories(config: ServerConfig, user: UserProfile): string[] {
  return [config.pipelineDirectories[0], user.pipelineDir];
}

function getUserDatabasePath(user: UserProfile): string {
  return path.join(user.dataDir, "pipeline.db");
}

function getUserEventLogPath(user: UserProfile): string {
  return path.join(user.logsDir, "pipeline-events.jsonl");
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  if (res.destroyed || res.writableEnded) {
    return;
  }

  try {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload, null, 2));
  } catch (error) {
    if (isIgnorableSocketError(error)) {
      return;
    }

    throw error;
  }
}

function sendFile(
  res: http.ServerResponse,
  statusCode: number,
  filePath: string,
  contentType: string,
): void {
  if (res.destroyed || res.writableEnded) {
    return;
  }

  try {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", contentType);
    res.end(fs.readFileSync(filePath));
  } catch (error) {
    if (isIgnorableSocketError(error)) {
      return;
    }

    throw error;
  }
}

type ErrorCandidate = {
  code: string | null;
  message: string;
};

function collectIgnorableErrorCandidates(
  error: unknown,
  depth = 0,
  seen = new Set<unknown>(),
): ErrorCandidate[] {
  if (depth > 4 || error == null || seen.has(error)) {
    return [];
  }

  seen.add(error);
  const candidates: ErrorCandidate[] = [];

  if (error instanceof Error) {
    const withCode = error as Error & { code?: string; cause?: unknown; errors?: unknown[] };
    candidates.push({
      code: withCode.code ?? null,
      message: error.message,
    });

    if ("cause" in withCode) {
      candidates.push(...collectIgnorableErrorCandidates(withCode.cause, depth + 1, seen));
    }

    if (Array.isArray(withCode.errors)) {
      for (const item of withCode.errors) {
        candidates.push(...collectIgnorableErrorCandidates(item, depth + 1, seen));
      }
    }

    return candidates;
  }

  if (typeof error === "object") {
    const value = error as Record<string, unknown>;
    candidates.push({
      code: typeof value.code === "string" ? value.code : null,
      message:
        typeof value.message === "string" ? value.message : String(error ?? ""),
    });

    if ("cause" in value) {
      candidates.push(...collectIgnorableErrorCandidates(value.cause, depth + 1, seen));
    }

    if (Array.isArray(value.errors)) {
      for (const item of value.errors) {
        candidates.push(...collectIgnorableErrorCandidates(item, depth + 1, seen));
      }
    }

    return candidates;
  }

  candidates.push({
    code: null,
    message: String(error ?? ""),
  });
  return candidates;
}

function isIgnorableSocketError(error: unknown): boolean {
  const fromCandidates = collectIgnorableErrorCandidates(error).some(({ code, message }) => {
    return (
      code === "EPIPE" ||
      code === "ECONNRESET" ||
      /broken pipe/i.test(message) ||
      /\bEPIPE\b/i.test(message) ||
      /\bECONNRESET\b/i.test(message)
    );
  });

  if (fromCandidates) {
    return true;
  }

  const diagnosticText = JSON.stringify({
    candidates: collectIgnorableErrorCandidates(error),
    error: describeUnknownError(error),
  });

  return (
    /broken pipe/i.test(diagnosticText) ||
    /\bEPIPE\b/i.test(diagnosticText) ||
    /\bECONNRESET\b/i.test(diagnosticText)
  );
}

function isDirectBrokenPipeWriteError(error: unknown): boolean {
  const description = describeUnknownError(error);
  const combined = [
    description.code,
    description.syscall,
    description.message,
    description.stringValue,
  ]
    .filter((value) => value != null)
    .join(" ");

  return (
    description.code === "EPIPE" ||
    (description.code === "ECONNRESET" && description.syscall === "write") ||
    /\bEPIPE\b/i.test(combined) ||
    /broken pipe/i.test(combined)
  );
}

function describeUnknownError(error: unknown): Record<string, unknown> {
  const objectValue = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const withFields = objectValue as {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    name?: unknown;
    stack?: unknown;
    message?: unknown;
  };

  return {
    typeof: typeof error,
    constructorName:
      error && typeof error === "object" && "constructor" in objectValue
        ? String((objectValue.constructor as { name?: unknown })?.name ?? "unknown")
        : null,
    name: withFields.name ?? (error instanceof Error ? error.name : null),
    code: withFields.code ?? null,
    errno: withFields.errno ?? null,
    syscall: withFields.syscall ?? null,
    message: withFields.message ?? (error instanceof Error ? error.message : String(error ?? "")),
    stack: withFields.stack ?? (error instanceof Error ? error.stack ?? null : null),
    keys: error && typeof error === "object" ? Object.keys(objectValue) : [],
    stringValue: String(error ?? ""),
  };
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function tryServeWebApp(
  res: http.ServerResponse,
  publicDir: string,
  pathname: string,
): boolean {
  const normalizedPath =
    pathname === "/" || pathname === "/app" || pathname === "/app/" ? "/index.html" : pathname;

  if (!normalizedPath.startsWith("/app/") && normalizedPath !== "/index.html") {
    return false;
  }

  const relativePath =
    normalizedPath === "/index.html" ? "index.html" : normalizedPath.replace(/^\/app\//, "");
  const resolvedPath = path.resolve(publicDir, relativePath);

  if (!resolvedPath.startsWith(publicDir)) {
    return false;
  }

  if (existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
    sendFile(res, 200, resolvedPath, contentTypeFor(resolvedPath));
    return true;
  }

  const spaEntryPath = path.join(publicDir, "index.html");
  if (existsSync(spaEntryPath)) {
    sendFile(res, 200, spaEntryPath, "text/html; charset=utf-8");
    return true;
  }

  return false;
}

function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function parseJsonBody<T>(req: http.IncomingMessage): Promise<T | undefined> {
  const body = await readRequestBody(req);
  if (!body.trim()) return undefined;
  return JSON.parse(body) as T;
}

function hasDefinition(
  value: PipelineCreateRequest | PipelineGraphSaveRequest | undefined,
): value is PipelineCreateRequest {
  return Boolean(value && "definition" in value && value.definition);
}

function hasDraft(
  value: PipelineCreateRequest | PipelineGraphSaveRequest | undefined,
): value is PipelineGraphSaveRequest {
  return Boolean(value && "draft" in value && value.draft);
}

function isActiveRunStatus(status: string): boolean {
  return status === "pending" || status === "running" || status === "paused" || status === "canceling";
}

export async function startServer(): Promise<void> {
  const config = createConfig();
  if (!existsSync(config.pipelinePath)) {
    throw new Error(`Pipeline definition not found: ${config.pipelinePath}`);
  }
  fs.mkdirSync(config.pipelineCwd, { recursive: true });
  fs.mkdirSync(config.usersRootDir, { recursive: true });
  const serverLock = acquireServerInstanceLock(config);

  try {
    const userStore = new JsonUserStore(config.usersFilePath, config.usersRootDir);
    const defaultUser = userStore.ensureAdmin();
    const managerCache = new Map<string, RunManager>();
    const defaultPipelineDirectory = config.pipelineDirectories[0] ?? path.resolve(process.cwd(), "pipelines");

    const getUser = (userId?: string): UserProfile => {
      const resolvedUserId = (userId ?? config.defaultUserId).trim() || config.defaultUserId;
      const user = userStore.get(resolvedUserId);
      if (!user) {
        throw new Error(`User not found: ${resolvedUserId}`);
      }
      return user;
    };

    const getManager = (userId?: string): RunManager => {
      const user = getUser(userId);
      const cached = managerCache.get(user.id);
      if (cached) {
        return cached;
      }

      const manager = new RunManager({
        userId: user.id,
        pipelinePath: config.pipelinePath,
        pipelineCwd: user.workspacePath,
        modelProfile: config.modelProfile,
        databasePath: getUserDatabasePath(user),
        eventLogPath: getUserEventLogPath(user),
      });
      seedPipelineDirectories(manager, {
        ...config,
        pipelineDirectories: getUserScopedPipelineDirectories(config, user),
      });
      manager.dispatchQueues();
      managerCache.set(user.id, manager);
      return manager;
    };

    getManager(defaultUser.id);
    let providerAvailability = await checkProviderAvailability();
    let shutdownInProgress = false;
    let ignorableSocketDiagnosticWritten = false;
    let exceptionDiagnosticWritten = false;
    let monitorDiagnosticWritten = false;
    let epipeDiagnosticLogged = false;

  const appendDiagnosticRecord = (fileName: string, payload: Record<string, unknown>): void => {
    const filePath = path.resolve(process.cwd(), "logs", fileName);

    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.appendFileSync(filePath, JSON.stringify(payload) + "\n", "utf-8");
    } catch (writeError) {
      try {
        const fallbackPath = path.resolve(process.cwd(), "logs", "diagnostic-fallback.log");
        fs.mkdirSync(path.dirname(fallbackPath), { recursive: true });
        fs.appendFileSync(
          fallbackPath,
          `${new Date().toISOString()} ${fileName} ${JSON.stringify({
            payload,
            writeError: describeUnknownError(writeError),
          })}\n`,
          "utf-8",
        );
      } catch {
        // Ignore diagnostic fallback failures.
      }
    }
  };

  const writeIgnorableSocketDiagnostic = (
    source: string,
    error: unknown,
    context: Record<string, unknown> = {},
  ): void => {
    if (ignorableSocketDiagnosticWritten) {
      return;
    }

    ignorableSocketDiagnosticWritten = true;
    appendDiagnosticRecord("socket-error-diagnostic.jsonl", {
      timestamp: new Date().toISOString(),
      event: "server.ignorable_socket_diagnostic",
      source,
      ...context,
      error: describeUnknownError(error),
    });
  };

  const logEpipeDiagnostic = (
    source: string,
    error: unknown,
    context: Record<string, unknown> = {},
  ): void => {
    if (epipeDiagnosticLogged) {
      return;
    }

    epipeDiagnosticLogged = true;
    logError("server.epipe_diagnostic", {
      source,
      directBrokenPipeWriteError: isDirectBrokenPipeWriteError(error),
      ignorableSocketError: isIgnorableSocketError(error),
      candidates: collectIgnorableErrorCandidates(error),
      error: describeUnknownError(error),
      ...context,
    });
  };

  const writeExceptionDiagnostic = (
    source: string,
    error: unknown,
    context: Record<string, unknown> = {},
  ): void => {
    if (exceptionDiagnosticWritten) {
      return;
    }

    exceptionDiagnosticWritten = true;
    appendDiagnosticRecord("exception-diagnostic.jsonl", {
      timestamp: new Date().toISOString(),
      event: "server.exception_diagnostic",
      source,
      ignorableSocketError: isIgnorableSocketError(error),
      candidates: collectIgnorableErrorCandidates(error),
      ...context,
      error: describeUnknownError(error),
    });
  };

  process.stdout.on("error", (error) => {
    if (isDirectBrokenPipeWriteError(error) || isIgnorableSocketError(error)) {
      logEpipeDiagnostic("process.stdout.error", error);
      writeIgnorableSocketDiagnostic("process.stdout.error", error);
    }
  });

  process.stderr.on("error", (error) => {
    if (isDirectBrokenPipeWriteError(error) || isIgnorableSocketError(error)) {
      logEpipeDiagnostic("process.stderr.error", error);
      writeIgnorableSocketDiagnostic("process.stderr.error", error);
    }
  });

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const requestUserId = url.searchParams.get("userId") ?? config.defaultUserId;

    req.on("error", (error) => {
      if (isDirectBrokenPipeWriteError(error) || isIgnorableSocketError(error)) {
        logEpipeDiagnostic("request.error", error, {
          method,
          path: url.pathname,
        });
        writeIgnorableSocketDiagnostic("request.error", error, {
          method,
          path: url.pathname,
        });
      }
    });

    res.on("error", (error) => {
      if (isDirectBrokenPipeWriteError(error) || isIgnorableSocketError(error)) {
        logEpipeDiagnostic("response.error", error, {
          method,
          path: url.pathname,
        });
        writeIgnorableSocketDiagnostic("response.error", error, {
          method,
          path: url.pathname,
        });
        return;
      }

      logError("server.response.error", {
        method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    try {
      if (method === "GET" && url.pathname === "/health") {
        providerAvailability = await checkProviderAvailability();
        const user = getUser(requestUserId);
        const scopedManager = getManager(user.id);
        sendJson(res, 200, {
          ok: true,
          databasePath: scopedManager.getDatabasePath(),
          pipelineCwd: user.workspacePath,
          defaultUserId: config.defaultUserId,
          user: toUserView(user),
          users: userStore.list().map((item) => toUserView(item)),
          workspaceRepoContext: inspectWorkspaceGitContext(user.workspacePath),
          providerAvailability,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/workspace-context") {
        const user = getUser(requestUserId);
        const workspacePath = url.searchParams.get("workspacePath")?.trim() || user.workspacePath;
        const resolvedWorkspacePath = path.isAbsolute(workspacePath)
          ? workspacePath
          : path.resolve(process.cwd(), workspacePath);

        sendJson(res, 200, {
          user: toUserView(user),
          workspacePath: resolvedWorkspacePath,
          context: inspectWorkspaceGitContext(resolvedWorkspacePath),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/users") {
        sendJson(res, 200, {
          users: userStore.list().map((user) => toUserView(user)),
          defaultUserId: config.defaultUserId,
        });
        return;
      }

      if (method === "POST" && url.pathname === "/users") {
        const request = await parseJsonBody<UserCreateRequest>(req);
        if (!request?.id) {
          sendJson(res, 400, { ok: false, error: "Request body must include id." });
          return;
        }
        const user = userStore.save(request);
        managerCache.delete(user.id);
        getManager(user.id);
        sendJson(res, 201, {
          ok: true,
          user: toUserView(user),
        });
        return;
      }

      if (method === "GET" && tryServeWebApp(res, config.publicDir, url.pathname)) {
        return;
      }

      if (method === "GET" && url.pathname === "/pipelines/default") {
        const definition = loadPipelineDefinition(config.pipelinePath);
        sendJson(res, 200, {
          pipeline: definition,
          summary: toPipelineSummary(definition),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/pipelines") {
        const scopedManager = getManager(requestUserId);
        sendJson(res, 200, {
          user: toUserView(getUser(requestUserId)),
          pipelines: scopedManager.listPipelines().map((pipeline) => ({
            summary: toPipelineSummary(pipeline),
            definition: pipeline,
          })),
          databasePath: scopedManager.getDatabasePath(),
        });
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/pipelines/")) {
        if (url.pathname.match(/^\/pipelines\/[^/]+\/graph$/)) {
          const pipelineId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
          const definition =
            pipelineId === "default"
              ? loadPipelineDefinition(config.pipelinePath)
              : getManager(requestUserId).getPipeline(pipelineId);
          if (!definition) {
            sendJson(res, 404, { ok: false, error: `Pipeline not found: ${pipelineId}` });
            return;
          }
          sendJson(res, 200, toPipelineGraph(definition));
          return;
        }

        const pipelineId = decodeURIComponent(url.pathname.replace("/pipelines/", ""));
        if (pipelineId === "default") {
          const definition = loadPipelineDefinition(config.pipelinePath);
          sendJson(res, 200, {
            pipeline: definition,
            summary: toPipelineSummary(definition),
          });
          return;
        }
        const pipeline = getManager(requestUserId).getPipeline(pipelineId);
        if (!pipeline) {
          sendJson(res, 404, { ok: false, error: `Pipeline not found: ${pipelineId}` });
          return;
        }
        sendJson(res, 200, {
          pipeline,
          summary: toPipelineSummary(pipeline),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/pipelines") {
        const request = await parseJsonBody<PipelineCreateRequest>(req);
        if (!request?.definition) {
          sendJson(res, 400, { ok: false, error: "Request body must include definition." });
          return;
        }
        validatePipelineDefinition(request.definition);
        getManager(requestUserId).savePipeline(request.definition);
        sendJson(res, 201, {
          ok: true,
          user: toUserView(getUser(requestUserId)),
          pipeline: request.definition,
          summary: toPipelineSummary(request.definition),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/pipeline-validations") {
        const request = await parseJsonBody<PipelineCreateRequest | PipelineGraphSaveRequest>(req);
        const definition = hasDraft(request)
          ? pipelineGraphDraftToDefinition(request.draft)
          : hasDefinition(request)
            ? request.definition
            : undefined;
        if (!definition) {
          sendJson(res, 400, { ok: false, error: "Request body must include definition or draft." });
          return;
        }
        const result = validatePipelineDefinitionDetailed(definition);
        sendJson(res, 200, {
          ok: result.ok,
          issues: result.issues.map((item) => toValidationIssueView(item)),
          summary: result.ok ? toPipelineSummary(definition) : null,
        });
        return;
      }

      if (method === "PUT" && url.pathname.match(/^\/pipelines\/[^/]+\/graph$/)) {
        const pipelineId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const request = await parseJsonBody<PipelineGraphSaveRequest>(req);
        if (!request?.draft) {
          sendJson(res, 400, { ok: false, error: "Request body must include draft." });
          return;
        }
        const definition = pipelineGraphDraftToDefinition(request.draft);
        if (definition.id !== pipelineId) {
          sendJson(res, 400, {
            ok: false,
            error: `Pipeline id mismatch: URL=${pipelineId}, body=${definition.id}`,
          });
          return;
        }
        const validation = validatePipelineDefinitionDetailed(definition);
        if (!validation.ok) {
          sendJson(res, 422, {
            ok: false,
            error: "Pipeline validation failed.",
            issues: validation.issues.map((item) => toValidationIssueView(item)),
          });
          return;
        }
        getManager(requestUserId).savePipeline(definition);
        sendJson(res, 200, {
          ok: true,
          user: toUserView(getUser(requestUserId)),
          pipeline: definition,
          summary: toPipelineSummary(definition),
          graph: toPipelineGraph(definition).graph,
        });
        return;
      }

      if (method === "PUT" && url.pathname.startsWith("/pipelines/")) {
        const pipelineId = decodeURIComponent(url.pathname.replace("/pipelines/", ""));
        const request = await parseJsonBody<PipelineUpdateRequest>(req);
        if (!request?.definition) {
          sendJson(res, 400, { ok: false, error: "Request body must include definition." });
          return;
        }
        if (request.definition.id !== pipelineId) {
          sendJson(res, 400, {
            ok: false,
            error: `Pipeline id mismatch: URL=${pipelineId}, body=${request.definition.id}`,
          });
          return;
        }
        validatePipelineDefinition(request.definition);
        getManager(requestUserId).savePipeline(request.definition);
        sendJson(res, 200, {
          ok: true,
          user: toUserView(getUser(requestUserId)),
          pipeline: request.definition,
          summary: toPipelineSummary(request.definition),
        });
        return;
      }

      if (method === "DELETE" && url.pathname.startsWith("/pipelines/")) {
        const pipelineId = decodeURIComponent(url.pathname.replace("/pipelines/", ""));
        const deleted = getManager(requestUserId).deletePipeline(pipelineId);
        if (!deleted) {
          sendJson(res, 404, { ok: false, error: `Pipeline not found: ${pipelineId}` });
          return;
        }
        sendJson(res, 200, { ok: true, deletedPipelineId: pipelineId });
        return;
      }

      if (method === "GET" && url.pathname === "/queues") {
        const scopedManager = getManager(requestUserId);
        sendJson(res, 200, {
          user: toUserView(getUser(requestUserId)),
          queues: scopedManager.listQueues().map((queue) => toTaskQueueView(queue)),
        });
        return;
      }

      if (method === "GET" && url.pathname.match(/^\/queues\/[^/]+\/tasks$/)) {
        const queueId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const scopedManager = getManager(requestUserId);
        const queue = scopedManager.getQueue(queueId);
        if (!queue) {
          sendJson(res, 404, { ok: false, error: `Queue not found: ${queueId}` });
          return;
        }
        sendJson(res, 200, {
          user: toUserView(getUser(requestUserId)),
          queue: toTaskQueueView(queue),
          tasks: scopedManager.listQueueTasks(queueId).map((task) => toQueueTaskView(task)),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/tasks") {
        const request = await parseJsonBody<QueueTaskCreateRequest>(req);
        if (!request?.title?.trim() || !request?.prompt?.trim()) {
          sendJson(res, 400, { ok: false, error: "Task creation requires non-empty title and prompt." });
          return;
        }

        const resolvedUserId = request.userId ?? requestUserId ?? config.defaultUserId;
        const task = getManager(resolvedUserId).enqueueTask({
          ...request,
          userId: resolvedUserId,
        });
        sendJson(res, 201, {
          ok: true,
          user: toUserView(getUser(resolvedUserId)),
          task: toQueueTaskView(task),
        });
        return;
      }

      if (method === "PATCH" && url.pathname.match(/^\/tasks\/[^/]+$/)) {
        const taskId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const request = (await parseJsonBody<QueueTaskUpdateRequest>(req)) ?? {};
        const task = getManager(requestUserId).updateTask(taskId, request);
        sendJson(res, 200, {
          ok: true,
          task: toQueueTaskView(task),
        });
        return;
      }

      if (method === "DELETE" && url.pathname.match(/^\/tasks\/[^/]+$/)) {
        const taskId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const deleted = getManager(requestUserId).deleteTask(taskId);
        sendJson(res, 200, {
          ok: true,
          deletedTaskId: taskId,
          deleted,
        });
        return;
      }

      if (method === "POST" && url.pathname.match(/^\/queues\/[^/]+\/reorder$/)) {
        const queueId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const request = await parseJsonBody<QueueTaskReorderRequest>(req);
        if (!request?.taskIds || !Array.isArray(request.taskIds)) {
          sendJson(res, 400, { ok: false, error: "Queue reorder requires taskIds." });
          return;
        }
        const tasks = getManager(requestUserId).reorderQueue(queueId, request);
        sendJson(res, 200, {
          ok: true,
          tasks: tasks.map((task) => toQueueTaskView(task)),
        });
        return;
      }

      if (method === "POST" && url.pathname.match(/^\/queues\/[^/]+\/pause$/)) {
        const queueId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const queue = getManager(requestUserId).pauseQueue(queueId);
        sendJson(res, 200, {
          ok: true,
          queue: toTaskQueueView(queue),
        });
        return;
      }

      if (method === "POST" && url.pathname.match(/^\/queues\/[^/]+\/resume$/)) {
        const queueId = decodeURIComponent(url.pathname.split("/")[2] ?? "");
        const queue = getManager(requestUserId).resumeQueue(queueId);
        sendJson(res, 200, {
          ok: true,
          queue: toTaskQueueView(queue),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/runs") {
        const scopedManager = getManager(requestUserId);
        sendJson(res, 200, {
          user: toUserView(getUser(requestUserId)),
          runs: scopedManager.listRuns().map((run) => toRunSummary(run)),
          defaultModelProfile: config.modelProfile,
          databasePath: scopedManager.getDatabasePath(),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/runs/all-active") {
        const requestingUser = getUser(requestUserId);
        const users = userStore.list();
        const activeRuns = users.flatMap((user) =>
          getManager(user.id)
            .listRuns()
            .filter((run) => isActiveRunStatus(run.status))
            .map((run) => ({
              ...toRunSummary(run),
              user: toUserView(user),
            })),
        );

        sendJson(res, 200, {
          user: toUserView(requestingUser),
          runs: activeRuns,
          totalUsers: users.length,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/runs/all") {
        const requestingUser = getUser(requestUserId);
        const users = userStore.list();
        const allRuns: Array<ReturnType<typeof toRunSummary> & { user: ReturnType<typeof toUserView> }> = users.flatMap((user) =>
          getManager(user.id)
            .listRuns()
            .map((run) => ({
              ...toRunSummary(run),
              user: toUserView(user),
            })),
        );

        allRuns.sort((left, right) =>
          String(right.startedAt ?? "").localeCompare(String(left.startedAt ?? "")),
        );

        sendJson(res, 200, {
          user: toUserView(requestingUser),
          runs: allRuns,
          totalUsers: users.length,
        });
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/runs/")) {
        if (url.pathname.match(/^\/runs\/[^/]+\/graph$/)) {
          const runId = url.pathname.split("/")[2] ?? "";
          const scopedManager = getManager(requestUserId);
          const run = scopedManager.getRun(runId);
          if (!run) {
            sendJson(res, 404, { ok: false, error: `Run not found: ${runId}` });
            return;
          }
          const definition = scopedManager.getPipelineForRun(runId);
          sendJson(res, 200, toRunGraph(run, definition));
          return;
        }

        if (url.pathname.match(/^\/runs\/[^/]+\/events$/)) {
          const runId = url.pathname.split("/")[2] ?? "";
          const scopedManager = getManager(requestUserId);
          const run = scopedManager.getRun(runId);
          if (!run) {
            sendJson(res, 404, { ok: false, error: `Run not found: ${runId}` });
            return;
          }
          sendJson(res, 200, {
            runId,
            events: scopedManager.listRunEvents(runId).map((event) => toRunEventView(event)),
          });
          return;
        }

        const runId = url.pathname.replace("/runs/", "");
        const run = getManager(requestUserId).getRun(runId);
        if (!run) {
          sendJson(res, 404, { ok: false, error: `Run not found: ${runId}` });
          return;
        }
        sendJson(res, 200, toRunDetail(run));
        return;
      }

      if (method === "POST" && url.pathname === "/runs") {
        const request = (await parseJsonBody<PipelineExecutionRequest>(req)) ?? {};
        const resolvedUserId = request.userId ?? config.defaultUserId;
        logInfo("server.run.create.request", {
          remoteAddress: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          userId: resolvedUserId,
          pipelineId: request.pipelineId,
          pipelinePath: request.pipelinePath,
          pipelineCwd: request.pipelineCwd,
          modelProfile: request.modelProfile,
          taskTitle: request.taskTitle?.trim(),
          hasTaskPrompt: Boolean(request.taskPrompt?.trim()),
        });
        let runRecord;
        try {
          runRecord = getManager(resolvedUserId).createRun({
            ...request,
            userId: resolvedUserId,
          });
        } catch (error) {
          if (error instanceof WorkspaceConflictError) {
            sendJson(res, 409, {
              ok: false,
              error: error.message,
              workspacePath: error.workspacePath,
              conflictingRunId: error.conflictingRunId,
              conflictingPipelineId: error.conflictingPipelineId,
            });
            return;
          }
          throw error;
        }
        sendJson(res, 202, {
          ok: true,
          message: "Run accepted and executing in background.",
          run: toRunSummary(runRecord),
        });
        return;
      }

      if (method === "POST" && url.pathname.match(/^\/runs\/[^/]+\/pause$/)) {
        const runId = url.pathname.split("/")[2] ?? "";
        logInfo("server.run.pause.request", {
          remoteAddress: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          runId,
        });
        const runRecord = getManager(requestUserId).pauseRun(runId);
        sendJson(res, 200, { ok: true, run: toRunSummary(runRecord) });
        return;
      }

      if (method === "POST" && url.pathname.match(/^\/runs\/[^/]+\/resume$/)) {
        const runId = url.pathname.split("/")[2] ?? "";
        logInfo("server.run.resume.request", {
          remoteAddress: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          runId,
        });
        const runRecord = getManager(requestUserId).resumeRun(runId);
        sendJson(res, 200, { ok: true, run: toRunSummary(runRecord) });
        return;
      }

      if (method === "POST" && url.pathname.match(/^\/runs\/[^/]+\/cancel$/)) {
        const runId = url.pathname.split("/")[2] ?? "";
        logInfo("server.run.cancel.request", {
          remoteAddress: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          runId,
        });
        const runRecord = getManager(requestUserId).cancelRun(runId);
        sendJson(res, 200, { ok: true, run: toRunSummary(runRecord) });
        return;
      }

      if (method === "POST" && url.pathname.match(/^\/runs\/[^/]+\/retry$/)) {
        const runId = url.pathname.split("/")[2] ?? "";
        logInfo("server.run.retry.request", {
          remoteAddress: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          runId,
        });
        let runRecord;
        try {
          runRecord = getManager(requestUserId).retryRun(runId);
        } catch (error) {
          if (error instanceof WorkspaceConflictError) {
            sendJson(res, 409, {
              ok: false,
              error: error.message,
              workspacePath: error.workspacePath,
              conflictingRunId: error.conflictingRunId,
              conflictingPipelineId: error.conflictingPipelineId,
            });
            return;
          }
          throw error;
        }
        sendJson(res, 202, {
          ok: true,
          message: "Retry accepted and executing in background.",
          run: toRunSummary(runRecord),
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: "Route not found." });
    } catch (error) {
      if (isIgnorableSocketError(error)) {
        return;
      }

      if (error instanceof PipelineValidationError) {
        sendJson(res, 422, {
          ok: false,
          error: "Pipeline validation failed.",
          issues: error.issues.map((item) => toValidationIssueView(item)),
        });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logError("server.request.failed", { method, path: url.pathname, error: message });
      sendJson(res, 500, { ok: false, error: message });
    }
  });

    server.listen(config.port, () => {
      logInfo("server.start", {
        pid: process.pid,
        port: config.port,
        defaultUserId: config.defaultUserId,
        pipelinePath: config.pipelinePath,
        pipelineDirectories: config.pipelineDirectories,
        pipelineCwd: defaultUser.workspacePath,
        modelProfile: config.modelProfile,
        databasePath: getManager(defaultUser.id).getDatabasePath(),
        serverLockPath: config.serverLockPath,
        usersFilePath: config.usersFilePath,
        usersRootDir: config.usersRootDir,
        providerAvailability,
      });
    });

  server.on("connection", (socket) => {
    socket.on("error", (error) => {
      if (isDirectBrokenPipeWriteError(error) || isIgnorableSocketError(error)) {
        logEpipeDiagnostic("server.connection.socket.error", error);
        writeIgnorableSocketDiagnostic("server.connection.socket.error", error);
        socket.destroy();
        return;
      }

      logError("server.connection.socket.error", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  server.on("clientError", (error, socket) => {
    if (isDirectBrokenPipeWriteError(error) || isIgnorableSocketError(error)) {
      logEpipeDiagnostic("server.client_error", error);
      writeIgnorableSocketDiagnostic("server.client_error", error);
      socket.destroy();
      return;
    }

    logError("server.client_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    socket.destroy();
  });

    server.on("error", (error) => {
      logError("server.listen.failed", {
        pid: process.pid,
        error: error instanceof Error ? error.message : String(error),
        port: config.port,
        serverLockPath: config.serverLockPath,
      });
      serverLock.release();
    });

    const shutdown = async (signal: string, exitCode: number) => {
      if (shutdownInProgress) return;
      shutdownInProgress = true;
      logInfo("server.shutdown.start", { signal, port: config.port, pid: process.pid });

      server.close(() => {
        logInfo("server.shutdown.http_closed", { signal, port: config.port, pid: process.pid });
      });

      try {
        await Promise.allSettled(
          [...managerCache.values()].map((manager) =>
            manager.gracefulShutdown(`Server shutdown requested by ${signal}.`),
          ),
        );
        logInfo("server.shutdown.finished", { signal, port: config.port, pid: process.pid });
      } catch (error) {
        logError("server.shutdown.failed", {
          signal,
          pid: process.pid,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        serverLock.release();
        process.exit(exitCode);
      }
    };

    process.on("SIGINT", () => {
      void shutdown("SIGINT", 0);
    });

    process.on("SIGTERM", () => {
      void shutdown("SIGTERM", 0);
    });

    process.on("uncaughtExceptionMonitor", (error, origin) => {
    if (monitorDiagnosticWritten) {
      return;
    }

    monitorDiagnosticWritten = true;
    appendDiagnosticRecord("exception-monitor-diagnostic.jsonl", {
      timestamp: new Date().toISOString(),
      event: "server.exception_monitor_diagnostic",
      source: "uncaughtExceptionMonitor",
      origin,
      ignorableSocketError: isIgnorableSocketError(error),
      candidates: collectIgnorableErrorCandidates(error),
      error: describeUnknownError(error),
    });

    if (isDirectBrokenPipeWriteError(error) || isIgnorableSocketError(error)) {
      logEpipeDiagnostic("uncaughtExceptionMonitor", error, { origin });
    }
    });

    process.on("uncaughtException", (error) => {
    const directBrokenPipeWriteError = isDirectBrokenPipeWriteError(error);
    writeExceptionDiagnostic("uncaughtException", error);

    if (directBrokenPipeWriteError || isIgnorableSocketError(error)) {
      logEpipeDiagnostic("uncaughtException", error);
      writeIgnorableSocketDiagnostic("uncaughtException", error);
      return;
    }

    logError("server.uncaught_exception", {
      error: error instanceof Error ? error.message : String(error),
    });
    void shutdown("uncaughtException", 1);
    });

    process.on("unhandledRejection", (reason) => {
    const directBrokenPipeWriteError = isDirectBrokenPipeWriteError(reason);
    writeExceptionDiagnostic("unhandledRejection", reason);

    if (directBrokenPipeWriteError || isIgnorableSocketError(reason)) {
      logEpipeDiagnostic("unhandledRejection", reason);
      writeIgnorableSocketDiagnostic("unhandledRejection", reason);
      return;
    }

    logError("server.unhandled_rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    void shutdown("unhandledRejection", 1);
    });

    process.once("exit", () => {
      serverLock.release();
    });
  } catch (error) {
    serverLock.release();
    throw error;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  void startServer().catch((error) => {
    logError("server.start.failed", {
      pid: process.pid,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
