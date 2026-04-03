---
title: Paper Draft
---

# AgentraLoop: From Model-Centric Chat to Agent-Centric Software

## Abstract

Most AI applications are still organized around chat with a model [ChatGPT; Claude; Google Gemini]. That works well for short interactive tasks, but it does not work well for continuous engineering work, queued task intake, or multi-user operation. In those settings, the hard problem is not generating one more response. It is accepting work, dispatching work, supervising work, and retaining operational history over time.

This paper argues that future AI applications should be built around **agents as executable software units** rather than around models as conversational endpoints. We present **AgentraLoop**, an implemented architecture in which users submit tasks into queues, queues dispatch runs, runs execute pipeline-defined agent nodes, and a web control surface exposes runtime state, interruption, editing, and history. The system separates queueing from execution, treats pipelines as explicit coordination graphs, and integrates multiple agent backends through a common provider layer.

The contribution is a systems argument, supported by an implemented system, that sustained AI productivity depends on architecture: queue-driven orchestration, explicit runtime state, human-visible control surfaces, and provider-integrated agent lifecycle management. We further argue that AI providers should increasingly offer integrated agent services that users can acquire by role and capability, much as organizations hire specialized workers, instead of forcing application builders to reconstruct agent lifecycle management on top of thin prompt interfaces.

## 1. Introduction

The dominant interaction pattern for AI software today remains the chat interface. A user opens a conversation, types a request, receives a response, and iterates through additional turns. This model-centric pattern has proven highly effective for search-like interaction, drafting, explanation, and exploratory problem solving [ChatGPT; Claude; Google Gemini]. However, it is increasingly misaligned with an emerging class of AI-enabled work: software implementation, code review, operational task intake, queued processing, and continuous multi-user service execution. In these scenarios, the core challenge is no longer the production of a single response, but the reliable execution of an evolving stream of tasks over time.

This limitation now extends beyond consumer chat products. Many developer-facing agent tools, including command-line coding agents, still preserve the same basic interaction pattern: one human, one active conversational session, one continuously steered task. That is a useful step beyond plain chat, but it remains poorly suited to unattended, long-duration, service-like operation. A system that must continue processing work when no human is actively present requires a stronger execution architecture than a single live conversation with a powerful agent.

Software engineering is a particularly useful lens through which to view this mismatch. Real development work is not a single prompt-response exchange. It involves task intake, context assembly, implementation, review, repair, cancellation, retry, and historical inspection. It may need to continue without pause for long periods, and it may need to serve multiple users whose workspaces, histories, and running tasks must remain isolated from one another. A chat interface can be placed on top of such a system, but it does not by itself provide the system properties required for this kind of work. Those properties must be supplied by a runtime architecture.

The central claim of this paper is that the primary execution unit of future AI applications should be the **agent**, not the bare model call. By agent, we mean a programmatically invocable worker with explicit configuration, lifecycle, workspace, provider identity, execution history, cancellation semantics, and observable outputs. Under this view, models remain important, but they are embedded within a larger software system that defines how tasks are accepted, how work is decomposed, how execution is controlled, and how results are audited. The key engineering task is therefore not only prompt design, but the design of an application architecture in which agents can operate as durable, manageable, and composable components. In mature systems, this also changes how users consume AI capabilities: instead of repeatedly crafting low-level model prompts, they should increasingly be able to select specialized agent services by role, capability, and operational contract, much as organizations hire specialized workers for specific responsibilities.

We develop and study this design through **AgentraLoop**, a multi-user, queue-driven agent orchestration system for software-oriented work. AgentraLoop represents work as a set of first-class objects: **pipelines**, **queues**, **tasks**, **runs**, **users**, and **providers**. Pipelines describe the execution graph. Queues define serial intake boundaries. Tasks are external work items. Runs are concrete executions derived from tasks or direct invocation. Users own isolated workspaces, data stores, logs, and pipeline scopes. Providers connect the orchestrator to concrete agent backends such as Codex CLI, Codex SDK, and the Claude Agent SDK. A web-based studio exposes separate surfaces for runtime monitoring, task creation, queue management, graph editing, historical inspection, and user administration.

The system is motivated by a simple engineering observation: productivity is not maximized by allowing multiple AI agents to talk indefinitely. Unbounded agent-to-agent conversation is expensive, hard to supervise, and poorly aligned with software operations. In contrast, structured orchestration can impose clear task boundaries, explicit node responsibilities, serial queue semantics, and operator-visible control over pause, resume, cancel, and retry. This yields a system in which AI work can proceed continuously while remaining legible and governable.

The contribution of this paper is an engineering argument, supported by an implemented system, that sustained AI work is better served by **agent-oriented software systems** than by **model-centric chat products**.

The remainder of the paper develops this argument through a concrete architecture. We begin by defining the engineering problems that motivate an agent-oriented approach. We then describe the system model, layered architecture, runtime semantics, provider strategy, and operator-facing web studio. Finally, we discuss validation scenarios, limitations, and the broader implications of agent-native design for future AI platforms.

## 2. Motivation and Problem Definition

### 2.1 The limits of model-centric AI applications

Most deployed AI products still treat the model endpoint as the center of the application. The surrounding software is often a thin shell over prompt submission and streamed output. This design is natural when the primary user need is conversational interaction. It is much less effective when the target workload is not a conversation, but a persistent operational process. Examples include queued engineering requests, autonomous-but-supervised software maintenance, batched review pipelines, and multi-user task services that must continue functioning whether or not a human is actively watching the screen.

The weakness of the model-centric pattern is that it conflates user interaction with execution architecture. In a chat product, context is often represented as a conversation transcript, control is implicit in the next user message, and operational state is weakly formalized. These choices are convenient for interactive use, but they create friction for systems that need explicit work intake, deterministic task boundaries, durable state transitions, and strong observability. Once AI work must proceed across multiple steps and across multiple users, the system needs more than a transcript. It needs an execution model.

### 2.2 Why unconstrained multi-agent conversation is not enough

A common response to the limitations of single-model chat is to introduce multiple agents that collaborate through free-form dialogue [AutoGen; ReAct]. This approach can create the appearance of autonomy, but it often fails as an engineering architecture. When agents communicate without strong structural constraints, the system becomes difficult to reason about. Costs grow unpredictably, termination becomes ambiguous, and responsibility boundaries blur. Operators may observe that work is happening, yet have no precise way to determine whether progress is real, whether a task is blocked, or whether the agents are simply extending the conversation.

This is the second major weakness in the current landscape. On one side are chat-style or session-style agent tools that still require close one-to-one human supervision. On the other side are orchestration frameworks that allow agents to talk too freely, producing large amounts of interaction whose cost, duration, and output quality are difficult to bound in advance. In both cases, the result is the same: the system is hard to run continuously and hard to trust as a production mechanism for sustained work.

For production software systems, such ambiguity is unacceptable. Tasks must begin at a known point, execute under explicit policy, and terminate in a state that can be audited. Inputs and outputs must be attributable to specific execution units. Cancellation must have a defined meaning. Historical records must be inspectable after the fact. Queue discipline matters, especially when the goal is to support 24x7 work intake without collapsing into uncontrolled background activity. These requirements suggest that open-ended agent conversation is not a sufficient systems primitive. It may occur within a node, but it should not be the top-level architecture.

### 2.3 Engineering requirements for continuous AI work

The target use case for AgentraLoop is not one-off interaction but **continuous, supervised, queue-driven task execution**. This target imposes several concrete engineering requirements.

First, the system must support **persistent task intake**. External tasks should be submitted programmatically, not only typed into an ad hoc chat window. Second, the system must support **serial queue semantics** at least as a baseline. A queue should define a clear processing boundary in which one task runs at a time and the next task begins only when the current task has truly finished. Third, the system must provide **human control** over active work: pause, resume, cancel, retry, and inspect. Fourth, the system must maintain **auditable history**, linking tasks to runs, runs to node events, and node events to provider-specific execution metadata.

Fifth, the system must support **multi-user isolation**. Users need separate workspaces, separate persistent data, separate logs, and potentially separate pipeline definitions. A shared conversational surface is not sufficient for this requirement. Sixth, the system must tolerate **heterogeneous providers**. Real deployments may use CLI-backed agents, SDK-backed agents, or a mix of both. Finally, the system must maintain a **clean separation of concerns**: task queueing should not be conflated with node execution, and provider-specific lifecycle logic should not leak into queue policy.

