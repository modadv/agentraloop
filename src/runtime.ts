import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { logError, logInfo } from "./logger.js";
import { validatePipelineDefinition } from "./schema.js";
import { getProviderClient } from "./providers/index.js";
import {
  type AgentProvider,
  type AgentNodeDefinition,
  type NodeRunRecord,
  type PipelineDefinition,
  type PipelineRunConfig,
  type PipelineRunRecord,
  type RunEventRecord,
  type RunControlState,
} from "./types.js";

function buildNodeMap(definition: PipelineDefinition): Map<string, AgentNodeDefinition> {
  return new Map(definition.nodes.map((node) => [node.id, node]));
}

function buildSuccessorMap(definition: PipelineDefinition): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of definition.nodes) {
    map.set(node.id, []);
  }
  for (const edge of definition.edges) {
    map.get(edge.from)?.push(edge.to);
  }
  return map;
}

function buildPredecessorMap(definition: PipelineDefinition): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const node of definition.nodes) {
    map.set(node.id, []);
  }
  for (const edge of definition.edges) {
    map.get(edge.to)?.push(edge.from);
  }
  return map;
}

function assemblePrompt(
  basePrompt: string,
  upstreamNodeRuns: NodeRunRecord[],
): string {
  const MAX_UPSTREAM_SECTION_CHARS = 3000;
  const trimmedPrompt = basePrompt.trim();

  if (upstreamNodeRuns.length === 0) return trimmedPrompt;

  const upstreamSections = upstreamNodeRuns.map((nodeRun) => {
    const rawBody =
      nodeRun.outputMarkdown?.trim() ||
      (nodeRun.status === "skipped" ? "[Node skipped]" : "[No output captured]");
    const body =
      rawBody.length > MAX_UPSTREAM_SECTION_CHARS
        ? `${rawBody.slice(0, MAX_UPSTREAM_SECTION_CHARS).trimEnd()}\n\n[Truncated after ${MAX_UPSTREAM_SECTION_CHARS} characters]`
        : rawBody;
    return [
      `### From: ${nodeRun.nodeName} (${nodeRun.nodeId})`,
      "",
      `Status: ${nodeRun.status}`,
      "",
      body,
    ].join("\n");
  });

  return [trimmedPrompt, "", "## Upstream Node Outputs", "", ...upstreamSections].join("\n\n");
}

function renderPromptTemplate(
  prompt: string,
  definition: PipelineDefinition,
  config: PipelineRunConfig,
): string {
  const replacements: Record<string, string> = {
    "{{run.taskTitle}}": config.taskTitle ?? "",
    "{{run.input.taskTitle}}": config.taskTitle ?? "",
    "{{run.taskPrompt}}": config.taskPrompt ?? "",
    "{{run.input.taskPrompt}}": config.taskPrompt ?? "",
    "{{run.repoUrl}}": config.repoUrl ?? "",
    "{{run.input.repoUrl}}": config.repoUrl ?? "",
    "{{run.branch}}": config.branch ?? "",
    "{{run.input.branch}}": config.branch ?? "",
    "{{run.pipelineId}}": definition.id,
    "{{run.pipelineName}}": definition.name,
    "{{run.pipelinePath}}": config.pipelinePath,
    "{{run.pipelineCwd}}": config.pipelineCwd,
    "{{run.modelProfile}}": config.modelProfile,
  };

  return Object.entries(replacements).reduce(
    (current, [token, value]) => current.split(token).join(value),
    prompt,
  );
}

function resolveNodeCwd(nodeCwd: string | undefined, pipelineCwd: string): string {
  if (!nodeCwd) return pipelineCwd;
  return path.isAbsolute(nodeCwd) ? nodeCwd : path.resolve(pipelineCwd, nodeCwd);
}

function resolveNodeModel(node: AgentNodeDefinition, config: PipelineRunConfig): string {
  return node.modelProfiles?.[config.modelProfile] ?? node.model;
}

function buildReachableNodeIds(
  entryNodeId: string,
  successorMap: Map<string, string[]>,
): Set<string> {
  const reachable = new Set<string>();
  const queue = [entryNodeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    for (const next of successorMap.get(current) ?? []) {
      if (!reachable.has(next)) {
        queue.push(next);
      }
    }
  }

  return reachable;
}

