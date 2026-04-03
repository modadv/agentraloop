---
title: General Pipeline Design
---

# Agent-Oriented General Software Pipeline

## Goal

Turn the current agentraloop-oriented orchestrator into a general software delivery pipeline that:

- treats every node as one independent Agent invocation
- keeps orchestration outside the AI provider
- supports `Claude Agent SDK` and `Codex CLI`
- links nodes through Markdown output appended to the next node prompt
- stays minimal enough to grow into a Web UI blueprint editor later
- evolves from a sequential MVP into an Agent node graph edited visually like Unreal Engine blueprints

## Design Principles

- `Orchestrate`: define nodes, edges, prompts, provider, model
- `Run`: execute nodes in order and manage run state
- `Observe`: keep structured run logs and node outputs
- `Manipulate`: reserve pause/resume/retry/cancel state semantics for later API/UI control

## Product Philosophy

AgentraLoop is designed as an **agent-oriented orchestration system**, not as a single monolithic AI agent.

The core product idea is:

- the platform owns orchestration, persistence, queueing, and observability
- each graph node remains an independent Agent invocation
- providers are interchangeable execution backends, not the place where workflow state lives
- long-running software work should be expressed as:
  - reusable pipeline definitions
  - queueable text tasks
  - durable run records
  - inspectable outputs

This philosophy drives several concrete product choices already visible in the codebase:

- a pipeline definition is stored separately from runs
- a task queue is stored separately from runs
- a queue task becomes a run, but is not the same thing as a run
- provider lifecycle is abstracted behind a common provider interface
- Web UI pages are split by operational intent, not by implementation detail

In practice, the platform is optimized for:

- repeatable agent workflows
- 24x7 server-style operation
- multi-user workspace isolation
- explicit runtime control
- future blueprint-style visual editing

## Architectural Overview

The current system is intentionally layered.

### 1. Definition Layer

The definition layer describes reusable pipelines as persisted DAGs:

- pipeline id / name / description
- node list
- edge list
- entry node
- node execution metadata such as:
  - provider
  - model
  - prompt
  - workspace override
  - optional timeout / maxTurns

This layer is implemented primarily through:

