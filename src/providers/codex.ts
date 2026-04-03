import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { logDebug } from "../logger.js";
import { type AgentInvocation, type AgentInvocationResult } from "../types.js";
import { type AgentProviderClient, type ProviderAvailability } from "./base.js";

type SpawnResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function isIgnorableCodexPipeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const withCode = error as Error & { code?: string };
  return (
    withCode.code === "EPIPE" ||
    withCode.code === "ECONNRESET" ||
    withCode.code === "ERR_STREAM_DESTROYED" ||
    /broken pipe/i.test(error.message) ||
    /\bEPIPE\b/i.test(error.message) ||
    /\bECONNRESET\b/i.test(error.message)
  );
}

function runCodexCommand(
  args: string[],
  prompt: string,
  cwd: string,
  abortSignal?: AbortSignal,
  timeoutMs?: number,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminating = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;

    if (timeoutMs && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        if (!settled) {
          terminating = true;
          settled = true;
          child.kill();
          reject(new Error(`Codex CLI timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);
    }

    if (abortSignal) {
      abortHandler = () => {
        if (!settled) {
          terminating = true;
          settled = true;
          child.kill();
          reject(new Error("Codex CLI invocation aborted."));
        }
      };

      if (abortSignal.aborted) {
        abortHandler();
        return;
      }

      abortSignal.addEventListener("abort", abortHandler, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.stdin.on("error", (error) => {
      if (isIgnorableCodexPipeError(error) && (terminating || child.killed)) {
        return;
      }

      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("error", (error) => {
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    child.on("close", (code) => {
      if (abortSignal && abortHandler) {
        abortSignal.removeEventListener("abort", abortHandler);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!settled) {
        settled = true;
        resolve({ code: code ?? 1, stdout, stderr });
      }
    });

    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (error) {
      if (isIgnorableCodexPipeError(error) && (terminating || child.killed)) {
        return;
      }

      if (!settled) {
        settled = true;
        reject(error);
      }
    }
  });
}

export class CodexCliProvider implements AgentProviderClient {
  readonly lifecycleMode = "process-backed" as const;

  async checkAvailability(): Promise<ProviderAvailability> {
    const result = spawnSync("codex", ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const errorMessage =
      result.error instanceof Error ? result.error.message : result.error ? String(result.error) : "";
    const stderr = [result.stderr ?? "", errorMessage].filter((item) => item.length > 0).join("\n").trim();
    const stdout = (result.stdout ?? "").trim();
    const status = result.status ?? 1;

    if (status !== 0) {
      return {
        provider: "codex-cli",
        available: false,
        details: stderr || stdout || `codex exited with status ${status}.`,
        lifecycleMode: this.lifecycleMode,
      };
    }

    return {
      provider: "codex-cli",
      available: true,
      details: stdout || "codex --version succeeded.",
      lifecycleMode: this.lifecycleMode,
    };
  }

  async invoke(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    const outputFile = path.join(
      os.tmpdir(),
      `codex-pipeline-${invocation.nodeId}-${Date.now()}.md`,
    );

    const args = [
      "exec",
      "-m",
      invocation.model,
      "--skip-git-repo-check",
      "--full-auto",
      "--json",
      "--output-last-message",
      outputFile,
      "-",
    ];

    logDebug("provider.codex.exec", {
      nodeId: invocation.nodeId,
      cwd: invocation.cwd,
      args,
    });

    try {
      const result = await runCodexCommand(
        args,
        invocation.prompt,
        invocation.cwd,
        invocation.abortSignal,
        invocation.timeoutMs,
      );

      const outputMarkdown = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf-8").trim()
        : "";

      try {
        fs.unlinkSync(outputFile);
      } catch {
        // Ignore temp file cleanup failures.
      }

      if (result.code !== 0) {
      return {
        ok: false,
        outputMarkdown,
        rawOutput: result.stdout,
        errorMessage: result.stderr.trim() || `Codex CLI exited with code ${result.code}.`,
        metadata: { exitCode: result.code, lifecycleMode: this.lifecycleMode },
      };
      }

      return {
        ok: true,
        outputMarkdown,
        rawOutput: result.stdout,
        metadata: {
          exitCode: result.code,
          stderr: result.stderr.trim() || undefined,
          lifecycleMode: this.lifecycleMode,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const partialOutputMarkdown = fs.existsSync(outputFile)
        ? fs.readFileSync(outputFile, "utf-8").trim()
        : "";

      logDebug("provider.codex.exec_error", {
        nodeId: invocation.nodeId,
        cwd: invocation.cwd,
        outputFile,
        errorMessage: message,
        partialOutputLength: partialOutputMarkdown.length,
      });

      try {
        fs.unlinkSync(outputFile);
      } catch {
        // Ignore temp file cleanup failures.
      }

      return {
        ok: false,
        aborted: message.includes("aborted"),
        outputMarkdown: partialOutputMarkdown,
        rawOutput: "",
        errorMessage: message,
        metadata: {
          lifecycleMode: this.lifecycleMode,
        },
      };
    }
  }
}
