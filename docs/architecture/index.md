---
title: Architecture
---

# Architecture

This section documents AgentraLoop from the current codebase outward. The emphasis is on operational structure: pipelines, runs, queues, providers, and the Web Studio control surface.

## Recommended Reading Order

1. [Agent-Centric Runtime](./agent-centric-runtime)
2. [Runtime and Orchestration](./runtime-and-orchestration)
3. [Task Queue](./task-queue)
4. [Providers](./providers)
5. [Web Studio](./web-studio)

## Core Source Areas

- `src/server.ts`
- `src/run-manager.ts`
- `src/runtime.ts`
- `src/store.ts`
- `src/providers/index.ts`
- `web/src/App.tsx`

## Related Sections

- [Getting Started](/getting-started)
- [Design Notes](/design/)
- [Research and Paper](/research/)
