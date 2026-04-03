import * as fs from "node:fs";
import * as path from "node:path";

type LogLevel = "INFO" | "ERROR" | "DEBUG";

const LOG_FILE = path.resolve(process.cwd(), "logs", "pipeline-runtime.jsonl");
const defaultConsoleLoggingDisabled =
  process.env.AGENTRALOOP_ENABLE_CONSOLE_LOGS === "1"
    ? false
    : !process.stdout.isTTY || !process.stderr.isTTY;
let consoleLoggingDisabled = defaultConsoleLoggingDisabled;
let consoleErrorHandlersInstalled = false;

function ensureDirForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendJsonLine(filePath: string, payload: Record<string, unknown>): void {
  ensureDirForFile(filePath);
  fs.appendFileSync(filePath, JSON.stringify(payload) + "\n", "utf-8");
}

export function writeJsonLineToFile(
  filePath: string,
  payload: Record<string, unknown>,
): void {
  appendJsonLine(filePath, payload);
}

function isBrokenConsoleError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as Error & { code?: string };
  return (
    errorWithCode.code === "EPIPE" ||
    errorWithCode.code === "ERR_STREAM_DESTROYED" ||
    /broken pipe/i.test(error.message)
  );
}

function disableConsoleLoggingForBrokenPipe(error: unknown): void {
  if (isBrokenConsoleError(error)) {
    consoleLoggingDisabled = true;
  }
}

function installConsoleErrorHandlers(): void {
  if (consoleErrorHandlersInstalled) {
    return;
  }

  consoleErrorHandlersInstalled = true;

  process.stdout.on("error", disableConsoleLoggingForBrokenPipe);
  process.stderr.on("error", disableConsoleLoggingForBrokenPipe);
}

function writeToConsole(level: LogLevel, event: string, data: Record<string, unknown>): void {
  if (consoleLoggingDisabled) {
    return;
  }

  const printer = level === "ERROR" ? console.error : console.log;

  try {
    printer(`[${level}] ${event}`, data);
  } catch (error) {
    if (isBrokenConsoleError(error)) {
      consoleLoggingDisabled = true;
      return;
    }

    throw error;
  }
}

function write(level: LogLevel, event: string, data: Record<string, unknown> = {}): void {
  installConsoleErrorHandlers();

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...data,
  };

  try {
    writeToConsole(level, event, data);
  } catch {
    consoleLoggingDisabled = true;
  }

  try {
    appendJsonLine(LOG_FILE, payload);
  } catch {
    // Keep runtime alive even if file logging fails.
  }
}

export function logInfo(event: string, data: Record<string, unknown> = {}): void {
  write("INFO", event, data);
}

export function logError(event: string, data: Record<string, unknown> = {}): void {
  write("ERROR", event, data);
}

export function logDebug(event: string, data: Record<string, unknown> = {}): void {
  write("DEBUG", event, data);
}

export function getRuntimeLogFile(): string {
  return LOG_FILE;
}
