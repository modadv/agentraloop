---
title: REST API Reference
---

# REST API Reference

This page documents the HTTP endpoints exposed by `agentraloop serve`.

## Base URL

```text
http://127.0.0.1:8787
```

## Common Rules

- Default content type is JSON.
- Scoped reads and mutations usually accept `?userId=<id>`.
- `POST /runs` and `POST /runs/:runId/retry` start background work and return `202`.
- Validation failures return `422`.
- Workspace conflicts return `409`.

## Shared Helpers

### Node.js

Node.js examples below assume Node.js 20+ with built-in `fetch`.

```js
const BASE_URL = "http://127.0.0.1:8787";

async function api(path, { method = "GET", body, userId } = {}) {
  const url = new URL(path, BASE_URL);
  if (userId) url.searchParams.set("userId", userId);

  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  return response.json();
}
```

### Python

Python examples below use only the standard library.

```python
import json
import urllib.parse
import urllib.request

BASE_URL = "http://127.0.0.1:8787"

def api(path, method="GET", body=None, user_id=None):
    url = urllib.parse.urljoin(BASE_URL, path)
    if user_id:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}userId={urllib.parse.quote(user_id)}"

    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request) as response:
        return json.load(response)
```

## System

### `GET /health`

Returns service health, current scoped user, workspace context, and provider availability.

Node.js:

```js
const health = await api("/health", { userId: "alice" });
```

Python:

```python
health = api("/health", user_id="alice")
```

### `GET /workspace-context`

Query params:

- `workspacePath`: absolute or relative workspace path

Returns detected Git context for a workspace.

Node.js:

```js
const ctx = await api("/workspace-context?workspacePath=D%3A%5CProjects%5Calice%5Cworkspace", {
  userId: "alice",
});
```

Python:

```python
ctx = api("/workspace-context?workspacePath=D%3A%5CProjects%5Calice%5Cworkspace", user_id="alice")
```

## Users

### `GET /users`

Lists user scopes and the default user id.

Node.js:

```js
const users = await api("/users");
```

Python:

```python
users = api("/users")
```

### `POST /users`

Body:

```json
{
  "id": "alice",
  "workspacePath": "D:\\Projects\\alice\\workspace"
}
```

Node.js:

```js
const created = await api("/users", {
  method: "POST",
  body: {
    id: "alice",
    workspacePath: "D:\\Projects\\alice\\workspace",
  },
});
```

Python:

```python
created = api("/users", method="POST", body={
    "id": "alice",
    "workspacePath": "D:\\Projects\\alice\\workspace",
})
```

## Pipelines

### `GET /pipelines/default`

Returns the bundled default pipeline and summary.

Node.js:

```js
const defaultPipeline = await api("/pipelines/default");
```

Python:

```python
default_pipeline = api("/pipelines/default")
```

### `GET /pipelines`

Lists pipelines visible to the selected user.

Node.js:

```js
const pipelines = await api("/pipelines", { userId: "alice" });
```

Python:

```python
pipelines = api("/pipelines", user_id="alice")
```

### `GET /pipelines/:pipelineId`

Returns a pipeline definition and summary.

Node.js:

```js
const pipeline = await api("/pipelines/simple-game-dev-review", { userId: "alice" });
```

Python:

```python
pipeline = api("/pipelines/simple-game-dev-review", user_id="alice")
```

### `GET /pipelines/:pipelineId/graph`

Returns the lightweight graph projection used by the editor and run views.

Node.js:

```js
const graph = await api("/pipelines/simple-game-dev-review/graph", { userId: "alice" });
```

Python:

```python
graph = api("/pipelines/simple-game-dev-review/graph", user_id="alice")
```

### `POST /pipelines`

Creates a pipeline from a full `definition` object.

Node.js:

```js
const created = await api("/pipelines", {
  method: "POST",
  userId: "alice",
  body: {
    definition: {
      id: "hello-pipeline",
      name: "Hello Pipeline",
      entryNodeId: "plan",
      nodes: [
        {
          id: "plan",
          name: "Plan",
          provider: "codex-cli",
          model: "gpt-5.4-mini",
          prompt: "Write a short implementation plan.",
        },
      ],
      edges: [],
    },
  },
});
```