These requirements motivate a design in which task queueing, run orchestration, provider invocation, persistence, and operator interaction are treated as separate but coordinated layers. This is the architectural space explored in the rest of the paper.

### 2.4 Problem statement

The problem addressed by this work can therefore be stated as follows:

> How should an AI application be architected if its primary objective is not short-form conversation, but continuous, multi-step, multi-user, human-supervised task execution using programmable agents?

Solving this problem requires a shift from model-centric design to agent-centric design. The application must define first-class agents, first-class tasks, first-class queues, and first-class runs. It must also provide a human control surface that makes execution visible and interruptible without reducing the system to a chat transcript. More importantly, it must make automation programmable and repeatable: once an agent workflow is defined, the system should be able to continue processing queued work without requiring constant human presence. The remainder of the paper presents one concrete answer to this problem in the form of AgentraLoop.

## 3. Design Principles

The architectural position taken in this paper can be summarized as follows: modern AI software should be built for **agent use**, not merely for **model conversation**. This principle has implications for both sides of the ecosystem. On the application side, users should interact with AI systems by submitting tasks into agent-oriented runtimes rather than by manually steering every step through chat. On the provider side, AI vendors should expose increasingly integrated agent services, including lifecycle-aware SDKs, session or thread semantics, cancellation support, structured execution metadata, and operational hooks suitable for software systems rather than only for conversational frontends. In mature form, this means users should be able to acquire specialized agent services much as organizations hire specialized workers: by role, capability, and operational contract, not by repeatedly hand-assembling low-level model calls.

From this position, several design principles follow.

### 3.1 Agents as first-class execution units

The system treats an agent invocation as a runtime entity with explicit state, provider identity, workspace, prompt context, outputs, and lifecycle events. This is a deliberate departure from the model-centric view in which the primary operation is simply "submit prompt, receive text." A software system that intends to support sustained AI work must know which agent ran, under what pipeline node, in which workspace, for which task, and with what terminal outcome. Without this level of explicit structure, the resulting system cannot provide reliable interruption, history, auditability, or queue discipline.

### 3.2 Pipelines as declarative coordination graphs

Agent behavior should not be embedded only in ad hoc prompt chains or UI interactions. Instead, coordination should be made explicit through pipelines whose nodes represent distinct responsibilities and whose edges define the permitted flow of work. This allows decomposition of software tasks into analyzable, inspectable stages such as planning, implementation, and review. The pipeline becomes the programmable contract for how agents are composed. This is valuable not only for reuse, but also for human comprehension: operators should be able to inspect and edit the execution graph directly.

### 3.3 Queues as the intake boundary for continuous work

A central thesis of this paper is that 24x7 AI work should not be modeled as an endlessly extended chat. It should be modeled as a sequence of tasks entering a queue and being converted into runs under clear dispatch policy. In AgentraLoop, a queue defines the serial intake boundary for a pipeline. This design makes the runtime predictable: tasks are accepted, ordered, dispatched, observed, and retired. The queue is therefore the software mechanism that allows continuous intake without collapsing into uncontrolled agent chatter.

### 3.4 Human supervision through control surfaces, not conversational micromanagement

An agent-oriented system does not eliminate human involvement. Instead, it relocates human participation from low-level token-by-token steering to higher-value control points: task submission, queue editing, pipeline authoring, pause, resume, cancel, retry, result inspection, and historical audit. This principle matters because many current AI workflows remain dependent on conversational micromanagement. Such interaction can be useful during exploration, but it does not scale as the dominant operational interface for sustained engineering work. A human operator should be able to supervise the system through explicit control surfaces rather than through endless conversational intervention.

### 3.5 Provider abstraction with provider-specific lifecycle respect

The architecture should abstract over multiple agent backends without erasing their lifecycle differences. Some providers are better represented as CLI-backed process invocations, while others expose richer SDK-backed thread or session semantics. A clean design treats both as valid provider modes while preferring SDK-native lifecycle management when available. This principle matters because the paper's argument extends beyond one vendor or one model family. If the future of AI software is agent-oriented, providers themselves must move toward integrated, lifecycle-aware agent services.

### 3.6 Simplicity over speculative autonomy

The system intentionally favors explicit orchestration, serial queue semantics, and bounded control over speculative autonomy and unconstrained multi-agent dialogue. This is not because richer autonomy is never useful, but because the near-term engineering value lies in systems that are observable, governable, and operationally predictable. In practice, a simple but reliable queue-driven system is more useful to an engineering organization than an apparently autonomous system whose cost, progress, and termination are difficult to control.

Taken together, these principles define the architectural position advanced in this paper: AI application engineering should be organized around durable agent execution units, queue-based work intake, and provider interfaces that support continuous, structured, human-supervised work.

## 4. System Model

AgentraLoop is organized around six first-class domain objects: **Pipeline**, **Queue**, **Task**, **Run**, **User**, and **Provider**. Together, these objects define the boundary between declarative workflow structure, operational work intake, concrete execution, and backend integration.

### 4.1 Pipeline

A pipeline is a declarative execution graph that defines how agents are composed to accomplish a class of work. Each node specifies an agent role, provider, model, prompt template, workspace scope, and optional execution parameters. Edges define admissible flow between nodes. Pipelines are persistent and user-scoped. They are edited in the graph-oriented editor and can be reused across many tasks.

In the architectural view advanced by this paper, a pipeline is not merely a visual convenience. It is the programming artifact through which agent coordination is expressed. This is one of the central ways in which the system departs from chat-centric AI software: instead of placing all structure into conversational context, it places structure into an explicit executable graph.

### 4.2 Queue

A queue is the intake and dispatch boundary associated with a pipeline. In the current system model, the relationship is intentionally simple:

> one pipeline corresponds to one queue.

This one-to-one mapping keeps the runtime easy to reason about. Tasks submitted for a given pipeline enter its queue, where they wait in order until dispatched. The queue is serial by design: at most one task is actively running within a queue at a time. This constraint is intentional, because it provides strong operational clarity and avoids workspace and control conflicts that would arise from uncontrolled parallelism.

### 4.3 Task

A task is an externally submitted unit of work. It is not itself an execution. Instead, it is an intake object that contains the human or upstream system's intent. In phase one of the system, a task is intentionally limited to structured text input:

- `taskTitle`
- `taskPrompt`

This deliberate restriction reflects an engineering tradeoff. The goal is to validate queue-driven continuous AI work without prematurely expanding into multi-modal task ingestion. A task may be edited, reordered, or deleted while it remains queued. Once dispatched, it becomes bound to a run.

### 4.4 Run

A run is a concrete execution instance derived from either direct invocation or queued task dispatch. A run carries resolved configuration such as user scope, workspace, task input, provider/model choices, and node state transitions. It is the primary operational record of execution. Runs expose node-level outputs, event histories, current status, and terminal outcomes. In other words, if tasks are the intake units, runs are the execution units.

This distinction is crucial to the paper's thesis. Many AI systems collapse task and execution into a single conversational artifact. AgentraLoop keeps them separate because continuous operation requires separate objects for what should be done and what is currently happening.

### 4.5 User

Users are first-class operational scopes. Each user has an isolated set of resources:

- workspace
- data store
- logs
- private pipelines

This model allows the system to function as a shared, long-running service without collapsing all activity into a single global workspace. It also allows the web studio to present runtime, history, queue, and editing surfaces within a clear user scope. The current implementation intentionally uses lightweight user scoping rather than a full authentication system, because the immediate design goal is operational separation, not enterprise identity management.

### 4.6 Provider

A provider is the bridge between the orchestrator and a concrete agent backend. Providers translate generic node invocations into backend-specific execution, capture outputs, and surface provider-native metadata such as session or thread identity. This design allows the system to integrate multiple agent backends under a common orchestration model while preserving important lifecycle differences. Providers are therefore treated not as interchangeable strings, but as distinct execution strategies with their own capabilities and failure modes.

### 4.7 Object relationships

The core relationships among these objects can be summarized as follows:

- a **user** owns many pipelines, queues, tasks, and runs
- a **pipeline** defines one queue
- a **queue** contains many tasks
- a **task** may produce one run
- a **run** executes one pipeline for one user
- a **provider** executes pipeline nodes during a run

