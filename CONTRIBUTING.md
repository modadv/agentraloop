# Contributing to AgentraLoop

Thanks for contributing. Keep changes scoped, reproducible, and easy to review.

## Before You Start

- Use Node.js `>= 20.11`.
- Install dependencies with `npm install`.
- Read [README.md](./README.md) for runtime and documentation commands.
- Check the repository guidelines in [AGENTS.md](./AGENTS.md) if you are working inside this repo directly.

## Development Workflow

1. Create a branch for your change.
2. Install dependencies with `npm install`.
3. Make the smallest change that solves the problem.
4. Run the relevant verification commands before opening a PR.

Common commands:

- `npm run build`: compile `src/` and build the web app into `public/app`
- `npm run lint`: run the repository typecheck gate
- `npm test`: rebuild and run the Node test suite
- `npm run verify`: run lint, tests, and docs build together
- `npm run serve`: start the local HTTP server
- `npm run docs:build`: build the VitePress documentation site

## Project Layout

- `src/`: runtime, server, storage, schema validation, providers
- `web/`: React studio source
- `test/`: Node test suite
- `docs/`: VitePress documentation source
- `pipelines/`: checked-in pipeline definitions
- `examples/`: small usage examples

## Coding Expectations

- Use TypeScript and ESM conventions already present in the repo.
- In `src/`, keep relative imports ending in `.js`.
- Match the existing style: 2 spaces, double quotes, semicolons, trailing commas in multiline structures.
- Prefer focused commits and imperative commit subjects.

## Tests and Validation

Run the commands that match the scope of your change.

- All code changes: `npm run lint`
- Runtime or schema changes: `npm test`
- UI-only changes: `npm run build:web`
- Documentation-only changes: `npm run docs:build`

If verification depends on local tools such as `sqlite3`, `codex`, or provider credentials, note that clearly in the PR.

## Pull Requests

Include:

- a short description of the behavior change
- the commands you ran to verify it
- screenshots for UI changes when relevant
- linked issues or context when available

Keep generated runtime state out of PRs unless the change intentionally updates checked-in assets.

Use the GitHub issue and pull request templates where applicable. They are part of the expected review flow for public contributions.

## Runtime Artifacts

Do not commit local runtime state from these paths unless the change explicitly requires it:

- `data/`
- `users/`
- `runtime-workspaces/`
- `logs/`
- `public/app/assets/`
