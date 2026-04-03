export type AgentProvider = "claude-agent-sdk" | "codex-cli" | "codex-sdk";
export type ModelProfile = "fast" | "standard";
export type ProviderLifecycleMode = "sdk-backed" | "process-backed";

export type PipelineRunStatus =
  | "pending"
  | "running"
  | "paused"
  | "failed"
  | "completed"
  | "canceled"
  | "canceling";

export type NodeRunStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped"
  | "canceled";

export type RunControlState = "running" | "pause_requested" | "paused" | "cancel_requested";

export type AgentNodeDefinition = {
  id: string;
  name: string;
  enabled?: boolean;
  provider: AgentProvider;
  model: string;
  modelProfiles?: Partial<Record<ModelProfile, string>>;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  maxTurns?: number;
  position?: {
    x: number;
    y: number;
  };
};

export type PipelineEdge = {
  from: string;
  to: string;
};

export type PipelineDefinition = {
  id: string;
  name: string;
  description?: string;
  entryNodeId: string;
  nodes: AgentNodeDefinition[];
  edges: PipelineEdge[];
};

export type AgentInvocation = {
  nodeId: string;
  provider: AgentProvider;
  model: string;
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  maxTurns?: number;
  abortSignal?: AbortSignal;
};

export type AgentInvocationResult = {
  ok: boolean;
  aborted?: boolean;
  outputMarkdown: string;
  rawOutput: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export type NodeRunRecord = {
  nodeId: string;
  nodeName: string;
  provider: AgentProvider;
  model: string;
  status: NodeRunStatus;
  startedAt: string;
  endedAt?: string;
  prompt: string;
  outputMarkdown?: string;
  rawOutput?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export type RunEventType =
  | "run_created"
  | "run_started"
  | "run_paused"
  | "run_resumed"
  | "run_cancel_requested"
  | "run_canceled"
  | "run_completed"
  | "run_failed"
  | "node_canceled"
  | "node_started"
  | "node_skipped"
  | "node_succeeded"
  | "node_failed";

export type RunEventRecord = {
  runId: string;
  timestamp: string;
  type: RunEventType;
  nodeId?: string;
  nodeName?: string;
  payload?: Record<string, unknown>;
};

export type PipelineRunRecord = {
  runId: string;
  pipelineId: string;
  pipelineName: string;
  status: PipelineRunStatus;
  startedAt: string;
  endedAt?: string;
  controlState?: RunControlState;
  config: PipelineRunConfig;
  nodeRuns: NodeRunRecord[];
};

export type CommitSummary = {
  sha: string;
  summary: string;
  committedAt: string;
};

export type WorkspaceRepoContext = {
  repoUrl?: string;
  branch?: string;
  recentCommits?: CommitSummary[];
};

export type PipelineRunConfig = {
  userId?: string;
  pipelinePath: string;
  pipelineCwd: string;
  modelProfile: ModelProfile;
  queueId?: string;
  taskId?: string;
  taskTitle?: string;
  taskPrompt?: string;
  repoUrl?: string;
  branch?: string;
  recentCommits?: CommitSummary[];
};

export type PipelineRunRequest = Partial<PipelineRunConfig>;

export type PipelineCreateRequest = {
  definition: PipelineDefinition;
};

export type PipelineUpdateRequest = {
  definition: PipelineDefinition;
};

export type PipelineExecutionRequest = PipelineRunRequest & {
  userId?: string;
  pipelineId?: string;
};

export type TaskQueueStatus = "active" | "paused";

export type TaskQueueRecord = {
  queueId: string;
  userId: string;
  pipelineId: string;
  name: string;
  status: TaskQueueStatus;
  createdAt: string;
  updatedAt: string;
};

export type QueueTaskStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type QueueTaskRecord = {
  taskId: string;
  userId: string;
  queueId: string;
  pipelineId: string;
  title: string;
  prompt: string;
  status: QueueTaskStatus;
  position: number;
  pipelineCwd?: string;
  modelProfile?: ModelProfile;
  runId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type QueueTaskCreateRequest = {
  userId?: string;
  queueId?: string;
  pipelineId?: string;
  title: string;
  prompt: string;
  pipelineCwd?: string;
  modelProfile?: ModelProfile;
};

export type QueueTaskUpdateRequest = {
  title?: string;
  prompt?: string;
};

export type QueueTaskReorderRequest = {
  taskIds: string[];
};

export type UserProfile = {
  id: string;
  isAdmin: boolean;
  workspacePath: string;
  dataDir: string;
  logsDir: string;
  pipelineDir: string;
  createdAt: string;
  updatedAt: string;
};

export type UserCreateRequest = {
  id: string;
  workspacePath?: string;
};

export type PipelineValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type PipelineEditorNode = {
  id: string;
  name: string;
  enabled?: boolean;
  provider: AgentProvider;
  model: string;
  modelProfiles?: Partial<Record<ModelProfile, string>>;
  prompt: string;
  cwd?: string;
  timeoutMs?: number;
  maxTurns?: number;
  position?: {
    x: number;
    y: number;
  };
};

export type PipelineEditorEdge = {
  from: string;
  to: string;
};

export type PipelineGraphDraft = {
  pipeline: {
    id: string;
    name: string;
    description?: string;
    entryNodeId: string;
  };
  graph: {
    nodes: PipelineEditorNode[];
    edges: PipelineEditorEdge[];
  };
};

export type PipelineGraphSaveRequest = {
  draft: PipelineGraphDraft;
};
