---
title: Paper Refinement Plan
---

# AgentraLoop Paper Refinement Plan

## Goal

Produce an arXiv-ready engineering systems paper that argues for a transition from **model-centric AI applications** to **agent-centric AI software**, using AgentraLoop as a concrete implementation case.

The paper must foreground three themes:

1. **Users should increasingly work with agents, not just with models**
2. **AI providers should expose more highly integrated agent-native services**
3. **Continuous productivity comes from programming and orchestrating agents, not from endless multi-agent conversation**

## Current Status

The current draft already contains:

- Abstract
- Introduction
- Motivation and Problem Definition
- Design Principles
- System Model
- Architecture
- Execution Semantics
- Provider Lifecycle Strategy
- Web Studio and Human Control Surface
- Implementation
- Case Studies and Validation Scenarios
- Limitations and Tradeoffs
- Related Work
- Conclusion
- Appendix

The next phase is refinement rather than first-pass drafting.

## Refinement Objectives

### 1. Tighten the thesis

The paper should read as a clear architectural argument, not as a product note or implementation dump.

The thesis must remain explicit:

- the central unit of future AI applications should be the **agent runtime**
- chat is a useful interface pattern, but not a sufficient application architecture
- engineering productivity requires queues, runs, control semantics, and provider lifecycle integration

### 2. Make the provider-side argument stronger

The paper should do more than describe one system. It should also argue that:

- AI vendors should move from thin model endpoints toward richer agent-native services
- SDK-backed lifecycle management is architecturally superior to forcing application builders to reconstruct lifecycle semantics externally
- application architecture and provider architecture co-evolve

### 3. Make the engineering contribution concrete

The paper must show how the proposed philosophy is realized in software.

This means the draft should continue to map theory to the current implementation:

- pipeline graph definitions
- queue-driven task intake
- task-to-run dispatch
- user-scoped isolation
- provider abstraction
- runtime control surface

### 4. Prepare the draft for later citation and submission formatting

The current Markdown draft should be improved so that later reference insertion and final formatting are straightforward.

This includes:

- citation placeholders
- stable section naming
- consistent terminology
- clear figure/table insertion points

## Execution Plan

### Phase 1. Citation scaffolding

Add placeholder reference markers for:

- model-centric / chat-centric AI applications
- autonomous agent frameworks
- workflow/orchestration systems
- developer-agent systems
- human-in-the-loop AI systems
- official provider SDK documentation

Deliverable:

- clean citation placeholders embedded in the draft

### Phase 2. Theme strengthening

Re-read the main draft and reinforce the three central themes:

1. user-facing shift from model to agent
2. vendor-facing shift from model endpoint to integrated agent service
3. engineering feasibility through queue-driven orchestration and runtime control

Deliverable:

- stronger topic sentences
- reduced drift into product-description language

### Phase 3. Evidence mapping

Improve the mapping between architecture claims and concrete implementation evidence from the current project.

Key evidence areas:

- queue editing and dispatch
- cancel semantics
- task-to-run mapping
- multi-user isolation
- provider comparison
- web control surfaces

Deliverable:

- a draft that reads as a systems paper supported by implementation evidence

### Phase 4. Language and structure refinement

Reduce repetition across:

- Abstract
- Introduction
- Design Principles
- Conclusion

Make the prose more paper-like by:

- trimming product-like language
- tightening definitions
- shortening over-explained transitions

Deliverable:

- a cleaner second draft suitable for citation insertion and figure planning

### Phase 5. Final pre-submission preparation

Before final publication formatting:

- stabilize headings
- identify figure locations
- identify table locations
- identify appendix materials

Deliverable:

- a Markdown draft that can be formatted for publication without structural rework

## Citation Buckets To Fill Later

The following reference buckets will likely be needed:

- foundational chat-centric LLM application references
- autonomous agent and multi-agent system references
- workflow/orchestration references
- developer-agent/tooling references
- human-in-the-loop and mixed-initiative system references
- official Codex SDK and Claude Agent SDK documentation references
- possibly human-computer interaction references on supervisory control surfaces

## Project-to-Paper Mapping

The current implementation supports the paper's claims through:

- `Pipeline / Queue / Task / Run / User / Provider` object model
- serial queue semantics with terminal-state-aware dispatch
- explicit cancel/pause/resume behavior
- multi-user isolated workspace/data/log design
- provider abstraction across `claude-agent-sdk`, `codex-cli`, and `codex-sdk`
- task creation, queue editing, runtime monitoring, history inspection, and pipeline editing through the Web Studio

## Immediate Next Actions

1. Insert citation placeholders into the draft.
2. Strengthen provider-side and engineering-feasibility arguments.
3. Tighten language in the Introduction, Related Work, and Conclusion.
4. Mark figure/table opportunities.