This object model is intentionally conservative. It favors explicit relationships and operational predictability over speculative generality. The result is a system model that is simple enough to operate continuously, yet expressive enough to support real multi-step agent workflows.

## 5. Architecture

The architecture of AgentraLoop is layered so that task intake, workflow definition, run execution, provider invocation, persistence, and operator interaction can evolve without collapsing into a single monolithic runtime. This separation is fundamental to the paper's argument: continuous AI work should be treated as a software-architecture problem, not as an enlarged chat loop.

### 5.1 Definition layer

The definition layer contains pipeline schemas, graph validation, graph editing contracts, and runtime prompt assembly rules. This layer determines what a valid pipeline is and how node prompts are constructed from task input, upstream node outputs, and node configuration. By isolating this layer, the system ensures that workflow structure is a first-class programming artifact rather than an emergent property of conversation history.

### 5.2 Task queue layer

The task queue layer accepts task submissions, stores queue state, exposes queue editing operations, and dispatches queued tasks into runs according to queue policy. This layer is responsible for the 24x7 intake model described in the paper. Importantly, it does not execute pipeline nodes directly. Its job is to decide when a task should be turned into a run and when the next task may begin.

This separation is essential. If queueing and execution were fused together, queue semantics would become entangled with provider behavior, node timing, and workspace details. By keeping queue dispatch separate, the architecture remains understandable and operationally robust.

### 5.3 Run orchestration layer

The run orchestration layer owns the lifecycle of runs and nodes. It resolves pipeline definitions, constructs runtime prompts, tracks active invocations, and enforces pause, resume, cancel, retry, and graceful shutdown behavior. It is the system's execution core, but it is not itself tied to any one agent vendor. This layer is what allows the paper to claim that AI work can be **programmed** rather than only **prompted**. The orchestrator turns a declarative workflow and an incoming task into a structured execution trace.

### 5.4 Provider layer

The provider layer adapts concrete agent backends to the common orchestration interface. The current implementation distinguishes two broad provider classes:

- **process-backed providers**, such as `codex-cli`
- **sdk-backed providers**, such as `claude-agent-sdk` and the experimental `codex-sdk`

This distinction is not cosmetic. It reflects an architectural commitment: when an official SDK offers lifecycle-aware agent control, the provider should use that lifecycle model directly rather than recreating it externally. At the same time, the system must remain practical enough to integrate providers that are currently best accessed through command-line execution. The provider layer is therefore the place where application-level orchestration meets vendor-specific agent semantics.

### 5.5 Persistence and observability layer

The persistence and observability layer stores pipelines, tasks, queues, runs, events, user metadata, and task-run relationships. It also provides the history needed for auditability and retrospective inspection. This layer is what makes the system suitable for long-running operation: it ensures that work is not merely executed, but recorded in a form that can be understood later.

Observability is especially important for agent-oriented systems, because AI work is otherwise prone to becoming opaque. By persisting task state, node events, outputs, provider metadata, and run transitions, the architecture ensures that operators can determine what happened, why it happened, and how the system should proceed.

### 5.6 Server and web studio layer

The server layer exposes the task, queue, run, pipeline, and user APIs. The web studio layer exposes human control surfaces over the same operational model. The UI is intentionally split into specialized pages:

- Runtime
- Create
- Editor
- Queue
- History
- Users

This page structure reflects the deeper architecture. Runtime and History focus on observation. Create focuses on task submission. Editor focuses on graph definition. Queue focuses on intake control. Users focuses on isolation and operational scoping. The UI is therefore an expression of the architecture rather than an independent concern.

### 5.7 Architectural significance

The architecture can be summarized in one sentence:

> tasks enter queues, queues dispatch runs, runs execute pipelines, pipelines invoke providers, and all of it remains visible through a human control surface.

This is the core architectural claim of the paper. It is the mechanism by which AI work becomes continuously operable rather than conversationally improvised. It is also the basis for the larger argument directed at AI service providers: if future AI applications are to be agent-native, providers must increasingly supply agent-integrated invocation services that fit into this layered architecture instead of assuming that all meaningful interaction occurs in a chat window.

## 6. Execution Semantics

The practical value of an agent-oriented architecture depends not only on its static object model, but on the precise semantics by which work is accepted, dispatched, executed, interrupted, and retired. AgentraLoop therefore defines explicit execution semantics for queues, tasks, runs, and nodes. These semantics are central to the paper's claim that agent-oriented AI systems can support continuous work without degenerating into uncontrolled conversation.

### 6.1 Task intake and dispatch

External work enters the system as a task. A task is first persisted in the queue associated with the target pipeline. At this point, the task is not yet executing; it is simply a queued work item with title, prompt, user scope, and ordering metadata. The dispatcher is responsible for turning queued tasks into runs.

The current dispatch policy is deliberately simple:

- each queue is serial
- at most one active task may execute in a queue at a time
- the next task is selected from queued tasks in queue order

This policy is not a limitation of imagination, but a deliberate engineering choice. It eliminates ambiguity around resource ownership, simplifies operator expectations, and avoids the class of failures that arise when multiple autonomous tasks attempt to mutate the same workspace concurrently. For the target use case of software-oriented work, this predictability is often more valuable than aggressive internal parallelism.

### 6.2 Task-to-run mapping

When the dispatcher selects a queued task, it creates a run that binds the task to a pipeline execution. The mapping is explicit rather than implicit: a task remains a task, and the run becomes the concrete realization of that task inside the orchestrator. The run inherits the task's user scope, workspace configuration, title, and prompt input. This mapping is important because it preserves clear accountability:

- the task answers the question: *what work was requested?*
- the run answers the question: *what execution actually occurred?*

This distinction is especially useful in continuous systems, where a queue may contain many tasks, some not yet started, some running, and others already terminated.

### 6.3 Run lifecycle

Runs progress through explicit statuses such as pending, running, paused, canceling, completed, failed, and canceled. These states are not cosmetic UI labels; they are control semantics used by the runtime and the dispatcher.

The most important properties are:

- a run is active while it is pending, running, paused, or canceling
- a run releases its queue only when it reaches a true terminal state
- terminal states are completed, failed, and canceled

These semantics are essential for serial queue execution. For example, a cancel request does not immediately free the queue, because the current run may still be unwinding provider execution. The queue is only released after the run has truly become canceled.

### 6.4 Node lifecycle

Within a run, nodes execute according to the resolved pipeline graph. Each node has its own status progression and event history. Nodes may be pending, running, succeeded, failed, or canceled. The orchestrator records node start and terminal events, along with provider metadata and outputs where applicable.

This node-level history is one of the major advantages of pipeline-driven execution over conversational execution. Instead of one unstructured transcript that mixes planning, implementation, and review, the system records which stage ran, what provider it used, how it terminated, and what output it produced. This structure is critical for debugging, review, and auditing.

### 6.5 Cancel semantics

Cancel behavior is intentionally conservative. When an operator requests cancel on the current run, the system first records the cancel request and transitions the run into a canceling state. It then propagates cancellation to the active provider invocation using the provider's own abort mechanism. However, the queue does not begin the next task at the moment of the cancel request. It waits until the run enters a true terminal canceled state.

This distinction prevents the queue from violating serial semantics. It also reflects a more general principle of agent-oriented system design: control signals should be meaningful state transitions, not mere UI intentions. A user asking for cancellation is not the same thing as the system having fully canceled the work.

### 6.6 Pause and resume semantics

Pause and resume are treated as cooperative control operations. A pause request does not necessarily interrupt a node in the middle of arbitrary provider execution. Instead, the orchestrator aims to pause execution at a safe control boundary. This produces a more legible and stable system than attempting to forcefully suspend all provider activity at arbitrary points.

The same philosophy applies to resume. Resuming a paused run returns the run to active execution under the orchestrator's control, rather than treating it as a new task. This design helps preserve execution history and state continuity while keeping the operator model understandable.

### 6.7 Workspace semantics

Workspace behavior is another important part of execution semantics. Runs operate within a user-scoped workspace path. The system enforces workspace conflict protection so that concurrent active runs do not silently contend for the same mutable workspace. This protection is particularly important in a multi-user, always-on environment. It ensures that queue dispatch and run execution remain aligned with the actual file-system mutation boundary.

This is a concrete example of the paper's broader argument: productive AI systems require software-engineering constraints, not merely richer prompts. Without workspace semantics, an apparently powerful agent system quickly becomes unsafe or unintelligible.

