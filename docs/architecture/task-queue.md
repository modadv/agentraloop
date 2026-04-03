---
title: Task Queue
---

# Task Queue

This document describes how AgentraLoop accepts, stores, edits, and dispatches queued work.

Primary source files:

- [src/run-manager.ts](https://github.com/modadv/agentraloop/blob/main/src/run-manager.ts)
- [src/store.ts](https://github.com/modadv/agentraloop/blob/main/src/store.ts)
- [src/server.ts](https://github.com/modadv/agentraloop/blob/main/src/server.ts)
- [src/api-contract.ts](https://github.com/modadv/agentraloop/blob/main/src/api-contract.ts)

## Core Model

Current queue design is intentionally simple:

- one pipeline corresponds to one queue
- one queue runs at most one active task at a time
- tasks are currently text-only

Each queued task contains:

- `taskId`
- `userId`
- `queueId`
- `pipelineId`
- `title`
- `prompt`
- `status`
- `position`
- optional `runId`

## Queue Records

Queue persistence is implemented in [src/store.ts](https://github.com/modadv/agentraloop/blob/main/src/store.ts).

Tables:

- `task_queues`
- `queue_tasks`

Important indexes:

- `idx_task_queues_pipeline_id`
- `idx_queue_tasks_queue_id`
- `idx_queue_tasks_run_id`

The store is simple SQLite-backed persistence accessed through `SqliteTaskQueueStore`.

## Queue Operations

`RunManager` exposes queue operations:

- `enqueueTask`
- `updateTask`
- `deleteTask`
- `reorderQueue`
- `pauseQueue`
- `resumeQueue`
- `listQueues`
- `listQueueTasks`

Behavioral rules:

- only `queued` tasks can be edited
- only `queued` tasks can be removed
- reorder requests must include exactly the queued task IDs for that queue
- paused queues do not dispatch new work

## Dispatch Semantics

Dispatch is handled by `RunManager.dispatchQueue()`.

Current policy:

- do nothing if the queue is already dispatching
- do nothing if the queue is paused
- do nothing if any task in the queue is already `running`
- choose the next `queued` task by position
- convert it into a run
- mark the task `running`

This is intentionally serial and conservative.

## Task to Run Mapping

When a queued task is dispatched, the manager creates a run with:

- `queueId`
- `taskId`
- `taskTitle`
- `taskPrompt`

This preserves a clean distinction:

- a task is requested work
- a run is actual execution

## Queue Release Rule

The queue is released only after the current run reaches a true terminal state:

- `completed`
- `failed`
- `canceled`

This is why cancel behavior works the way it does:

- cancel request does not immediately start the next task
- next dispatch happens only after the run is truly terminal

## HTTP API

Queue and task APIs are exposed from [src/server.ts](https://github.com/modadv/agentraloop/blob/main/src/server.ts).

Current endpoints:

- `GET /queues`
- `GET /queues/:queueId/tasks`
- `POST /tasks`
- `PATCH /tasks/:taskId`
- `DELETE /tasks/:taskId`
- `POST /queues/:queueId/reorder`
- `POST /queues/:queueId/pause`
- `POST /queues/:queueId/resume`

These APIs use `userId` as the scope selector. This is deliberate: current architecture prioritizes user separation over a heavy permission system.

## Why the Queue Matters

The queue is not a UI convenience. It is the intake boundary that makes:

- unattended execution
- task editing before dispatch
- serial workspace-safe operation
- history-aware processing

possible in a continuous service.
