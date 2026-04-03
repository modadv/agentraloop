---
title: Runtime and Orchestration
---

# Runtime and Orchestration

This document explains how AgentraLoop executes work once a task has been accepted.

Primary source files:

- [src/run-manager.ts](https://github.com/modadv/agentraloop/blob/main/src/run-manager.ts)
- [src/runtime.ts](https://github.com/modadv/agentraloop/blob/main/src/runtime.ts)
- [src/schema.ts](https://github.com/modadv/agentraloop/blob/main/src/schema.ts)
- [src/types.ts](https://github.com/modadv/agentraloop/blob/main/src/types.ts)

## Runtime Responsibilities

The runtime is split into two layers:

- `RunManager`
  - owns persisted runs
  - manages queue dispatch
  - tracks active invocations
  - handles cancel, pause, resume, retry, and shutdown
- `runPipeline`
  - executes a resolved pipeline graph
  - assembles prompts
  - invokes providers node by node
  - produces node events and final run state

This split is important. `RunManager` owns service behavior. `runtime.ts` owns pipeline execution behavior.

## Run Creation

`RunManager.createRun()` normalizes a request into a `PipelineRunConfig` and creates a managed run record.

Important config fields include:

- `userId`
- `pipelinePath`
- `pipelineCwd`
- `modelProfile`
- `queueId`
- `taskId`
- `taskTitle`
- `taskPrompt`

The manager also captures read-only git context when available:

- `repoUrl`
- `branch`
- `recentCommits`

This is inspection only. The orchestrator does not automatically initialize or modify git state.

## Pipeline Execution

`runPipeline()` in [src/runtime.ts](https://github.com/modadv/agentraloop/blob/main/src/runtime.ts) performs the actual node execution.

Key steps:

1. validate the pipeline definition
2. build node, successor, and predecessor maps
3. compute reachable nodes from the entry node
4. create the initial ready queue
5. execute ready nodes in dependency order
6. collect outputs and append events
7. transition the run into a terminal state

## Prompt Assembly

Prompt assembly happens in two stages:

1. template rendering
   - `run.taskTitle`
   - `run.taskPrompt`
   - `run.repoUrl`
   - `run.branch`
   - pipeline metadata
2. upstream output injection
   - previous node outputs are appended under `## Upstream Node Outputs`

Current behavior intentionally truncates each upstream section to a bounded size before appending it.

## Execution Model

The runtime is still conservative:

- graph execution respects declared dependencies
- runs are controlled by explicit state, not by transcript continuity
- node execution uses provider-specific backends under one orchestrator contract

Node execution emits structured events such as:

- `node_started`
- `node_succeeded`
- `node_failed`
- `node_canceled`

Run execution emits events such as:

- `run_started`
- `run_completed`
- `run_failed`
- `run_canceled`

## Control Semantics

Control state is separate from terminal run state.

Important concepts:

- `running`
- `paused`
- `canceling`
- terminal states:
  - `completed`
  - `failed`
  - `canceled`

`cancel requested` does not immediately free a queue. The queue is released only when the run reaches a true terminal state.

`pause` and `resume` are cooperative control operations handled by the runtime, not arbitrary process suspension.

## Workspace Semantics

Runs execute inside a user-scoped workspace path.

The manager enforces workspace conflict protection:

- one mutable workspace should not silently host overlapping active runs

This is a deliberate runtime rule, not an incidental safety check.

## Why This Split Matters

AgentraLoop does not treat execution as “send a prompt and wait”.

It treats execution as:

- resolve work
- create run state
- coordinate node lifecycle
- route through providers
- record events
- expose control to operators

That is the main difference between a runtime and a prompt launcher.