### 6.8 Why these semantics matter

The cumulative effect of these execution rules is that AgentraLoop behaves less like a conversation system and more like a runtime-managed software service. Tasks are ingested, ordered, dispatched, executed, paused, canceled, resumed, and archived under explicit policy. The operator can observe and influence these transitions through the control surface, but the semantics themselves remain stable and machine-readable.

This is precisely the kind of behavior required to argue that continuous AI work is feasible as a systems problem. The system does not depend on conversational continuity to remain coherent. It depends on explicit execution semantics.

## 7. Provider Lifecycle Strategy

If agents are to become first-class execution units, then the way the system integrates providers is not a minor implementation detail; it is a central architectural concern. AgentraLoop therefore adopts an explicit provider lifecycle strategy in which the orchestrator owns run and node semantics, while providers own the mechanics of backend-specific invocation. This separation is designed to preserve both system-level consistency and provider-level correctness.

### 7.1 Why provider lifecycle matters

In a model-centric application, the boundary between application logic and model invocation is often thin. In an agent-oriented system, this boundary becomes much more important. Providers differ in how they handle sessions, threads, cancellation, progress reporting, and output collection. Some are best accessed through SDKs that already define lifecycle semantics. Others are currently exposed most practically through command-line interfaces and OS-level process control.

An architecture that ignores these differences either becomes leaky or becomes brittle. If all providers are forced into the same simplistic abstraction, the system loses important control and observability. If each provider is allowed to dictate the entire runtime model, the orchestrator loses coherence. AgentraLoop addresses this tension by dividing responsibility: the platform defines **what lifecycle events mean**, while the provider defines **how to realize them** for a specific backend.

### 7.2 Common provider contract

All providers implement a common invocation-oriented contract. From the orchestrator's point of view, a node invocation supplies:

- the resolved prompt
- the workspace
- the model identifier
- optional execution limits
- an abort signal

The provider returns:

- success or failure
- output content
- raw output where relevant
- provider-native metadata
- terminal outcome information, including abort state where applicable

This contract is intentionally narrow. It avoids forcing all providers into a single conversation abstraction while still giving the orchestrator enough information to manage run and node state coherently.

### 7.3 SDK-backed and process-backed providers

The current implementation distinguishes between two provider classes.

First, **sdk-backed providers** are backends whose official or native APIs expose lifecycle-aware execution semantics directly. In the current system, the Claude Agent SDK is treated this way, and the experimental Codex SDK provider is also treated this way. These providers can surface SDK-native identifiers such as sessions or threads and can often support cancellation in a way that aligns naturally with the provider's own execution model.

Second, **process-backed providers** are backends integrated through command-line execution. The current Codex CLI provider falls into this category. In such cases, the provider lifecycle is mediated through operating-system process management rather than through a richer SDK-native session model.

The distinction is useful for both engineering clarity and long-term product direction. It allows the system to support practical integrations today while maintaining a principled preference for SDK-native lifecycle management when it exists.

### 7.4 Preference for SDK-native lifecycle management

One of the architectural positions advanced by this paper is that AI service providers should move toward more integrated agent services rather than exposing only thin prompt interfaces. This applies directly to provider implementation strategy. When an official SDK provides thread, session, abort, or execution metadata semantics, the application should prefer to use those semantics directly instead of reconstructing them externally [OpenAI Codex SDK; Anthropic Claude Agent SDK].

This preference has several benefits:

- better alignment with the provider's intended execution model
- richer identity and metadata for runs and nodes
- cleaner cancellation behavior
- lower application-side responsibility for simulating agent lifecycle

This is why the system now explicitly records provider lifecycle mode and provider-native execution identifiers where available. These are not mere diagnostics; they are steps toward an architecture in which providers are increasingly integrated into the runtime as agent-native backends rather than as opaque text emitters.

### 7.5 Current provider strategy in AgentraLoop

AgentraLoop currently supports multiple backends under this strategy:

- `claude-agent-sdk` as an SDK-backed provider
- `codex-cli` as a process-backed provider
- `codex-sdk` as an experimental SDK-backed provider

This mix is instructive. It demonstrates both the practicality and the transitional nature of current AI engineering. Not all vendors or tools yet provide the same level of integrated lifecycle support, so a production system must be able to accommodate both native SDK paths and process-based compatibility paths. At the same time, the existence of both paths makes visible a larger lesson: the closer a provider is to a true agent runtime, the more cleanly it fits the architecture advocated in this paper.

### 7.6 Lifecycle control and human supervision

Provider lifecycle strategy is also tightly coupled to human supervision. When an operator requests cancel, pause, or inspection, the orchestrator must translate this intent into provider-specific control. This translation is feasible only if the provider interface preserves enough lifecycle semantics to make cancellation and observation meaningful. A system that relies only on unstructured chat APIs is far more limited in this respect.

For this reason, the paper's argument is not only that agent-native software is desirable, but that providers themselves should support agent-native control. When vendors expose only thin prompt-response interfaces, application builders must repeatedly reconstruct cancellation, thread or session tracking, execution metadata, and operational control in the application layer. Vendors who offer stronger lifecycle-aware SDKs reduce that duplication and make systems like the one described here easier to build, safer to operate, and more predictable to extend. In that sense, the architecture has implications beyond one implementation: it also suggests a direction for the future evolution of AI platforms.

### 7.7 Strategic implication

The broader implication is straightforward. If the industry continues to treat AI access primarily as a model endpoint behind a chat or completion interface, application builders will keep re-implementing lifecycle, queueing, state tracking, cancellation, and orchestration externally. If instead providers deliver integrated agent services with stronger lifecycle semantics, then architectures like AgentraLoop become easier to build, safer to operate, and more predictable to extend.

This is one of the central theses of the paper: the future of engineering-grade AI software depends not only on better models, but on better provider-level support for programmable agent execution.

## 8. Web Studio and Human Control Surface

An agent-oriented architecture still requires a practical human interface. In AgentraLoop, that interface is not treated as a decorative dashboard layered on top of the runtime. Instead, the web studio is designed as a **human control surface** that exposes the main operational objects of the system in a way that matches their runtime semantics. This reinforces the paper's central claim: if future AI software is agent-oriented, then human interaction should shift from low-level conversational steering to high-level supervision, intervention, and audit.

### 8.1 Why a control surface is necessary

Purely programmatic systems are powerful, but production AI work also requires human operators to inspect progress, intervene in execution, author workflows, and understand failures. Traditional chat interfaces provide one kind of human interaction, but they tie visibility and control to the conversation transcript. That model is poorly suited to a system in which multiple tasks, queues, users, and runs may be active over time. A long-running agent system therefore needs a different kind of interface: one that presents runtime state, task intake, queue state, graph structure, and history as explicit navigable surfaces.

The web studio fills this role. It gives operators a way to supervise AI work without having to reconstruct system state from conversation history. In that sense, it is not merely a frontend; it is part of the system's control model.

### 8.2 Page model

The current studio is intentionally split into specialized pages:

- **Runtime**
- **Create**
- **Editor**
- **Queue**
- **History**
- **Users**

This split is not just an interface preference. It mirrors the system model itself.

The **Runtime** page is for observing and controlling active execution. It emphasizes current runs, queue state, current and next tasks, queue summaries, and control operations such as pause, resume, cancel, and retry.

The **Create** page is for task submission. It is the operator-facing input path into the queueing system. Instead of encouraging users to begin work through informal conversation, it asks them to create explicit tasks with titles, prompts, and target pipelines.

The **Editor** page is for pipeline graph editing. This page treats pipelines as editable programs composed of agent nodes and edges. It is the clearest expression of the claim that agent orchestration should be programmable.

The **Queue** page is for queue editing. It separates intake management from graph authoring, allowing users to insert, edit, remove, and reorder queued tasks without conflating these actions with pipeline design.

The **History** page is for historical inspection. It links terminated tasks and runs, surfaces terminal outcomes, and provides node- and event-level history for retrospective analysis.

The **Users** page provides operational scoping. It allows the system to expose multi-user separation as a first-class concept, consistent with the underlying storage and workspace model.

### 8.3 Human supervision model

The studio embodies a specific view of human involvement. Humans are not expected to guide every token-level decision through chat. Instead, they act at control points:

- submit work
- edit queue order
- author and revise pipelines
- pause or cancel active work
- inspect node outputs
- compare providers
- review historical traces

