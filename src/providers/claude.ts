import { query, type SDKMessage, type SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { logDebug } from "../logger.js";
import { type AgentInvocation, type AgentInvocationResult } from "../types.js";
import { type AgentProviderClient, type ProviderAvailability } from "./base.js";

function messageToRawText(message: Extract<SDKResultMessage, { subtype: "success" }>): string {
  const withStructured = message as SDKResultMessage & {
    structured_output?: unknown;
    result?: string;
  };
  if (withStructured.structured_output && typeof withStructured.structured_output === "object") {
    return JSON.stringify(withStructured.structured_output, null, 2);
  }
  return withStructured.result ?? "";
}

function logSdkMessage(message: SDKMessage, nodeId: string): void {
  logDebug("provider.claude.sdk_message", {
    nodeId,
    type: message.type,
    sessionId: "session_id" in message ? message.session_id : undefined,
  });
}

export class ClaudeAgentSdkProvider implements AgentProviderClient {
  readonly lifecycleMode = "sdk-backed" as const;

  async checkAvailability(): Promise<ProviderAvailability> {
    return {
      provider: "claude-agent-sdk",
      available: typeof query === "function",
      details:
        typeof query === "function"
          ? "Claude Agent SDK module loaded."
          : "Claude Agent SDK query export is unavailable.",
      lifecycleMode: this.lifecycleMode,
    };
  }

  async invoke(invocation: AgentInvocation): Promise<AgentInvocationResult> {
    let finalResult: SDKResultMessage | null = null;
    let sessionId: string | undefined;
    const maxTurns = typeof invocation.maxTurns === "number" && invocation.maxTurns > 0
      ? invocation.maxTurns
      : undefined;
    const iterator = query({
      prompt: invocation.prompt,
      options: {
        cwd: invocation.cwd,
        model: invocation.model,
        maxTurns,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        tools: { type: "preset", preset: "claude_code" },
        systemPrompt: { type: "preset", preset: "claude_code" },
        settingSources: [],
        agentProgressSummaries: false,
        persistSession: false,
      },
    })[Symbol.asyncIterator]();

    const abortError = new Error("Claude Agent SDK invocation aborted.");
    const nextMessage = async (): Promise<IteratorResult<SDKMessage>> => {
      if (!invocation.abortSignal) {
        return iterator.next();
      }

      if (invocation.abortSignal.aborted) {
        throw abortError;
      }

      return Promise.race([
        iterator.next(),
        new Promise<never>((_, reject) => {
          invocation.abortSignal?.addEventListener("abort", () => reject(abortError), {
            once: true,
          });
        }),
      ]);
    };

    try {
      while (true) {
        const item = await nextMessage();
        if (item.done) break;
        const message = item.value;
        logSdkMessage(message, invocation.nodeId);
        if ("session_id" in message && typeof message.session_id === "string") {
          sessionId = message.session_id;
        }
        if (message.type === "result") {
          finalResult = message;
        }
      }
    } catch (error) {
      if (error === abortError || (error instanceof Error && error.message === abortError.message)) {
        await iterator.return?.();
        return {
          ok: false,
          aborted: true,
          outputMarkdown: "",
          rawOutput: "",
          errorMessage: abortError.message,
          metadata: {
            lifecycleMode: this.lifecycleMode,
            providerSessionId: sessionId,
          },
        };
      }
      throw error;
    } finally {
      await iterator.return?.();
    }

    if (!finalResult) {
      return {
        ok: false,
        outputMarkdown: "",
        rawOutput: "",
        errorMessage: "Claude Agent SDK did not return a final result.",
        metadata: {
          lifecycleMode: this.lifecycleMode,
          providerSessionId: sessionId,
        },
      };
    }

    if (finalResult.subtype !== "success") {
      return {
        ok: false,
        outputMarkdown: "",
        rawOutput: finalResult.errors.join("\n"),
        errorMessage: finalResult.errors.join("; "),
        metadata: {
          lifecycleMode: this.lifecycleMode,
          providerSessionId: sessionId,
          subtype: finalResult.subtype,
          durationMs: finalResult.duration_ms,
          totalCostUsd: finalResult.total_cost_usd,
        },
      };
    }

    const rawOutput = messageToRawText(finalResult);

    return {
      ok: true,
      outputMarkdown: rawOutput,
      rawOutput,
      metadata: {
        lifecycleMode: this.lifecycleMode,
        providerSessionId: sessionId,
        subtype: finalResult.subtype,
        durationMs: finalResult.duration_ms,
        totalCostUsd: finalResult.total_cost_usd,
        numTurns: finalResult.num_turns,
      },
    };
  }
}
