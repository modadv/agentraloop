---
title: Getting Started
---

# Getting Started

## Prerequisites

- Node.js `>= 20.11`
- `npm`
- `sqlite3` on `PATH` if you want the full queue-backed test suite to pass
- Optional: TeX Live or MiKTeX for rebuilding the paper PDF

## Install and Build

```bash
npm install
npm run build
```

`npm run build` compiles the TypeScript runtime into `dist/` and builds the React Web Studio into `public/app/`.

## Run Locally

Start the server:

```bash
npm run serve
```

Run the default pipeline once:

```bash
npm run dev
```

After npm publication, the packaged CLI can be run with:

```bash
npx agentraloop serve
```

## Useful Commands

- `npm test`: rebuild and run the Node test suite
- `npm run build:web`: rebuild only the Web Studio assets
- `npm run docs:dev`: run the documentation site locally
- `npm run docs:generate`: build the documentation site once

## API Reference

- REST API overview: [API Overview](./api/index.md)
- Full endpoint reference with Node.js and Python examples: [REST API](./api/rest-api.md)

## Key Runtime Paths

- `pipelines/default.pipeline.json`: bundled default pipeline
- `data/`: runtime database and lock files
- `users/`: user-scoped runtime state
- `runtime-workspaces/`: default local workspaces
- `logs/`: runtime logs and diagnostics

## Important Environment Variables

- `PORT`
- `PIPELINE_PATH`
- `PIPELINE_CWD`
- `PIPELINE_DB_PATH`
- `AGENTRALOOP_USERS_ROOT`
- `AGENTRALOOP_USERS_FILE`