This supervision model is one of the main practical differentiators between an agent-oriented application and a chat-centric one. It assumes that the system should carry work forward on its own, while humans retain meaningful control over task boundaries, runtime policy, and outcome evaluation.

### 8.4 Why the UI is architecturally relevant

One might view the studio as an implementation detail, but in this paper it has architectural significance. The paper argues that agent-oriented AI software requires explicit runtime state and durable execution objects. The web studio is the place where these abstractions become legible to operators. Without a clear control surface, an agent runtime risks becoming opaque even if its internal architecture is sound. The studio therefore serves as the human-readable projection of the runtime model.

This is also why the UI is organized around queues, tasks, runs, pipelines, and users rather than around a single chat pane. The structure of the interface reinforces the structure of the system.

## 9. Implementation

AgentraLoop is implemented as a TypeScript-based system with a long-running server mode, a CLI execution mode, a provider abstraction layer, persistent user-scoped storage, and a web studio frontend. Although the implementation details are not themselves the central contribution of the paper, they are important because they demonstrate that the proposed architecture is practical with today's tooling.

### 9.1 Runtime and server

The core runtime is implemented in Node.js and TypeScript. The server is responsible for managing user scopes, exposing HTTP APIs, loading pipeline definitions, coordinating task queues, dispatching runs, and serving the web studio. The CLI mode provides a simpler surface for direct execution, but the long-running server mode is the main embodiment of the system as an always-on AI work service.

This dual-surface implementation is consistent with the paper's argument. The same underlying architecture can support direct execution and continuous service operation, because the central abstractions are runtime objects rather than UI-specific interactions.

### 9.2 Persistence model

Persistent state is user-scoped. Each user has isolated directories and persisted records for:

- workspace files
- pipeline definitions
- run history
- queue state
- task state
- logs

This design supports multi-user operation without requiring immediate introduction of a heavy authentication system. It is sufficient to demonstrate the architectural principle that users must remain operationally separated when AI work is long-running and mutable.

### 9.3 Pipeline representation and editing

Pipelines are represented as graph-structured definitions that can be persisted, validated, rendered, and edited through the studio. The system exposes both runtime-oriented pipeline semantics and editor-oriented graph drafts. This allows a single pipeline artifact to serve multiple roles:

- executable coordination graph
- persisted reusable workflow definition
- editable graph program

The editor itself uses a graph-oriented interaction model to reinforce the idea that workflow structure should be authored explicitly rather than hidden inside conversation sequences.

### 9.4 Queue and task implementation

The task queue phase of the system is intentionally conservative. Tasks are text-only in the current implementation and are bound one-to-one to a pipeline queue. Queue operations include insertion, editing, deletion, reordering, pause, and resume. Queued tasks are editable; running and terminal tasks are not. A dispatcher converts queued tasks into runs and observes run state to decide when the next task may begin.

This implementation is significant because it shows that queue-driven AI work does not require speculative autonomy or complex scheduling to be useful. Even a minimal serial queue can support meaningful continuous work if the surrounding runtime and control model are well defined.

### 9.5 Provider implementation

The provider layer currently integrates:

- `claude-agent-sdk`
- `codex-cli`
- `codex-sdk` as an experimental provider

This mix reflects present-day realities. Some providers offer SDK-native lifecycle semantics, while others are still most practically integrated through process control. The implementation explicitly classifies providers as `sdk-backed` or `process-backed`, records provider-native metadata where available, and routes cancellation through provider-specific mechanisms. This makes the provider layer a concrete realization of the paper's argument about vendor-facing agent integration.

### 9.6 Operational features

Several operational features support the system's use as a continuous service:

- graceful shutdown
- workspace conflict protection
- user-scoped logs
- queue status persistence
- run and node event histories
- task-to-run linkage

These features are not secondary conveniences. They are part of what turns the system into an AI application runtime rather than a prompt launcher.

### 9.7 Implementation significance

The importance of the implementation is not that it proves a single optimal design, but that it demonstrates feasibility through a concrete engineering artifact. AgentraLoop serves in this paper as an implementation case showing that an agent-oriented, queue-driven architecture can be built using current AI backends, current web technologies, and a relatively compact orchestration core. This matters because the paper's thesis is practical: AI productivity can be improved now by changing software architecture, not only by waiting for future model advances.

## 10. Case Studies and Validation Scenarios

The value of the architecture should be judged not only by its conceptual clarity, but by whether it supports real workflows. AgentraLoop has therefore been exercised through a series of implementation-focused validation scenarios. These scenarios are not presented as benchmark competitions, but as engineering demonstrations of architectural viability.

### 10.1 Prompt chaining smoke workflow

A minimal smoke pipeline was used to verify upstream-to-downstream prompt propagation. The first node emits a controlled token and status marker. The second node verifies that it receives the upstream output and can reason over it deterministically. This scenario demonstrates that the runtime prompt assembly model is functioning as intended and that pipeline execution can express multi-step dependencies without collapsing into a monolithic prompt.

The significance of this scenario is modest but foundational: it establishes that pipelines can transmit structured work products between nodes while preserving execution state and auditability.

### 10.2 Requirement-driven game modification workflow

A more realistic validation scenario used a simple browser game as the target artifact. A pipeline consisting of implementation and review roles was used to modify the game's requirements, including title changes, UI changes, gameplay adjustments, and control behavior. The resulting game was then inspected and validated in the browser.

This scenario is important because it demonstrates that the system is not limited to abstract prompt passing. It can coordinate actual software modification work in a user-scoped workspace, and the results can be verified as concrete artifacts. In terms of the paper's thesis, this is direct evidence that queue-driven agent orchestration can support real development tasks.

### 10.3 Multi-user isolated execution

The system was also validated under multi-user operation. Separate users were assigned separate workspaces and independent tasks, including the generation of distinct software artifacts such as a game and a weather site. The resulting runs, workspaces, logs, and histories remained isolated per user, while administrative views retained the ability to inspect active and historical work across users.

This case matters because continuous AI work is rarely single-user in practice. A system that cannot preserve clear user separation is not a serious candidate for shared operational deployment.

### 10.4 Queue editing and automatic next-task dispatch

The task queue model was validated by enqueuing multiple text tasks into a single pipeline queue, editing queued tasks, reordering them, pausing and resuming the queue, and canceling the active task. The key behavioral rule was that the next task should begin only after the currently running task had reached a true terminal state. This rule was observed in practice: canceling a running task did not immediately free the queue, but once the run entered a true canceled state, the next queued task began automatically.

This scenario demonstrates one of the central operational claims of the paper: queue semantics can make continuous AI work stable and legible, whereas chat-centric workflows generally provide no equivalent operational discipline.

### 10.5 Provider comparison

The architecture was also exercised across multiple provider backends, including process-backed and SDK-backed Codex integrations as well as the Claude Agent SDK. These comparisons showed both the promise and the current variability of provider behavior. Some providers offered stronger lifecycle semantics, cleaner abort behavior, or richer execution metadata. Others performed better in certain task-quality scenarios. The significance of these results is not that one provider universally dominates, but that the architecture can absorb heterogeneous providers while preserving common orchestration semantics.

This case study directly supports the argument that AI providers should expose richer agent-native services. The more lifecycle-aware and structured the provider interface, the more naturally it fits into an engineering-oriented agent runtime.

### 10.6 What the validation scenarios show

Taken together, these scenarios support three claims.

First, the architecture is **practically implementable**. It is not merely a conceptual critique of chat systems.

Second, the architecture is **operationally meaningful**. Queues, runs, users, providers, and control surfaces are not redundant abstractions; they support behavior that would be difficult or fragile in a pure conversation system.

Third, the architecture is **productively conservative**. It does not rely on speculative, unconstrained autonomy. Instead, it demonstrates that clear agent roles, explicit queues, and structured control already provide substantial practical value.

## 11. Limitations and Tradeoffs

The architecture presented in this paper is intentionally opinionated, and those opinions introduce both strengths and limitations. Because the paper's contribution is primarily architectural rather than benchmark-oriented, it is important to be explicit about the tradeoffs that accompany this design.

### 11.1 Serial queues constrain throughput

