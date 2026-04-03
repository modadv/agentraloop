import { spawnSync } from "node:child_process";
import { Codex } from "@openai/codex-sdk";
import { logDebug } from "../logger.js";
import { type AgentInvocation, type AgentInvocationResult } from "../types.js";
import { type AgentProviderClient, type ProviderAvailability } from "./base.js";

function isAbortError(error: unknown, abortSignal?: AbortSignal): boolean {
  if (abortSignal?.aborted) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return /abort/i.test(error.message);
}

export class CodexSdkProvider implements AgentProviderClient {
  readonly lifecycleMode = "sdk-backed" as const;

  async checkAvailability(): Promise<ProviderAvailability> {
    const cliResult = spawnSync("codex", ["--version"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const errorMessage =
      cliResult.error instanceof Error
        ? cliResult.error.message
        : cliResult.error
          ? String(cliResult.error)
          : "";
    const stderr = [cliResult.stderr ?? "", errorMessage]
      .filter((value) => value.length > 0)
      .join("\n")
      .trim();
    const stdout = (cliResult.stdout ?? "").trim();
    const status = cliResult.status ?? 1;

    if (typeof Codex !== "function") {
      return {
        provider: "codex-sdk",
        available: false,
        details: "Codex SDK module is unavailable.",
        lifecycleMode: this.lifecycleMode,
      };
    }

    if (status !== 0) {
      return {
        provider: "codex-sdk",
        available: false,
        details: stderr || stdout || `codex exited with status ${status}.`,
        lifecycleMode: this.lifecycleMode,
      };
    }

    return {
      provider: "codex-sdk",
      available: true,
      details: stdout || "Codex SDK module loaded and codex --version succeeded.",
      lifecycleMode: this.lifecycleMode,
    };
  }

  async invoke(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    const codex = new Codex();
    const thread = codex.startThread({
      model: invocation.model,
      approvalPolicy: "never",
      sandboxMode: "workspace-write",
      workingDirectory: invocation.cwd,
      skipGitRepoCheck: true,
    });

    try {
      logDebug("provider.codex_sdk.run", {
        nodeId: invocation.nodeId,
        cwd: invocation.cwd,
        model: invocation.model,
      });

      const turn = await thread.run(invocation.prompt, {
        signal: invocation.abortSignal,
      });
      const threadId = thread.id ?? undefined;
      const rawOutput = turn.finalResponse ?? "";

      return {
        ok: true,
        outputMarkdown: rawOutput,
        rawOutput,
        metadata: {
          lifecycleMode: this.lifecycleMode,
          providerSessionId: threadId,
          providerThreadId: threadId,
          usage: turn.usage,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const threadId = thread.id ?? undefined;

      logDebug("provider.codex_sdk.run_error", {
        nodeId: invocation.nodeId,
        cwd: invocation.cwd,
        errorMessage: message,
        providerThreadId: threadId,
      });

      return {
        ok: false,
        aborted: isAbortError(error, invocation.abortSignal),
        outputMarkdown: "",
        rawOutput: "",
        errorMessage: message,
        metadata: {
          lifecycleMode: this.lifecycleMode,
          providerSessionId: threadId,
          providerThreadId: threadId,
        },
      };
    }
  }
}
