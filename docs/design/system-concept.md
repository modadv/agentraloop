---
title: System Concept
---

# 📄 **Autonomous Agent-Orchestrated Bug Fixing System**

---

# 1. Overview

## 1.1 Objective

Build a **fully autonomous, continuously running AI-driven bug fixing system** that:

* Operates **24×7 without interruption**
* Uses **model-native agents (Claude Agent SDK)** as execution units
* Implements **orchestration, control, observability, and recovery**
* Requires **minimal human intervention**

---

## 1.2 Core Philosophy

> **Agents perform all execution.
> Orchestrator controls, observes, and stabilizes the system.**

---

## 1.3 Architectural Model

```text
Orchestrator (Control Plane)
        ↓
Claude Agent SDK (Execution Engine)
        ↓
Agent (Claude Code loop + MCP tools)
```

---

# 2. System Characteristics

---

## 2.1 Key Properties

| Property              | Description                         |
| --------------------- | ----------------------------------- |
| Autonomous            | No manual triggering required       |
| Continuous            | Runs in infinite loop               |
| Deterministic control | Loop + retry + rollback controlled  |
| Agent-native          | Execution delegated to Claude Agent |
| Observable            | Full logs + traces                  |
| Recoverable           | Safe rollback on failure            |

---

## 2.2 Design Paradigm

This system follows:

> **Hybrid Agent Architecture**

* **Agent (Claude Code)** → reasoning + tools + execution
* **Orchestrator (index.ts)** → scheduling + control + observability

---

# 3. System Architecture

---

## 3.1 High-Level Architecture

```text
+--------------------------------------------------+
|                ORCHESTRATOR (TS)                 |
|--------------------------------------------------|
| Scheduler | State | Router | Controller | Logger |
+--------------------+-----------------------------+
                     ↓
        +-----------------------------+
        | Claude Agent SDK            |
        |-----------------------------|
        | Claude Code Agent Loop      |
        | MCP Atlassian Tools         |
        +-----------------------------+
                     ↓
        (Agent handles all external systems internally)
```

---

## 3.2 Execution Boundary

### Orchestrator DOES:

* Select tasks
* Invoke agent
* Evaluate results
* Manage retries / rollback
* Maintain logs

---

### Agent DOES:

* Fetch Jira issue (via MCP)
* Analyze bug
* Modify code
* Run git commands
* Perform self-review
* Commit changes

---

👉 This is explicitly visible in your prompt design 

---

# 4. Core Components

---

# 4.1 Orchestrator Layer

---

## 4.1.1 Scheduler

Responsible for:

* Loading Buglist.xlsx
* Selecting next bug
* Loop scheduling

### Selection logic:

```text
assignee == "我"
status ∉ {"完成", "修复失败"}
```



---

## 4.1.2 State Model

Implicit state (derived from Excel + runtime):

```json
{
  "task_id": "ATAOI_2019-46140",
  "status": "running",
  "attempts": 1,
  "result": "pending"
}
```

---

## 4.1.3 Controller

Handles:

* Retry strategy
* Failure handling
* Loop pacing
* Graceful shutdown

Example:

```ts
maxConsecutiveErrors = 5
```



---

## 4.1.4 Router

Currently:

* Single agent (Claude)

Future-ready for:

* multi-model routing
* fallback strategies

---

# 4.2 Agent Execution Layer

---

## 4.2.1 Execution Engine

Uses:

```ts
query() from Claude Agent SDK
```



---

## 4.2.2 Agent Capabilities

The agent performs:

* Jira retrieval (via MCP)
* Code analysis
* Code modification
* Git commit
* Self-review

---

## 4.2.3 MCP Integration

Configured:

```ts
mcpServers: {
  "mcp-atlassian": {...}
}
```



---

👉 Enables:

* jira_get_issue
* jira_download_attachments
* jira_get_issue_images

---

# 4.3 Multi-Repo Git Management

---

## 4.3.1 Supported Architecture

```text
Client repo
Server repo
```



---

## 4.3.2 Safety Mechanisms

### Commit detection:

```ts
headsChanged(before, after)
```



---

### Rollback:

```ts
git reset --hard HEAD
git clean -fd
```



---

👉 Guarantees:

> **System is always left in a consistent state**

---

# 4.4 Observability System

---

## 4.4.1 Logging

Structured JSON logs:

```json
{
  "timestamp": "...",
  "event": "pipeline.success",
  "issueKey": "...",
  "commitSha": "..."
}
```

---

## 4.4.2 SDK-level Tracing

Captured:

* assistant messages
* tool usage
* result metadata



---

## 4.4.3 Metrics (implicit)

* bugsFixed
* bugsFailed
* consecutiveErrors



---

## 4.4.4 Debug Mode

```ts
debugFile: logs/claude-agent-debug.log
```

---

👉 Provides:

* full agent execution trace
* MCP interactions
* tool calls

---

# 4.5 Control & Manipulation

---

## 4.5.1 Loop Control

```ts
while (!shutdownRequested)
```



---

## 4.5.2 Graceful Shutdown

```ts
SIGINT / SIGTERM
```



---

## 4.5.3 Dynamic Behavior

* cooldown after success
* retry delay after failure
* wait when no tasks

---

## 4.5.4 Failure Guard

```ts
if (consecutiveErrors >= max)
    stop system
```

---

# 5. Execution Flow

---

## 5.1 Main Loop

```text
while (true):

    bug = findTargetBug()

    if none:
        wait(noBugRetryMs)
        continue

    result = runAgent(bug)

    if success:
        update Excel → 完成
    else:
        rollback
        update Excel → 修复失败
```

---

## 5.2 Agent Lifecycle

```text
1. Fetch Jira issue (MCP)
2. Analyze bug
3. Modify code
4. Self-review
5. Commit
6. Return structured result
```

---

# 6. Failure Handling

---

## 6.1 Failure Types

* Agent failed to fix
* No commit created
* Invalid output
* Runtime crash

---

## 6.2 Recovery Strategy

```text
rollback → mark failed → retry next loop
```

---

## 6.3 System-level Protection

* maxConsecutiveErrors
* retry backoff
* shutdown guard

---

# 7. Strengths of Current Design

---

## 7.1 Fully Agent-Native

* No external system coupling
* MCP used directly by agent

---

## 7.2 Strong Safety Guarantees

* Git rollback
* commit verification
* Excel state consistency

---

## 7.3 Production-Ready Loop

* infinite execution
* error tolerance
* graceful shutdown

---

## 7.4 High Observability

* structured logs
* SDK tracing
* debug file

---

# 8. Limitations

---

## 8.1 Single-Agent Bottleneck

* Only Claude used
* No specialization

---

## 8.2 Limited Scheduling Intelligence

* FIFO-like selection
* no prioritization

---

## 8.3 No Cross-Task Memory

* each run isolated

---

## 8.4 No Parallel Execution

* strictly sequential

---

# 9. Future Enhancements

---

## 9.1 Multi-Agent Orchestration

```text
Planner → Claude
Coder → Codex
Reviewer → Claude
```

---

## 9.2 Smart Routing

```text
if complex → Claude
if simple → Gemini
```

---

## 9.3 Distributed Execution

* multiple workers
* queue system

---

## 9.4 Advanced Observability

* dashboard
* tracing UI
* replay system

---

# 10. Final Summary

---

## 🔥 Core Insight

> **This system transforms Claude Agent SDK into a continuously running autonomous developer.**

---

## 🔥 Architecture Essence

```text
Agent = intelligence + execution
Orchestrator = control + stability + visibility
```

---

## 🔥 System Role

> Not just a script
> → A **self-healing software engineering system**