function createReadyQueue(
  definition: PipelineDefinition,
  reachableNodeIds: Set<string>,
  predecessorMap: Map<string, string[]>,
): string[] {
  return definition.nodes
    .filter((node) => reachableNodeIds.has(node.id))
    .filter((node) => (predecessorMap.get(node.id) ?? []).length === 0)
    .map((node) => node.id);
}

export type RuntimeControl = {
  getControlState(): RunControlState;
  waitIfPaused(): Promise<void>;
  shouldCancel(): boolean;
  createAbortController?(context: {
    runId: string;
    nodeId: string;
    nodeName: string;
    provider: AgentProvider;
    model: string;
  }): AbortController | undefined;
  clearAbortController?(nodeId: string): void;
};

export type RuntimeEventSink = {
  append(event: RunEventRecord): void;
};

type RunPipelineOptions = {
  definition: PipelineDefinition;
  config: PipelineRunConfig;
  control?: RuntimeControl;
  existingRunId?: string;
  eventSink?: RuntimeEventSink;
  onUpdate?: (runRecord: PipelineRunRecord) => void;
  providerResolver?: typeof getProviderClient;
};

function createRunRecord(
  definition: PipelineDefinition,
  config: PipelineRunConfig,
  existingRunId?: string,
): PipelineRunRecord {
  return {
    runId: existingRunId ?? randomUUID(),
    pipelineId: definition.id,
    pipelineName: definition.name,
    status: "pending",
    startedAt: new Date().toISOString(),
    controlState: "running",
    config,
    nodeRuns: [],
  };
}

