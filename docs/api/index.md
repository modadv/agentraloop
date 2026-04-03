---
title: API Overview
---

# API Overview

AgentraLoop exposes a JSON-over-HTTP API for health checks, user scope management, pipeline editing, queue operations, and run control.

## Base URL

When running locally with the bundled server, the default base URL is:

```text
http://127.0.0.1:8787
```

## Conventions

- All request and response bodies use JSON.
- Use `Content-Type: application/json` for `POST`, `PUT`, and `PATCH` requests with a body.
- Most scoped endpoints accept `?userId=<id>` as a query parameter.
- Run creation and retry are asynchronous and return `202 Accepted`.
- Validation failures return `422 Unprocessable Entity`.
- Workspace conflicts return `409 Conflict`.

## Main Resource Groups

- `GET /health`, `GET /workspace-context`
- `GET /users`, `POST /users`
- `GET|POST|PUT|DELETE /pipelines...`
- `GET /queues`, `GET /queues/:queueId/tasks`, `POST /tasks`
- `GET|POST /runs...`

## Next Step

Use the full reference for request bodies, status codes, and runnable examples:

- [REST API Reference](./rest-api.md)
