type ModelProfile = "fast" | "standard";

type CreateTaskRequest = {
  userId: string;
  pipelineId: string;
  title: string;
  prompt: string;
  pipelineCwd?: string;
  modelProfile?: ModelProfile;
};

type QueueTask = {
  taskId: string;
  userId: string;
  queueId: string;
  pipelineId: string;
  title: string;
  prompt: string;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  position: number;
  runId?: string;
};

type CreateTaskResponse = {
  ok: boolean;
  task: QueueTask;
  queue: {
    queueId: string;
    pipelineId: string;
    status: "active" | "paused";
  };
};

type QueueTasksResponse = {
  queue: {
    queueId: string;
    pipelineId: string;
    status: "active" | "paused";
  };
  tasks: QueueTask[];
};

const serverBaseUrl = process.env.AGENTRALOOP_BASE_URL ?? "http://127.0.0.1:8787";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${serverBaseUrl}${path}`, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with status ${response.status}`);
  }
  return data;
}

async function createTask(payload: CreateTaskRequest): Promise<CreateTaskResponse> {
  return requestJson<CreateTaskResponse>("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function getQueueTasks(userId: string, queueId: string): Promise<QueueTasksResponse> {
  return requestJson<QueueTasksResponse>(
    `/queues/${encodeURIComponent(queueId)}/tasks?userId=${encodeURIComponent(userId)}`,
  );
}

async function main(): Promise<void> {
  const payload: CreateTaskRequest = {
    userId: "admin",
    pipelineId: "task-input-smoke-check",
    title: "API Example Task",
    prompt: "Verify that POST /tasks can enqueue a text task from a TypeScript client.",
    pipelineCwd: "E:\\Projects\\agentraloop\\users\\admin\\workspace",
    modelProfile: "standard",
  };

  const created = await createTask(payload);
  console.log("Created task:");
  console.log(JSON.stringify(created, null, 2));

  const queue = await getQueueTasks(payload.userId, payload.pipelineId);
  console.log("\nCurrent queue state:");
  console.log(JSON.stringify(queue, null, 2));
}

void main();
