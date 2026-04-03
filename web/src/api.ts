import type {
  HealthResponse,
  PipelineDefinition,
  PipelineGraphDraft,
  PipelineGraphResponse,
  PipelineListItem,
  PipelineValidationIssue,
  RunDetailResponse,
  RunEventsResponse,
  RunGraphResponse,
  GlobalRunSummary,
  QueueTask,
  RunSummary,
  TaskQueue,
  UserProfile,
  WorkspaceRepoContext,
} from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with status ${response.status}`);
  }
  return data;
}

function withUserId(path: string, userId?: string): string {
  if (!userId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}userId=${encodeURIComponent(userId)}`;
}

export async function getHealth(userId?: string): Promise<HealthResponse> {
  return parseJson<HealthResponse>(await fetch(withUserId("/health", userId)));
}

export async function getWorkspaceContext(
  workspacePath: string,
  userId?: string,
): Promise<{ workspacePath: string; context: WorkspaceRepoContext }> {
  const query = `/workspace-context?workspacePath=${encodeURIComponent(workspacePath)}`;
  return parseJson(await fetch(withUserId(query, userId)));
}

export async function getUsers(): Promise<{ users: UserProfile[]; defaultUserId?: string }> {
  return parseJson(await fetch("/users"));
}

export async function getPipelines(userId?: string): Promise<PipelineListItem[]> {
  const response = await parseJson<{ pipelines: PipelineListItem[] }>(await fetch(withUserId("/pipelines", userId)));
  return response.pipelines ?? [];
}

export async function getPipeline(
  pipelineId: string,
  userId?: string,
): Promise<{ pipeline: PipelineDefinition; summary: PipelineListItem["summary"] }> {
  return parseJson(await fetch(withUserId(`/pipelines/${encodeURIComponent(pipelineId)}`, userId)));
}

export async function getPipelineGraph(pipelineId: string, userId?: string): Promise<PipelineGraphResponse> {
  return parseJson(await fetch(withUserId(`/pipelines/${encodeURIComponent(pipelineId)}/graph`, userId)));
}

export async function getQueues(userId?: string): Promise<{ queues: TaskQueue[] }> {
  return parseJson(await fetch(withUserId("/queues", userId)));
}

export async function getQueueTasks(queueId: string, userId?: string): Promise<{ queue: TaskQueue; tasks: QueueTask[] }> {
  return parseJson(await fetch(withUserId(`/queues/${encodeURIComponent(queueId)}/tasks`, userId)));
}

export async function createTask(payload: {
  userId?: string;
  pipelineId?: string;
  queueId?: string;
  title: string;
  prompt: string;
  pipelineCwd?: string;
  modelProfile?: "fast" | "standard";
}): Promise<{ ok: boolean; task: QueueTask }> {
  return parseJson(
    await fetch("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function updateTask(
  taskId: string,
  payload: { title?: string; prompt?: string },
  userId?: string,
): Promise<{ ok: boolean; task: QueueTask }> {
  return parseJson(
    await fetch(withUserId(`/tasks/${encodeURIComponent(taskId)}`, userId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function deleteTask(taskId: string, userId?: string): Promise<{ ok: boolean; deletedTaskId: string }> {
  return parseJson(
    await fetch(withUserId(`/tasks/${encodeURIComponent(taskId)}`, userId), {
      method: "DELETE",
    }),
  );
}

export async function reorderQueue(
  queueId: string,
  taskIds: string[],
  userId?: string,
): Promise<{ ok: boolean; tasks: QueueTask[] }> {
  return parseJson(
    await fetch(withUserId(`/queues/${encodeURIComponent(queueId)}/reorder`, userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskIds }),
    }),
  );
}

export async function controlQueue(
  queueId: string,
  action: "pause" | "resume",
  userId?: string,
): Promise<{ ok: boolean; queue: TaskQueue }> {
  return parseJson(
    await fetch(withUserId(`/queues/${encodeURIComponent(queueId)}/${action}`, userId), {
      method: "POST",
    }),
  );
}

export async function getRuns(): Promise<{
  runs: RunSummary[];
  defaultModelProfile: "fast" | "standard";
}> {
  return parseJson(await fetch("/runs"));
}

export async function getRunsForUser(userId?: string): Promise<{
  runs: RunSummary[];
  defaultModelProfile: "fast" | "standard";
}> {
  return parseJson(await fetch(withUserId("/runs", userId)));
}

export async function getAllActiveRuns(userId?: string): Promise<{
  runs: GlobalRunSummary[];
  totalUsers: number;
}> {
  return parseJson(await fetch(withUserId("/runs/all-active", userId)));
}

export async function getAllRuns(userId?: string): Promise<{
  runs: GlobalRunSummary[];
  totalUsers: number;
}> {
  return parseJson(await fetch(withUserId("/runs/all", userId)));
}

export async function getRun(runId: string, userId?: string): Promise<RunDetailResponse> {
  return parseJson(await fetch(withUserId(`/runs/${encodeURIComponent(runId)}`, userId)));
}

export async function getRunGraph(runId: string, userId?: string): Promise<RunGraphResponse> {
  return parseJson(await fetch(withUserId(`/runs/${encodeURIComponent(runId)}/graph`, userId)));
}

export async function getRunEvents(runId: string, userId?: string): Promise<RunEventsResponse> {
  return parseJson(await fetch(withUserId(`/runs/${encodeURIComponent(runId)}/events`, userId)));
}

export async function createRun(payload: {
  userId?: string;
  pipelineId: string;
  pipelineCwd: string;
  modelProfile: "fast" | "standard";
  taskTitle?: string;
  taskPrompt?: string;
}): Promise<{ ok: boolean; run: RunSummary; message: string }> {
  return parseJson(
    await fetch("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function controlRun(
  runId: string,
  action: "pause" | "resume" | "cancel" | "retry",
  userId?: string,
): Promise<{ ok: boolean; run: RunSummary; message?: string }> {
  return parseJson(
    await fetch(withUserId(`/runs/${encodeURIComponent(runId)}/${action}`, userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export async function validateDraft(draft: PipelineGraphDraft, userId?: string): Promise<{
  ok: boolean;
  issues: PipelineValidationIssue[];
}> {
  return parseJson(
    await fetch(withUserId("/pipeline-validations", userId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    }),
  );
}

export async function saveDraft(
  pipelineId: string,
  draft: PipelineGraphDraft,
  userId?: string,
): Promise<{ ok: boolean; pipeline: PipelineDefinition; graph: PipelineGraphResponse["graph"] }> {
  return parseJson(
    await fetch(withUserId(`/pipelines/${encodeURIComponent(pipelineId)}/graph`, userId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft }),
    }),
  );
}
