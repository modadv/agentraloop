import {
  type PipelineValidationIssue,
  type NodeRunRecord,
  type PipelineDefinition,
  type PipelineRunRecord,
  type QueueTaskRecord,
  type RunEventRecord,
  type TaskQueueRecord,
  type UserProfile,
} from "./types.js";

export function toPipelineSummary(definition: PipelineDefinition): Record<string, unknown> {
  const enabledNodeCount = definition.nodes.filter((node) => node.enabled !== false).length;
  const disabledNodeCount = definition.nodes.length - enabledNodeCount;

  return {
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "",
    entryNodeId: definition.entryNodeId,
    nodeCount: definition.nodes.length,
    edgeCount: definition.edges.length,
    enabledNodeCount,
    disabledNodeCount,
  };
}

export function toPipelineGraph(definition: PipelineDefinition): Record<string, unknown> {
  return {
    pipeline: {
      id: definition.id,
      name: definition.name,
      description: definition.description ?? "",
      entryNodeId: definition.entryNodeId,
    },
    graph: {
      nodes: definition.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        enabled: node.enabled !== false,
        provider: node.provider,
        model: node.model,
        hasModelProfiles: Boolean(node.modelProfiles && Object.keys(node.modelProfiles).length > 0),
        cwd: node.cwd ?? null,
        position: node.position ?? null,
      })),
      edges: definition.edges.map((edge, index) => ({
        id: `edge-${index}`,
        from: edge.from,
        to: edge.to,
      })),
    },
  };
}

export function toRunSummary(run: PipelineRunRecord): Record<string, unknown> {
  const nodeStatuses = run.nodeRuns.reduce<Record<string, number>>((acc, node) => {
    acc[node.status] = (acc[node.status] ?? 0) + 1;
    return acc;
  }, {});

  return {
    runId: run.runId,
    pipelineId: run.pipelineId,
    pipelineName: run.pipelineName,
    status: run.status,
    controlState: run.controlState,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    nodeCount: run.nodeRuns.length,
    nodeStatuses,
    config: run.config,
  };
}

export function toNodeRunView(node: NodeRunRecord): Record<string, unknown> {
  return {
    nodeId: node.nodeId,
    nodeName: node.nodeName,
    provider: node.provider,
    model: node.model,
    status: node.status,
    startedAt: node.startedAt,
    endedAt: node.endedAt,
    errorMessage: node.errorMessage,
    metadata: node.metadata,
    prompt: node.prompt,
    outputMarkdown: node.outputMarkdown,
    rawOutput: node.rawOutput,
  };
}

export function toRunDetail(run: PipelineRunRecord): Record<string, unknown> {
  return {
    run: {
      runId: run.runId,
      pipelineId: run.pipelineId,
      pipelineName: run.pipelineName,
      status: run.status,
      controlState: run.controlState,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      config: run.config,
    },
    nodes: run.nodeRuns.map((node) => toNodeRunView(node)),
  };
}

export function toRunGraph(
  run: PipelineRunRecord,
  definition?: PipelineDefinition,
): Record<string, unknown> {
  const nodeStatusMap = new Map(
    run.nodeRuns.map((node) => [
      node.nodeId,
      {
        status: node.status,
        startedAt: node.startedAt,
        endedAt: node.endedAt,
        errorMessage: node.errorMessage ?? null,
      },
    ]),
  );

  return {
    run: {
      runId: run.runId,
      pipelineId: run.pipelineId,
      pipelineName: run.pipelineName,
      status: run.status,
      controlState: run.controlState,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      config: run.config,
    },
    graph: {
      entryNodeId: definition?.entryNodeId ?? null,
      nodes: definition
        ? definition.nodes.map((node) => ({
            id: node.id,
            name: node.name,
            enabled: node.enabled !== false,
            provider: node.provider,
            model: node.model,
            position: node.position ?? null,
            runtimeStatus: nodeStatusMap.get(node.id)?.status ?? "pending",
            startedAt: nodeStatusMap.get(node.id)?.startedAt ?? null,
            endedAt: nodeStatusMap.get(node.id)?.endedAt ?? null,
            errorMessage: nodeStatusMap.get(node.id)?.errorMessage ?? null,
          }))
        : run.nodeRuns.map((node) => ({
            id: node.nodeId,
            name: node.nodeName,
            provider: node.provider,
            model: node.model,
            position: null,
            runtimeStatus: node.status,
            startedAt: node.startedAt,
            endedAt: node.endedAt,
            errorMessage: node.errorMessage ?? null,
          })),
      edges: definition
        ? definition.edges.map((edge, index) => ({
            id: `edge-${index}`,
            from: edge.from,
            to: edge.to,
          }))
        : [],
      nodeStatusMap: Object.fromEntries(nodeStatusMap),
    },
  };
}

export function toRunEventView(event: RunEventRecord): Record<string, unknown> {
  return {
    timestamp: event.timestamp,
    type: event.type,
    nodeId: event.nodeId,
    nodeName: event.nodeName,
    payload: event.payload ?? {},
  };
}

export function toValidationIssueView(issue: PipelineValidationIssue): Record<string, unknown> {
  return {
    code: issue.code,
    path: issue.path,
    message: issue.message,
  };
}

export function toUserView(user: UserProfile): Record<string, unknown> {
  return {
    id: user.id,
    isAdmin: user.isAdmin,
    workspacePath: user.workspacePath,
    dataDir: user.dataDir,
    logsDir: user.logsDir,
    pipelineDir: user.pipelineDir,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function toTaskQueueView(queue: TaskQueueRecord): Record<string, unknown> {
  return {
    queueId: queue.queueId,
    userId: queue.userId,
    pipelineId: queue.pipelineId,
    name: queue.name,
    status: queue.status,
    createdAt: queue.createdAt,
    updatedAt: queue.updatedAt,
  };
}

export function toQueueTaskView(task: QueueTaskRecord): Record<string, unknown> {
  return {
    taskId: task.taskId,
    userId: task.userId,
    queueId: task.queueId,
    pipelineId: task.pipelineId,
    title: task.title,
    prompt: task.prompt,
    status: task.status,
    position: task.position,
    pipelineCwd: task.pipelineCwd,
    modelProfile: task.modelProfile,
    runId: task.runId,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}
