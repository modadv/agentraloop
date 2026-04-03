---
title: Providers
---

# Providers

This document describes how AgentraLoop integrates concrete agent backends.

Primary source files:

- [src/providers/base.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/base.ts)
- [src/providers/index.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/index.ts)
- [src/providers/claude.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/claude.ts)
- [src/providers/codex.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/codex.ts)
- [src/providers/codex-sdk.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/codex-sdk.ts)
- [src/runtime.ts](https://github.com/modadv/agentraloop/blob/main/src/runtime.ts)

## Provider Contract

From the runtime's point of view, a provider receives:

- resolved prompt
- workspace path
- model identifier
- optional execution limits
- abort signal

It returns:

- success or failure
- output content
- raw output where relevant
- provider-native metadata
- terminal outcome details

This common contract keeps orchestration code stable while preserving provider-specific behavior.

## Lifecycle Modes

AgentraLoop explicitly distinguishes two lifecycle modes:

- `sdk-backed`
- `process-backed`

This is not just labeling. It affects:

- cancellation behavior
- identity tracking
- output handling
- operational metadata quality

## Current Providers

| Provider | Lifecycle mode | Native identity | Cancel path | Current role |
| --- | --- | --- | --- | --- |
| `claude-agent-sdk` | `sdk-backed` | session id | SDK abort | stable SDK integration |
| `codex-cli` | `process-backed` | process metadata | process termination | stable default Codex path |
| `codex-sdk` | `sdk-backed` | thread id | SDK abort | experimental Codex SDK path |

## Provider Registry

The registry lives in [src/providers/index.ts](https://github.com/modadv/agentraloop/blob/main/src/providers/index.ts).

It does two things:

- returns a concrete provider client for a requested provider ID
- checks provider availability for `/health` and the UI

This keeps provider wiring centralized.

## Claude Agent SDK

The Claude integration uses the official SDK path.

Current behavior:

- classified as `sdk-backed`
- records `providerSessionId`
- uses `persistSession: false` by default
- supports abort through the SDK path

This matches the runtime's preference for using provider-native lifecycle semantics where available.

## Codex CLI

The CLI integration is still process-based.

Current behavior:

- classified as `process-backed`
- uses spawned CLI execution
- collects stdout/stderr and final message output
- supports cancellation through process termination

This path remains the stable default because it is mature in the current codebase.

## Codex SDK

The SDK integration exists as a parallel provider, not a replacement.

Current behavior:

- classified as `sdk-backed`
- records `providerThreadId`
- supports SDK abort
- used for comparison and validation, not as the default path

This allows the project to compare CLI-backed and SDK-backed Codex execution under the same orchestration model.

## Why Provider Lifecycle Matters

AgentraLoop's broader provider-facing position is:

> future AI providers should expose integrated, lifecycle-aware agent services instead of only thin prompt endpoints

Without that, application builders must repeatedly rebuild:

- cancellation
- thread/session tracking
- execution metadata
- lifecycle control

The provider layer is where that difference becomes concrete.
