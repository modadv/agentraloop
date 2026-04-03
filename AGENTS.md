# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the Node/TypeScript runtime, HTTP server, storage, schema validation, and provider integrations. `web/` contains the Vite/React studio UI; production assets are emitted into `public/app/`. `test/` holds Node test files such as `server.test.js` and `schema.test.js`. `pipelines/` stores checked-in pipeline definitions, while `examples/` contains client and API usage samples. `docs/` covers architecture, design, and research notes. Runtime state lives under `data/`, `users/`, and `runtime-workspaces/`.

## Build, Test, and Development Commands
`npm run build` compiles `src/` to `dist/` and builds the web app into `public/app/`. `npm run build:web` rebuilds only the React frontend. `npm test` runs the full build and then executes the Node test suite with `node --test`. `npm run serve` starts the local server from `src/server.ts` on port `8787` by default. `npm run dev` runs the CLI pipeline entry point in `src/main.ts`.

## Coding Style & Naming Conventions
Use strict TypeScript and ESM conventions already present in the repo. In `src/`, keep relative imports ending in `.js` so compiled output stays valid. Follow the existing style: 2-space indentation, double quotes, semicolons, and trailing commas in multiline objects and arrays. Use `camelCase` for functions and variables, `PascalCase` for React components and exported types, and `kebab-case` for filenames such as `run-manager.ts` and `rete-draft-editor.tsx`.

## Testing Guidelines
Add tests under `test/` using the `*.test.js` pattern. Current tests use the built-in `node:test` module with `assert/strict` and import from `dist/`, so run `npm run build` before troubleshooting failures. Keep fixtures self-contained with temporary directories and explicit file setup.

## Commit & Pull Request Guidelines
Recent history uses short single-line subjects such as `update`; keep the same imperative style, but make new messages specific, for example `Add workspace conflict check for queued runs`. PRs should summarize behavioral changes, list the commands run (`npm test`, `npm run build`), link related issues, and include screenshots when `web/` or served UI output changes.

## Configuration & Runtime Notes
Common environment overrides include `PORT`, `PIPELINE_PATH`, `PIPELINE_CWD`, `PIPELINE_DB_PATH`, `AGENTRALOOP_USERS_ROOT`, and `AGENTRALOOP_USERS_FILE`. Avoid committing generated assets or local state changes from `public/app/assets/`, `data/`, logs, or per-user runtime workspaces unless the change is intentional.