export async function runPipeline(options: RunPipelineOptions): Promise<PipelineRunRecord> {
  const {
    definition,
    config,
    control,
    existingRunId,
    eventSink,
    onUpdate,
    providerResolver = getProviderClient,
  } = options;
  validatePipelineDefinition(definition);

  const nodeMap = buildNodeMap(definition);
  const successorMap = buildSuccessorMap(definition);
  const predecessorMap = buildPredecessorMap(definition);
  const reachableNodeIds = buildReachableNodeIds(definition.entryNodeId, successorMap);
  const runRecord = createRunRecord(definition, config, existingRunId);
  const runId = runRecord.runId;
  runRecord.status = "running";
  const reportUpdate = () => onUpdate?.(runRecord);

  logInfo("pipeline.run.start", {
    runId,
    pipelineId: definition.id,
    pipelineName: definition.name,
    pipelinePath: config.pipelinePath,
    pipelineCwd: config.pipelineCwd,
  });
  eventSink?.append({
    runId,
    timestamp: new Date().toISOString(),
    type: "run_started",
    payload: {
      pipelineId: definition.id,
      pipelineName: definition.name,
      pipelinePath: config.pipelinePath,
      pipelineCwd: config.pipelineCwd,
      modelProfile: config.modelProfile,
      hasTaskTitle: Boolean(config.taskTitle),
      hasTaskPrompt: Boolean(config.taskPrompt),
      repoUrl: config.repoUrl,
      branch: config.branch,
    },
  });
  reportUpdate();

  const completedNodeIds = new Set<string>();
  const remainingPredecessors = new Map<string, number>();
  for (const nodeId of reachableNodeIds) {
    remainingPredecessors.set(
      nodeId,
      (predecessorMap.get(nodeId) ?? []).filter((pred) => reachableNodeIds.has(pred)).length,
    );
  }
  const readyQueue = createReadyQueue(definition, reachableNodeIds, predecessorMap);
  const nodeRunMap = new Map<string, NodeRunRecord>();

  while (readyQueue.length > 0) {
    if (control?.shouldCancel()) {
      runRecord.status = "canceled";
      runRecord.controlState = undefined;
      runRecord.endedAt = new Date().toISOString();
      logInfo("pipeline.run.canceled", { runId, pipelineId: definition.id });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "run_canceled",
        payload: { pipelineId: definition.id },
      });
      reportUpdate();
      return runRecord;
    }

    if (control?.getControlState() === "pause_requested") {
      runRecord.status = "paused";
      runRecord.controlState = "paused";
      logInfo("pipeline.run.paused", { runId, pipelineId: definition.id });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "run_paused",
        payload: { pipelineId: definition.id },
      });
      reportUpdate();
      await control.waitIfPaused();
      if (control.shouldCancel()) {
        runRecord.status = "canceled";
        runRecord.controlState = undefined;
        runRecord.endedAt = new Date().toISOString();
        logInfo("pipeline.run.canceled", { runId, pipelineId: definition.id });
        eventSink?.append({
          runId,
          timestamp: new Date().toISOString(),
          type: "run_canceled",
          payload: { pipelineId: definition.id },
        });
        reportUpdate();
        return runRecord;
      }
      runRecord.status = "running";
      runRecord.controlState = "running";
      logInfo("pipeline.run.resumed", { runId, pipelineId: definition.id });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "run_resumed",
        payload: { pipelineId: definition.id },
      });
      reportUpdate();
    }

    const currentNodeId = readyQueue.shift();
    if (!currentNodeId || completedNodeIds.has(currentNodeId)) {
      continue;
    }

    const node = nodeMap.get(currentNodeId);
    if (!node) {
      throw new Error(`Node not found during runtime: ${currentNodeId}`);
    }

    if (node.enabled === false) {
      const skippedNodeRun: NodeRunRecord = {
        nodeId: node.id,
        nodeName: node.name,
        provider: node.provider,
        model: node.model,
        status: "skipped",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        prompt: node.prompt,
        metadata: {
          reason: "node_disabled",
        },
      };
      runRecord.nodeRuns.push(skippedNodeRun);
      nodeRunMap.set(node.id, skippedNodeRun);
      completedNodeIds.add(node.id);

      logInfo("pipeline.node.skipped", {
        runId,
        nodeId: node.id,
        nodeName: node.name,
        reason: "node_disabled",
      });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "node_skipped",
        nodeId: node.id,
        nodeName: node.name,
        payload: {
          provider: node.provider,
          model: resolveNodeModel(node, config),
          reason: "node_disabled",
        },
      });
      reportUpdate();

      for (const successorId of successorMap.get(node.id) ?? []) {
        const nextRemaining = (remainingPredecessors.get(successorId) ?? 0) - 1;
        remainingPredecessors.set(successorId, nextRemaining);
        if (nextRemaining === 0) {
          readyQueue.push(successorId);
        }
      }
      continue;
    }

    const upstreamNodeRuns = (predecessorMap.get(node.id) ?? [])
      .map((predecessorId) => nodeRunMap.get(predecessorId))
      .filter((value): value is NodeRunRecord => Boolean(value));
    const prompt = assemblePrompt(
      renderPromptTemplate(node.prompt, definition, config),
      upstreamNodeRuns,
    );
    const provider = providerResolver(node.provider);
    const resolvedCwd = resolveNodeCwd(node.cwd, config.pipelineCwd);
    const resolvedModel = resolveNodeModel(node, config);
    const nodeRun: NodeRunRecord = {
      nodeId: node.id,
      nodeName: node.name,
      provider: node.provider,
      model: resolvedModel,
      status: "running",
      startedAt: new Date().toISOString(),
      prompt,
    };
    runRecord.nodeRuns.push(nodeRun);

    logInfo("pipeline.node.start", {
      runId,
      nodeId: node.id,
      nodeName: node.name,
      provider: node.provider,
      model: resolveNodeModel(node, config),
    });
    eventSink?.append({
      runId,
      timestamp: new Date().toISOString(),
      type: "node_started",
      nodeId: node.id,
      nodeName: node.name,
      payload: {
        provider: node.provider,
        model: resolvedModel,
        lifecycleMode: provider.lifecycleMode,
        upstreamNodeIds: upstreamNodeRuns.map((item) => item.nodeId),
      },
    });
    reportUpdate();
    const abortController = control?.createAbortController?.({
      runId,
      nodeId: node.id,
      nodeName: node.name,
      provider: node.provider,
      model: resolvedModel,
    });
    const result = await provider.invoke({
      nodeId: node.id,
      provider: node.provider,
      model: resolvedModel,
      prompt,
      cwd: resolvedCwd,
      timeoutMs: node.timeoutMs,
      maxTurns: node.maxTurns,
      abortSignal: abortController?.signal,
    });
    control?.clearAbortController?.(node.id);

    nodeRun.endedAt = new Date().toISOString();
    nodeRun.outputMarkdown = result.outputMarkdown;
    nodeRun.rawOutput = result.rawOutput;
    nodeRun.metadata = result.metadata;
    nodeRunMap.set(node.id, nodeRun);

    if (result.aborted || control?.shouldCancel()) {
      nodeRun.status = "canceled";
      nodeRun.errorMessage = result.errorMessage;
      runRecord.status = "canceled";
      runRecord.controlState = undefined;
      runRecord.endedAt = nodeRun.endedAt;

      logInfo("pipeline.node.canceled", {
        runId,
        nodeId: node.id,
        nodeName: node.name,
        reason: result.errorMessage ?? "Invocation aborted.",
      });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "node_canceled",
        nodeId: node.id,
        nodeName: node.name,
        payload: {
          provider: node.provider,
          model: resolvedModel,
          lifecycleMode: provider.lifecycleMode,
          providerSessionId:
            typeof result.metadata?.providerSessionId === "string" ? result.metadata.providerSessionId : undefined,
          providerThreadId:
            typeof result.metadata?.providerThreadId === "string" ? result.metadata.providerThreadId : undefined,
          reason: result.errorMessage ?? "Invocation aborted.",
        },
      });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "run_canceled",
        payload: {
          pipelineId: definition.id,
          nodeId: node.id,
          reason: result.errorMessage ?? "Invocation aborted.",
        },
      });
      reportUpdate();
      break;
    }

    if (!result.ok) {
      nodeRun.status = "failed";
      nodeRun.errorMessage = result.errorMessage;
      runRecord.status = "failed";
      runRecord.controlState = undefined;
      runRecord.endedAt = nodeRun.endedAt;

      logError("pipeline.node.failed", {
        runId,
        nodeId: node.id,
        nodeName: node.name,
        errorMessage: result.errorMessage,
      });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "node_failed",
        nodeId: node.id,
        nodeName: node.name,
        payload: {
          provider: node.provider,
          model: resolvedModel,
          lifecycleMode: provider.lifecycleMode,
          providerSessionId:
            typeof result.metadata?.providerSessionId === "string" ? result.metadata.providerSessionId : undefined,
          providerThreadId:
            typeof result.metadata?.providerThreadId === "string" ? result.metadata.providerThreadId : undefined,
          errorMessage: result.errorMessage,
        },
      });
      reportUpdate();
      break;
    }

    nodeRun.status = "success";
    completedNodeIds.add(node.id);

    logInfo("pipeline.node.success", {
      runId,
      nodeId: node.id,
      nodeName: node.name,
      outputLength: result.outputMarkdown.length,
    });
    eventSink?.append({
      runId,
      timestamp: new Date().toISOString(),
      type: "node_succeeded",
      nodeId: node.id,
      nodeName: node.name,
      payload: {
        provider: node.provider,
        model: resolvedModel,
        lifecycleMode: provider.lifecycleMode,
        providerSessionId:
          typeof result.metadata?.providerSessionId === "string" ? result.metadata.providerSessionId : undefined,
        providerThreadId:
          typeof result.metadata?.providerThreadId === "string" ? result.metadata.providerThreadId : undefined,
        outputLength: result.outputMarkdown.length,
      },
    });
    reportUpdate();

    for (const successorId of successorMap.get(node.id) ?? []) {
      const nextRemaining = (remainingPredecessors.get(successorId) ?? 0) - 1;
      remainingPredecessors.set(successorId, nextRemaining);
      if (nextRemaining === 0) {
        readyQueue.push(successorId);
      }
    }
  }

  if (runRecord.status === "running" && completedNodeIds.size !== reachableNodeIds.size) {
    throw new Error(
      `DAG execution stalled: completed ${completedNodeIds.size} of ${reachableNodeIds.size} reachable nodes.`,
    );
  }

  if (runRecord.status === "running") {
    runRecord.status = "completed";
    runRecord.controlState = undefined;
    runRecord.endedAt = new Date().toISOString();
    logInfo("pipeline.run.completed", {
      runId,
      pipelineId: definition.id,
      nodeCount: runRecord.nodeRuns.length,
    });
    eventSink?.append({
      runId,
      timestamp: new Date().toISOString(),
      type: "run_completed",
      payload: {
        pipelineId: definition.id,
        nodeCount: runRecord.nodeRuns.length,
      },
    });
  } else {
    if (runRecord.status === "canceled") {
      logInfo("pipeline.run.canceled", {
        runId,
        pipelineId: definition.id,
        nodeCount: runRecord.nodeRuns.length,
      });
    } else {
      logError("pipeline.run.failed", {
        runId,
        pipelineId: definition.id,
        nodeCount: runRecord.nodeRuns.length,
      });
      eventSink?.append({
        runId,
        timestamp: new Date().toISOString(),
        type: "run_failed",
        payload: {
          pipelineId: definition.id,
          nodeCount: runRecord.nodeRuns.length,
        },
      });
    }
  }

  reportUpdate();

  return runRecord;
}
