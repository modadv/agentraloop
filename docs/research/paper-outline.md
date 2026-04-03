---
title: Paper Outline
---

# AgentraLoop Paper Outline v1

## Working Title Candidates

1. **From Model-Centric Chat to Agent-Centric Software: A Queue-Driven Architecture for Continuous AI Work**
2. **Agent-Oriented AI Applications: Programmable Pipelines, Task Queues, and Continuous Human-Supervised Execution**
3. **Beyond Chat Interfaces: Engineering Agent-Native AI Software with Pipelines, Queues, and Runtime Control**

## Positioning

This paper should be written as an **engineering systems paper**, not as a product announcement, benchmark-only paper, or model paper.

Core stance:

- Modern AI applications should move from **model-centric conversation** to **agent-centric execution**.
- Agent systems should be **programmable, queue-driven, observable, interruptible, and multi-user capable**.
- Productivity gains come from **structured orchestration of agents**, not from allowing agents to chat indefinitely.
- AI providers should expose more complete **agent-native runtime services and SDKs**, rather than only prompt/response model endpoints.

## Target Audience

- Researchers and engineers in AI systems, software engineering, HCI, and developer tools
- Practitioners building production AI applications beyond chat UX
- Infrastructure and platform teams evaluating agent orchestration patterns

## Abstract Draft

Large language model applications are still commonly delivered as model-centric chat systems, where a user interacts directly with a single model through a conversational interface. While this interaction pattern is effective for question answering and lightweight ideation, it is poorly matched to long-running, multi-step, production-oriented work such as software development, review, queue-based task intake, and continuous multi-user service operation. In this paper, we argue that modern AI applications should be designed around **agents as executable software units**, rather than around models as conversational endpoints. We present **AgentraLoop**, an agent-oriented application architecture that combines pipeline-defined agent workflows, user-scoped task queues, serial task dispatch, runtime observability, and provider abstraction across multiple agent backends. The system is designed to support 24x7 task intake and execution while preserving human supervision, operational control, and auditable history. We describe the architectural principles behind the system, its domain model spanning pipelines, queues, tasks, runs, users, and providers, and the rationale for separating task queueing from run execution. We further discuss why queue-driven orchestration offers a more controllable and productive alternative to unconstrained multi-agent conversation, and outline the implications for future AI service providers and engineering platforms.

## Keywords

- agent-oriented software
- AI systems architecture
- agent orchestration
- queue-driven execution
- human-in-the-loop
- software engineering agents
- continuous AI work
- developer tools

## Main Thesis

The paper should make the following central claim:

> The next generation of AI applications should be built as **agent-oriented software systems** in which agents are explicit execution units orchestrated by programmable pipelines, task queues, and runtime control surfaces, rather than as model-centric chat interfaces centered on free-form conversation.

## Core Claims

### Claim 1: Model-centric chat is not a sufficient application architecture

- Single-model conversational UX is useful for Q&A and ideation.
- It is not sufficient for:
  - continuous software tasks
  - queued work intake
  - multi-user isolation
  - operational observability
  - interruptible execution
  - production auditability

### Claim 2: Agents should be first-class runtime entities

- Agents should have:
  - lifecycle
  - configuration
  - state
  - cancellation semantics
  - execution history
  - provider identity
- Agent systems need more than prompt completion APIs.

### Claim 3: Programming, not chatting, is the core productivity amplifier

- Productivity comes from:
  - decomposing work into roles
  - binding roles to explicit execution nodes
  - queueing tasks
  - validating outcomes
  - keeping humans on the control surface
- Unbounded agent-to-agent conversation is expensive and hard to govern.

### Claim 4: Continuous AI work requires queue semantics

- 24x7 operation requires:
  - task intake
  - serial or policy-constrained dispatch
  - terminal-state transitions
  - resumable supervision
  - user isolation
- Run execution and task queueing should be separate concerns.

## Recommended Paper Structure

arXiv does not require a fixed section order, but this paper should follow a standard computer systems / software architecture structure.

### 1. Introduction

Goal:

- Frame the shift from model-centric AI software to agent-centric AI software.
- Explain why software engineering is a representative use case for this transition.
- State the paper's thesis clearly.

Include:

- Why chat-first AI products are insufficient for sustained production work
- Why software development is a strong stress test for agent systems
- A concise preview of AgentraLoop

### 2. Motivation and Problem Definition

Goal:

- Define the engineering gap this architecture addresses.

Include:

- Limitations of pure conversational systems
- Limitations of uncontrolled multi-agent dialogue
- Need for queue-driven, operator-visible, interruptible execution
- Need for multi-user separation and continuous intake

### 3. Design Principles

Goal:

- State the principles that shaped the system.

Include:

- agents as executable units
- pipelines as declarative coordination graphs
- queues as serial intake boundaries
- runs as auditable execution records
- user-scoped isolation
- provider abstraction without losing provider-specific lifecycle semantics
- orchestrator simplicity over speculative complexity

### 4. System Model

Goal:

- Introduce the domain objects and their relationships.

Include:

- Pipeline
- Queue
- Task
- Run
- User
- Provider

Important design choices:

- `1 pipeline = 1 queue`
- `task -> run` mapping
- per-user isolation for workspace, data, logs, and pipelines

### 5. Architecture

Goal:

- Present the layered software architecture.

Subsections:

