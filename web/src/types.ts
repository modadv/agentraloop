export type AgentProvider = "claude-agent-sdk" | "codex-cli" | "codex-sdk";
export type ModelProfile = "fast" | "standard";

export type ProviderAvailability = {
  provider: AgentProvider;
  available: boolean;
  details?: string;
  lifecycleMode: "sdk-backed" | "process-backed";
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

export type PipelineSummary = {
  id: string;
  name: string;
  description: string;
  entryNodeId: string;
  nodeCount: number;
  edgeCount: number;
  enabledNodeCount: number;
  disabledNodeCount: number;
};

export type PipelineNode = {
  id: string;
  name: string;
  enabled?: boolean;
  provider: AgentProvider;
  model: string;
  modelProfiles?: Partial<Record<ModelProfile, string>>;
  prompt: string;
  cwd?: string;
  timeoutMs?: number | null;
  maxTurns?: number | null;
  position?: {
    x: number;
    y: number;
  } | null;
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
  nodes: PipelineNode[];
  edges: PipelineEdge[];
};

export type PipelineListItem = {
  summary: PipelineSummary;
  definition: PipelineDefinition;
};

export type PipelineGraphResponse = {
  pipeline: {
    id: string;
    name: string;
    description: string;
    entryNodeId: string;
  };
  graph: {
    nodes: Array<{
      id: string;
      name: string;
      enabled: boolean;
      provider: AgentProvider;
      model: string;
      hasModelProfiles?: boolean;
      cwd?: string | null;
      position?: {
        x: number;
        y: number;
      } | null;
    }>;
    edges: Array<{ id: string; from: string; to: string }>;
  };
};

export type RunSummary = {
  runId: string;
  pipelineId: string;
  pipelineName: string;
  status: string;
  controlState?: string;
  startedAt: string;
  endedAt?: string;
  nodeCount: number;
  nodeStatuses: Record<string, number>;
  config: {
    userId?: string;
    pipelinePath: string;
    pipelineCwd: string;
    modelProfile: ModelProfile;
    taskTitle?: string;
    taskPrompt?: string;
    repoUrl?: string;
    branch?: string;
    recentCommits?: Array<{
      sha: string;
      summary: string;
      committedAt: string;
    }>;
  };
};

export type RunNodeDetail = {
  nodeId: string;
  nodeName: string;
  provider: AgentProvider;
  model: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  prompt: string;
  outputMarkdown?: string;
  rawOutput?: string;
};

export type RunDetailResponse = {
  run: {
    runId: string;
    pipelineId: string;
    pipelineName: string;
    status: string;
    controlState?: string;
    startedAt: string;
    endedAt?: string;
    config: {
      userId?: string;
      pipelinePath: string;
      pipelineCwd: string;
      modelProfile: ModelProfile;
      taskTitle?: string;
      taskPrompt?: string;
      repoUrl?: string;
      branch?: string;
      recentCommits?: Array<{
        sha: string;
        summary: string;
        committedAt: string;
      }>;
    };
  };
  nodes: RunNodeDetail[];
};

export type RunEvent = {
  timestamp: string;
  type: string;
  nodeId?: string;
  nodeName?: string;
  payload: Record<string, unknown>;
};

export type RunEventsResponse = {
  runId: string;
  events: RunEvent[];
};

export type RunGraphResponse = {
  run: RunDetailResponse["run"];
  graph: {
    entryNodeId: string | null;
    nodes: Array<{
      id: string;
      name: string;
      enabled?: boolean;
      provider: AgentProvider;
      model: string;
      position?: {
        x: number;
        y: number;
      } | null;
      runtimeStatus: string;
      startedAt?: string | null;
      endedAt?: string | null;
      errorMessage?: string | null;
    }>;
    edges: Array<{ id: string; from: string; to: string }>;
    nodeStatusMap: Record<
      string,
      {
        status: string;
        startedAt?: string;
        endedAt?: string;
        errorMessage?: string | null;
      }
    >;
  };
};

export type TaskQueue = {
  queueId: string;
  userId: string;
  pipelineId: string;
  name: string;
  status: "active" | "paused";
  createdAt: string;
  updatedAt: string;
};

export type QueueTask = {
  taskId: string;
  userId: string;
  queueId: string;
  pipelineId: string;
  title: string;
  prompt: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  position: number;
  pipelineCwd?: string;
  modelProfile?: ModelProfile;
  runId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

export type PipelineValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type PipelineGraphDraft = {
  pipeline: {
    id: string;
    name: string;
    description?: string;
    entryNodeId: string;
  };
  graph: {
    nodes: PipelineNode[];
    edges: PipelineEdge[];
  };
};

export type GlobalRunSummary = RunSummary & {
  user: UserProfile;
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

export type HealthResponse = {
  ok: boolean;
  databasePath: string;
  pipelineCwd: string;
  defaultUserId?: string;
  user?: UserProfile;
  users?: UserProfile[];
  workspaceRepoContext?: WorkspaceRepoContext;
  providerAvailability: Record<AgentProvider, ProviderAvailability>;
};
