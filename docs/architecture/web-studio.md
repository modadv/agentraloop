---
title: Web Studio
---

# Web Studio

This document explains how the current UI maps onto the runtime model.

Primary source files:

- [web/src/App.tsx](https://github.com/modadv/agentraloop/blob/main/web/src/App.tsx)
- [web/src/api.ts](https://github.com/modadv/agentraloop/blob/main/web/src/api.ts)
- [web/src/types.ts](https://github.com/modadv/agentraloop/blob/main/web/src/types.ts)
- [web/src/components/graph/rete-draft-editor.tsx](https://github.com/modadv/agentraloop/blob/main/web/src/components/graph/rete-draft-editor.tsx)

## UI Role

The current UI is a human control surface over runtime objects. It is not the architecture itself.

The UI exists so operators can:

- submit tasks
- inspect queue state
- monitor active runs
- edit pipelines
- inspect history
- manage user scope

## Current Page Model

`App.tsx` currently uses these top-level pages:

- `runtime`
- `create`
- `editor`
- `queue`
- `history`
- `users`

This split is intentional. Each page corresponds to a different operational object or responsibility.

## Current Page Responsibilities

### Runtime

Focus:

- active runs
- queue runtime summary
- current task
- next task
- latest terminal task
- run control actions

This page is for live supervision.

### Create

Focus:

- choose pipeline
- choose workspace
- choose model profile
- enter `taskTitle`
- enter `taskPrompt`
- enqueue work

This page is the human-facing task intake path.

### Editor

Focus:

- load pipeline draft
- edit graph structure
- edit node provider/model/prompt/workspace
- edit edges
- validate and save

This page treats pipelines as editable programs rather than hidden prompt chains.

### Queue

Focus:

- view current queue
- insert queued tasks
- edit queued tasks
- reorder queued tasks
- pause/resume queue
- inspect terminal task history for the selected pipeline queue

This page separates intake control from graph authoring.

### History

Focus:

- inspect terminal runs
- browse global history for admin
- inspect linked task context
- inspect node outputs and timelines

This page is for retrospective understanding, not live control.

### Users

Focus:

- switch operational scope
- create users
- inspect workspace/data/log paths

This page reflects the runtime's user-scoped storage model.

## Graph Editor

The current editor uses:

- `ReteDraftEditor`

This gives the UI a graph-native editing model for pipelines. The graph editor is not just a visual flourish; it matches the underlying pipeline representation used by the runtime.

## Queue Awareness in the UI

The UI does not treat queueing as hidden background behavior.

It explicitly surfaces:

- queue status
- queued task count
- running task
- terminal task count
- next queued task
- task editing eligibility

That is important because queue state is one of the main operational boundaries in the system.

## API Mapping

The UI talks to the server through [web/src/api.ts](https://github.com/modadv/agentraloop/blob/main/web/src/api.ts).

Major UI actions map to explicit HTTP endpoints:

- create task -> `POST /tasks`
- load queues -> `GET /queues`
- load queue tasks -> `GET /queues/:queueId/tasks`
- update task -> `PATCH /tasks/:taskId`
- delete task -> `DELETE /tasks/:taskId`
- reorder queue -> `POST /queues/:queueId/reorder`
- pause/resume queue -> `POST /queues/:queueId/pause|resume`
- run control -> run control endpoints

This keeps the UI thin. The service remains the source of truth.

## Why the UI Is Split This Way

The page split follows the runtime model:

- runtime state should not be mixed with graph editing
- queue editing should not be mixed with pipeline design
- history should not be hidden behind live views
- user scoping should remain visible in a multi-user system

This is why the current UI feels closer to an operations console than to a single AI chat pane.