- Definition Layer
- Task Queue Layer
- Run Orchestration Layer
- Provider Layer
- Persistence and Observability Layer
- Server and Web Studio Layer

Explain:

- why queueing is not embedded directly inside the pipeline executor
- why providers are isolated behind a common invocation model
- why orchestration owns lifecycle semantics while providers own concrete agent execution

### 6. Execution Semantics

Goal:

- Specify how the system behaves at runtime.

Include:

- queue dispatch model
- serial execution per queue
- run lifecycle
- node lifecycle
- cancel behavior
- pause/resume behavior
- terminal-state semantics
- workspace conflict behavior

Important point:

- next task starts only after the current task's run reaches a true terminal state

### 7. Provider Lifecycle Strategy

Goal:

- Explain how the system integrates heterogeneous agent backends.

Include:

- `sdk-backed` vs `process-backed` providers
- Claude Agent SDK as `sdk-backed`
- Codex CLI as `process-backed`
- Codex SDK as experimental `sdk-backed`
- why SDK-native lifecycle management is preferred when available

Important framing:

- the platform owns orchestration semantics
- the provider owns backend-specific invocation semantics

### 8. Web Studio and Human Control Surface

Goal:

- Explain how human operators interact with the system.

Include:

- Runtime page
- Create page
- Editor page
- Queue page
- History page
- Users page

Emphasize:

- the UI is not merely a dashboard
- it is a control surface for supervision, intervention, and auditability

### 9. Implementation

Goal:

- Describe the implementation without becoming a code walkthrough.

Include:

- TypeScript/Node runtime
- persisted pipeline definitions
- user-scoped SQLite/datastore usage
- provider abstraction
- Rete-based graph editor
- queue/task/run APIs

Avoid:

- line-by-line implementation detail
- excessive UI minutiae unless they support the argument

### 10. Case Studies and Validation Scenarios

Goal:

- Show the architecture in action with concrete engineering scenarios.

Recommended cases:

- smoke pipeline with prompt chaining
- game generation and requirement modification
- multi-user parallel operation with isolated workspaces
- queued tasks with automatic next-task dispatch after cancel
- provider comparison (`codex-cli` vs `codex-sdk`)

This section should demonstrate:

- that the system works
- why the architecture matters
- why queue-driven agent orchestration is practical

### 11. Limitations and Tradeoffs

Goal:

- Be explicit about what is intentionally not solved.

Include:

- no complex auth yet
- no task attachments in phase 1
- queue is serial by design
- provider quality varies
- defaulting to deterministic orchestration may reduce apparent autonomy
- continuous AI work still needs supervision and validation

### 12. Related Work

Goal:

- Position the work relative to:
  - chat-centric AI products
  - autonomous agent frameworks
  - workflow orchestration systems
  - developer agents
  - multi-agent conversation systems

Key framing:

- this work is not primarily a new model, benchmark, or planner
- it is a systems architecture for agent-native software

### 13. Conclusion

Goal:

- Re-state the thesis cleanly.

Conclude:

- AI software should move from conversational endpoints to programmable agent systems
- task queues and runtime control are foundational, not peripheral
- provider vendors should expose more integrated agent lifecycle services
- future AI productivity will come from software architecture, not from more chat tabs

### 14. Appendix

Potential appendix items:

- API examples
- pipeline schema examples
- queue state machine details
- provider metadata examples
- UI screenshots

## Figures and Tables to Include

### Candidate Figures

1. **System architecture diagram**
   - Pipeline / Queue / Task / Run / User / Provider

2. **Execution lifecycle diagram**
   - task queued -> dispatched -> run started -> node execution -> terminal state

3. **Web Studio page model**
   - Runtime / Create / Editor / Queue / History / Users

4. **Provider lifecycle comparison**
   - sdk-backed vs process-backed

### Candidate Tables

1. **Core domain object table**
   - object
   - purpose
   - persistent scope

2. **Run and task state table**
   - state
   - meaning
   - transition trigger

3. **Provider comparison table**
   - provider
   - backing mode
   - cancel behavior
   - metadata richness

## Evaluation Direction

This paper should not depend on a benchmark-heavy evaluation section. Instead, evaluation should be framed as **engineering validation**.

Suggested evaluation dimensions:

- correctness of queue semantics
- correctness of user isolation
- observability and traceability of runs
- controllability under cancel/pause/resume
- practical viability across multiple providers

## Writing Constraints

To keep the paper coherent:

- Do not write it as a product manual.
- Do not over-focus on UI polish history.
- Do not center the contribution on one provider or one model.
- Do not claim general intelligence or autonomous software engineering as the contribution.
- Keep the contribution at the **system architecture and engineering methodology** level.

## Immediate Next Writing Steps

1. Draft the **Abstract** in final-paper style.
2. Draft the **Introduction** around the model-centric vs agent-centric shift.
3. Draft **Design Principles** and **System Model** from the current implementation.
4. Draft **Architecture** and **Execution Semantics** using the existing design document as source material.
5. Add **Case Studies** from already validated scenarios in the repository.

## Source Document Mapping

Primary internal source:

- [general-pipeline.md](../design/general-pipeline.md)

Most useful sections from that source for expansion:

- Product Philosophy
- Architectural Overview
- Core Domain Objects
- Execution Semantics
- Provider Strategy
- Web Studio Information Architecture
- Task Queue Direction and Queue Model
- Queue Phase Acceptance Summary

