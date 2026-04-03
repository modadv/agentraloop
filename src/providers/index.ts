import { type AgentProvider } from "../types.js";
import { type AgentProviderClient, type ProviderAvailability } from "./base.js";
import { ClaudeAgentSdkProvider } from "./claude.js";
import { CodexCliProvider } from "./codex.js";
import { CodexSdkProvider } from "./codex-sdk.js";

const providers: Record<AgentProvider, AgentProviderClient> = {
  "claude-agent-sdk": new ClaudeAgentSdkProvider(),
  "codex-cli": new CodexCliProvider(),
  "codex-sdk": new CodexSdkProvider(),
};

export function getProviderClient(provider: AgentProvider): AgentProviderClient {
  return providers[provider];
}

export async function checkProviderAvailability(): Promise<Record<AgentProvider, ProviderAvailability>> {
  const entries = await Promise.all(
    (Object.entries(providers) as Array<[AgentProvider, AgentProviderClient]>).map(
      async ([provider, client]) => {
        try {
          const result = client.checkAvailability
            ? await client.checkAvailability()
            : { provider, available: true, details: "No explicit check implemented." };
          return [provider, result] as const;
        } catch (error) {
          return [
            provider,
            {
              provider,
              available: false,
              details: error instanceof Error ? error.message : String(error),
            },
          ] as const;
        }
      },
    ),
  );

  return Object.fromEntries(entries) as Record<AgentProvider, ProviderAvailability>;
}