Python:

```python
created = api("/pipelines", method="POST", user_id="alice", body={
    "definition": {
        "id": "hello-pipeline",
        "name": "Hello Pipeline",
        "entryNodeId": "plan",
        "nodes": [
            {
                "id": "plan",
                "name": "Plan",
                "provider": "codex-cli",
                "model": "gpt-5.4-mini",
                "prompt": "Write a short implementation plan."
            }
        ],
        "edges": []
    }
})
```

### `POST /pipeline-validations`

Accepts either `definition` or `draft` and returns validation issues.

Node.js:

```js
const validation = await api("/pipeline-validations", {
  method: "POST",
  userId: "alice",
  body: {
    draft: {
      pipeline: {
        id: "hello-pipeline",
        name: "Hello Pipeline",
        entryNodeId: "plan",
      },
      graph: {
        nodes: [
          {
            id: "plan",
            name: "Plan",
            provider: "codex-cli",
            model: "gpt-5.4-mini",
            prompt: "Write a short implementation plan.",
          },
        ],
        edges: [],
      },
    },
  },
});
```

Python:

```python
validation = api("/pipeline-validations", method="POST", user_id="alice", body={
    "draft": {
        "pipeline": {
            "id": "hello-pipeline",
            "name": "Hello Pipeline",
            "entryNodeId": "plan"
        },
        "graph": {
            "nodes": [
                {
                    "id": "plan",
                    "name": "Plan",
                    "provider": "codex-cli",
                    "model": "gpt-5.4-mini",
                    "prompt": "Write a short implementation plan."
                }
            ],
            "edges": []
        }
    }
})
```

### `PUT /pipelines/:pipelineId/graph`

Validates and saves an editor draft.

Node.js:

```js
const saved = await api("/pipelines/hello-pipeline/graph", {
  method: "PUT",
  userId: "alice",
  body: {
    draft: {
      pipeline: {
        id: "hello-pipeline",
        name: "Hello Pipeline",
        entryNodeId: "plan",
      },
      graph: {
        nodes: [
          {
            id: "plan",
            name: "Plan",
            provider: "codex-cli",
            model: "gpt-5.4-mini",
            prompt: "Write a short implementation plan.",
          },
        ],
        edges: [],
      },
    },
  },
});
```

Python:

```python
saved = api("/pipelines/hello-pipeline/graph", method="PUT", user_id="alice", body={
    "draft": {
        "pipeline": {
            "id": "hello-pipeline",
            "name": "Hello Pipeline",
            "entryNodeId": "plan"
        },
        "graph": {
            "nodes": [
                {
                    "id": "plan",
                    "name": "Plan",
                    "provider": "codex-cli",
                    "model": "gpt-5.4-mini",
                    "prompt": "Write a short implementation plan."
                }
            ],
            "edges": []
        }
    }
})
```

### `PUT /pipelines/:pipelineId`

Replaces a pipeline using a full `definition` object.

Node.js:

```js
const updated = await api("/pipelines/hello-pipeline", {
  method: "PUT",
  userId: "alice",
  body: {
    definition: {
      id: "hello-pipeline",
      name: "Hello Pipeline v2",
      entryNodeId: "plan",
      nodes: [
        {
          id: "plan",
          name: "Plan",
          provider: "codex-cli",
          model: "gpt-5.4-mini",
          prompt: "Write a short implementation plan.",
        },
      ],
      edges: [],
    },
  },
});
```

Python:

```python
updated = api("/pipelines/hello-pipeline", method="PUT", user_id="alice", body={
    "definition": {
        "id": "hello-pipeline",
        "name": "Hello Pipeline v2",
        "entryNodeId": "plan",
        "nodes": [
            {
                "id": "plan",
                "name": "Plan",
                "provider": "codex-cli",
                "model": "gpt-5.4-mini",
                "prompt": "Write a short implementation plan."
            }
        ],
        "edges": []
    }
})
```

### `DELETE /pipelines/:pipelineId`

Deletes a saved pipeline.

Node.js:

```js
const deleted = await api("/pipelines/hello-pipeline", {
  method: "DELETE",
  userId: "alice",
});
```