The current queue model is deliberately serial: one queue, one active task at a time. This simplifies control semantics, workspace ownership, and operator understanding, but it also constrains throughput. In settings where tasks are read-only, embarrassingly parallel, or isolated by design, more aggressive concurrency may eventually be desirable. However, the present system prioritizes predictable behavior over raw throughput because the target workloads involve mutable software workspaces and human-visible runtime control. The tradeoff is therefore intentional: reduced concurrency in exchange for clearer operational guarantees.

### 11.2 Multi-modal task input is intentionally absent in the current phase

The current task model is text-only. This is a conscious scope decision rather than an oversight. Support for images, audio, video, and other rich task artifacts would increase both expressive power and implementation complexity. It would require additional storage models, ingestion APIs, metadata semantics, and provider-facing prompt or attachment conventions. The paper argues that queue-driven continuous AI work can already be meaningfully validated using structured text tasks alone. Nevertheless, this means the present system does not yet address the broader challenge of multi-modal agent task orchestration.

### 11.3 Provider quality remains heterogeneous

The architecture can normalize lifecycle semantics and provider metadata, but it cannot fully normalize backend quality. Different providers may behave differently in latency, cancellation responsiveness, output quality, and long-task stability. This is not a flaw unique to AgentraLoop; it reflects the current state of AI service ecosystems. It also reinforces one of the paper's arguments: application builders need better provider-level agent services, because the quality of an agent-oriented system remains partly constrained by the quality of the provider backends it integrates.

### 11.4 Human supervision remains necessary

The paper argues for reducing dependence on constant conversational micromanagement, but it does not claim that human supervision becomes unnecessary. Tasks still need validation, pipelines still need design, queue contents still need curation, and outputs still need review. In this sense, the system is best understood as a productivity amplifier for human-supervised work rather than as a fully autonomous engineering replacement. This is a tradeoff worth stating clearly, because the paper's value lies in advocating better operational structure, not in claiming fully self-governing AI labor.

### 11.5 The web studio is a control surface, not a complete product abstraction

The current studio demonstrates the viability of page-based operational separation across runtime, task creation, queue editing, graph editing, history, and user scopes. However, it is still a pragmatic control surface, not a finalized universal interface pattern for all agent-native software. Future systems may require richer visualizations, stronger analytics, alternative modes of human supervision, or domain-specific interfaces. The studio should therefore be understood as a proof that explicit control surfaces matter, not as the final word on UI design for agent systems.

### 11.6 No strong security model yet

The current system emphasizes user-scoped operational separation, not enterprise-grade authorization. Requests are scoped by user identity, and resources are separated per user, but the paper does not claim a complete security or authentication architecture. This limitation is acceptable for the current contribution because the central problem under study is agent-oriented execution architecture. Still, for production deployment at larger scale, stronger identity, authorization, and policy controls would be necessary.

### 11.7 Conservative design may understate possible autonomy

Because the architecture emphasizes explicit orchestration, queue discipline, and bounded control, it may seem less autonomous than systems that foreground free-form multi-agent interaction. In one sense, this is a limitation: the design does not attempt to explore the full space of open-ended autonomous agent societies. In another sense, this is a deliberate methodological stance. The paper is not trying to maximize spectacle; it is trying to demonstrate a reliable path toward engineering-grade AI work. Nevertheless, the design does trade exploratory autonomy for operational clarity.

### 11.8 Summary of tradeoffs

The system trades:

- unconstrained autonomy for controllability
- speculative parallelism for queue stability
- multi-modal generality for implementation focus
- universal abstraction for provider-aware integration
- chat convenience for operational structure

These tradeoffs are not incidental. They define the architecture. The paper's thesis is that such tradeoffs are not merely acceptable, but often necessary if AI software is to move from demo-oriented interaction to continuous production use.

## 12. Related Work

The ideas in this paper intersect several active areas of research and practice: chat-centric AI applications, autonomous agent frameworks, workflow orchestration systems, developer-agent tooling, and human-in-the-loop operational interfaces. AgentraLoop is best understood as sitting at the intersection of these traditions while making a more specific architectural claim about the future of AI software.

### 12.1 Chat-centric AI applications

The dominant consumer and developer-facing pattern for AI products remains the chat interface, as illustrated by mainstream systems such as ChatGPT, Claude, and Google Gemini [ChatGPT; Claude; Google Gemini]. These systems have played a major role in making language models usable and widely adopted. However, they typically treat the conversation as the primary unit of state and the model response as the primary unit of work. This paper differs by arguing that such systems are insufficient as a general architecture for continuous production work. The contribution here is therefore not to improve chat interaction, but to move beyond chat as the dominant organizing abstraction.

### 12.2 Autonomous agent frameworks

A growing body of work and tooling explores autonomous or semi-autonomous agents that plan, invoke tools, and interact with one another. Many of these systems emphasize flexible delegation, agent collaboration, or open-ended reasoning loops. AgentraLoop shares the view that AI systems should be able to act rather than merely respond. However, it differs in its emphasis on queue semantics, operator-visible control, explicit task-to-run mapping, and conservative runtime discipline. In this sense, the system is closer to a workflow runtime for agents than to an unconstrained autonomous society of agents.

### 12.3 Workflow and orchestration systems

Traditional workflow systems, build pipelines, and job orchestrators demonstrate the value of explicit execution graphs, retries, state transitions, and historical logging [Apache Airflow]. AgentraLoop borrows heavily from this tradition, but applies it to AI-native execution. The key difference is that the execution units are not fixed binaries or deterministic tasks alone; they are agent invocations mediated by heterogeneous providers and structured prompts. The paper therefore extends workflow thinking into the domain of AI work rather than replacing workflow principles.

### 12.4 Developer-agent systems

Recent developer-agent tools and coding assistants provide strong evidence that AI can participate meaningfully in software engineering tasks such as implementation, repair, and review [SWE-agent]. AgentraLoop aligns with this direction, but shifts the emphasis from single-session assistance toward service-like orchestration. Instead of asking how one agent helps one user in one session, the paper asks how a system can accept tasks continuously, dispatch them safely, retain history, support multiple users, and keep humans in operational control.

### 12.5 Human-in-the-loop AI systems

Human-in-the-loop design has long emphasized that AI systems should keep humans informed and empowered at meaningful intervention points [Mixed-Initiative Interaction]. AgentraLoop is aligned with this tradition, but interprets it in a specific way: the goal is not to keep the human inside the token loop, but to give the human strong control over task intake, queue order, runtime state, graph structure, and historical validation. In this respect, the system contributes a concrete control-surface interpretation of human-in-the-loop design for continuous agent work.

### 12.6 Distinct contribution

What distinguishes the present work is not that it introduces agents, workflows, human oversight, or coding assistance individually. Rather, it combines them into a specific architectural thesis:

- AI work should be modeled as queued tasks rather than endless conversations
- task execution should be realized as runs over programmable agent pipelines
- providers should be integrated through lifecycle-aware abstractions
- human supervision should occur through explicit control surfaces
- multi-user continuous operation should be a first-class design goal

This positions the paper less as a narrow systems implementation report and more as an architectural argument about the next stage of AI software engineering.

## 13. Conclusion

This paper has argued that modern AI applications should move from **model-centric conversation** to **agent-centric execution**. The claim is not that conversation becomes irrelevant, nor that one specific model or agent backend solves software production on its own. Rather, the claim is that software architecture is now a primary bottleneck for sustained AI productivity. If AI systems are to support continuous engineering work, multi-user operation, explicit task intake, interruption, auditability, and long-running execution, then they must be built around first-class agents, first-class queues, first-class runs, and explicit human control surfaces.

AgentraLoop was presented as one concrete realization of this architectural position. Its object model separates pipelines, queues, tasks, runs, users, and providers. Its runtime semantics enforce serial queue discipline, terminal-state-aware dispatch, and provider-aware lifecycle control. Its web studio exposes operational control through specialized pages rather than through a monolithic chat interface. Its implementation shows that this architecture is practical today using current AI providers, current web technologies, and a relatively compact orchestration layer. Its validation scenarios show that queue-driven agent work can support real software-oriented tasks while remaining observable and governable.

The broader implication is that future AI productivity gains will not come only from better models, larger context windows, or more elaborate conversation patterns. They will also come from software systems that know how to accept work, structure work, supervise work, and retain operational history. In that sense, the important shift is conceptual as much as technical: users should increasingly work with agent runtimes rather than with isolated model chats, and providers should increasingly expose integrated agent services that can be selected by role, capability, and lifecycle contract, much as firms recruit specialized workers instead of hand-assembling every task from raw labor. The practical consequence is that more software work can move out of the real-time conversational loop and into durable, unattended, continuously running execution systems.