- [src/types.ts](https://github.com/modadv/agentraloop/blob/main/src/types.ts)
- [src/schema.ts](https://github.com/modadv/agentraloop/blob/main/src/schema.ts)
- [src/store.ts](https://github.com/modadv/agentraloop/blob/main/src/store.ts)

### 2. Task Queue Layer

The queue layer accepts external text tasks and serializes them per pipeline.

Current phase rules:

- one pipeline corresponds to one queue
- one queue belongs to one user scope
- tasks in one queue execute serially
- queue tasks are persistent records
- a queue task is converted into a run only when dispatched

This layer is implemented primarily through:

- [src/run-manager.ts](https://github.com/modadv/agentraloop/blob/main/src/run-manager.ts)
- [src/store.ts](https://github.com/modadv/agentraloop/blob/main/src/store.ts)
- [src/server.ts](https://github.com/modadv/agentraloop/blob/main/src/server.ts)

### 3. Run Orchestration Layer

The orchestration layer converts a selected pipeline definition and runtime config into an executable run.

Responsibilities:

- resolve the execution target
- resolve user-scoped workspace and runtime config
- create run records
- execute graph nodes dependency-by-dependency
- track node status
- emit run and node events
- expose pause / resume / cancel / retry semantics

This layer is implemented primarily through:

- [src/run-manager.ts](https://github.com/modadv/agentraloop/blob/main/src/run-manager.ts)
- [src/runtime.ts](https://github.com/modadv/agentraloop/blob/main/src/runtime.ts)

### 4. Provider Layer

The provider layer adapts runtime node invocations to concrete Agent backends.

Responsibilities:

- invoke one Agent
- return output markdown and raw output
- expose provider availability
- surface provider-native lifecycle metadata

The provider layer explicitly distinguishes:

- `sdk-backed`
- `process-backed`

Current providers:

- `claude-agent-sdk`
- `codex-cli`
- `codex-sdk`

This layer is implemented through:

- [src/providers/base.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/base.ts)
- [src/providers/index.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/index.ts)
- [src/providers/claude.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/claude.ts)
- [src/providers/codex.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/codex.ts)
- [src/providers/codex-sdk.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/codex-sdk.ts)

### 5. Persistence and Observability Layer

The system is built to persist both definitions and execution history.

Current persisted entities:

- pipeline definitions
- runs
- run events
- queues
- queue tasks
- users

Current observability surfaces:

- SQLite stores
- JSONL event logs
- `/health`
- run detail APIs
- timeline APIs
- graph APIs
- Web UI runtime/history pages

This layer is implemented primarily through:

- [src/store.ts](https://github.com/modadv/agentraloop/blob/main/src/store.ts)
- [src/logger.ts](https://github.com/modadv/agentraloop/blob/main/src/logger.ts)
- [src/api-contract.ts](https://github.com/modadv/agentraloop/blob/main/src/api-contract.ts)

### 6. Server and Web Studio Layer

The HTTP server is the integration surface that ties user isolation, task input, run control, and the Web UI together.

Responsibilities:

- user-scoped routing by `userId`
- pipeline CRUD
- task queue APIs
- run APIs
- provider health reporting
- static serving of the web application

This layer is implemented primarily through:

- [src/server.ts](https://github.com/modadv/agentraloop/blob/main/src/server.ts)
- [web/src/App.tsx](https://github.com/modadv/agentraloop/blob/main/web/src/App.tsx)
- [web/src/api.ts](https://github.com/modadv/agentraloop/blob/main/web/src/api.ts)

## Core Domain Objects

The current architecture revolves around five persistent first-class objects.

### Pipeline

A reusable executable graph definition.

Key idea:

- stable design-time object
- edited separately from runtime state

### Queue

A serial execution lane bound to one pipeline and one user scope.

Key idea:

- operational input buffer for a pipeline

### Task

A unit of queued text work.

Key idea:

- durable task request
- editable only while queued
- mapped to a run only when dispatched

### Run

A concrete execution instance of a pipeline under one runtime configuration.

Key idea:

- immutable historical record of one execution attempt

### User

A filesystem-scoped and data-scoped operational tenant.

Key idea:

- current isolation primitive
- future authorization can layer on top without redesigning storage

## Execution Semantics

The current runtime semantics are intentionally conservative.

- graph validation is DAG-based
- execution is dependency-aware
- node execution is still single-active within one run
- queues are serial
- multiple users may run independently
- one queue task dispatches exactly one run

The system therefore supports:

- multi-user concurrency
- serial queue execution
- per-run graph execution

but intentionally does not yet support:

- queue-internal parallelism
- multi-node parallel execution within a run
- typed workflow payload contracts

## Runtime Context Model

Runtime inputs are layered rather than conflated.

### Run-level context

The run currently carries:

- `userId`
- `pipelinePath`
- `pipelineCwd`
- `modelProfile`
- `taskId`
- `queueId`
- `taskTitle`
- `taskPrompt`
- read-only repository context when available

### Node-level context

Each node contributes:

- provider
- model
- prompt
- optional model-profile overrides
- optional workspace override
- optional timeout
- optional maxTurns

### Upstream context

Downstream nodes receive upstream node output by prompt assembly rather than by typed object passing.

This preserves the current agent-oriented model:

- the orchestrator routes context
- the Agent interprets context

## Provider Strategy

The provider layer is intentionally kept narrow.

Platform responsibilities:

- queueing
- run lifecycle
- node lifecycle
- cancel / pause / resume semantics
- event persistence

Provider responsibilities:

- concrete Agent invocation
- provider-native lifecycle handling
- output collection
- provider-specific availability checks

Current strategic direction:

- prefer official SDK-native lifecycle management when an SDK exists
- keep CLI-backed providers as compatibility adapters
- continue evaluating `codex-sdk` against `codex-cli` before changing defaults

## Deployment Surfaces

The repository currently supports two execution surfaces.

### CLI run mode

Implemented by:

- [src/main.ts](https://github.com/modadv/agentraloop/blob/main/src/main.ts)

Use case:

- direct single pipeline execution
- local debugging

### Long-running server mode

Implemented by:

- [src/server.ts](https://github.com/modadv/agentraloop/blob/main/src/server.ts)

Use case:

- multi-user service
- queue processing
- Web Studio
- RESTful control plane

The long-running server mode is the primary product direction.

## Web Studio Information Architecture

The current Web UI is no longer a single overloaded control room. It is intentionally split by operational responsibility.

Current top-level pages:

- `Runtime`
  - current queue state
  - active runs
  - run controls
  - selected active run details
- `Create`
  - submit a text task into the selected pipeline queue
- `Editor`
  - edit the selected pipeline graph
  - node properties
  - validation state
- `Queue`
  - edit queued tasks for the selected pipeline
  - insert / edit / remove / reorder queued tasks
  - pause / resume queue
- `History`
  - terminal tasks
  - terminal runs
  - timelines
  - linked task-to-run inspection
- `Users`
  - user scope switching
  - user directory overview
  - admin-only user creation

This page split reflects the product model directly:

- design-time graph editing
- operational queue editing
- runtime monitoring
- historical audit
- tenant management

## Why the Architecture Looks This Way

Several choices in the repository are intentional tradeoffs rather than unfinished accidents.

- the orchestrator remains simple and explicit instead of embedding workflow logic in one provider SDK
- tasks, queues, and runs are separated to keep service-style operation durable
- graph data is persisted independently from runtime history
- user isolation is file-and-database based before full auth is introduced
- queue serialism is chosen over speculative internal parallelism
- UI is split by task rather than by implementation subsystem

This gives the project a usable shape for both:

- practical software delivery workflows
- future technical writing about an agent-oriented pipeline architecture

## Current Status

The repository currently implements a working MVP with:

- Agent-only nodes
- DAG-capable graph validation
- dependency-aware sequential graph execution
- background run manager
- SQLite-backed run persistence
- SQLite-backed pipeline-definition persistence
- request-driven runtime config
- run-level task input (`taskPrompt`)
- a dedicated default workspace at `runtime-workspaces/default`
- cooperative pause/resume/cancel/retry
- node-level `enabled` / `skipped` support
- model-profile selection (`fast` / `standard`)
- DAG cycle detection during schema validation
- default upstream input aggregation for merge nodes
- a minimal static Web UI control room served from the same Node server
- basic Web UI run controls for create/pause/resume/cancel/retry
- reusable task-driven validation pipelines, including a simple browser game development + review flow
- graceful shutdown with active-run cancellation and best-effort Agent cleanup
- workspace-level concurrency protection for multi-user safety
- startup-time pipeline discovery from project and user pipeline directories
- provider availability preflight exposed through `/health`
- structured pipeline validation results and graph-oriented save APIs for future editing

This is an intentional stepping stone, not the final orchestration model.

## MVP Scope

The current MVP intentionally supports:

- one node type: `Agent invocation`
- DAG graphs with a single entry root
- multiple incoming and outgoing edges
- sequential dependency-aware scheduling
- Markdown-only data flow between nodes
- real provider adapters for Claude and Codex

The current MVP intentionally does not yet support:

- blueprint-style visual editing
- typed output validation
- background job queue
- parallel node execution

## Pipeline Schema

```json
{
  "id": "default-software-delivery-pipeline",
  "name": "Default Software Delivery Pipeline",
  "entryNodeId": "task-intake",
  "nodes": [
    {
      "id": "task-intake",
      "name": "Task Intake",
      "enabled": true,
      "provider": "claude-agent-sdk",
      "model": "opus[1m]",
      "prompt": "..."
    }
  ],
  "edges": [
    { "from": "task-intake", "to": "implementation" }
  ]
}
```

## Target Graph Model

The final product direction is a node graph rather than a simple chain.

Planned target properties:

- one node still equals one independent Agent invocation
- a node may have multiple incoming edges
- a node may have multiple outgoing edges
- users edit nodes and edges visually in a blueprint-style Web UI
- runtime executes the graph using dependency-aware scheduling

Planned default merge rule:

- a node becomes runnable only when **all** upstream dependencies required by its incoming edges have completed successfully

This means the current sequential runner should be treated as a temporary execution subset of the future graph engine.

## Runtime Model

Pipeline run statuses:

- `pending`
- `running`
- `paused`
- `failed`
- `completed`
- `canceled`

Node run statuses:

- `pending`
- `running`
- `success`
- `failed`
- `skipped`
- `canceled`

## Prompt Linking

For the current graph-capable MVP, a runnable node assembles its final prompt from all upstream node outputs like this:

```md
<node prompt>

## Upstream Node Outputs

### From: intake (task-intake)
Status: success

<markdown>

### From: review (review-node)
Status: skipped

[Node skipped]
```

This keeps the pipeline completely agent-oriented and avoids introducing typed workflow payloads in the MVP.

## Input Modes

Current default behavior:

- `aggregate`

Meaning:

- a downstream node waits until all required upstream nodes are finished
- runtime aggregates all upstream Markdown outputs
- runtime invokes the downstream Agent exactly once

This is the only implemented input mode today.

Planned future extension:

- `sequential`

Intended meaning:

- each upstream output may trigger the downstream node independently
- the downstream Agent may be invoked multiple times for the same graph node
- runtime will need per-node multi-invocation tracking instead of a single node-run record

Current product decision:

- keep `aggregate` as the default and only active mode
- reserve schema and runtime evolution space for `sequential` later
- do not increase runtime complexity until the current graph model is stable

## Model Profiles

Run config now supports:

```json
{
  "modelProfile": "fast"
}
```

Each node may optionally provide per-profile model overrides:

```json
{
  "model": "gpt-5.4",
  "modelProfiles": {
    "fast": "gpt-5.4-mini",
    "standard": "gpt-5.4"
  }
}
```

Rules:

- if a profile override exists, runtime uses it
- otherwise runtime falls back to the node `model`
- testing and debugging should generally prefer `fast`
- `timeoutMs` is optional; if it is omitted, the runtime does not enforce a timeout for that node
- `timeoutMs` should only be set when a workflow author explicitly wants a bounded node execution window

Default workspace behavior:

- if `pipelineCwd` is omitted, server and CLI runs default to `runtime-workspaces/default`
- this keeps reusable pipeline tasks out of the main `agentraloop` source tree by default
- the default workspace may contain baseline assets, such as a tiny browser game used for task-driven validation
- the runtime does not automatically initialize or configure git repositories in the selected workspace
- if a workspace is already inside a git repository, the runtime reads repository context such as branch, remote URL, and recent commits
- any git write operations such as `git init`, `git add`, `git commit`, or branch manipulation are left to the runtime Agent node behavior instead of the orchestrator

## User Isolation Model

The server now supports user-scoped pipeline operation.

Current rules:

- every run belongs to a `userId`
- the default user is `admin`
- `admin` is special and may create new users
- user-scoped data is separated by directory and database, not only by UI filter state

Current on-disk layout:

- `users/admin/workspace`
- `users/admin/data`
- `users/admin/logs`
- `users/admin/pipelines`
- `users/<userId>/workspace`
- `users/<userId>/data`
- `users/<userId>/logs`
- `users/<userId>/pipelines`

Current server behavior:

- `GET /users` lists known users
- `POST /users` creates a new user profile and derived directories
- `GET /health?userId=<id>` returns user-scoped defaults such as:
  - `pipelineCwd`
  - `databasePath`
  - resolved user profile
- pipeline, run, graph, and event queries are user-scoped through `userId`
- each user has an independent SQLite database at:
  - `users/<userId>/data/pipeline.db`
- each user has an independent mirrored event log at:
  - `users/<userId>/logs/pipeline-events.jsonl`
- if a user does not override workspace at run creation time, the run defaults to:
  - `users/<userId>/workspace`

This is the current baseline for multi-user isolation.

Planned later evolution:

- richer per-user configuration beyond workspace and basic profile metadata
- admin-managed policy and permission controls
- user-scoped pipeline templates and imported task sources

## Node Enablement

Each node may optionally declare:

```json
{
  "enabled": true
}
```

Rules:

- omitted means enabled
- `false` means the node is skipped by runtime
- skipped nodes are recorded with status `skipped`
- runtime continues to the next connected node without invoking the provider

This is the current MVP mechanism for trimming pipelines to reduce latency and agent-call cost during testing or scenario-specific execution.

## Source Layout

- `src/types.ts`: shared runtime and schema types
- `src/schema.ts`: pipeline loading and validation
- `src/runtime.ts`: sequential execution engine
- `src/store.ts`: SQLite-backed stores for pipelines, runs, and run events
- `src/providers/claude.ts`: Claude Agent SDK adapter
- `src/providers/codex.ts`: Codex CLI adapter
- `src/main.ts`: executable entrypoint
- `src/server.ts`: minimal HTTP control surface
- `pipelines/default.pipeline.json`: default configurable pipeline

## Provider Lifecycle Principle

Current provider architecture is intentionally split into:

- orchestrator-managed run and node lifecycle
- provider-managed Agent invocation details

Current implementation status:

- the orchestrator owns:
  - queue dispatch
  - run state
  - node execution order
  - pause / resume / cancel semantics
  - active invocation tracking
- provider adapters own:
  - prompt delivery
  - model invocation
  - result collection
  - provider-specific abort behavior

Current low-cost token controls:

- `claude-agent-sdk` defaults to `persistSession: false`
- Claude node invocations no longer hard-code a global default `maxTurns`; the default is unset and node-level configuration can override it when needed
- downstream prompt assembly now truncates each upstream node output section before appending it to the next node prompt, preventing large markdown reports from expanding every subsequent invocation

Design principle going forward:

- if a provider has an official SDK or native session/runtime API, the adapter should prefer the SDK's own lifecycle and process/session management model
- the orchestrator should not re-implement provider-internal process management when a stable SDK lifecycle already exists
- CLI-backed providers remain acceptable as compatibility adapters when no suitable SDK/runtime surface exists
- the platform should continue to expose a unified provider interface, but internally distinguish:
  - `sdk-backed provider`
  - `process-backed provider`

Current interpretation:

- `claude-agent-sdk` is already close to the target direction because the adapter runs within the SDK query/session model
- `codex-cli` is currently a process-backed compatibility adapter because invocation is implemented through direct CLI process spawning
- `codex-sdk` is now implemented as an experimental `sdk-backed` provider spike alongside `codex-cli`
- current low-cost improvements already applied:
  - provider availability now exposes `lifecycleMode`
  - Claude adapter now defaults to `persistSession: false` for one-shot node execution
  - provider-native instance/session identifiers may be recorded in node metadata and event payloads when available
  - `codex-sdk` now records the native Codex thread id into node metadata/event payloads

Current `codex-sdk` spike validation status:

- direct SDK invocation succeeds for a one-shot prompt
- `AbortSignal` cancellation is honored by the SDK-backed adapter
- runtime smoke execution succeeds through the normal pipeline runtime/event path
- the Web UI now exposes `codex-sdk` in provider status and node provider selection
- `codex-cli` remains the stable default compatibility path until more parity testing is completed

This principle is a design constraint for future provider cleanup and should guide later refactors toward a more internally consistent provider model.

## Current HTTP API

The current server is intentionally small and background-run oriented:

- `GET /health`
- `GET /users`
- `POST /users`
- `GET /pipelines`
- `GET /pipelines/default`
- `GET /pipelines/:pipelineId`
- `GET /pipelines/:pipelineId/graph`
- `POST /pipelines`
- `PUT /pipelines/:pipelineId`
- `PUT /pipelines/:pipelineId/graph`
- `DELETE /pipelines/:pipelineId`
- `POST /pipeline-validations`
- `GET /runs`
- `GET /runs/:runId`
- `GET /runs/:runId/graph`
- `GET /runs/:runId/events`
- `POST /runs`
- `POST /runs/:runId/pause`
- `POST /runs/:runId/resume`
- `POST /runs/:runId/cancel`
- `POST /runs/:runId/retry`

`POST /runs` now creates a background run and returns immediately.

`GET /health` now also returns provider preflight status, including whether:

- `codex-cli` is executable in the current server environment
- `claude-agent-sdk` is available to the current Node process

Pipeline editing support now includes:

- structured validation errors from `POST /pipeline-validations`
- graph-draft persistence through `PUT /pipelines/:pipelineId/graph`
- `422` responses with machine-readable validation issues instead of plain error strings

The current Web UI is now a React-based workbench served from the same Node process:

- build output is generated by Vite into `public/app`
- the server serves the SPA and its assets under `/` and `/app`
- graph rendering is now unified on `Rete.js 2` for `Pipeline`, `Run`, and `Draft`
- component styling is now moving onto `Tailwind CSS` with a small `shadcn`-style primitive layer
- the layout is now page-oriented instead of a single overloaded workbench

The current Web UI supports:

- a dedicated `Runtime` page for active runs and operator controls on selected live runs
- a dedicated `Create` page for task creation and run launch
- a dedicated `Editor` page for pipeline draft editing
- a dedicated `History` page for terminal runs and detailed past execution state
- a dedicated `Users` page for user scope management and per-user storage/workspace overview
- listing persisted pipelines
- listing recent runs
- selecting a pipeline or run to inspect graph/detail/timeline
- creating a run from the selected persisted pipeline
- supplying a run-level task prompt when creating a run
- pausing, resuming, canceling, and retrying the selected run
- warning when the selected pipeline depends on a provider that is currently unavailable
- editing a pipeline draft through a minimal form-oriented editor with node and edge management
- validating and saving graph drafts back through the editing APIs

## Blueprint Editor Technology Decision

The current canvas implementation proved good enough for getting the editing model, backend APIs, and workbench layout in place, but it is not the final editor technology choice.

After multiple rounds of interaction testing, the most persistent problem is the Draft-mode editing feel:

- node dragging still feels too fragile compared with a real blueprint editor
- connection creation is harder to make reliable than desired
- the current implementation remains too sensitive to React render churn during graph interaction

The product decision is now:

- do **not** move to a 3D/game-engine stack such as `Three.js` or `Babylon.js`
- keep the frontend application shell as:
  - `React`
  - `TypeScript`
  - `Vite`
  - `Tailwind CSS`
- replace the **graph editor layer** with `Rete.js 2`

Why this direction:

- `Rete.js 2` is TypeScript-first and explicitly positioned as a framework for visual programming rather than only graph display
- it is a better semantic fit for a blueprint-style node editor than the current React Flow-based canvas
- it lets us keep the rest of the frontend architecture while swapping only the editor core

Why not a 3D/game-engine route:

- the product needs a 2D node editor, not a 3D scene system
- a graphics/game engine would introduce much more rendering and interaction complexity than the problem requires
- that route would be heavier, slower to ship, and less maintainable for this product stage

Why not keep React Flow as the long-term editor core:

- React Flow remains a useful modern graph UI library and can continue to serve as a temporary or read-only graph renderer
- however, the Draft editor's primary interaction quality is now the bottleneck, and the current React Flow editing layer has already consumed too much tuning effort for too little remaining certainty

Current plan:

- `Rete.js 2` becomes the target editor technology for the blueprint editing surface
- the existing React Flow editor remains a transitional implementation until the Rete-based editor reaches parity
- backend graph contracts stay intact so the canvas layer can be swapped without redesigning the runtime model

## Pipeline Discovery

On server startup, pipeline definitions are now seeded from:

- project directory: `./pipelines`
- user directory: `~/.agentraloop/pipelines`

Rules:

- all `.json` files in those directories are attempted
- valid definitions are persisted into SQLite and become visible in the Web UI
- missing directories are ignored
- invalid files are logged and skipped without blocking server startup

This keeps the current UI model based on persisted pipeline definitions while allowing future user-scoped custom pipeline files.

## Editing Contracts

The backend now supports two editing-friendly patterns:

1. Validate without saving

- `POST /pipeline-validations`
- accepts either a full `definition` or a graph-oriented `draft`
- returns `ok` plus a list of structured issues

2. Save graph draft directly

- `PUT /pipelines/:pipelineId/graph`
- accepts a graph-oriented `draft`
- converts the draft into a runtime `PipelineDefinition`
- validates it
- persists it on success

Validation issue shape:

```json
{
  "code": "duplicate_node_id",
  "path": "graph.nodes[1].id",
  "message": "Duplicate node id detected: node-a"
}
```

## Graceful Shutdown

The server now performs best-effort active run cleanup when the Node process receives:

- `SIGINT`
- `SIGTERM`
- `uncaughtException`
- `unhandledRejection`

Current shutdown behavior:

- stop accepting new HTTP connections
- mark active runs as `cancel_requested`
- abort the currently active node invocation when the provider supports it
- wait briefly for active run tasks to settle
- persist the updated run state and events before exit

Provider support level:

- `codex-cli`: explicit child-process abort is implemented
- `claude-agent-sdk`: best-effort abort is wired through runtime/provider control flow, but cleanup guarantees still depend on SDK behavior

## Workspace Concurrency

The server now enforces a simple workspace safety rule:

- only one active run may use the same `pipelineCwd` at a time

Meaning:

- `pending`
- `running`
- `paused`
- `canceling`

all still hold the workspace lock.

If a second run is created or retried against the same workspace while another active run still owns it:

- the request is rejected with HTTP `409`
- the response includes the conflicting `runId`, `pipelineId`, and `workspacePath`

This is the current minimal multi-user protection layer before introducing more advanced queueing or workspace-copy isolation.

Request body:

```json
{
  "pipelineId": "dag-smoke-graph-check",
  "pipelinePath": "pipelines/default.pipeline.json",
  "pipelineCwd": ".",
  "modelProfile": "fast",
  "taskPrompt": "Fix the login crash when the password is empty."
}
```

Run-level task input can be injected into node prompts with template tokens:

- `run.taskTitle`
- `run.input.taskTitle`
- `run.taskPrompt`
- `run.input.taskPrompt`

The repository also includes a reusable task-driven validation pipeline:

- `simple-game-dev-review`

Purpose:

- apply a run-level task prompt to a tiny browser game workspace
- let one agent implement the requested game change
- let a second agent review the resulting workspace against the same task

Recommended validation workspace:

- `runtime-workspaces/default`

Run execution now supports either:

- `pipelineId` for persisted pipeline definitions
- or `pipelinePath` for file-based execution fallback

This lets the caller override runtime config per request, which is useful for debugging and for future Web UI integration.

Run records are now persisted in SQLite by default:

- default path: `data/pipeline.db`
- configurable through `PIPELINE_DB_PATH`
- run history survives server restarts

Pipeline definitions are also persisted in the same SQLite database.

- server startup seeds the configured default pipeline file into the database
- CRUD APIs operate on persisted definitions
- future Web UI work should prefer persisted pipeline IDs over file paths

Run event timelines are also persisted in SQLite.

- lifecycle and node events are appended during execution
- `GET /runs/:runId/events` returns the ordered event stream
- this is the intended backend surface for future graph execution visualization

## API Contract Notes

The server now exposes more UI-friendly response shapes:

- pipeline endpoints return both:
  - `pipeline`: the full persisted definition
  - `summary`: compact metadata for lists and cards
- run list endpoints return compact run summaries
- run detail endpoints return:
  - `run`: top-level run metadata and config
  - `nodes`: node execution records
- run event endpoints return ordered timeline items already normalized for frontend rendering
- graph endpoints return:
  - graph node/edge data ready for canvas rendering
  - node runtime status snapshots for run visualization

This contract is intended to reduce frontend-side reshaping work before the blueprint UI exists.

Current minimal UI entry:

- `GET /`
- `GET /app`

The UI currently covers:

- pipeline list
- run list
- run detail JSON view
- graph rendering from graph endpoints
- run event timeline view

## Control Semantics

The current control plane is cooperative:

- `pause` takes effect at node boundaries
- `resume` continues from the next pending node
- `cancel` is cooperative and also takes effect at node boundaries
- `retry` creates a brand new run using the original run config

This matches the current MVP architecture, where each node is one independent Agent invocation and the orchestrator does not yet forcibly interrupt provider-internal execution.

## Workspace Semantics

Run requests can provide a `pipelineCwd`, which acts as the pipeline workspace root.

- each node may define its own `cwd`
- if a node `cwd` is relative, it is resolved against `pipelineCwd`
- if a node `cwd` is omitted, the node runs directly in `pipelineCwd`

This is the intended isolation model for running pipelines against external workspaces instead of the orchestrator repository itself.

## DAG Validation

Even though the current runtime still executes a sequential subset, schema validation now rejects cyclic graphs.

- pipelines must remain acyclic
- the configured `entryNodeId` must be a root node with no incoming edges
- cycle detection happens before execution
- invalid graphs should be rejected before future Web UI save/run actions

## Simplified DAG Execution Model

The current runtime is intentionally simple:

- only nodes reachable from `entryNodeId` are executed
- a node becomes runnable when all reachable upstream nodes have completed or been skipped
- runnable nodes are executed sequentially in deterministic order
- the first node failure still fails the run

This is enough to support blueprint-style graph authoring without introducing parallel scheduling complexity yet.

For merge-like graph shapes, this means:

- fan-out branches may complete independently
- a downstream merge node executes only after all required upstream branches have completed
- the merge itself currently happens during downstream prompt assembly, not as a standalone system node

## Case 4 Note

The current `case4` validation pipeline is intended to verify richer multi-step semantic chaining without modifying repository code.

Recent validation uncovered two important constraints:

- node workspaces must be resolved relative to the requested `pipelineCwd`
- prompts must explicitly forbid nested pipeline execution, otherwise an Agent may recursively invoke `npm start` / `node dist/main.js` and contaminate the validation result

The repository has already been updated to address both issues in source, and `case4` has been simplified to a shorter 3-node validation flow using fast-model profile overrides. An already-running server process will continue serving older code until restarted.

## TODO

Near-term:

1. `Blueprint Editor v1 Freeze` is complete.
   - canvas structure editing is the primary editing path
   - Inspector property editing is the primary property-editing path
   - `Quick Jump` and `Support Tools` are auxiliary on-demand panels
   - the top canvas mode bar information architecture is frozen
   - node visual states and edge visual hierarchy are frozen for v1
   - the mobile/tablet/desktop responsive layout strategy is frozen for v1
2. `Rete.js 2` is now the unified graph canvas layer.
   - keep `React + TypeScript + Vite + Tailwind` as the application shell
   - `Pipeline` uses readonly Rete rendering
   - `Run` uses readonly Rete rendering with runtime state overlays
   - `Draft` uses editable Rete rendering
   - the old React Flow main-canvas path has been removed from the primary UI flow
3. Run a full system test pass on the unified Rete baseline:
   - pipeline view
   - run view
   - draft view
   - node selection
   - node drag/move
   - edge creation and deletion
   - draft save / validate / reload
   - responsive layout
   - run control actions
4. Add per-node workspace examples and test fixtures.
5. Improve validation error messages for graph issues such as entry-root conflicts versus cycles.
6. Keep `React Flow` out of the main editor path unless a future fallback is explicitly required.

Next architecture step:

1. Keep the current backend graph/save/validate contract stable while iterating on the unified Rete editor.
2. Add parallel execution for independent ready nodes.
3. Expand run-control semantics for graph-aware pause/resume visibility.
4. Add graph-aware skip policies and richer edge semantics.
5. Support multi-root graphs if the product truly needs them.
6. Add node-level `inputMode` design with future `sequential` support while keeping `aggregate` as the default.

Product/UI:

1. Complete the post-freeze system test pass on the unified Rete canvas and fix any blocking regressions.
2. Preserve the current “canvas for structure, inspector for properties” editing model while tightening details.
3. Only after the unified editor baseline is stable, continue with deeper blueprint editing interactions.

## Run Input Context

Run creation now supports a reusable task-oriented input model.

- `taskTitle`
  - a short human-friendly task label for the current run
- `taskPrompt`
  - the main free-form task description
- repository context
  - collected automatically from the selected workspace when possible
  - includes:
    - `repoUrl`
    - `branch`
    - `recentCommits`

Prompt templates can reference:

- `run.taskTitle`
- `run.input.taskTitle`
- `run.taskPrompt`
- `run.input.taskPrompt`
- `run.repoUrl`
- `run.input.repoUrl`
- `run.branch`
- `run.input.branch`

Reusable task-oriented pipelines should normally include both:

- `run.taskTitle` for a short human-readable task name
- `run.taskPrompt` for the full request body

This keeps task inputs at the run level rather than modeling them as dedicated pipeline nodes.

The Web UI `Run Controls` panel also shows a live workspace repository preview before a run is created:

- current workspace path
- detected branch
- detected remote URL
- recent commit count

## Task Queue Direction

The next orchestration step is a queue-driven task input layer for 24x7 operation.

The current design direction is intentionally narrow:

- only pure text tasks in this phase
- no image/audio/video attachments yet
- no queue-internal parallelism
- no advanced priority or retry routing

The queue system should not replace the existing pipeline/run model. Instead:

- a queue accepts external tasks
- the dispatcher converts each task into exactly one run
- the existing `RunManager` and pipeline runtime remain the execution layer

This keeps the architecture simple:

- `task -> run`
- `queue -> pipeline`
- `dispatcher -> createRun()`

## Queue Binding Model

Current product decision:

- one pipeline definition corresponds to one task queue
- one queue belongs to one user scope
- one queue executes tasks serially

This is intentionally a `1:1` mapping:

- `queue -> pipeline`

It is preferred for the current phase because:

- the user mental model is simple
- scheduling logic stays small
- the pipeline graph and its queue remain tightly associated
- future expansion remains possible without redesigning the run engine

Future expansion such as multiple queues per pipeline or queue-to-pipeline routing is explicitly deferred.

## Task Model

The queue layer should introduce a persistent task model that is separate from runs.

Suggested minimal shape:

- `taskId`
- `userId`
- `queueId`
- `pipelineId`
- `title`
- `prompt`
- `status`
- `position`
- `runId`
- `createdAt`
- `updatedAt`
- `startedAt`
- `finishedAt`

Current phase status set:

- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

The run mapping is straightforward:

- `task.title -> run.config.taskTitle`
- `task.prompt -> run.config.taskPrompt`
- `task.userId -> run.config.userId`
- `task.pipelineId -> run.config.pipelineId`

Future extension points may add `metadata` and `attachments`, but they are intentionally out of scope for this phase.

## Queue Model

Suggested minimal queue shape:

- `queueId`
- `userId`
- `pipelineId`
- `name`
- `status`
- `createdAt`
- `updatedAt`

Current phase queue status:

- `active`
- `paused`

Queue concurrency is fixed to `1` in this phase.

## Dispatcher Semantics

The dispatcher should be a thin serial scheduler layered on top of the existing run system.

Rules:

- a queue may have at most one active task at a time
- the active task is the one whose mapped run is still non-terminal
- when no active task exists, the dispatcher selects the earliest `queued` task by `position`
- dispatching a task creates exactly one run
- when that run reaches a terminal state, the task reaches the corresponding terminal state
- the dispatcher then immediately checks the next queued task

This means the queue serializes tasks, but the run engine remains unchanged.

## Cancel Behavior

Current product decision:

- canceling the active task should not stop the queue
- the queue must continue with the next queued task once the canceled task truly reaches terminal state

Important distinction:

- `cancel_requested` or `canceling` does **not** release the queue
- only the terminal task state `canceled` releases the queue

Default queue continuation policy in this phase:

- after `completed`, continue with the next queued task
- after `failed`, continue with the next queued task
- after `canceled`, continue with the next queued task

No configurable `stopOnFailure` or `stopOnCancel` policy is introduced yet.

## Queue Editing Rules

The task queue editor should only allow mutation of queued work.

Rules:

- `queued` tasks:
  - editable
  - removable
  - reorderable
- `running` tasks:
  - readonly
  - not removable from the editor
  - not reorderable
- terminal tasks:
  - readonly
  - shown in history, not edited in the queue editor

This keeps the runtime state machine stable and avoids mid-flight task mutation.

## Web UI Impact

The graph editor and queue editor should be separated at the page level to keep editing flows clear.

Recommended split:

- `Editor`
  - edit the pipeline node graph
- `Queue`
  - edit the pipeline's queued text tasks

The queue page should support:

- insert task
- edit queued task
- remove queued task
- drag to reorder queued tasks

The `Create` page remains the lightweight task submission entry point, while the dedicated `Queue` page handles direct queue management for the selected pipeline.

## API Direction For Queue Phase

Suggested minimal API surface for the first implementation pass:

- `POST /tasks`
  - create and enqueue a text task
- `GET /queues`
  - list queues for a user
- `GET /queues/:queueId/tasks`
  - list tasks for one queue
- `PATCH /tasks/:taskId`
  - edit a queued task
- `DELETE /tasks/:taskId`
  - remove a queued task
- `POST /queues/:queueId/reorder`
  - update queued task order
- `POST /queues/:queueId/pause`
- `POST /queues/:queueId/resume`

The current phase does not require attachment upload endpoints.

Programming examples for task submission:

- JavaScript: [examples/create-task.example.mjs](https://github.com/modadv/agentraloop/blob/main/examples/create-task.example.mjs)
- TypeScript: [examples/create-task.example.ts](https://github.com/modadv/agentraloop/blob/main/examples/create-task.example.ts)

## Queue Phase Scope Lock

To keep scope controlled, the first queue implementation should explicitly exclude:

- image/audio/video/file attachments
- queue-internal parallel execution
- priority preemption
- advanced retry policy
- queue-to-pipeline routing
- multi-stage task decomposition outside normal pipeline nodes

The goal of this phase is simply:

- accept text tasks continuously
- serialize them per queue
- translate them into runs
- keep the existing run and pipeline architecture intact

## Queue Phase Implementation Status

The first text-only queue phase is now implemented.

Delivered backend capabilities:

- persistent per-user queues
- persistent per-user text tasks
- queue-scoped serial dispatch
- `task -> run` mapping through the existing `RunManager`
- queue pause / resume
- queued-task update / delete / reorder
- queue continuation after `completed`, `failed`, and `canceled`

Delivered Web UI capabilities:

- `Create` page enqueues text tasks instead of directly creating runs
- `Editor` page focuses on graph editing only
- `Queue` page includes `Queue Editor`
- `Queue Editor` supports:
  - insert queued task
  - edit queued task
  - remove queued task
  - reorder queued task order
- running tasks are shown in `Current Task` and are readonly

Validation completed for this phase:

- enqueue task from Web UI
- automatic queue dispatch into a run
- editing, deleting, and reordering queued tasks
- queue pause / resume
- cancel active task and automatically continue with the next queued task after terminal `canceled`
- task history display in the `History` page
- `task -> run` linkage visible in the `History` page and `Inspector`

## Queue Phase Acceptance Summary

The first text-only task queue phase can now be considered functionally accepted.

Accepted execution flow:

1. A user opens the `Create` page and submits a text task.
2. The task is stored in the queue bound to the selected pipeline.
3. If the queue is active and idle, the task is automatically dispatched into a run.
4. The `Editor` page allows queued tasks to be edited, removed, and reordered.
5. Running tasks are shown as readonly queue state rather than editable task forms.
6. When the active task reaches `completed`, `failed`, or `canceled`, the queue automatically advances to the next queued task.
7. The `History` page shows both terminal runs and terminal queue tasks, with task-to-run linkage.

Accepted behavioral rules:

- `1 pipeline = 1 queue`
- queue concurrency remains `1`
- only `queued` tasks are editable
- `running` tasks are readonly
- terminal tasks move into history semantics rather than remaining queue-editable
- canceling the current run does not release the queue until the task truly reaches terminal `canceled`

## Queue Phase Residual Backlog

The current queue phase is usable, but these non-blocking items remain:

1. `Runtime` should present a stronger queue-focused summary:
   - current task
   - next queued task
   - queue status
   - queue depth
2. `History` can still benefit from a clearer result summary for each terminal task/run pair.
3. Cross-page task navigation can be smoother, especially after creating a task and then switching into `Editor` or `History`.
4. Larger-scale task and queue histories will likely need stronger filtering once usage grows.

## Next Steps

1. Add queue-centric observability to the `Runtime` page.
2. Improve terminal task/run summaries in the `History` page.
3. Smooth task navigation between `Create`, `Editor`, and `History`.
4. Then decide whether to deepen queue operations further or return to blueprint editing interactions.

## Current Test Outcome

The current stage baseline is:

- `Pipeline / Run / Draft` now share one Rete-based graph canvas implementation
- `Draft` supports:
  - left-drag node
  - right-drag canvas
  - handle-to-handle connection
  - delete node / delete edge
  - validate / save / reload
- `Run` supports:
  - create
  - pause
  - resume
  - cancel
  - retry
- responsive layout remains usable on desktop and on narrow mobile width (`390x844`)

Verified in-browser during the current phase:

- `Pipeline` readonly graph rendering
- `Run` readonly graph rendering with runtime status updates
- `Draft` editable graph rendering
- node selection -> Inspector synchronization
- run create / cancel on the unified Rete canvas
- run pause / resume timeline propagation on the unified Rete canvas
- mobile Draft editing chain including quick add and Inspector sync

Current residual issues / backlog:

1. Pause/resume event semantics are observable, but the UI can still show the run as `running` while the pause request is waiting for the node boundary to settle.
2. The run list now has `Active / All / Terminal` filters, but large validation histories still create noise if the user stays on `All`.
3. The current mobile layout is functional, but large-scale graph editing ergonomics on phone-sized screens still need a dedicated refinement pass.
4. Provider lifecycle cleanup remains a future architecture task:
   - explicitly classify providers as `sdk-backed` or `process-backed`
   - prefer official SDK-native lifecycle/session management whenever available
   - keep CLI spawning only as a compatibility path when no suitable SDK/runtime surface exists
   - continue parity testing for `codex-sdk` before considering any default-provider switch away from `codex-cli`
