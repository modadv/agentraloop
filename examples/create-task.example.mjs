const serverBaseUrl = process.env.AGENTRALOOP_BASE_URL ?? "http://127.0.0.1:8787";

const payload = {
  userId: "admin",
  pipelineId: "task-input-smoke-check",
  title: "API Example Task",
  prompt: "Verify that POST /tasks can enqueue a text task from a JavaScript client.",
  pipelineCwd: "E:\\Projects\\agentraloop\\users\\admin\\workspace",
  modelProfile: "standard",
};

async function requestJson(path, init) {
  const response = await fetch(`${serverBaseUrl}${path}`, init);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error ?? `Request failed with status ${response.status}`);
  }
  return data;
}

async function main() {
  const created = await requestJson("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.log("Created task:");
  console.log(JSON.stringify(created, null, 2));

  const queueTasks = await requestJson(
    `/queues/${encodeURIComponent(payload.pipelineId)}/tasks?userId=${encodeURIComponent(payload.userId)}`,
    { method: "GET" },
  );

  console.log("\nCurrent queue state:");
  console.log(JSON.stringify(queueTasks, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