Python:

```python
deleted = api("/pipelines/hello-pipeline", method="DELETE", user_id="alice")
```

## Queues and Tasks

### `GET /queues`

Lists queues for the selected user.

Node.js:

```js
const queues = await api("/queues", { userId: "alice" });
```

Python:

```python
queues = api("/queues", user_id="alice")
```

### `GET /queues/:queueId/tasks`

Returns queue metadata and queued/history tasks.

Node.js:

```js
const tasks = await api("/queues/simple-game-dev-review/tasks", { userId: "alice" });
```

Python:

```python
tasks = api("/queues/simple-game-dev-review/tasks", user_id="alice")
```

### `POST /tasks`

Creates a queued task.

Body:

```json
{
  "userId": "alice",
  "pipelineId": "simple-game-dev-review",
  "title": "Add split planning",
  "prompt": "Draft a monorepo split plan.",
  "pipelineCwd": "D:\\Projects\\alice\\workspace",
  "modelProfile": "standard"
}
```

Node.js:

```js
const task = await api("/tasks", {
  method: "POST",
  body: {
    userId: "alice",
    pipelineId: "simple-game-dev-review",
    title: "Add split planning",
    prompt: "Draft a monorepo split plan.",
    pipelineCwd: "D:\\Projects\\alice\\workspace",
    modelProfile: "standard",
  },
});
```

Python:

```python
task = api("/tasks", method="POST", body={
    "userId": "alice",
    "pipelineId": "simple-game-dev-review",
    "title": "Add split planning",
    "prompt": "Draft a monorepo split plan.",
    "pipelineCwd": "D:\\Projects\\alice\\workspace",
    "modelProfile": "standard",
})
```

### `PATCH /tasks/:taskId`

Updates a queued task title and/or prompt.

Node.js:

```js
const updated = await api("/tasks/9847f44c-8efe-46d1-8cb3-bfbb59d88482", {
  method: "PATCH",
  userId: "alice",
  body: {
    title: "Add split planning and migration notes",
  },
});
```

Python:

```python
updated = api("/tasks/9847f44c-8efe-46d1-8cb3-bfbb59d88482", method="PATCH", user_id="alice", body={
    "title": "Add split planning and migration notes"
})
```

### `DELETE /tasks/:taskId`

Deletes a task.

Node.js:

```js
const deleted = await api("/tasks/9847f44c-8efe-46d1-8cb3-bfbb59d88482", {
  method: "DELETE",
  userId: "alice",
});
```

Python:

```python
deleted = api("/tasks/9847f44c-8efe-46d1-8cb3-bfbb59d88482", method="DELETE", user_id="alice")
```

### `POST /queues/:queueId/reorder`

Reorders queued tasks by `taskIds`.

Node.js:

```js
const reordered = await api("/queues/simple-game-dev-review/reorder", {
  method: "POST",
  userId: "alice",
  body: {
    taskIds: [
      "task-a",
      "task-b",
      "task-c",
    ],
  },
});
```

Python:

```python
reordered = api("/queues/simple-game-dev-review/reorder", method="POST", user_id="alice", body={
    "taskIds": ["task-a", "task-b", "task-c"]
})
```

### `POST /queues/:queueId/pause`

Pauses queue dispatch.

Node.js:

```js
const paused = await api("/queues/simple-game-dev-review/pause", {
  method: "POST",
  userId: "alice",
});
```

Python:

```python
paused = api("/queues/simple-game-dev-review/pause", method="POST", user_id="alice")
```

### `POST /queues/:queueId/resume`

Resumes queue dispatch.

Node.js:

```js
const resumed = await api("/queues/simple-game-dev-review/resume", {
  method: "POST",
  userId: "alice",
});
```

Python:

```python
resumed = api("/queues/simple-game-dev-review/resume", method="POST", user_id="alice")
```

## Runs

### `GET /runs`

Lists runs for the selected user.

Node.js:

```js
const runs = await api("/runs", { userId: "alice" });
```

Python:

```python
runs = api("/runs", user_id="alice")
```

### `GET /runs/all-active`

Lists active runs across all users.