If this shift occurs, then the next generation of AI applications may come to resemble software operating systems more than chat boxes: task-driven, queue-managed, runtime-aware, provider-integrated, and continuously productive. That, we argue, is the architectural direction in which engineering-grade AI software should evolve.

## References

The references cited in this draft are listed below. Citation style and final formatting can be normalized later during publication preparation.

1. **OpenAI.** *ChatGPT Overview.*  
   Official product page:  
   https://openai.com/chatgpt/overview/

2. **Anthropic.** *Intro to Claude.*  
   Official documentation and platform introduction:  
   https://docs.anthropic.com/en/docs/welcome

3. **Google.** *Use Gemini Apps.*  
   Official product/help page:  
   https://support.google.com/gemini/answer/13275745?hl=en

4. **Wu, Qingyun, et al.** *AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation.* 2023.  
   Microsoft Research publication page:  
   https://www.microsoft.com/en-us/research/publication/autogen-enabling-next-gen-llm-applications-via-multi-agent-conversation-framework/  
   Hugging Face papers entry:  
   https://huggingface.co/papers/2308.08155

5. **Yao, Shunyu, et al.** *ReAct: Synergizing Reasoning and Acting in Language Models.* 2022.  
   Princeton publication page:  
   https://collaborate.princeton.edu/en/publications/react-synergizing-reasoning-and-acting-in-language-models  
   arXiv metadata:  
   https://arxiv.org/abs/2210.03629

6. **Apache Software Foundation.** *Apache Airflow Documentation.*  
   DAGs:  
   https://airflow.apache.org/docs/apache-airflow/2.10.3/core-concepts/dags.html  
   Architecture overview:  
   https://airflow.apache.org/docs/apache-airflow/2.11.0/core-concepts/overview.html

7. **Yang, John, et al.** *SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering.* 2024.  
   Hugging Face papers entry:  
   https://huggingface.co/papers/2405.15793

8. **Horvitz, Eric.** *Mixed-Initiative Interaction.* 1999.  
   Microsoft Research page:  
   https://www.microsoft.com/en-us/research/publication/mixed-initiative-interaction/

9. **OpenAI.** *Codex SDK Documentation.*  
   Official documentation:  
   https://developers.openai.com/codex/sdk

10. **Anthropic.** *Agent SDK Overview.*  
   Official documentation:  
   https://platform.claude.com/docs/en/agent-sdk/overview  
   Agent loop reference:  
   https://platform.claude.com/docs/en/agent-sdk/agent-loop

## Appendix

This appendix collects concrete technical material that supports the architectural arguments made in the main body of the paper. The appendix is intentionally implementation-oriented. Its purpose is not to redefine the paper's contribution, but to make the proposed system more reproducible and easier to analyze.

### A.1 Core object relationship summary

The architecture can be summarized through the following object relationships:

- a **user** owns isolated workspaces, data, logs, and private pipeline scope
- a **pipeline** defines an executable agent coordination graph
- a **queue** is bound to one pipeline
- a **task** enters a queue as a unit of externally requested work
- a **run** is the concrete execution produced from a task or direct invocation
- a **provider** executes the work of individual pipeline nodes

This relationship graph reflects the key architectural separation in the system:

- pipelines define **how** work is structured
- queues define **how** work enters and is ordered
- tasks define **what** work is requested
- runs define **what execution actually occurred**

### A.2 Queue state summary

At the queue level, the system uses a deliberately simple operational model:

- one queue is associated with one pipeline
- one queue executes at most one active task at a time
- queued tasks may be:
  - inserted
  - edited
  - removed
  - reordered
- running tasks are not directly editable
- terminal tasks move into history-oriented views

The queue itself may be:

- active
- paused

When paused, no new queued task is dispatched. When resumed, dispatch restarts under the normal serial policy.

### A.3 Task lifecycle summary

The current task lifecycle is intentionally minimal:

- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

The important state transition rule is:

> a task remains the current queue occupant until its associated run reaches a true terminal state.

This means that:

- `cancel requested` does not immediately free the queue
- `canceling` does not immediately free the queue
- only true terminal states free the queue for the next task

### A.4 Run lifecycle summary

The run lifecycle in the present implementation includes the following major states:

- `pending`
- `running`
- `paused`
- `canceling`
- `completed`
- `failed`
- `canceled`

The orchestrator treats the following as active states:

- `pending`
- `running`
- `paused`
- `canceling`

This active-state concept is used for:

- queue dispatch blocking
- workspace conflict protection
- runtime monitoring
- operator controls

### A.5 Node event model

Node-level history is captured as explicit events rather than as an undifferentiated transcript. Representative node events include:

- `node_started`
- `node_succeeded`
- `node_failed`
- `node_canceled`

These events may carry provider metadata such as:

- lifecycle mode
- provider-native session or thread identity
- execution duration
- usage metrics where available

This event model is one of the mechanisms by which the system keeps agent execution observable and auditable.

### A.6 Provider classification

The system currently recognizes two major provider categories:

#### SDK-backed providers

These providers rely on official or native SDKs that expose lifecycle-aware execution semantics. In the current implementation, examples include:

- `claude-agent-sdk`
- `codex-sdk` (experimental)

#### Process-backed providers

These providers are managed through OS-level process invocation and control. In the current implementation, the primary example is:

- `codex-cli`

The paper argues that future AI platform evolution should increasingly favor SDK-backed integrations where lifecycle semantics are richer and more naturally aligned with runtime control.

### A.7 Representative HTTP API surface

The current system exposes an HTTP API sufficient to support the main operational surfaces of the architecture.

Representative endpoints include:

- `POST /tasks`
  - submit a new task into a queue
- `GET /queues`
  - list queues for a user
- `GET /queues/:queueId/tasks`
  - inspect queue contents
- `PATCH /tasks/:taskId`
  - edit a queued task
- `DELETE /tasks/:taskId`
  - remove a queued task
- `POST /queues/:queueId/reorder`
  - reorder queued tasks
- `POST /queues/:queueId/pause`
  - pause dispatch
- `POST /queues/:queueId/resume`
  - resume dispatch
- `POST /runs`
  - direct run creation
- `GET /runs`
  - run inspection
- `GET /runs/all`
  - global run view for administrative scope

This API structure reinforces the system's central architectural distinction:

- tasks and queues govern intake
- runs govern concrete execution

### A.8 Example task submission

An example text-only task submission can be represented as:

```json
{
  "userId": "admin",
  "pipelineId": "general-ai-dev-review-commit",
  "title": "Build Pixel Tap",
  "prompt": "Build a tiny browser game called Pixel Tap using only plain HTML, CSS, and JavaScript."
}
```

This example is intentionally simple. It illustrates the paper's current scope boundary: phase one validates queue-driven text task execution without requiring multi-modal ingestion.

### A.9 Example architectural control path

The main execution path of the system can be summarized as:

1. A user or upstream system submits a task.
2. The task is persisted in the queue bound to the target pipeline.
3. If the queue is active and idle, the dispatcher selects the task.
4. The dispatcher creates a run from the task.
5. The run executes the pipeline node graph through the provider layer.
6. Node events, outputs, and provider metadata are persisted.
7. The run reaches a terminal state.
8. The task is updated to the corresponding terminal state.
9. The dispatcher selects the next queued task, if one exists.

This path is the practical embodiment of the paper's main argument that AI work should proceed through software runtime semantics rather than through conversational continuity.

### A.10 Representative validation scenarios

The current implementation has already been exercised through several scenario classes:

- prompt propagation smoke workflows
- requirement-driven software modification workflows
- queue editing and dispatch workflows
- multi-user isolated operation
- provider comparison across CLI-backed and SDK-backed agent integrations

These scenarios are not intended to prove universal optimality. Their purpose is to demonstrate feasibility and to support the paper's systems argument.

### A.11 Future appendix expansion

If the paper is later prepared for formal submission, the appendix should be expanded with:

- an architecture figure
- a task and run state transition diagram
- queue dispatch pseudocode
- provider metadata examples
- selected screenshots from the web studio
- optional code snippets for task submission and pipeline definition

These additions would strengthen reproducibility and readability without changing the paper's core claims.

### A.12 Figure and table insertion plan

The following figures and tables are recommended for the arXiv-formatted version of the paper.

