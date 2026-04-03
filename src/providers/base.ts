import { type AgentInvocation, type AgentInvocationResult, type ProviderLifecycleMode } from "../types.js";

export type ProviderAvailability = {
  provider: string;
  available: boolean;
  details?: string;
  lifecycleMode: ProviderLifecycleMode;
};

export interface AgentProviderClient {
  readonly lifecycleMode: ProviderLifecycleMode;
  invoke(invocation: AgentInvocation): Promise<AgentInvocationResult>;
  checkAvailability?(): Promise<ProviderAvailability>;
}