Node.js:

```js
const allActive = await api("/runs/all-active", { userId: "admin" });
```

Python:

```python
all_active = api("/runs/all-active", user_id="admin")
```

### `GET /runs/all`

Lists all runs across all users.

Node.js:

```js
const allRuns = await api("/runs/all", { userId: "admin" });
```

Python:

```python
all_runs = api("/runs/all", user_id="admin")
```

### `GET /runs/:runId`

Returns run metadata plus node-level details.

Node.js:

```js
const run = await api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd", { userId: "alice" });
```

Python:

```python
run = api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd", user_id="alice")
```

### `GET /runs/:runId/graph`

Returns the runtime graph with node statuses.

Node.js:

```js
const runGraph = await api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/graph", { userId: "alice" });
```

Python:

```python
run_graph = api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/graph", user_id="alice")
```

### `GET /runs/:runId/events`

Returns persisted run lifecycle events.

Node.js:

```js
const events = await api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/events", { userId: "alice" });
```

Python:

```python
events = api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/events", user_id="alice")
```

### `POST /runs`

Starts a background run immediately.

Body:

```json
{
  "userId": "alice",
  "pipelineId": "simple-game-dev-review",
  "pipelineCwd": "D:\\Projects\\alice\\workspace",
  "modelProfile": "standard",
  "taskTitle": "Monorepo split plan",
  "taskPrompt": "Split the fullstack monorepo into client and server repositories."
}
```

Node.js:

```js
const accepted = await api("/runs", {
  method: "POST",
  body: {
    userId: "alice",
    pipelineId: "simple-game-dev-review",
    pipelineCwd: "D:\\Projects\\alice\\workspace",
    modelProfile: "standard",
    taskTitle: "Monorepo split plan",
    taskPrompt: "Split the fullstack monorepo into client and server repositories.",
  },
});
```

Python:

```python
accepted = api("/runs", method="POST", body={
    "userId": "alice",
    "pipelineId": "simple-game-dev-review",
    "pipelineCwd": "D:\\Projects\\alice\\workspace",
    "modelProfile": "standard",
    "taskTitle": "Monorepo split plan",
    "taskPrompt": "Split the fullstack monorepo into client and server repositories."
})
```

### `POST /runs/:runId/pause`

Requests pause for an active run.

Node.js:

```js
const paused = await api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/pause", {
  method: "POST",
  userId: "alice",
});
```

Python:

```python
paused = api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/pause", method="POST", user_id="alice")
```

### `POST /runs/:runId/resume`

Resumes a paused run.

Node.js:

```js
const resumed = await api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/resume", {
  method: "POST",
  userId: "alice",
});
```

Python:

```python
resumed = api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/resume", method="POST", user_id="alice")
```

### `POST /runs/:runId/cancel`

Requests cancellation for an active run.

Node.js:

```js
const canceled = await api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/cancel", {
  method: "POST",
  userId: "alice",
});
```

Python:

```python
canceled = api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/cancel", method="POST", user_id="alice")
```

### `POST /runs/:runId/retry`

Starts a new retry run from an existing run record.

Node.js:

```js
const retried = await api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/retry", {
  method: "POST",
  userId: "alice",
});
```

Python:

```python
retried = api("/runs/31366c9d-eec4-46ab-b0fb-980cf5f77dfd/retry", method="POST", user_id="alice")
```

## Error Shapes

Typical error responses are JSON:

```json
{
  "ok": false,
  "error": "Pipeline not found: hello-pipeline"
}
```

Validation failures include `issues`:

```json
{
  "ok": false,
  "error": "Pipeline validation failed.",
  "issues": [
    {
      "code": "missing_field",
      "path": "pipeline.entryNodeId",
      "message": "Pipeline entryNodeId is required."
    }
  ]
}
```

Workspace conflicts include conflict metadata:

```json
{
  "ok": false,
  "error": "Workspace is already in use: D:\\Projects\\alice\\workspace (run ..., pipeline ...).",
  "workspacePath": "D:\\Projects\\alice\\workspace",
  "conflictingRunId": "existing-run-id",
  "conflictingPipelineId": "simple-game-dev-review"
}
```