#### Figures

1. **Overall architecture diagram**
   - suggested placement: after Section 5
   - should show:
     - User
     - Queue
     - Task
     - Run
     - Pipeline
     - Provider
     - Web Studio

2. **Execution lifecycle diagram**
   - suggested placement: in Section 6
   - should show:
     - queued task
     - dispatch
     - run start
     - node execution
     - terminal state
     - next-task dispatch

3. **Provider lifecycle comparison diagram**
   - suggested placement: in Section 7
   - should show:
     - sdk-backed provider path
     - process-backed provider path
     - orchestrator lifecycle boundary

4. **Web Studio information architecture diagram**
   - suggested placement: in Section 8
   - should show:
     - Runtime
     - Create
     - Editor
     - Queue
     - History
     - Users

#### Tables

1. **Core domain object table**
   - suggested placement: near Section 4
   - columns:
     - object
     - role
     - persistence scope
     - primary operator

2. **Run and task state table**
   - suggested placement: in Section 6
   - columns:
     - state
     - meaning
     - terminal or active
     - dispatch implication

3. **Provider comparison table**
   - suggested placement: in Section 7
   - columns:
     - provider
     - lifecycle mode
     - cancellation mode
     - metadata richness
     - current maturity

4. **Validation scenario table**
   - suggested placement: in Section 10
   - columns:
     - scenario
     - claim validated
     - artifact or evidence

### A.13 Figure content for publication layout

The following text blocks provide figure-ready content for later formal layout. Each figure includes a recommended placement, a publication-style caption, and a bounded list of required visual elements so that the figure can be produced without redesigning its meaning during layout work.

#### Figure 1. Overall architecture diagram

Recommended placement:

- after Section 5

Recommended caption:

> **Overall architecture of AgentraLoop.** Users submit tasks into queues bound to pipelines. The dispatcher converts queued tasks into runs. Runs execute pipeline nodes through the provider layer. Persistence and observability record tasks, runs, events, and user-scoped history. The web studio exposes runtime, queue, history, editing, and user control surfaces.

Required visual elements:

- User
- Web Studio
- Create page
- Queue page
- Runtime page
- History page
- Editor page
- Task Queue Layer
- Run Orchestration Layer
- Provider Layer
- Persistence and Observability Layer
- Workspace / Filesystem

Required directed relationships:

- User -> Create page -> Task Queue Layer
- Task Queue Layer -> Run Orchestration Layer
- Run Orchestration Layer -> Provider Layer
- Provider Layer -> Workspace / Filesystem
- Run Orchestration Layer -> Persistence and Observability Layer
- Web Studio pages <-> Persistence and Observability Layer

#### Figure 2. Execution lifecycle diagram

Recommended placement:

- in Section 6

Recommended caption:

> **Queue-driven execution lifecycle.** A queued task is dispatched into a run, the run executes pipeline nodes, and the queue is released only when the run reaches a true terminal state. Cancel requests do not immediately free the queue; terminal cancellation does.

Required stages:

1. task submitted
2. task queued
3. queue idle check
4. dispatch
5. run created
6. node execution
7. terminal state:
   - completed
   - failed
   - canceled
8. next task dispatch

Required emphasis:

- distinguish `cancel requested` from terminal `canceled`
- show that the next task is dispatched only after true terminal release

#### Figure 3. Provider lifecycle comparison

Recommended placement:

- in Section 7

Recommended caption:

> **Provider lifecycle modes.** SDK-backed providers expose native lifecycle constructs such as sessions or threads, while process-backed providers rely on OS-level process control. The orchestrator preserves common run and node semantics across both classes.

Required comparison structure:

- Left column: SDK-backed
  - provider SDK
  - session/thread identity
  - provider-native abort
  - richer metadata
- Right column: Process-backed
  - spawned process
  - PID/process exit
  - process kill/timeout
  - limited native identity

Required annotation:

- show orchestrator lifecycle semantics above both columns
- show provider-specific control mechanics inside each column

#### Figure 4. Web Studio information architecture

Recommended placement:

- in Section 8

Recommended caption:

> **Web Studio as a human control surface.** Runtime, Create, Editor, Queue, History, and Users pages expose the system's major operational objects directly, replacing transcript-centered interaction with task-, queue-, run-, and user-centered supervision.

Required grouping:

- Intake:
  - Create
  - Queue
- Execution:
  - Runtime
- Definition:
  - Editor
- Audit:
  - History
- Scope:
  - Users

### A.14 Table content for publication layout

The following text blocks provide table-ready content for later publication layout. Each table includes a recommended placement, a publication-style caption, and a stable content schema so that formatting can proceed without redesigning the table.

#### Table 1. Core domain objects

Recommended placement:

- near Section 4

Recommended caption:

> **Core domain objects in AgentraLoop.**

Required columns:

| Object | Role | Scope | Notes |
| --- | --- | --- | --- |
| User | Operational isolation boundary | Per user | Owns workspace, data, logs, private pipelines |
| Pipeline | Declarative coordination graph | Per user | Defines agent roles and edges |
| Queue | Serial intake boundary | Per pipeline | Holds queued tasks and dispatch state |
| Task | External requested work item | Per queue | Text-only in phase one |
| Run | Concrete execution record | Per task or direct invocation | Tracks node state and outputs |
| Provider | Backend execution adapter | Global/provider-specific | CLI-backed or SDK-backed |

#### Table 2. Run and task states

Recommended placement:

- in Section 6

Recommended caption:

> **Representative task and run state semantics.**

Required columns:

| Object | State | Meaning | Terminal | Dispatch implication |
| --- | --- | --- | --- | --- |
| Task | queued | waiting in queue | no | candidate for dispatch |
| Task | running | bound to active run | no | blocks next task |
| Task | completed | terminal success | yes | queue may continue |
| Task | failed | terminal failure | yes | queue may continue |
| Task | canceled | terminal cancellation | yes | queue may continue |
| Run | pending | created, not yet active | no | still blocks queue as active |
| Run | running | active execution | no | blocks queue |
| Run | paused | cooperatively paused | no | blocks queue |
| Run | canceling | cancel requested, not terminal | no | still blocks queue |
| Run | completed | terminal success | yes | queue released |
| Run | failed | terminal failure | yes | queue released |
| Run | canceled | terminal cancel | yes | queue released |

#### Table 3. Provider comparison

Recommended placement:

- in Section 7

Recommended caption:

> **Current provider classes in AgentraLoop.**

Required columns:

| Provider | Lifecycle Mode | Typical Control Mechanism | Metadata Richness | Current Role |
| --- | --- | --- | --- | --- |
| claude-agent-sdk | sdk-backed | SDK-native control | high | primary Claude integration |
| codex-cli | process-backed | process spawn/kill | moderate | stable Codex default |
| codex-sdk | sdk-backed | SDK-native thread/session control | high | experimental Codex path |

#### Table 4. Validation scenarios

Recommended placement:

- in Section 10

Recommended caption:

> **Validation scenarios used to support the system argument.**

Required columns:

| Scenario | Claim Validated | Evidence Type |
| --- | --- | --- |
| prompt chaining smoke | pipeline dependency propagation works | node outputs and run success |
| game modification workflow | agent pipelines can perform concrete software work | generated artifacts and browser verification |
| multi-user isolated execution | user-scoped isolation works | separate workspaces, logs, and runs |
| queue cancel and next dispatch | terminal-state-aware queue semantics hold | task and run history |
| provider comparison | provider abstraction preserves common orchestration semantics | run metadata and outcome comparison |

### A.15 Figure and table migration notes

Recommended migration order:

1. convert Table 1 and Table 2 first, because they stabilize terminology used throughout the paper
2. convert Figure 1 and Figure 2 next, because they anchor the main architecture and execution semantics
3. convert Table 3 and Figure 3 together, because they share provider-lifecycle terminology
4. convert Figure 4 and Table 4 last, because they depend least on low-level wording changes

Recommended formatting conventions:

- keep captions short inside figure/table environments
- move longer interpretive notes into body text or appendix prose
- use stable semantic labels, for example:
  - `fig:overall-architecture`
  - `fig:execution-lifecycle`
  - `fig:provider-lifecycle`
  - `fig:web-studio`
  - `tab:core-objects`
  - `tab:run-task-states`
  - `tab:provider-comparison`
  - `tab:validation-scenarios`
