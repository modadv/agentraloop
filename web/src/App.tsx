import { useEffect, useMemo, useRef, useState } from "react";
import {
  controlQueue,
  controlRun,
  createTask,
  deleteTask,
  getQueueTasks,
  getQueues,
  getAllRuns,
  getHealth,
  getPipeline,
  getPipelineGraph,
  getPipelines,
  getRun,
  getRunEvents,
  getRunGraph,
  getRunsForUser,
  getUsers,
  getWorkspaceContext,
  reorderQueue,
  saveDraft,
  updateTask,
  validateDraft,
} from "./api";
import { ReteDraftEditor } from "./components/graph/rete-draft-editor";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Panel, PanelHeader } from "./components/ui/panel";
import type {
  AgentProvider,
  HealthResponse,
  PipelineDefinition,
  PipelineGraphDraft,
  PipelineGraphResponse,
  PipelineListItem,
  PipelineValidationIssue,
  GlobalRunSummary,
  RunDetailResponse,
  RunEventsResponse,
  RunGraphResponse,
  RunSummary,
  QueueTask,
  TaskQueue,
  UserProfile,
  WorkspaceRepoContext,
} from "./types";

type GraphMode = "pipeline" | "run" | "draft";
type StudioPage = "runtime" | "create" | "editor" | "queue" | "history" | "users";

function isActiveRun(status?: string): boolean {
  return status === "pending" || status === "running" || status === "paused" || status === "canceling";
}

function statusTone(status?: string): string {
  if (!status) return "neutral";
  if (status === "completed" || status === "success") return "success";
  if (status === "failed" || status === "canceled") return "danger";
  if (status === "paused" || status === "canceling") return "warning";
  return "accent";
}

function formatWhen(value?: string | null): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function pipelineToDraft(definition: PipelineDefinition): PipelineGraphDraft {
  return {
    pipeline: {
      id: definition.id,
      name: definition.name,
      description: definition.description ?? "",
      entryNodeId: definition.entryNodeId,
    },
    graph: {
      nodes: definition.nodes.map((node) => ({
        ...node,
        enabled: node.enabled !== false,
        cwd: node.cwd ?? ".",
        timeoutMs: node.timeoutMs ?? null,
        maxTurns: node.maxTurns ?? null,
      })),
      edges: definition.edges.map((edge) => ({ ...edge })),
    },
  };
}

function definitionToSummary(definition: PipelineDefinition): PipelineListItem["summary"] {
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

function definitionToGraph(definition: PipelineDefinition): PipelineGraphResponse {
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
        cwd: node.cwd ?? ".",
        position: node.position ?? null,
      })),
      edges: definition.edges.map((edge) => ({
        id: `pipeline-edge-${edge.from}-${edge.to}`,
        from: edge.from,
        to: edge.to,
      })),
    },
  };
}

function cloneDraft(draft: PipelineGraphDraft): PipelineGraphDraft {
  return JSON.parse(JSON.stringify(draft)) as PipelineGraphDraft;
}

function shouldIgnoreShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || target.isContentEditable;
}

function nodeLabelsFor(ids: string[], label: string): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, label]));
}

function computeAutoLayoutPositions(
  nodes: Array<{
    id: string;
    position?: { x: number; y: number } | null;
  }>,
  edges: Array<{ id: string; from: string; to: string }>,
  entryNodeId?: string | null,
): Map<string, { x: number; y: number }> {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const roots =
    entryNodeId && incoming.has(entryNodeId)
      ? [entryNodeId]
      : nodes.filter((node) => (incoming.get(node.id)?.length ?? 0) === 0).map((node) => node.id);

  const levels = new Map<string, number>();
  const queue = [...roots];
  for (const root of roots) levels.set(root, 0);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = levels.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      const nextLevel = Math.max(level + 1, levels.get(next) ?? 0);
      if (nextLevel !== levels.get(next)) {
        levels.set(next, nextLevel);
        queue.push(next);
      }
    }
  }
  for (const node of nodes) {
    if (!levels.has(node.id)) levels.set(node.id, 0);
  }

  const grouped = new Map<number, string[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    const items = grouped.get(level) ?? [];
    items.push(node.id);
    grouped.set(level, items);
  }

  const positions = new Map<string, { x: number; y: number }>();
  for (const level of [...grouped.keys()].sort((a, b) => a - b)) {
    const items = (grouped.get(level) ?? []).sort();
    items.forEach((id, index) => positions.set(id, { x: level * 300, y: index * 170 }));
  }

  return positions;
}

export default function App() {
  const canvasNoticeTimerRef = useRef<number | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("admin");
  const [newUserId, setNewUserId] = useState("");
  const [newUserWorkspacePath, setNewUserWorkspacePath] = useState("");
  const [pipelines, setPipelines] = useState<PipelineListItem[]>([]);
  const [queues, setQueues] = useState<TaskQueue[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
  const [queueTasks, setQueueTasks] = useState<QueueTask[]>([]);
  const [selectedQueueTaskId, setSelectedQueueTaskId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [globalRuns, setGlobalRuns] = useState<GlobalRunSummary[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedPipelineDetail, setSelectedPipelineDetail] = useState<{
    pipeline: PipelineDefinition;
    summary: PipelineListItem["summary"];
  } | null>(null);
  const [selectedPipelineGraph, setSelectedPipelineGraph] = useState<PipelineGraphResponse | null>(null);
  const [selectedRunDetail, setSelectedRunDetail] = useState<RunDetailResponse | null>(null);
  const [selectedRunGraph, setSelectedRunGraph] = useState<RunGraphResponse | null>(null);
  const [selectedRunEvents, setSelectedRunEvents] = useState<RunEventsResponse["events"]>([]);
  const [graphMode, setGraphMode] = useState<GraphMode>("pipeline");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [selectedGraphEdgeId, setSelectedGraphEdgeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PipelineGraphDraft | null>(null);
  const [selectedEditorNodeId, setSelectedEditorNodeId] = useState<string | null>(null);
  const [selectedEditorEdgeIndex, setSelectedEditorEdgeIndex] = useState<number | null>(null);
  const [issues, setIssues] = useState<PipelineValidationIssue[]>([]);
  const [actionMessage, setActionMessage] = useState("Studio ready.");
  const [actionTone, setActionTone] = useState("neutral");
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [showQuickJump, setShowQuickJump] = useState(false);
  const [showSupportTools, setShowSupportTools] = useState(false);
  const [pipelineCwd, setPipelineCwd] = useState("");
  const [modelProfile, setModelProfile] = useState<"fast" | "standard">("standard");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [queueTaskTitle, setQueueTaskTitle] = useState("");
  const [queueTaskPrompt, setQueueTaskPrompt] = useState("");
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceRepoContext | null>(null);
  const previousUserIdRef = useRef<string | null>(null);
  const libraryRequestIdRef = useRef(0);
  const pipelineCwdDirtyRef = useRef(false);
  const [edgeFrom, setEdgeFrom] = useState("");
  const [edgeTo, setEdgeTo] = useState("");
  const [connectSourceNodeId, setConnectSourceNodeId] = useState<string | null>(null);
  const [connectTargetNodeId, setConnectTargetNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [draggingNodePosition, setDraggingNodePosition] = useState<{ x: number; y: number } | null>(null);
  const [recentNodeIds, setRecentNodeIds] = useState<string[]>([]);
  const [recentNodeLabels, setRecentNodeLabels] = useState<Record<string, string>>({});
  const [recentEdgeId, setRecentEdgeId] = useState<string | null>(null);
  const [recentConnection, setRecentConnection] = useState<{ from: string; to: string } | null>(null);
  const [lastDraftChange, setLastDraftChange] = useState<{
    label: string;
    value: string;
    tone: "success" | "warning" | "accent";
  } | null>(null);
  const [canvasNotice, setCanvasNotice] = useState<{ tone: "success" | "warning" | "accent"; message: string } | null>(null);
  const [pendingRunSelection, setPendingRunSelection] = useState<{
    userId: string;
    runId: string;
  } | null>(null);
  const [studioPage, setStudioPage] = useState<StudioPage>(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
    if (hash === "runtime" || hash === "create" || hash === "editor" || hash === "history" || hash === "users") return hash;
    return "runtime";
  });

  function clearRunSelection() {
    setSelectedRunId(null);
    setSelectedRunDetail(null);
    setSelectedRunGraph(null);
    setSelectedRunEvents([]);
  }

  function clearGraphSelection() {
    setSelectedGraphNodeId(null);
    setSelectedGraphEdgeId(null);
  }

  function clearEditorSelection() {
    setSelectedEditorNodeId(null);
    setSelectedEditorEdgeIndex(null);
  }

  function handleCanvasNodeActivate(nodeId: string) {
    if (graphMode === "draft") {
      if (connectSourceNodeId && connectSourceNodeId !== nodeId) {
        addEdgeConnection(connectSourceNodeId, nodeId);
        setConnectSourceNodeId(null);
        setConnectTargetNodeId(null);
        return;
      }
      if (draft?.graph.nodes.some((node) => node.id === nodeId)) {
        selectDraftNode(nodeId);
      }
      return;
    }

    setSelectedGraphNodeId(nodeId);
    setSelectedGraphEdgeId(null);
  }

  function pushDraftChange(
    label: string,
    value: string,
    tone: "success" | "warning" | "accent",
  ) {
    setLastDraftChange({ label, value, tone });
  }

  function clearDraftTransientState() {
    if (canvasNoticeTimerRef.current != null) {
      window.clearTimeout(canvasNoticeTimerRef.current);
      canvasNoticeTimerRef.current = null;
    }
    setCanvasNotice(null);
    setLastDraftChange(null);
    setRecentNodeIds([]);
    setRecentNodeLabels({});
    setRecentEdgeId(null);
    setRecentConnection(null);
    setConnectSourceNodeId(null);
    setConnectTargetNodeId(null);
    setDraggingNodeId(null);
    setDraggingNodePosition(null);
  }

  function selectDraftNode(nodeId: string) {
    setGraphMode("draft");
    setSelectedEditorNodeId(nodeId);
    setSelectedEditorEdgeIndex(null);
    setSelectedGraphNodeId(nodeId);
    setSelectedGraphEdgeId(null);
  }

  function selectDraftEdge(index: number, from: string, to: string) {
    setGraphMode("draft");
    setSelectedEditorEdgeIndex(index);
    setSelectedEditorNodeId(null);
    setSelectedGraphEdgeId(`draft-edge-${index}`);
    setSelectedGraphNodeId(null);
    setEdgeFrom(from);
    setEdgeTo(to);
  }

  function selectPipelineContext(pipelineId: string) {
    setSelectedPipelineId(pipelineId);
    setSelectedQueueId(pipelineId);
    setQueueTasks([]);
    setSelectedQueueTaskId(null);
    clearRunSelection();
    clearGraphSelection();
    clearEditorSelection();
    setShowQuickJump(false);
    setShowSupportTools(false);
    setGraphMode(studioPage === "editor" ? "draft" : "pipeline");
  }

  function selectRunContext(run: RunSummary) {
    setSelectedRunId(run.runId);
    setSelectedPipelineId(run.pipelineId);
    clearGraphSelection();
    clearEditorSelection();
    setShowQuickJump(false);
    setShowSupportTools(false);
    setGraphMode("run");
  }

  function selectTaskHistoryContext(task: QueueTask) {
    if (!task.runId) return;
    const linkedRun = runs.find((run) => run.runId === task.runId);
    if (linkedRun) {
      selectRunContext(linkedRun);
      return;
    }
    setSelectedRunId(task.runId);
    setSelectedPipelineId(task.pipelineId);
    clearGraphSelection();
    clearEditorSelection();
    setShowQuickJump(false);
    setShowSupportTools(false);
    setGraphMode("run");
  }

  function applyQueueTasks(tasks: QueueTask[]) {
    setQueueTasks(tasks);
    setSelectedQueueTaskId((current) =>
      current && tasks.some((task) => task.taskId === current && task.status === "queued")
        ? current
        : tasks.find((task) => task.status === "queued")?.taskId ?? null,
    );
  }

  async function refreshLibrary(userIdOverride?: string) {
    const requestUserId = userIdOverride ?? selectedUserId;
    const requestId = ++libraryRequestIdRef.current;
    const [usersData, healthData, pipelineItems, queueData, runData] = await Promise.all([
      getUsers(),
      getHealth(requestUserId),
      getPipelines(requestUserId),
      getQueues(requestUserId),
      getRunsForUser(requestUserId),
    ]);
    if (requestId !== libraryRequestIdRef.current) return;
    setUsers(usersData.users ?? []);
    if (usersData.defaultUserId && !requestUserId) {
      setSelectedUserId(usersData.defaultUserId);
    }
    setHealth(healthData);
    const previousUserId = previousUserIdRef.current;
    if (previousUserId !== requestUserId || !pipelineCwdDirtyRef.current) {
      setPipelineCwd(healthData.pipelineCwd);
      pipelineCwdDirtyRef.current = false;
    }
    previousUserIdRef.current = requestUserId;
    setPipelines(pipelineItems);
    setQueues(queueData.queues ?? []);
    setRuns(runData.runs ?? []);
    if (requestUserId === "admin") {
      const globalRunData = await getAllRuns(requestUserId);
      if (requestId !== libraryRequestIdRef.current) return;
      setGlobalRuns(globalRunData.runs ?? []);
    } else {
      setGlobalRuns([]);
    }
    if (!selectedPipelineId && pipelineItems.length > 0) setSelectedPipelineId(pipelineItems[0].summary.id);
  }

  useEffect(() => {
    void refreshLibrary().catch((error: Error) => {
      setActionMessage(error.message);
      setActionTone("danger");
    });
  }, [selectedUserId]);

  useEffect(() => {
    if (health?.pipelineCwd && !pipelineCwd.trim()) {
      setPipelineCwd(health.pipelineCwd);
    }
  }, [health?.pipelineCwd, pipelineCwd]);

  useEffect(() => {
    if (!pipelineCwd.trim()) {
      setWorkspaceContext(null);
      return;
    }

    let active = true;
    const timer = window.setTimeout(() => {
      void getWorkspaceContext(pipelineCwd.trim(), selectedUserId)
        .then((result) => {
          if (!active) return;
          setWorkspaceContext(result.context ?? null);
        })
        .catch(() => {
          if (!active) return;
          setWorkspaceContext(null);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pipelineCwd, selectedUserId]);

  useEffect(() => {
    if (!selectedPipelineId) return;
    void (async () => {
      const [detail, graph] = await Promise.all([
        getPipeline(selectedPipelineId, selectedUserId),
        getPipelineGraph(selectedPipelineId, selectedUserId),
      ]);
      setSelectedPipelineDetail(detail);
      setSelectedPipelineGraph(graph);
        if (!draft || draft.pipeline.id !== detail.pipeline.id) {
      const nextDraft = pipelineToDraft(detail.pipeline);
      setDraft(nextDraft);
      setDraftDirty(false);
      setLastDraftChange(null);
      setSelectedEditorNodeId(nextDraft.graph.nodes[0]?.id ?? null);
          setSelectedEditorEdgeIndex(null);
          setEdgeFrom(nextDraft.graph.nodes[0]?.id ?? "");
          setEdgeTo(nextDraft.graph.nodes[1]?.id ?? nextDraft.graph.nodes[0]?.id ?? "");
        }
      if (studioPage !== "editor") {
        setGraphMode((current) => (current === "run" && selectedRunId ? current : "pipeline"));
      }
    })().catch((error: Error) => {
      setActionMessage(error.message);
      setActionTone("danger");
    });
  }, [selectedPipelineId, selectedUserId, selectedRunId, studioPage]);

  useEffect(() => {
    if (!selectedPipelineId) {
      setSelectedQueueId(null);
      setQueueTasks([]);
      setSelectedQueueTaskId(null);
      return;
    }
    const queueId = selectedPipelineId;
    setSelectedQueueId(queueId);
    void (async () => {
      try {
        const result = await getQueueTasks(queueId, selectedUserId);
        applyQueueTasks(result.tasks ?? []);
      } catch {
        setQueueTasks([]);
        setSelectedQueueTaskId(null);
      }
    })();
  }, [selectedPipelineId, selectedUserId]);

  useEffect(() => {
    if (!selectedRunId) return;
    void (async () => {
      const [detail, graph, events] = await Promise.all([
        getRun(selectedRunId, selectedUserId),
        getRunGraph(selectedRunId, selectedUserId),
        getRunEvents(selectedRunId, selectedUserId),
      ]);
      setSelectedRunDetail(detail);
      setSelectedRunGraph(graph);
      setSelectedRunEvents(events.events ?? []);
      if (studioPage !== "editor") {
        setGraphMode("run");
      }
    })().catch((error: Error) => {
      setActionMessage(error.message);
      setActionTone("danger");
    });
  }, [selectedRunId, selectedUserId, studioPage]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const [runData, queueData, selectedQueueTaskData] = await Promise.all([
            getRunsForUser(selectedUserId),
            getQueues(selectedUserId),
            selectedQueueId || selectedPipelineId
              ? getQueueTasks(selectedQueueId ?? selectedPipelineId ?? "", selectedUserId)
              : Promise.resolve({ tasks: [] as QueueTask[] }),
          ]);
          setRuns(runData.runs ?? []);
          setQueues(queueData.queues ?? []);
          applyQueueTasks(selectedQueueTaskData.tasks ?? []);
          if (selectedRunId) {
            const selected = (runData.runs ?? []).find((item) => item.runId === selectedRunId);
            const currentStatus = selectedRunDetail?.run.status;
            const shouldRefreshSelectedRun =
              !!selected && (isActiveRun(selected.status) || currentStatus !== selected.status);
            if (selected && shouldRefreshSelectedRun) {
              const [detail, graph, events] = await Promise.all([
                getRun(selectedRunId, selectedUserId),
                getRunGraph(selectedRunId, selectedUserId),
                getRunEvents(selectedRunId, selectedUserId),
              ]);
              setSelectedRunDetail(detail);
              setSelectedRunGraph(graph);
              setSelectedRunEvents(events.events ?? []);
            }
          }
        } catch {
          // keep current view stable during polling failures
        }
      })();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [selectedPipelineId, selectedQueueId, selectedRunDetail?.run.status, selectedRunId, selectedUserId]);

  useEffect(() => {
    if (recentNodeIds.length === 0) return;
    const timer = window.setTimeout(() => {
      setRecentNodeIds([]);
      setRecentNodeLabels({});
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [recentNodeIds]);

  useEffect(() => {
    if (!recentEdgeId) return;
    const timer = window.setTimeout(() => setRecentEdgeId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [recentEdgeId]);

  useEffect(() => {
    if (!recentConnection) return;
    const timer = window.setTimeout(() => setRecentConnection(null), 2600);
    return () => window.clearTimeout(timer);
  }, [recentConnection]);

  useEffect(
    () => () => {
      if (canvasNoticeTimerRef.current != null) {
        window.clearTimeout(canvasNoticeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    clearRunSelection();
    clearGraphSelection();
    clearEditorSelection();
    setSelectedPipelineId(null);
    setDraft(null);
    setDraftDirty(false);
    pipelineCwdDirtyRef.current = false;
    setPipelineCwd("");
    setGlobalRuns([]);
  }, [selectedUserId]);

  useEffect(() => {
    if (!pendingRunSelection) return;
    if (pendingRunSelection.userId !== selectedUserId) return;
    const targetRun = runs.find((item) => item.runId === pendingRunSelection.runId);
    if (!targetRun) return;
    selectRunContext(targetRun);
    setPendingRunSelection(null);
  }, [pendingRunSelection, runs, selectedUserId]);

  useEffect(() => {
    const nextHash = `#${studioPage}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash);
    }

    if (studioPage === "editor") {
      setGraphMode("draft");
      return;
    }

    if (studioPage === "queue") {
      setGraphMode("pipeline");
      return;
    }

    if (studioPage === "users") {
      setGraphMode("pipeline");
      return;
    }

    setGraphMode(selectedRunId ? "run" : "pipeline");
  }, [selectedRunId, studioPage]);

  const selectedRunSummary = useMemo(
    () => runs.find((item) => item.runId === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const activeRuns = useMemo(() => runs.filter((item) => isActiveRun(item.status)), [runs]);
  const terminalRuns = useMemo(() => runs.filter((item) => !isActiveRun(item.status)), [runs]);
  const activeGlobalRuns = useMemo(() => globalRuns.filter((item) => isActiveRun(item.status)), [globalRuns]);
  const terminalGlobalRuns = useMemo(() => globalRuns.filter((item) => !isActiveRun(item.status)), [globalRuns]);
  const selectedUserProfile = useMemo(
    () => users.find((user) => user.id === selectedUserId) ?? null,
    [selectedUserId, users],
  );
  const pageTitle =
    studioPage === "runtime"
      ? "Runtime"
      : studioPage === "create"
        ? "Create Task"
        : studioPage === "editor"
          ? "Editor"
          : studioPage === "queue"
            ? "Queue"
          : studioPage === "history"
            ? "History"
            : "Users";
  const pageDescription =
    studioPage === "runtime"
      ? "Monitor active pipeline runs and inspect the currently selected execution."
      : studioPage === "create"
        ? "Submit a text task into the selected pipeline queue using the current workspace context."
        : studioPage === "editor"
          ? "Edit the selected pipeline graph, node properties, and validation state."
          : studioPage === "queue"
            ? "Manage the selected pipeline queue, including insertion, editing, ordering, and removal of queued tasks."
          : studioPage === "history"
            ? "Review terminal pipeline runs, outputs, and execution history."
            : "Manage user scopes, workspaces, and per-user runtime separation.";
  const selectedPipelineProviders = useMemo(() => {
    const nodes = selectedPipelineDetail?.pipeline.nodes ?? [];
    return [...new Set(nodes.map((node) => node.provider))];
  }, [selectedPipelineDetail]);
  const unavailableProviders = useMemo(() => {
    const availability = health?.providerAvailability ?? {};
    return selectedPipelineProviders.filter((provider) => availability[provider]?.available === false);
  }, [health, selectedPipelineProviders]);

  const currentGraph = useMemo(() => {
    if (graphMode === "draft" && draft) {
      return {
        entryNodeId: draft.pipeline.entryNodeId,
        nodes: draft.graph.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          provider: node.provider,
          model: node.model,
          enabled: node.enabled !== false,
          position: node.position ?? null,
          runtimeStatus: "draft",
        })),
        edges: draft.graph.edges.map((edge, index) => ({
          id: `draft-edge-${index}`,
          from: edge.from,
          to: edge.to,
        })),
      };
    }
    if (graphMode === "run" && selectedRunGraph) return selectedRunGraph.graph;
    return selectedPipelineGraph?.graph ?? null;
  }, [draft, graphMode, selectedPipelineGraph, selectedRunGraph]);

  const selectedEditorNode = useMemo(
    () => draft?.graph.nodes.find((node) => node.id === selectedEditorNodeId) ?? null,
    [draft, selectedEditorNodeId],
  );
  const selectedGraphNode = useMemo(
    () => currentGraph?.nodes.find((node) => node.id === selectedGraphNodeId) ?? null,
    [currentGraph, selectedGraphNodeId],
  );
  const selectedGraphEdge = useMemo(
    () => currentGraph?.edges.find((edge) => edge.id === selectedGraphEdgeId) ?? null,
    [currentGraph, selectedGraphEdgeId],
  );
  const selectedEditorEdge = useMemo(
    () => (selectedEditorEdgeIndex == null ? null : draft?.graph.edges[selectedEditorEdgeIndex] ?? null),
    [draft, selectedEditorEdgeIndex],
  );
  const selectedQueue = useMemo(
    () => queues.find((queue) => queue.queueId === (selectedQueueId ?? selectedPipelineId ?? "")) ?? null,
    [queues, selectedPipelineId, selectedQueueId],
  );
  const selectedQueueTask = useMemo(
    () => queueTasks.find((task) => task.taskId === selectedQueueTaskId) ?? null,
    [queueTasks, selectedQueueTaskId],
  );
  const editableQueueTask = useMemo(
    () => (selectedQueueTask?.status === "queued" ? selectedQueueTask : null),
    [selectedQueueTask],
  );
  const queuedQueueTasks = useMemo(
    () => queueTasks.filter((task) => task.status === "queued").sort((left, right) => left.position - right.position),
    [queueTasks],
  );
  const runningQueueTask = useMemo(
    () => queueTasks.find((task) => task.status === "running") ?? null,
    [queueTasks],
  );
  const terminalQueueTasks = useMemo(
    () =>
      queueTasks
        .filter((task) => task.status === "completed" || task.status === "failed" || task.status === "canceled")
        .sort((left, right) => {
          const leftTime = left.finishedAt ?? left.updatedAt;
          const rightTime = right.finishedAt ?? right.updatedAt;
          return rightTime.localeCompare(leftTime);
        }),
    [queueTasks],
  );
  const queueRuntimeStats = useMemo(
    () => ({
      running: queueTasks.filter((task) => task.status === "running").length,
      queued: queueTasks.filter((task) => task.status === "queued").length,
      completed: queueTasks.filter((task) => task.status === "completed").length,
      failed: queueTasks.filter((task) => task.status === "failed").length,
      canceled: queueTasks.filter((task) => task.status === "canceled").length,
      total: queueTasks.length,
    }),
    [queueTasks],
  );
  const selectedRunLinkedTask = useMemo(
    () => (selectedRunId ? queueTasks.find((task) => task.runId === selectedRunId) ?? null : null),
    [queueTasks, selectedRunId],
  );
  const nextQueuedTask = useMemo(
    () => queuedQueueTasks[0] ?? null,
    [queuedQueueTasks],
  );
  const latestTerminalTask = useMemo(
    () => terminalQueueTasks[0] ?? null,
    [terminalQueueTasks],
  );
  const runtimeFocusTask = useMemo(
    () => selectedRunLinkedTask ?? runningQueueTask,
    [runningQueueTask, selectedRunLinkedTask],
  );
  useEffect(() => {
    if (editableQueueTask) {
      setQueueTaskTitle(editableQueueTask.title);
      setQueueTaskPrompt(editableQueueTask.prompt);
    } else {
      setQueueTaskTitle("");
      setQueueTaskPrompt("");
    }
  }, [editableQueueTask]);
  const selectedDraftNodePosition = useMemo(() => {
    if (draggingNodeId && selectedEditorNode?.id === draggingNodeId && draggingNodePosition) {
      return draggingNodePosition;
    }
    if (!selectedEditorNode?.position) return null;
    return {
      x: Math.round(selectedEditorNode.position.x),
      y: Math.round(selectedEditorNode.position.y),
    };
  }, [draggingNodeId, draggingNodePosition, selectedEditorNode]);
  const currentDraftFocusLabel = useMemo(() => {
    if (selectedEditorNode) return `Node: ${selectedEditorNode.name}`;
    if (selectedEditorEdge) {
      const fromName = draft?.graph.nodes.find((node) => node.id === selectedEditorEdge.from)?.name ?? selectedEditorEdge.from;
      const toName = draft?.graph.nodes.find((node) => node.id === selectedEditorEdge.to)?.name ?? selectedEditorEdge.to;
      return `Edge: ${fromName} → ${toName}`;
    }
    return "No draft selection";
  }, [draft, selectedEditorEdge, selectedEditorNode]);
  const activeGraphNode = useMemo(() => {
    if (graphMode === "draft" && selectedEditorNode) {
      return currentGraph?.nodes.find((node) => node.id === selectedEditorNode.id) ?? null;
    }
    return selectedGraphNode;
  }, [currentGraph, graphMode, selectedEditorNode, selectedGraphNode]);
  const activeGraphEdge = useMemo(() => {
    if (graphMode === "draft" && selectedEditorEdge) {
      return (
        currentGraph?.edges.find(
          (edge) => edge.from === selectedEditorEdge.from && edge.to === selectedEditorEdge.to,
        ) ?? null
      );
    }
    return selectedGraphEdge;
  }, [currentGraph, graphMode, selectedEditorEdge, selectedGraphEdge]);
  const selectedRunNodeDetail = useMemo(() => {
    if (graphMode !== "run" || !selectedRunDetail || !activeGraphNode) return null;
    return selectedRunDetail.nodes.find((node) => node.nodeId === activeGraphNode.id) ?? null;
  }, [activeGraphNode, graphMode, selectedRunDetail]);
  const currentViewLabel = useMemo(() => {
    if (graphMode === "draft") return "Draft editing";
    if (graphMode === "run") return "Run inspection";
    return "Pipeline overview";
  }, [graphMode]);
  const currentModeLabel = useMemo(() => {
    if (graphMode === "draft") return "Draft";
    if (graphMode === "run") return "Run";
    return "Pipeline";
  }, [graphMode]);
  const currentGraphLabel = useMemo(() => {
    return currentGraph
      ? `${currentGraph.nodes.length} nodes · ${currentGraph.edges.length} edges`
      : "No graph loaded";
  }, [currentGraph]);
  const currentStateLabel = useMemo(() => {
    if (graphMode === "draft") {
      return draft ? (draftDirty ? "Unsaved draft" : "Saved draft") : "No draft loaded";
    }
    if (graphMode === "run") {
      return selectedRunSummary?.status ?? "No run selected";
    }
    return selectedPipelineDetail ? "Saved pipeline" : "No pipeline selected";
  }, [draft, draftDirty, graphMode, selectedPipelineDetail, selectedRunSummary]);
  const currentContextFocusLabel = useMemo(() => {
    if (graphMode === "draft") return currentDraftFocusLabel;
    if (activeGraphEdge) return formatCurrentGraphEdgeLabel(activeGraphEdge.from, activeGraphEdge.to);
    if (activeGraphNode) return activeGraphNode.name;
    return "No graph selection";
  }, [activeGraphEdge, activeGraphNode, currentDraftFocusLabel, graphMode]);
  const editorFocusLabel = useMemo(() => {
    if (graphMode === "draft") return currentDraftFocusLabel;
    return currentContextFocusLabel;
  }, [currentContextFocusLabel, currentDraftFocusLabel, graphMode]);
  const currentSelectionPositionLabel = useMemo(() => {
    if (graphMode === "draft") {
      if (selectedDraftNodePosition) {
        return `x ${selectedDraftNodePosition.x} · y ${selectedDraftNodePosition.y}`;
      }
      if (selectedEditorEdge) return "Connection selected";
      return "Auto layout";
    }
    if (activeGraphNode && "position" in activeGraphNode) {
      return activeGraphNode.position
        ? `${Math.round(activeGraphNode.position.x)} · ${Math.round(activeGraphNode.position.y)}`
        : "Auto layout";
    }
    if (activeGraphEdge) return "Connection selected";
    return "No canvas selection";
  }, [
    activeGraphEdge,
    activeGraphNode,
    graphMode,
    selectedDraftNodePosition,
    selectedEditorEdge,
  ]);
  const effectiveCanvasNotice = useMemo(() => {
    if (canvasNotice) return canvasNotice;
    if (graphMode === "draft" && actionTone === "success" && actionMessage.startsWith("Connected ")) {
      return {
        tone: "success" as const,
        message: actionMessage.replace(/^Connected /, "Connection completed: ").replace(/\.$/, ""),
      };
    }
    if (recentConnection) {
      return {
        tone: "success" as const,
        message: `Connection completed: ${recentConnection.from} → ${recentConnection.to}`,
      };
    }
    return null;
  }, [actionMessage, actionTone, canvasNotice, graphMode, recentConnection]);
  const canvasActivityItems = useMemo(() => {
    const items: Array<{ key: string; label: string; value: string; tone?: "success" | "warning" | "accent" }> = [];
    if (effectiveCanvasNotice) {
      items.push({
        key: "notice",
        label: "Notice",
        value: effectiveCanvasNotice.message,
        tone: effectiveCanvasNotice.tone,
      });
    }
    if (connectSourceNodeId) {
      items.push({
        key: "source",
        label: "Source",
        value: draft?.graph.nodes.find((node) => node.id === connectSourceNodeId)?.name ?? connectSourceNodeId,
        tone: "accent",
      });
    }
    if (connectTargetNodeId) {
      items.push({
        key: "target",
        label: "Target",
        value: draft?.graph.nodes.find((node) => node.id === connectTargetNodeId)?.name ?? connectTargetNodeId,
        tone: "success",
      });
    }
    if (graphMode === "draft" && draggingNodeId && draggingNodePosition) {
      items.push({
        key: "dragging",
        label: "Dragging",
        value: `${draft?.graph.nodes.find((node) => node.id === draggingNodeId)?.name ?? draggingNodeId} · x ${draggingNodePosition.x} · y ${draggingNodePosition.y}`,
        tone: "warning",
      });
    }
    return items;
  }, [
    connectSourceNodeId,
    connectTargetNodeId,
    draft,
    draggingNodeId,
    draggingNodePosition,
    effectiveCanvasNotice,
    graphMode,
  ]);
  const recentDraftChange = lastDraftChange;

  function updateDraft(mutator: (nextDraft: PipelineGraphDraft) => void) {
    setDraft((current) => {
      if (!current) return current;
      const next = cloneDraft(current);
      mutator(next);
      return next;
    });
    setDraftDirty(true);
    setIssues([]);
    setGraphMode("draft");
  }

  function getDraftNodeDisplayName(nodeId: string): string {
    return draft?.graph.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
  }

  function getCurrentGraphNodeDisplayName(nodeId: string): string {
    return currentGraph?.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
  }

  function formatDraftEdgeLabel(from: string, to: string): string {
    return `${getDraftNodeDisplayName(from)} → ${getDraftNodeDisplayName(to)}`;
  }

  function formatCurrentGraphEdgeLabel(from: string, to: string): string {
    return `${getCurrentGraphNodeDisplayName(from)} → ${getCurrentGraphNodeDisplayName(to)}`;
  }

  function showCanvasNotice(tone: "success" | "warning" | "accent", message: string) {
    if (canvasNoticeTimerRef.current != null) {
      window.clearTimeout(canvasNoticeTimerRef.current);
    }
    setCanvasNotice({ tone, message });
    canvasNoticeTimerRef.current = window.setTimeout(() => {
      setCanvasNotice(null);
      canvasNoticeTimerRef.current = null;
    }, 1800);
  }

  function commitDraftNodeMove(nodeId: string, position: { x: number; y: number }) {
    updateDraft((next) => {
      const target = next.graph.nodes.find((item) => item.id === nodeId);
      if (!target) return;
      target.position = {
        x: Math.round(position.x),
        y: Math.round(position.y),
      };
    });
    setDraggingNodeId(null);
    setDraggingNodePosition(null);
    const movedNodeName = getDraftNodeDisplayName(nodeId);
    setRecentNodeIds([nodeId]);
    setRecentNodeLabels(nodeLabelsFor([nodeId], "MOVED"));
    pushDraftChange("Change", `Moved ${movedNodeName}`, "accent");
    showCanvasNotice("accent", `Moved ${movedNodeName} to x ${Math.round(position.x)} · y ${Math.round(position.y)}`);
    setActionMessage(`Moved ${movedNodeName} to x ${Math.round(position.x)} · y ${Math.round(position.y)}.`);
    setActionTone("accent");
  }

  function addNode() {
    let createdNodeId = "";
    updateDraft((next) => {
      let index = next.graph.nodes.length + 1;
      while (next.graph.nodes.some((node) => node.id === `node-${index}`)) index += 1;
      const nodeId = `node-${index}`;
      createdNodeId = nodeId;
      next.graph.nodes.push({
        id: nodeId,
        name: `Node ${index}`,
        provider: "codex-cli",
        model: "gpt-5.4-mini",
        prompt: "Describe the action for this node.",
        cwd: ".",
        enabled: true,
      });
      setGraphMode("draft");
      setSelectedEditorNodeId(nodeId);
      setSelectedGraphNodeId(nodeId);
      setSelectedEditorEdgeIndex(null);
      setSelectedGraphEdgeId(null);
      if (!next.pipeline.entryNodeId) next.pipeline.entryNodeId = nodeId;
      if (!edgeFrom) setEdgeFrom(nodeId);
      if (!edgeTo) setEdgeTo(nodeId);
    });
    if (createdNodeId) {
      const createdNodeName = `Node ${Number(createdNodeId.replace("node-", ""))}`;
      setRecentNodeIds([createdNodeId]);
      setRecentNodeLabels(nodeLabelsFor([createdNodeId], "NEW"));
      pushDraftChange("Change", `New ${createdNodeName}`, "success");
      showCanvasNotice("success", `Node added: ${createdNodeName}`);
    }
    setActionMessage("Draft node added.");
    setActionTone("success");
  }

  function removeNode() {
    if (!selectedEditorNodeId) return;
    const removedNode = draft?.graph.nodes.find((node) => node.id === selectedEditorNodeId);
    updateDraft((next) => {
      next.graph.nodes = next.graph.nodes.filter((node) => node.id !== selectedEditorNodeId);
      next.graph.edges = next.graph.edges.filter(
        (edge) => edge.from !== selectedEditorNodeId && edge.to !== selectedEditorNodeId,
      );
      if (next.pipeline.entryNodeId === selectedEditorNodeId) {
        next.pipeline.entryNodeId = next.graph.nodes[0]?.id ?? "";
      }
      const fallback = next.graph.nodes[0]?.id ?? null;
      setGraphMode("draft");
      setSelectedEditorNodeId(fallback);
      setSelectedGraphNodeId(fallback);
      setSelectedEditorEdgeIndex(null);
      setSelectedGraphEdgeId(null);
    });
    pushDraftChange("Change", `Removed ${removedNode?.name ?? selectedEditorNodeId}`, "warning");
    showCanvasNotice("warning", `Node removed: ${removedNode?.name ?? selectedEditorNodeId}`);
    setActionMessage(`Removed node ${removedNode?.name ?? selectedEditorNodeId}.`);
    setActionTone("warning");
  }

  function addEdge() {
    if (!draft || !edgeFrom || !edgeTo) return;
    addEdgeConnection(edgeFrom, edgeTo);
  }

  function addEdgeConnection(from: string, to: string) {
    if (!draft || !from || !to || from === to) return;
    if (draft.graph.edges.some((edge) => edge.from === from && edge.to === to)) {
      showCanvasNotice("warning", `Edge already exists: ${from} → ${to}`);
      setActionMessage(`Edge ${from} → ${to} already exists.`);
      setActionTone("warning");
      return;
    }
    const newIndex = draft.graph.edges.length;
    const edgeId = `draft-edge-${newIndex}`;
    updateDraft((next) => {
      next.graph.edges.push({ from, to });
      setGraphMode("draft");
      setSelectedEditorEdgeIndex(newIndex);
      setSelectedEditorNodeId(null);
      setSelectedGraphNodeId(null);
      setSelectedGraphEdgeId(edgeId);
      setEdgeFrom(from);
      setEdgeTo(to);
    });
    const fromName = getDraftNodeDisplayName(from);
    const toName = getDraftNodeDisplayName(to);
    setRecentEdgeId(edgeId);
    setRecentNodeIds([from, to]);
    setRecentNodeLabels(nodeLabelsFor([from, to], "LINKED"));
    setRecentConnection({ from: fromName, to: toName });
      pushDraftChange("Change", `Linked ${fromName} → ${toName}`, "success");
    showCanvasNotice("success", `Connection completed: ${fromName} → ${toName}`);
    setActionMessage(`Connected ${fromName} → ${toName}.`);
    setActionTone("success");
  }

  function beginConnectionFromSelectedNode() {
    if (!selectedEditorNodeId) return;
    setConnectSourceNodeId(selectedEditorNodeId);
    setConnectTargetNodeId(null);
    setActionMessage(`Connection mode enabled from ${getDraftNodeDisplayName(selectedEditorNodeId)}. Click a target node or drag from the OUT handle.`);
    setActionTone("accent");
  }

  function cancelConnectionMode() {
    setConnectSourceNodeId(null);
    setConnectTargetNodeId(null);
    setActionMessage("Connection mode canceled.");
    setActionTone("neutral");
  }

  function updateSelectedDraftNode(mutator: (node: PipelineGraphDraft["graph"]["nodes"][number], next: PipelineGraphDraft) => void) {
    if (!selectedEditorNodeId) return;
    updateDraft((next) => {
      const node = next.graph.nodes.find((item) => item.id === selectedEditorNodeId);
      if (!node) return;
      mutator(node, next);
    });
  }

  function updateSelectedDraftEdge(mutator: (edge: PipelineGraphDraft["graph"]["edges"][number], next: PipelineGraphDraft) => void) {
    if (selectedEditorEdgeIndex == null) return;
    updateDraft((next) => {
      const edge = next.graph.edges[selectedEditorEdgeIndex];
      if (!edge) return;
      mutator(edge, next);
    });
  }

  function removeEdge(index: number) {
    const removedEdge = draft?.graph.edges[index];
    updateDraft((next) => {
      next.graph.edges.splice(index, 1);
      if (selectedEditorEdgeIndex == null) return;
      if (selectedEditorEdgeIndex === index) {
        const fallbackIndex = next.graph.edges[index] ? index : next.graph.edges.length - 1;
        setSelectedEditorEdgeIndex(fallbackIndex >= 0 ? fallbackIndex : null);
        setSelectedGraphEdgeId(fallbackIndex >= 0 ? `draft-edge-${fallbackIndex}` : null);
      } else if (selectedEditorEdgeIndex > index) {
        setSelectedEditorEdgeIndex(selectedEditorEdgeIndex - 1);
        setSelectedGraphEdgeId(`draft-edge-${selectedEditorEdgeIndex - 1}`);
      }
    });
    if (removedEdge) {
      const fromName = getDraftNodeDisplayName(removedEdge.from);
      const toName = getDraftNodeDisplayName(removedEdge.to);
      pushDraftChange("Change", `Removed ${fromName} → ${toName}`, "warning");
      showCanvasNotice("warning", `Edge removed: ${fromName} → ${toName}`);
      setActionMessage(`Removed edge ${fromName} → ${toName}.`);
      setActionTone("warning");
    }
  }

  function removeSelectedDraftSelection() {
    if (graphMode !== "draft") return;
    if (selectedEditorEdgeIndex != null) {
      removeEdge(selectedEditorEdgeIndex);
      return;
    }
    if (selectedEditorNodeId) {
      removeNode();
    }
  }

  function handleResetLayout() {
    if (!draft) return;
    updateDraft((next) => {
      next.graph.nodes.forEach((node) => {
        delete node.position;
      });
      clearGraphSelection();
      clearEditorSelection();
    });
    showCanvasNotice("success", "Layout reset to automatic positioning");
    setRecentNodeIds(draft.graph.nodes.map((node) => node.id));
    setRecentNodeLabels(nodeLabelsFor(draft.graph.nodes.map((node) => node.id), "RELAYOUT"));
    pushDraftChange("Change", `Relayout ${draft.graph.nodes.length} nodes`, "success");
    setActionMessage("Draft layout reset to automatic positioning.");
    setActionTone("success");
  }

  function moveSelectedDraftNodeWithKeyboard(key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight") {
    if (graphMode !== "draft" || !draft || !selectedEditorNodeId) return;
    const selectedNode = draft.graph.nodes.find((node) => node.id === selectedEditorNodeId);
    if (!selectedNode) return;

    const fallbackPositions = computeAutoLayoutPositions(
      draft.graph.nodes.map((node) => ({
        id: node.id,
        position: node.position ?? null,
      })),
      draft.graph.edges.map((edge, index) => ({
        id: `draft-edge-${index}`,
        from: edge.from,
        to: edge.to,
      })),
      draft.pipeline.entryNodeId,
    );

    const basePosition = selectedNode.position ?? {
      x: Math.round(fallbackPositions.get(selectedEditorNodeId)?.x ?? 0),
      y: Math.round(fallbackPositions.get(selectedEditorNodeId)?.y ?? 0),
    };
    const step = 32;
    const nextPosition = {
      x: basePosition.x + (key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0),
      y: basePosition.y + (key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0),
    };

    updateDraft((next) => {
      const target = next.graph.nodes.find((node) => node.id === selectedEditorNodeId);
      if (!target) return;
      target.position = nextPosition;
    });

    setDraggingNodeId(null);
    setDraggingNodePosition(null);
    const movedNodeName = getDraftNodeDisplayName(selectedEditorNodeId);
    setRecentNodeIds([selectedEditorNodeId]);
    setRecentNodeLabels(nodeLabelsFor([selectedEditorNodeId], "MOVED"));
    pushDraftChange("Change", `Moved ${movedNodeName}`, "accent");
    showCanvasNotice("accent", `Moved ${movedNodeName} to x ${nextPosition.x} · y ${nextPosition.y}`);
    setActionMessage(`Moved ${movedNodeName} to x ${nextPosition.x} · y ${nextPosition.y}.`);
    setActionTone("accent");
  }

  async function handleValidate() {
    if (!draft) return;
    setBusy(true);
    try {
      const result = await validateDraft(draft, selectedUserId);
      setIssues(result.issues ?? []);
      setActionMessage(result.ok ? "Draft validation passed." : "Draft validation returned issues.");
      setActionTone(result.ok ? "success" : "warning");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  function handleLoadDraft() {
    if (!selectedPipelineDetail) return;
    const next = pipelineToDraft(selectedPipelineDetail.pipeline);
    clearDraftTransientState();
    setDraft(next);
    setDraftDirty(false);
    setSelectedEditorNodeId(next.graph.nodes[0]?.id ?? null);
    setSelectedEditorEdgeIndex(null);
    clearGraphSelection();
    setGraphMode("draft");
    setIssues([]);
    setActionMessage(`Draft reloaded from saved pipeline ${next.pipeline.name}.`);
    setActionTone("neutral");
  }

  async function handleSave() {
    if (!draft) return;
    setBusy(true);
    try {
      const result = await saveDraft(draft.pipeline.id, draft, selectedUserId);
      clearDraftTransientState();
      setActionMessage(`Pipeline ${result.pipeline.name} saved.`);
      setActionTone("success");
      await refreshLibrary(selectedUserId);
      setSelectedPipelineId(result.pipeline.id);
      setSelectedPipelineDetail({
        pipeline: result.pipeline,
        summary: definitionToSummary(result.pipeline),
      });
      setSelectedPipelineGraph(definitionToGraph(result.pipeline));
      setDraft(pipelineToDraft(result.pipeline));
      setDraftDirty(false);
      setIssues([]);
      setGraphMode("pipeline");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function refreshSelectedQueueTasks(queueId = selectedQueueId ?? selectedPipelineId ?? "") {
    if (!queueId) return;
    const result = await getQueueTasks(queueId, selectedUserId);
    applyQueueTasks(result.tasks ?? []);
    return result.tasks ?? [];
  }

  async function handleCreateTask() {
    if (!selectedPipelineId) return;
    setBusy(true);
    try {
      const result = await createTask({
        userId: selectedUserId,
        pipelineId: selectedPipelineId,
        pipelineCwd,
        modelProfile,
        title: taskTitle.trim() || "Untitled Task",
        prompt: taskPrompt.trim(),
      });
      setActionMessage(`Task queued: ${result.task.title}`);
      setActionTone("success");
      await refreshLibrary(selectedUserId);
      const tasks = await refreshSelectedQueueTasks(selectedPipelineId);
      setSelectedQueueTaskId(tasks.find((task) => task.taskId === result.task.taskId && task.status === "queued")?.taskId ?? null);
      setTaskTitle("");
      setTaskPrompt("");
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleInsertQueueTask() {
    if (!selectedPipelineId) return;
    setBusy(true);
    try {
      const result = await createTask({
        userId: selectedUserId,
        pipelineId: selectedPipelineId,
        pipelineCwd,
        modelProfile,
        title: queueTaskTitle.trim() || "Untitled Task",
        prompt: queueTaskPrompt.trim(),
      });
      setActionMessage(`Task queued: ${result.task.title}`);
      setActionTone("success");
      await refreshLibrary(selectedUserId);
      const tasks = await refreshSelectedQueueTasks(selectedPipelineId);
      setSelectedQueueTaskId(tasks.find((task) => task.taskId === result.task.taskId && task.status === "queued")?.taskId ?? null);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleQueueTaskSave() {
    if (!selectedQueueTaskId) return;
    setBusy(true);
    try {
      const result = await updateTask(
        selectedQueueTaskId,
        { title: queueTaskTitle.trim(), prompt: queueTaskPrompt.trim() },
        selectedUserId,
      );
      setActionMessage(`Task updated: ${result.task.title}`);
      setActionTone("success");
      await refreshSelectedQueueTasks(result.task.queueId);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleQueueTaskDelete(taskId = selectedQueueTaskId ?? "") {
    if (!taskId) return;
    setBusy(true);
    try {
      await deleteTask(taskId, selectedUserId);
      setActionMessage("Task removed from queue.");
      setActionTone("warning");
      await refreshSelectedQueueTasks();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleQueueMove(taskId: string, direction: "up" | "down") {
    const queued = queueTasks.filter((task) => task.status === "queued").sort((a, b) => a.position - b.position);
    const index = queued.findIndex((task) => task.taskId === taskId);
    if (index < 0) return;
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= queued.length) return;

    const reordered = [...queued];
    const [task] = reordered.splice(index, 1);
    reordered.splice(swapIndex, 0, task);

    setBusy(true);
    try {
      await reorderQueue(selectedQueueId ?? selectedPipelineId ?? "", reordered.map((item) => item.taskId), selectedUserId);
      setActionMessage("Queue order updated.");
      setActionTone("accent");
      await refreshSelectedQueueTasks();
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleQueueAction(action: "pause" | "resume") {
    if (!selectedQueue) return;
    setBusy(true);
    try {
      const result = await controlQueue(selectedQueue.queueId, action, selectedUserId);
      setActionMessage(`Queue ${result.queue.name} ${action}d.`);
      setActionTone("success");
      await refreshLibrary(selectedUserId);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleRunAction(action: "pause" | "resume" | "cancel" | "retry") {
    if (!selectedRunId) return;
    setBusy(true);
    try {
      const result = await controlRun(selectedRunId, action, selectedUserId);
      setActionMessage(result.message ?? `${action} accepted.`);
      setActionTone("success");
      await refreshLibrary(selectedUserId);
      if (action === "retry") {
        selectRunContext(result.run);
      }
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateUser() {
    const id = newUserId.trim();
    if (!id) return;
    setBusy(true);
    try {
      const response = await fetch("/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          workspacePath: newUserWorkspacePath.trim() || undefined,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; error?: string; user?: UserProfile };
      if (!response.ok) {
        throw new Error(result.error ?? `Request failed with status ${response.status}`);
      }
      const nextUserId = result.user?.id ?? id;
      setActionMessage(`User ${nextUserId} created.`);
      setActionTone("success");
      setNewUserId("");
      setNewUserWorkspacePath("");
      setSelectedUserId(nextUserId);
      await refreshLibrary(nextUserId);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : String(error));
      setActionTone("danger");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (graphMode !== "draft") return;
      if (shouldIgnoreShortcutTarget(event.target)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selectedEditorNodeId && selectedEditorEdgeIndex == null) return;
        event.preventDefault();
        event.stopPropagation();
        removeSelectedDraftSelection();
        return;
      }

      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
      ) {
        if (!selectedEditorNodeId) return;
        event.preventDefault();
        event.stopPropagation();
        moveSelectedDraftNodeWithKeyboard(event.key);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [draft, graphMode, selectedEditorEdgeIndex, selectedEditorNodeId]);

  return (
    <div className="studio-shell">
      <header className="studio-hero">
        <div>
          <p className="eyebrow">AgentraLoop Studio</p>
          <h1>{pageTitle} Page</h1>
          <p className="hero-copy">{pageDescription}</p>
          <div className="studio-nav" role="tablist" aria-label="Studio pages">
            <button type="button" className={studioPage === "runtime" ? "active" : ""} onClick={() => setStudioPage("runtime")}>
              Runtime
            </button>
            <button type="button" className={studioPage === "create" ? "active" : ""} onClick={() => setStudioPage("create")}>
              Create
            </button>
            <button type="button" className={studioPage === "editor" ? "active" : ""} onClick={() => setStudioPage("editor")}>
              Editor
            </button>
            <button type="button" className={studioPage === "queue" ? "active" : ""} onClick={() => setStudioPage("queue")}>
              Queue
            </button>
            <button type="button" className={studioPage === "history" ? "active" : ""} onClick={() => setStudioPage("history")}>
              History
            </button>
            <button type="button" className={studioPage === "users" ? "active" : ""} onClick={() => setStudioPage("users")}>
              Users
            </button>
          </div>
        </div>
        <div className="hero-status">
          <Badge tone={actionTone as "neutral" | "success" | "warning" | "danger" | "accent"}>
            {actionMessage}
          </Badge>
          <div className="meta-stack">
            <span>User: {selectedUserId}</span>
            <span>DB: {health?.databasePath ?? "loading"}</span>
            <span>Workspace default: {health?.pipelineCwd ?? "."}</span>
          </div>
        </div>
      </header>

      <main className={`studio-layout page-${studioPage}`}>
        <Panel className="library-panel">
          <PanelHeader
            title={
              studioPage === "editor"
                ? "Pipelines"
                : studioPage === "create" || studioPage === "queue"
                  ? "Pipeline Catalog"
                  : studioPage === "runtime"
                    ? "Active Runs"
                    : studioPage === "history"
                      ? "History Browser"
                      : "Users"
            }
            actions={
              <Button variant="ghost" size="compact" onClick={() => void refreshLibrary()}>
                Refresh
              </Button>
            }
          />
          {studioPage === "users" ? (
            <div className="page-library-stack">
              <div>
                <div className="subhead">
                  <h3>User Scopes</h3>
                  <span>{users.length}</span>
                </div>
                <div className="card-list">
                  {users.map((user) => (
                    <button
                      key={user.id}
                      className={`list-card ${selectedUserId === user.id ? "selected" : ""}`}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <strong>{user.id}</strong>
                      <span>{user.isAdmin ? "admin" : "user"}</span>
                      <small>{user.workspacePath}</small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : studioPage === "editor" || studioPage === "create" || studioPage === "queue" ? (
            <div className="page-library-stack">
              <div>
                <div className="subhead">
                  <h3>Pipelines</h3>
                  <span>{pipelines.length}</span>
                </div>
                <div className="card-list">
                  {pipelines.map((item) => (
                    <button
                      key={item.summary.id}
                      className={`list-card ${selectedPipelineId === item.summary.id ? "selected" : ""}`}
                      onClick={() => selectPipelineContext(item.summary.id)}
                    >
                      <strong>{item.summary.name}</strong>
                      <span>{item.summary.id}</span>
                      <small>
                        {item.summary.nodeCount} nodes · {item.summary.edgeCount} edges
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : studioPage === "runtime" ? (
            <div className="page-library-stack">
              {selectedPipelineDetail ? (
                <div className="empty-note">
                  <strong>{selectedPipelineDetail.summary.name}</strong>
                  <div>{selectedPipelineDetail.summary.id}</div>
                  <small>
                    {selectedPipelineDetail.summary.nodeCount} nodes · {selectedPipelineDetail.summary.edgeCount} edges
                  </small>
                </div>
              ) : null}
              <div>
                <div className="subhead">
                  <h3>My Active Runs</h3>
                  <span>{activeRuns.length}</span>
                </div>
                <div className="card-list">
                  {activeRuns.map((item) => (
                    <button
                      key={item.runId}
                      className={`list-card ${selectedRunId === item.runId ? "selected" : ""}`}
                      onClick={() => selectRunContext(item)}
                    >
                      <strong>{item.pipelineName}</strong>
                      <span>{item.runId}</span>
                      <small className={`tone-${statusTone(item.status)}`}>{item.status}</small>
                    </button>
                  ))}
                  {activeRuns.length === 0 ? <div className="empty-note">No active runs for this user.</div> : null}
                </div>
              </div>
              {selectedUserId === "admin" ? (
                <div>
                  <div className="subhead">
                    <h3>Global Active Runs</h3>
                    <span>{activeGlobalRuns.length}</span>
                  </div>
                  <div className="card-list">
                    {activeGlobalRuns.map((item) => (
                      <button
                        key={`${item.user.id}-${item.runId}`}
                        className={`list-card ${selectedRunId === item.runId ? "selected" : ""}`}
                        onClick={() => {
                          setPendingRunSelection({ userId: item.user.id, runId: item.runId });
                          setSelectedUserId(item.user.id);
                        }}
                      >
                        <strong>{item.pipelineName}</strong>
                        <span>{item.user.id}</span>
                        <small className={`tone-${statusTone(item.status)}`}>{item.status}</small>
                      </button>
                    ))}
                    {activeGlobalRuns.length === 0 ? <div className="empty-note">No active runs across users.</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="page-library-stack">
              <div>
                <div className="subhead">
                  <h3>My Terminal Runs</h3>
                  <span>{terminalRuns.length}</span>
                </div>
                <div className="card-list">
                  {terminalRuns.map((item) => (
                    <button
                      key={item.runId}
                      className={`list-card ${selectedRunId === item.runId ? "selected" : ""}`}
                      onClick={() => selectRunContext(item)}
                    >
                      <strong>{item.pipelineName}</strong>
                      <span>{item.runId}</span>
                      <small className={`tone-${statusTone(item.status)}`}>{item.status}</small>
                    </button>
                  ))}
                  {terminalRuns.length === 0 ? <div className="empty-note">No completed, failed, or canceled runs yet.</div> : null}
                </div>
              </div>
              {selectedUserId === "admin" ? (
                <div>
                  <div className="subhead">
                    <h3>Global History</h3>
                    <span>{terminalGlobalRuns.length}</span>
                  </div>
                  <div className="card-list">
                    {terminalGlobalRuns.map((item) => (
                      <button
                        key={`${item.user.id}-${item.runId}`}
                        className={`list-card ${selectedRunId === item.runId ? "selected" : ""}`}
                        onClick={() => {
                          setPendingRunSelection({ userId: item.user.id, runId: item.runId });
                          setSelectedUserId(item.user.id);
                        }}
                      >
                        <strong>{item.pipelineName}</strong>
                        <span>{item.user.id}</span>
                        <small className={`tone-${statusTone(item.status)}`}>{item.status}</small>
                      </button>
                    ))}
                    {terminalGlobalRuns.length === 0 ? <div className="empty-note">No terminal runs across users yet.</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </Panel>

        {studioPage === "runtime" ? (
        <Panel className="control-panel">
          <PanelHeader
            title="Queue Runtime"
            actions={
              selectedQueue ? (
                <Badge tone={selectedQueue.status === "active" ? "success" : "warning"}>
                  {selectedQueue.status}
                </Badge>
              ) : null
            }
          />
          <div className="control-shell">
            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Queue Summary</h3>
                <small className="muted-copy">{selectedQueue?.name ?? "Select an active run or pipeline"}</small>
              </div>
              <div className="inspector-selection-strip">
                <div className="inspector-selection-chip primary">
                  <span>Queue</span>
                  <strong>{selectedQueue?.queueId ?? "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Status</span>
                  <strong>{selectedQueue?.status ?? "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Total</span>
                  <strong>{queueRuntimeStats.total}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Running</span>
                  <strong>{queueRuntimeStats.running}</strong>
                </div>
              </div>
              <div className="inspector-selection-strip">
                <div className="inspector-selection-chip">
                  <span>Queued</span>
                  <strong>{queueRuntimeStats.queued}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Completed</span>
                  <strong>{queueRuntimeStats.completed}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Failed</span>
                  <strong>{queueRuntimeStats.failed}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Canceled</span>
                  <strong>{queueRuntimeStats.canceled}</strong>
                </div>
              </div>
            </section>

            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Current Task</h3>
                <small className="muted-copy">Currently running or selected run-linked task</small>
              </div>
              {runtimeFocusTask ? (
                <div className="list-card selected">
                  <strong>{runtimeFocusTask.title}</strong>
                  <span>{runtimeFocusTask.taskId}</span>
                  <small className={`tone-${statusTone(runtimeFocusTask.status)}`}>{runtimeFocusTask.status}</small>
                  <small>{runtimeFocusTask.runId ? `run ${runtimeFocusTask.runId}` : "Awaiting run assignment"}</small>
                </div>
              ) : (
                <div className="empty-note">No active task is currently associated with this queue.</div>
              )}
            </section>

            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Next Task</h3>
                <small className="muted-copy">Next queued task that will run after the current one finishes</small>
              </div>
              {nextQueuedTask ? (
                <div className="list-card">
                  <strong>{nextQueuedTask.title}</strong>
                  <span>{nextQueuedTask.taskId}</span>
                  <small>position #{nextQueuedTask.position}</small>
                </div>
              ) : (
                <div className="empty-note">No queued follow-up task for this pipeline.</div>
              )}
            </section>

            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Latest Result</h3>
                <small className="muted-copy">Most recent terminal task result for this queue</small>
              </div>
              {latestTerminalTask ? (
                <div className="list-card">
                  <strong>{latestTerminalTask.title}</strong>
                  <span>{latestTerminalTask.taskId}</span>
                  <small className={`tone-${statusTone(latestTerminalTask.status)}`}>{latestTerminalTask.status}</small>
                  <small>{latestTerminalTask.finishedAt ? `finished ${formatWhen(latestTerminalTask.finishedAt)}` : "terminal"}</small>
                </div>
              ) : (
                <div className="empty-note">No terminal tasks have completed in this queue yet.</div>
              )}
            </section>

            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Run Controls</h3>
                <small className="muted-copy">Control the selected run from the active runs list.</small>
              </div>
              <div className="button-row">
                <Button onClick={() => void handleRunAction("pause")} disabled={busy || !selectedRunId}>Pause</Button>
                <Button onClick={() => void handleRunAction("resume")} disabled={busy || !selectedRunId}>Resume</Button>
                <Button variant="danger" onClick={() => void handleRunAction("cancel")} disabled={busy || !selectedRunId}>Cancel</Button>
                <Button variant="ghost" onClick={() => void handleRunAction("retry")} disabled={busy || !selectedRunId}>Retry</Button>
              </div>
              <small className="muted-copy">Use the Create page to enqueue new work into this queue.</small>
            </section>
          </div>
        </Panel>
        ) : null}

        {studioPage === "create" ? (
        <Panel className="control-panel">
          <PanelHeader
            title="Create Queued Task"
            actions={
              <Badge tone={unavailableProviders.length > 0 ? "danger" : "success"}>
              {unavailableProviders.length > 0 ? `Blocked: ${unavailableProviders.join(", ")}` : "Providers ready"}
              </Badge>
            }
          />
          <div className="control-shell">
            <section className="control-form-card">
              <div className="form-grid">
                <label htmlFor="run-user-id">
                  <span>User</span>
                  <select id="run-user-id" name="runUserId" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.id}{user.isAdmin ? " (admin)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="run-pipeline-id">
                  <span>Pipeline</span>
                  <select id="run-pipeline-id" name="runPipelineId" value={selectedPipelineId ?? ""} onChange={(e) => selectPipelineContext(e.target.value)}>
                    {pipelines.map((item) => (
                      <option key={item.summary.id} value={item.summary.id}>
                        {item.summary.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="run-pipeline-cwd">
                  <span>Workspace</span>
                  <input
                    id="run-pipeline-cwd"
                    name="runPipelineCwd"
                    value={pipelineCwd}
                    onChange={(e) => {
                      pipelineCwdDirtyRef.current = true;
                      setPipelineCwd(e.target.value);
                    }}
                  />
                </label>
                <label htmlFor="run-model-profile">
                  <span>Profile</span>
                  <select id="run-model-profile" name="runModelProfile" value={modelProfile} onChange={(e) => setModelProfile(e.target.value as "fast" | "standard")}>
                    <option value="standard">standard</option>
                    <option value="fast">fast</option>
                  </select>
                </label>
                <label htmlFor="run-task-title" className="field-span-full">
                  <span>Task Title</span>
                  <input
                    id="run-task-title"
                    name="runTaskTitle"
                    placeholder="Short task name for this run."
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                  />
                </label>
                <label htmlFor="run-task-prompt" className="field-span-full">
                  <span>Task Prompt</span>
                  <textarea
                    id="run-task-prompt"
                    name="runTaskPrompt"
                    rows={4}
                    placeholder="Describe the current task, bug, or work item for this run."
                    value={taskPrompt}
                    onChange={(e) => setTaskPrompt(e.target.value)}
                  />
                  <small className="muted-copy">Available inside node prompts as <code>{"{{run.taskTitle}}"}</code> and <code>{"{{run.taskPrompt}}"}</code>.</small>
                </label>
              </div>
              <div className="inspector-selection-strip run-context-preview">
                <div className="inspector-selection-chip primary">
                  <span>Workspace Preview</span>
                  <strong>{pipelineCwd || "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Branch</span>
                  <strong>{workspaceContext?.branch ?? "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Remote</span>
                  <strong>{workspaceContext?.repoUrl ?? "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Commits</span>
                  <strong>{workspaceContext?.recentCommits?.length ?? 0}</strong>
                </div>
              </div>
              <div className="button-row">
                <Button onClick={() => void handleCreateTask()} disabled={busy || !selectedPipelineId || unavailableProviders.length > 0 || !taskPrompt.trim()}>
                  Enqueue Task
                </Button>
              </div>
            </section>
            <section className="control-provider-card">
              <div className="control-provider-head">
                <h3>Provider Status</h3>
                <small className="muted-copy">Preflight availability</small>
              </div>
              <div className="provider-grid">
                {health &&
                  Object.entries(health.providerAvailability).map(([provider, availability]) => (
                    <article key={provider} className="provider-card">
                      <div className="provider-card-head">
                        <strong>{provider}</strong>
                        <small className={`tone-${availability.available ? "success" : "danger"}`}>
                          {availability.available ? "available" : "unavailable"}
                        </small>
                      </div>
                      <p><strong>Lifecycle:</strong> {availability.lifecycleMode}</p>
                      <p>{availability.details ?? "No details."}</p>
                    </article>
                  ))}
              </div>
            </section>
          </div>
        </Panel>
        ) : null}

        {studioPage === "queue" ? (
        <Panel className="control-panel">
          <PanelHeader
            title="Queue Editor"
            actions={
              selectedQueue ? (
                <Badge tone={selectedQueue.status === "active" ? "success" : "warning"}>
                  {selectedQueue.status}
                </Badge>
              ) : null
            }
          />
          <div className="control-shell">
            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Current Task</h3>
                <div className="button-row compact">
                  <Button variant="ghost" size="compact" onClick={() => void refreshSelectedQueueTasks()} disabled={busy || !selectedQueue}>
                    Refresh Queue
                  </Button>
                  <Button size="compact" onClick={() => void handleQueueAction("pause")} disabled={busy || !selectedQueue || selectedQueue.status !== "active"}>
                    Pause Queue
                  </Button>
                  <Button size="compact" variant="ghost" onClick={() => void handleQueueAction("resume")} disabled={busy || !selectedQueue || selectedQueue.status !== "paused"}>
                    Resume Queue
                  </Button>
                </div>
              </div>
              {runningQueueTask ? (
                <div className="list-card selected">
                  <strong>{runningQueueTask.title}</strong>
                  <span>{runningQueueTask.taskId}</span>
                  <small>Running · linked run {runningQueueTask.runId ?? "pending"}</small>
                </div>
              ) : (
                <div className="empty-note">No running task in this queue.</div>
              )}
            </section>

            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Queued Tasks</h3>
                <small className="muted-copy">{queuedQueueTasks.length} queued</small>
              </div>
              <div className="card-list">
                {queuedQueueTasks.map((task, index) => (
                  <article
                    key={task.taskId}
                    className={`edge-card ${selectedQueueTaskId === task.taskId ? "selected" : ""}`}
                  >
                    <button type="button" className="queue-task-select" onClick={() => setSelectedQueueTaskId(task.taskId)}>
                      <strong>{task.title}</strong>
                      <span>{task.taskId}</span>
                      <small>#{task.position}</small>
                    </button>
                    <div className="button-row compact">
                      <Button size="compact" variant="ghost" onClick={() => void handleQueueMove(task.taskId, "up")} disabled={busy || index === 0}>Up</Button>
                      <Button size="compact" variant="ghost" onClick={() => void handleQueueMove(task.taskId, "down")} disabled={busy || index === queuedQueueTasks.length - 1}>Down</Button>
                      <Button size="compact" variant="danger" onClick={() => void handleQueueTaskDelete(task.taskId)} disabled={busy}>Remove</Button>
                    </div>
                  </article>
                ))}
                {queuedQueueTasks.length === 0 ? <div className="empty-note">No queued tasks for this pipeline.</div> : null}
              </div>
            </section>

            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>{editableQueueTask ? "Edit Queued Task" : "Insert Task"}</h3>
                {editableQueueTask ? <Badge tone="accent">{editableQueueTask.taskId}</Badge> : null}
              </div>
              <div className="form-grid">
                <label htmlFor="queue-task-title" className="field-span-full">
                  <span>Task Title</span>
                  <input
                    id="queue-task-title"
                    name="queueTaskTitle"
                    value={queueTaskTitle}
                    onChange={(e) => setQueueTaskTitle(e.target.value)}
                    placeholder="Short task title"
                  />
                </label>
                <label htmlFor="queue-task-prompt" className="field-span-full">
                  <span>Task Prompt</span>
                  <textarea
                    id="queue-task-prompt"
                    name="queueTaskPrompt"
                    rows={6}
                    value={queueTaskPrompt}
                    onChange={(e) => setQueueTaskPrompt(e.target.value)}
                    placeholder="Describe the queued work for this pipeline."
                  />
                </label>
              </div>
              <div className="button-row">
                <Button
                  onClick={() =>
                    editableQueueTask ? void handleQueueTaskSave() : void handleInsertQueueTask()
                  }
                  disabled={busy || !selectedPipelineId || !queueTaskPrompt.trim()}
                >
                  {editableQueueTask ? "Save Task" : "Insert Task"}
                </Button>
                {editableQueueTask ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSelectedQueueTaskId(null);
                      setQueueTaskTitle("");
                      setQueueTaskPrompt("");
                    }}
                    disabled={busy}
                  >
                    Clear Selection
                  </Button>
                ) : null}
              </div>
            </section>
          </div>
        </Panel>
        ) : null}

        {studioPage === "history" ? (
        <Panel className="control-panel">
          <PanelHeader
            title="Task History"
            actions={
              <Badge tone="accent">
                {terminalQueueTasks.length} terminal
              </Badge>
            }
          />
          <div className="control-shell">
            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Pipeline Queue</h3>
                <small className="muted-copy">{selectedPipelineDetail?.summary.name ?? "No pipeline selected"}</small>
              </div>
              <div className="inspector-selection-strip">
                <div className="inspector-selection-chip primary">
                  <span>Queue</span>
                  <strong>{selectedQueue?.name ?? "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Status</span>
                  <strong>{selectedQueue?.status ?? "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Terminal Tasks</span>
                  <strong>{terminalQueueTasks.length}</strong>
                </div>
              </div>
            </section>

            <section className="control-form-card">
              <div className="control-provider-head">
                <h3>Terminal Tasks</h3>
                <small className="muted-copy">Click a task to open its linked run.</small>
              </div>
              <div className="card-list">
                {terminalQueueTasks.map((task) => (
                  <button
                    key={task.taskId}
                    className={`list-card ${selectedRunLinkedTask?.taskId === task.taskId ? "selected" : ""}`}
                    onClick={() => selectTaskHistoryContext(task)}
                  >
                    <strong>{task.title}</strong>
                    <span>{task.taskId}</span>
                    <small className={`tone-${statusTone(task.status)}`}>{task.status}</small>
                    <small>{task.runId ? `run ${task.runId}` : "No linked run"}</small>
                    <small>{formatWhen(task.finishedAt ?? task.updatedAt)}</small>
                  </button>
                ))}
                {terminalQueueTasks.length === 0 ? (
                  <div className="empty-note">No completed, failed, or canceled tasks for this pipeline queue yet.</div>
                ) : null}
              </div>
            </section>
          </div>
        </Panel>
        ) : null}

        {studioPage === "users" ? (
        <Panel className="control-panel">
          <PanelHeader
            title="User Management"
            actions={<Badge tone={selectedUserId === "admin" ? "accent" : "neutral"}>{selectedUserId}</Badge>}
          />
          <div className="control-shell">
            <section className="control-form-card">
              <div className="form-grid">
                <label htmlFor="scope-user-id">
                  <span>Current Scope</span>
                  <select id="scope-user-id" name="scopeUserId" value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.id}{user.isAdmin ? " (admin)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="selected-user-workspace">
                  <span>Workspace</span>
                  <input
                    id="selected-user-workspace"
                    name="selectedUserWorkspace"
                    value={users.find((user) => user.id === selectedUserId)?.workspacePath ?? ""}
                    readOnly
                  />
                </label>
                <label htmlFor="selected-user-data-dir">
                  <span>Data Dir</span>
                  <input
                    id="selected-user-data-dir"
                    name="selectedUserDataDir"
                    value={users.find((user) => user.id === selectedUserId)?.dataDir ?? ""}
                    readOnly
                  />
                </label>
                <label htmlFor="selected-user-logs-dir">
                  <span>Logs Dir</span>
                  <input
                    id="selected-user-logs-dir"
                    name="selectedUserLogsDir"
                    value={users.find((user) => user.id === selectedUserId)?.logsDir ?? ""}
                    readOnly
                  />
                </label>
              </div>
            </section>
            {selectedUserId === "admin" ? (
              <section className="control-form-card">
                <div className="form-grid admin-user-form">
                  <label htmlFor="new-user-id">
                    <span>New User ID</span>
                    <input id="new-user-id" name="newUserId" value={newUserId} onChange={(e) => setNewUserId(e.target.value)} placeholder="alice" />
                  </label>
                  <label htmlFor="new-user-workspace">
                    <span>Workspace Override</span>
                    <input id="new-user-workspace" name="newUserWorkspace" value={newUserWorkspacePath} onChange={(e) => setNewUserWorkspacePath(e.target.value)} placeholder="Optional absolute path" />
                  </label>
                  <div className="button-row">
                    <Button variant="ghost" onClick={() => void handleCreateUser()} disabled={busy || !newUserId.trim()}>
                      Create User
                    </Button>
                  </div>
                </div>
              </section>
            ) : (
              <section className="control-provider-card">
                <div className="control-provider-head">
                  <h3>Scope Notes</h3>
                  <small className="muted-copy">Current user separation only</small>
                </div>
                <div className="empty-note">
                  This page manages user-scoped workspace, data, logs, and pipeline directories. Detailed permission control is intentionally deferred.
                </div>
              </section>
            )}
          </div>
        </Panel>
        ) : null}

        <Panel className="canvas-panel">
          <PanelHeader title={studioPage === "users" ? "User Overview" : "Canvas"} />
          {studioPage === "users" ? (
            <div className="user-overview-grid">
              <article className="overview-summary-card">
                <span>User ID</span>
                <strong>{selectedUserProfile?.id ?? "n/a"}</strong>
              </article>
              <article className="overview-summary-card">
                <span>Role</span>
                <strong>{selectedUserProfile?.isAdmin ? "admin" : "user"}</strong>
              </article>
              <article className="overview-summary-card">
                <span>Workspace</span>
                <strong>{selectedUserProfile?.workspacePath ?? "n/a"}</strong>
              </article>
              <article className="overview-summary-card">
                <span>Data</span>
                <strong>{selectedUserProfile?.dataDir ?? "n/a"}</strong>
              </article>
              <article className="overview-summary-card">
                <span>Logs</span>
                <strong>{selectedUserProfile?.logsDir ?? "n/a"}</strong>
              </article>
              <article className="overview-summary-card">
                <span>Pipelines</span>
                <strong>{selectedUserProfile?.pipelineDir ?? "n/a"}</strong>
              </article>
            </div>
          ) : (
          <>
          <div className={`canvas-toolbar ${graphMode === "draft" ? "is-draft" : ""}`}>
            <div className="canvas-toolbar-top">
              <div className="canvas-mode-switch">
                <span className="canvas-mode-label">Page</span>
                <Badge tone={studioPage === "editor" ? "accent" : studioPage === "runtime" ? "success" : studioPage === "queue" ? "warning" : "warning"}>
                  {pageTitle}
                </Badge>
              </div>
              <div className="canvas-summary-strip">
                <div className="canvas-summary-chip">
                  <span>Mode</span>
                  <strong>{currentModeLabel}</strong>
                </div>
                <div className="canvas-summary-chip">
                  <span>Graph</span>
                  <strong>{currentGraphLabel}</strong>
                </div>
                <div className="canvas-summary-chip">
                  <span>Focus</span>
                  <strong>{currentContextFocusLabel}</strong>
                </div>
                <div className="canvas-summary-chip">
                  <span>State</span>
                  <strong>{currentStateLabel}</strong>
                </div>
                {graphMode === "draft" && recentDraftChange ? (
                  <div className={`canvas-summary-chip recent-change-card tone-${recentDraftChange.tone}`}>
                    <span>{recentDraftChange.label}</span>
                    <strong>{recentDraftChange.value}</strong>
                  </div>
                ) : null}
              </div>
            </div>
            {graphMode === "draft" ? (
              <div className="canvas-actions-grid">
                <div className="canvas-action-group">
                  <span className="canvas-action-group-label">Add</span>
                  <div className="button-row compact">
                    <Button variant="ghost" size="compact" onClick={addNode}>Quick Add Node</Button>
                    <Button variant="ghost" size="compact" onClick={handleResetLayout}>Reset Layout</Button>
                  </div>
                </div>
                <div className="canvas-action-group">
                  <span className="canvas-action-group-label">Panels</span>
                  <div className="button-row compact">
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => setShowQuickJump((current) => !current)}
                    >
                      {showQuickJump ? "Hide Quick Jump" : "Show Quick Jump"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="compact"
                      onClick={() => setShowSupportTools((current) => !current)}
                    >
                      {showSupportTools ? "Hide Support Tools" : "Show Support Tools"}
                    </Button>
                  </div>
                </div>
                <div className="canvas-action-group">
                  <span className="canvas-action-group-label">Edit</span>
                  <div className="button-row compact">
                    {!connectSourceNodeId && selectedEditorNode ? (
                      <Button variant="ghost" size="compact" onClick={beginConnectionFromSelectedNode}>Connect From Node</Button>
                    ) : null}
                    {connectSourceNodeId ? (
                      <Button variant="ghost" size="compact" onClick={cancelConnectionMode}>Cancel Connection</Button>
                    ) : null}
                    {selectedEditorEdge ? (
                      <Button variant="danger" size="compact" onClick={removeSelectedDraftSelection}>Delete Edge</Button>
                    ) : null}
                    {!selectedEditorEdge && selectedEditorNode ? (
                      <Button variant="danger" size="compact" onClick={removeSelectedDraftSelection}>Delete Node</Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            {canvasActivityItems.length > 0 ? (
              <div className="canvas-activity-strip">
                {canvasActivityItems.map((item) => (
                  <div
                    key={item.key}
                    className={`canvas-activity-pill ${item.tone ? `tone-${item.tone}` : ""}`}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="canvas-hint">
              {graphMode === "draft"
                ? "Drag node headers. Right-drag canvas. Connect OUT to IN."
                : graphMode === "run"
                  ? "Inspect run state, graph status, and timeline."
                  : "Review the saved pipeline graph. Switch to Draft to edit."}
            </p>
          </div>
          <div className="canvas-wrap">
            {currentGraph ? (
              <ReteDraftEditor
                graph={currentGraph}
                editable={graphMode === "draft"}
                selectedNodeId={graphMode === "draft" ? selectedEditorNodeId : selectedGraphNodeId}
                onSelectNode={handleCanvasNodeActivate}
                onNodeMove={graphMode === "draft" ? commitDraftNodeMove : undefined}
                onConnect={graphMode === "draft" ? addEdgeConnection : undefined}
              />
            ) : null}
          </div>
          </>
          )}
        </Panel>
        {studioPage === "editor" ? (
        <Panel className="editor-panel">
          <PanelHeader
            title="Graph Workbench"
            actions={
            <div className="button-row compact">
              <Button
                variant="ghost"
                size="compact"
                onClick={handleLoadDraft}
              >
                Load Draft
              </Button>
              <Button variant="ghost" size="compact" onClick={() => void handleValidate()} disabled={busy || !draft}>Validate</Button>
              <Button size="compact" onClick={() => void handleSave()} disabled={busy || !draft || !draftDirty}>Save</Button>
            </div>
            }
          />
          {draft ? (
            <div className="editor-workbench editor-shell">
              <section className="editor-overview">
                <div className="editor-focus-row">
                  <Badge tone={graphMode === "draft" ? "accent" : "neutral"}>{currentModeLabel}</Badge>
                  <Badge tone={graphMode === "draft" && draftDirty ? "warning" : "neutral"}>{currentStateLabel}</Badge>
                  <span>{editorFocusLabel}</span>
                </div>
                <div className="overview-summary-row mode-consistent">
                  <div className="overview-summary-card">
                    <span>Mode</span>
                    <strong>{currentModeLabel}</strong>
                  </div>
                  <div className="overview-summary-card">
                    <span>Graph</span>
                    <strong>{currentGraphLabel}</strong>
                  </div>
                  <div className="overview-summary-card">
                    <span>State</span>
                    <strong>{currentStateLabel}</strong>
                  </div>
                </div>
                <div className="overview-summary-row">
                  <div className="overview-summary-card">
                    <span>Pipeline ID</span>
                    <strong>{draft.pipeline.id}</strong>
                  </div>
                  <div className="overview-summary-card">
                    <span>Graph</span>
                    <strong>{draft.graph.nodes.length} nodes · {draft.graph.edges.length} edges</strong>
                  </div>
                  <div className="overview-summary-card">
                    <span>Entry</span>
                    <strong>{draft.pipeline.entryNodeId || "n/a"}</strong>
                  </div>
                </div>
                <label htmlFor="draft-pipeline-name">
                  <span>Name</span>
                  <input
                    id="draft-pipeline-name"
                    name="draftPipelineName"
                    value={draft.pipeline.name}
                    onChange={(e) => updateDraft((next) => { next.pipeline.name = e.target.value; })}
                  />
                </label>
                <details className="editor-overview-details">
                  <summary>Pipeline Notes</summary>
                  <label htmlFor="draft-pipeline-description">
                    <span>Description</span>
                    <textarea id="draft-pipeline-description" name="draftPipelineDescription" rows={3} value={draft.pipeline.description ?? ""} onChange={(e) => updateDraft((next) => { next.pipeline.description = e.target.value; })} />
                  </label>
                </details>
              </section>

              <div className={`editor-layout ${showQuickJump ? "" : "no-sidebar"}`}>
                {showQuickJump ? (
                  <aside className="editor-sidebar">
                    <details className="quick-jump-panel" open>
                      <summary>
                        <span>Quick Jump</span>
                        <small>
                          {selectedEditorNode
                            ? selectedEditorNode.name
                            : selectedEditorEdge
                              ? formatDraftEdgeLabel(selectedEditorEdge.from, selectedEditorEdge.to)
                              : `${draft.graph.nodes.length} nodes`}
                        </small>
                      </summary>
                      <p className="muted-copy">
                        Navigation only. Use the canvas toolbar for structure changes and the Inspector for property edits.
                      </p>
                      <div className="chip-list editor-chip-list">
                        {draft.graph.nodes.map((node) => (
                          <button
                            key={node.id}
                            className={`chip ${selectedEditorNodeId === node.id || selectedGraphNodeId === node.id ? "selected" : ""}`}
                            onClick={() => selectDraftNode(node.id)}
                          >
                            <span className="chip-title">{node.name}</span>
                            <small>{node.id}</small>
                          </button>
                        ))}
                      </div>
                    </details>
                  </aside>
                ) : null}

                <div className="editor-main">
                  <div className="editor-node-card editor-guidance-strip">
                  <div className="editor-guidance-chip">
                    <span>Selection</span>
                    <strong>{editorFocusLabel}</strong>
                  </div>
                  <div className="editor-guidance-chip">
                    <span>Position</span>
                    <strong>{currentSelectionPositionLabel}</strong>
                  </div>
                  <p className="muted-copy">Structure on canvas. Properties on the right.</p>
                </div>

                  <section className="editor-support">
                    {showSupportTools ? (
                      <details className="editor-support-shell" open>
                        <summary>
                          <span>Support Tools</span>
                          <small>Fallback only</small>
                        </summary>
                        <div className="editor-support-stack">
                          <details className="editor-support-card edge-tools-panel">
                            <summary>
                              <span>Fallback Edge Tools</span>
                              <small>{draft.graph.edges.length} edges</small>
                            </summary>
                            <div className="edge-tools-body">
                              <div className="subhead">
                                <p className="muted-copy">
                                  Canvas connections are the primary editing path. Use these controls only for precise cleanup and fallback edge editing.
                                </p>
                                <div className="button-row compact">
                                  {selectedEditorEdge ? <Badge tone="accent">{formatDraftEdgeLabel(selectedEditorEdge.from, selectedEditorEdge.to)}</Badge> : null}
                                  <Button variant="ghost" size="compact" onClick={addEdge}>Add Edge</Button>
                                </div>
                              </div>
                              <div className="field-grid">
                                <label htmlFor="draft-edge-from"><span>From</span><select id="draft-edge-from" name="draftEdgeFrom" value={edgeFrom} onChange={(e) => setEdgeFrom(e.target.value)}><option value="">Select node</option>{draft.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
                                <label htmlFor="draft-edge-to"><span>To</span><select id="draft-edge-to" name="draftEdgeTo" value={edgeTo} onChange={(e) => setEdgeTo(e.target.value)}><option value="">Select node</option>{draft.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
                              </div>
                              <div className="edge-list edge-scroll">
                                {draft.graph.edges.map((edge, index) => (
                                  <article
                                    key={`${edge.from}-${edge.to}-${index}`}
                                    className={`edge-card ${selectedEditorEdgeIndex === index || selectedGraphEdgeId === `draft-edge-${index}` ? "selected" : ""}`}
                                  >
                                    <div><strong>{edge.from} → {edge.to}</strong></div>
                                    <div className="button-row compact">
                                      <Button
                                        variant="ghost"
                                        size="compact"
                                        onClick={() => selectDraftEdge(index, edge.from, edge.to)}
                                      >
                                        Select
                                      </Button>
                                      <Button variant="danger" size="compact" onClick={() => removeEdge(index)}>
                                        Remove
                                      </Button>
                                    </div>
                                  </article>
                                ))}
                              </div>
                            </div>
                          </details>

                          <details className="json-card advanced-json-panel">
                            <summary>Advanced JSON (Expert Only)</summary>
                            <p className="muted-copy">
                              Fallback only for export, debugging, or recovery. Prefer canvas structure edits and Inspector property edits.
                            </p>
                            <pre>{JSON.stringify(draft, null, 2)}</pre>
                          </details>
                        </div>
                      </details>
                    ) : null}
                  </section>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a pipeline to load an editable draft.</div>
          )}
        </Panel>
        ) : null}
        <Panel className="inspector-panel">
          <PanelHeader
            title={studioPage === "users" ? "User Details" : "Inspector"}
            actions={
              <Badge tone={statusTone(selectedRunSummary?.status) as "neutral" | "success" | "warning" | "danger" | "accent"}>
                {studioPage === "users"
                  ? selectedUserId
                  : studioPage === "editor"
                    ? currentStateLabel
                    : studioPage === "queue"
                      ? selectedQueue?.status ?? "queue"
                    : selectedRunSummary?.status ?? "selection"}
              </Badge>
            }
          />
          {studioPage === "users" ? (
            <>
              <div className="inspector-section-label">Context</div>
              <div className="inspector-block">
                <h3>User Scope</h3>
                <div className="inspector-context-strip">
                  <div className="inspector-context-chip">
                    <span>User</span>
                    <strong>{selectedUserProfile?.id ?? "n/a"}</strong>
                  </div>
                  <div className="inspector-context-chip">
                    <span>Role</span>
                    <strong>{selectedUserProfile?.isAdmin ? "admin" : "user"}</strong>
                  </div>
                  <div className="inspector-context-chip">
                    <span>Created</span>
                    <strong>{formatWhen(selectedUserProfile?.createdAt)}</strong>
                  </div>
                  <div className="inspector-context-chip">
                    <span>Updated</span>
                    <strong>{formatWhen(selectedUserProfile?.updatedAt)}</strong>
                  </div>
                </div>
              </div>
              <div className="inspector-block">
                <h3>Directories</h3>
                <div className="inspector-selection-strip">
                  <div className="inspector-selection-chip primary">
                    <span>Workspace</span>
                    <strong>{selectedUserProfile?.workspacePath ?? "n/a"}</strong>
                  </div>
                  <div className="inspector-selection-chip">
                    <span>Data</span>
                    <strong>{selectedUserProfile?.dataDir ?? "n/a"}</strong>
                  </div>
                  <div className="inspector-selection-chip">
                    <span>Logs</span>
                    <strong>{selectedUserProfile?.logsDir ?? "n/a"}</strong>
                  </div>
                  <div className="inspector-selection-chip">
                    <span>Pipelines</span>
                    <strong>{selectedUserProfile?.pipelineDir ?? "n/a"}</strong>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
          <div className="inspector-section-label">Context</div>
          <div className="inspector-block">
            <h3>Workbench Context</h3>
            <p className="inspector-context-title">{selectedPipelineDetail?.pipeline.name ?? "n/a"}</p>
            <div className="inspector-context-strip">
              <div className="inspector-context-chip">
                <span>Mode</span>
                <strong>{currentModeLabel}</strong>
              </div>
              <div className="inspector-context-chip">
                <span>Graph</span>
                <strong>{currentGraphLabel}</strong>
              </div>
              <div className="inspector-context-chip">
                <span>Focus</span>
                <strong>{currentContextFocusLabel}</strong>
              </div>
              <div className="inspector-context-chip">
                <span>State</span>
                <strong>{currentStateLabel}</strong>
              </div>
              {selectedRunDetail && (studioPage === "runtime" || studioPage === "history") ? (
                <>
                  <div className="inspector-context-chip">
                    <span>Run</span>
                    <strong>{selectedRunDetail.run.runId}</strong>
                  </div>
                  {selectedRunDetail.run.config.taskPrompt ? (
                    <div className="inspector-context-chip">
                      <span>Task</span>
                      <strong>Provided</strong>
                    </div>
                  ) : null}
                  {selectedRunDetail.run.config.taskTitle ? (
                    <div className="inspector-context-chip">
                      <span>Title</span>
                      <strong>{selectedRunDetail.run.config.taskTitle}</strong>
                    </div>
                  ) : null}
                  {selectedRunDetail.run.config.branch ? (
                    <div className="inspector-context-chip">
                      <span>Branch</span>
                      <strong>{selectedRunDetail.run.config.branch}</strong>
                    </div>
                  ) : null}
                  <div className="inspector-context-chip">
                    <span>Started</span>
                    <strong>{formatWhen(selectedRunDetail.run.startedAt)}</strong>
                  </div>
                </>
              ) : null}
            </div>
          </div>
          {selectedRunDetail && (studioPage === "runtime" || studioPage === "history") ? (
            <div className="inspector-block">
              <h3>Repository Context</h3>
              <div className="inspector-selection-strip">
                <div className="inspector-selection-chip primary">
                  <span>Workspace</span>
                  <strong>{selectedRunDetail.run.config.pipelineCwd}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Branch</span>
                  <strong>{selectedRunDetail.run.config.branch ?? "n/a"}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Remote</span>
                  <strong>{selectedRunDetail.run.config.repoUrl ?? "n/a"}</strong>
                </div>
              </div>
              <details className="property-group property-group-collapsible" open>
                <summary className="property-group-summary">
                  <div className="property-group-head">
                    <span>Recent Commits</span>
                    <small>{selectedRunDetail.run.config.recentCommits?.length ?? 0} entries</small>
                  </div>
                </summary>
                <div className="property-group-body">
                  {selectedRunDetail.run.config.recentCommits && selectedRunDetail.run.config.recentCommits.length > 0 ? (
                    <div className="commit-history-list">
                      {selectedRunDetail.run.config.recentCommits.map((commit) => (
                        <article key={commit.sha} className="edge-card">
                          <div><strong>{commit.summary}</strong></div>
                          <div className="muted-copy">{commit.sha.slice(0, 12)} · {formatWhen(commit.committedAt)}</div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="muted-copy">No commits recorded for this workspace yet.</p>
                  )}
                </div>
              </details>
            </div>
          ) : null}
          {selectedRunDetail && selectedRunLinkedTask && (studioPage === "runtime" || studioPage === "history") ? (
            <div className="inspector-block">
              <h3>Linked Task</h3>
              <div className="inspector-selection-strip">
                <div className="inspector-selection-chip primary">
                  <span>Title</span>
                  <strong>{selectedRunLinkedTask.title}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Status</span>
                  <strong>{selectedRunLinkedTask.status}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Queue</span>
                  <strong>{selectedRunLinkedTask.queueId}</strong>
                </div>
              </div>
              <details className="property-group property-group-collapsible" open>
                <summary className="property-group-summary">
                  <div className="property-group-head">
                    <span>Task Prompt</span>
                    <small>{selectedRunLinkedTask.taskId}</small>
                  </div>
                </summary>
                <div className="property-group-body">
                  <pre className="inspector-code-block">{selectedRunLinkedTask.prompt}</pre>
                </div>
              </details>
            </div>
          ) : null}
          <div className="inspector-block">
            <h3>Canvas Selection</h3>
            {activeGraphEdge ? (
              <div className="inspector-selection-strip">
                <div className="inspector-selection-chip primary">
                  <span>Edge</span>
                  <strong>{formatCurrentGraphEdgeLabel(activeGraphEdge.from, activeGraphEdge.to)}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>From</span>
                  <strong>{getCurrentGraphNodeDisplayName(activeGraphEdge.from)}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>To</span>
                  <strong>{getCurrentGraphNodeDisplayName(activeGraphEdge.to)}</strong>
                </div>
              </div>
            ) : activeGraphNode ? (
              <div className="inspector-selection-strip">
                <div className="inspector-selection-chip primary">
                  <span>Node</span>
                  <strong>{activeGraphNode.name}</strong>
                </div>
                <div className="inspector-selection-chip">
                  <span>Provider</span>
                  <strong>{activeGraphNode.provider}</strong>
                </div>
                {"position" in activeGraphNode ? (
                  <div className="inspector-selection-chip">
                    <span>Position</span>
                    <strong>
                      {activeGraphNode.position
                        ? `${Math.round(activeGraphNode.position.x)}, ${Math.round(activeGraphNode.position.y)}`
                        : "auto"}
                    </strong>
                  </div>
                ) : null}
                {"runtimeStatus" in activeGraphNode ? (
                  <div className="inspector-selection-chip">
                    <span>Status</span>
                    <strong>{activeGraphNode.runtimeStatus}</strong>
                  </div>
                ) : null}
              </div>
            ) : <p className="muted-copy">Select a node or edge in the canvas to inspect it here.</p>}
          </div>
          {graphMode === "run" && selectedRunNodeDetail && (studioPage === "runtime" || studioPage === "history") ? (
            <>
              <div className="inspector-section-label">Node Output</div>
              <div className="inspector-block">
                <h3>Run Node Output</h3>
                <div className="inspector-selection-strip">
                  <div className="inspector-selection-chip primary">
                    <span>Node</span>
                    <strong>{selectedRunNodeDetail.nodeName}</strong>
                  </div>
                  <div className="inspector-selection-chip">
                    <span>Provider</span>
                    <strong>{selectedRunNodeDetail.provider}</strong>
                  </div>
                  <div className="inspector-selection-chip">
                    <span>Model</span>
                    <strong>{selectedRunNodeDetail.model}</strong>
                  </div>
                </div>
                <details className="property-group property-group-collapsible" open>
                  <summary className="property-group-summary">
                    <div className="property-group-head">
                      <span>Prompt</span>
                      <small>Resolved node prompt</small>
                    </div>
                  </summary>
                  <div className="property-group-body">
                    <pre className="inspector-code-block">{selectedRunNodeDetail.prompt || "No prompt captured."}</pre>
                  </div>
                </details>
                <details className="property-group property-group-collapsible" open>
                  <summary className="property-group-summary">
                    <div className="property-group-head">
                      <span>Output Markdown</span>
                      <small>Agent result</small>
                    </div>
                  </summary>
                  <div className="property-group-body">
                    <pre className="inspector-code-block">{selectedRunNodeDetail.outputMarkdown || "No markdown output captured."}</pre>
                  </div>
                </details>
                <details className="property-group property-group-collapsible">
                  <summary className="property-group-summary">
                    <div className="property-group-head">
                      <span>Raw Output</span>
                      <small>Provider raw text</small>
                    </div>
                  </summary>
                  <div className="property-group-body">
                    <pre className="inspector-code-block">{selectedRunNodeDetail.rawOutput || "No raw output captured."}</pre>
                  </div>
                </details>
              </div>
            </>
          ) : null}
          {graphMode === "draft" ? (
            <>
            <div className="inspector-section-label">Editor</div>
            <div className="inspector-block inspector-block-editor">
              <h3>Draft Properties</h3>
              {selectedEditorNode ? (
                <div className="inspector-form">
                  <details className="property-group property-group-collapsible" open>
                    <summary className="property-group-summary">
                      <div className="property-group-head">
                        <span>Identity</span>
                        <Badge tone="accent">{selectedEditorNode.id}</Badge>
                      </div>
                    </summary>
                    <div className="property-group-body">
                      <div className="field-grid">
                        <label htmlFor="inspector-node-name"><span>Name</span><input id="inspector-node-name" name="inspectorNodeName" value={selectedEditorNode.name} onChange={(e) => updateSelectedDraftNode((node) => { node.name = e.target.value; })} /></label>
                        <label htmlFor="inspector-node-id"><span>Node ID</span><input id="inspector-node-id" name="inspectorNodeId" value={selectedEditorNode.id} onChange={(e) => updateDraft((next) => {
                          const node = next.graph.nodes.find((item) => item.id === selectedEditorNode.id);
                          if (!node) return;
                          const oldId = node.id;
                          node.id = e.target.value;
                          if (next.pipeline.entryNodeId === oldId) next.pipeline.entryNodeId = e.target.value;
                          next.graph.edges.forEach((edge) => {
                            if (edge.from === oldId) edge.from = e.target.value;
                            if (edge.to === oldId) edge.to = e.target.value;
                          });
                          setSelectedEditorNodeId(e.target.value);
                          setSelectedGraphNodeId(e.target.value);
                        })} /></label>
                      </div>
                      <div className="field-grid toggles">
                        <label className="toggle" htmlFor="inspector-node-enabled"><input id="inspector-node-enabled" name="inspectorNodeEnabled" type="checkbox" checked={selectedEditorNode.enabled !== false} onChange={(e) => updateSelectedDraftNode((node) => { node.enabled = e.target.checked; })} /><span>Enabled</span></label>
                        <label className="toggle" htmlFor="inspector-node-entry"><input id="inspector-node-entry" name="inspectorNodeEntry" type="checkbox" checked={draft?.pipeline.entryNodeId === selectedEditorNode.id} onChange={(e) => updateDraft((next) => { if (e.target.checked) next.pipeline.entryNodeId = selectedEditorNode.id; })} /><span>Entry Node</span></label>
                      </div>
                    </div>
                  </details>

                  <details className="property-group property-group-collapsible" open>
                    <summary className="property-group-summary">
                      <div className="property-group-head">
                        <span>Execution</span>
                        <small>Runtime behavior</small>
                      </div>
                    </summary>
                    <div className="property-group-body">
                      <div className="field-grid">
                        <label htmlFor="inspector-node-provider"><span>Provider</span><select id="inspector-node-provider" name="inspectorNodeProvider" value={selectedEditorNode.provider} onChange={(e) => updateSelectedDraftNode((node) => { node.provider = e.target.value as AgentProvider; delete node.modelProfiles; })}><option value="codex-cli">codex-cli</option><option value="codex-sdk">codex-sdk</option><option value="claude-agent-sdk">claude-agent-sdk</option></select></label>
                        <label htmlFor="inspector-node-model"><span>Model</span><input id="inspector-node-model" name="inspectorNodeModel" value={selectedEditorNode.model} onChange={(e) => updateSelectedDraftNode((node) => { node.model = e.target.value; delete node.modelProfiles; })} /></label>
                        <label htmlFor="inspector-node-workspace"><span>Workspace</span><input id="inspector-node-workspace" name="inspectorNodeWorkspace" value={selectedEditorNode.cwd ?? "."} onChange={(e) => updateSelectedDraftNode((node) => { node.cwd = e.target.value; })} /></label>
                        <label htmlFor="inspector-node-timeout"><span>Timeout (ms)</span><input id="inspector-node-timeout" name="inspectorNodeTimeout" type="number" placeholder="No timeout" value={selectedEditorNode.timeoutMs ?? ""} onChange={(e) => updateSelectedDraftNode((node) => { const value = e.target.value.trim(); node.timeoutMs = value ? Number(value) : undefined; })} /></label>
                        <label htmlFor="inspector-node-max-turns"><span>Max Turns</span><input id="inspector-node-max-turns" name="inspectorNodeMaxTurns" type="number" placeholder="No limit" value={selectedEditorNode.maxTurns ?? ""} onChange={(e) => updateSelectedDraftNode((node) => { const value = e.target.value.trim(); node.maxTurns = value ? Number(value) : undefined; })} /></label>
                      </div>
                    </div>
                  </details>

                  <details className="property-group property-group-collapsible" open>
                    <summary className="property-group-summary">
                      <div className="property-group-head">
                        <span>Canvas</span>
                        <small>Spatial state</small>
                      </div>
                    </summary>
                    <div className="property-group-body">
                      <div className={`node-position-banner ${selectedDraftNodePosition ? "" : "subtle"}`}>
                        <span>Canvas position</span>
                        <strong>
                          {selectedDraftNodePosition
                            ? `x ${selectedDraftNodePosition.x} · y ${selectedDraftNodePosition.y}`
                            : "Auto layout"}
                        </strong>
                      </div>
                    </div>
                  </details>

                  <details className="property-group property-group-collapsible">
                    <summary className="property-group-summary">
                      <div className="property-group-head">
                        <span>Prompt</span>
                        <small>Main behavior</small>
                      </div>
                    </summary>
                    <div className="property-group-body">
                      <label htmlFor="inspector-node-prompt"><span>Prompt</span><textarea id="inspector-node-prompt" name="inspectorNodePrompt" rows={10} value={selectedEditorNode.prompt} onChange={(e) => updateSelectedDraftNode((node) => { node.prompt = e.target.value; })} /></label>
                    </div>
                  </details>
                </div>
              ) : selectedEditorEdge ? (
                <div className="inspector-form">
                  <section className="property-group">
                    <div className="property-group-head">
                      <span>Connection</span>
                      <Badge tone="accent">{formatDraftEdgeLabel(selectedEditorEdge.from, selectedEditorEdge.to)}</Badge>
                    </div>
                    <div className="field-grid">
                      <label htmlFor="inspector-edge-from"><span>From</span><select id="inspector-edge-from" name="inspectorEdgeFrom" value={selectedEditorEdge.from} onChange={(e) => updateSelectedDraftEdge((edge) => {
                        edge.from = e.target.value;
                        setEdgeFrom(edge.from);
                      })}><option value="">Select node</option>{draft?.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
                      <label htmlFor="inspector-edge-to"><span>To</span><select id="inspector-edge-to" name="inspectorEdgeTo" value={selectedEditorEdge.to} onChange={(e) => updateSelectedDraftEdge((edge) => {
                        edge.to = e.target.value;
                        setEdgeTo(edge.to);
                      })}><option value="">Select node</option>{draft?.graph.nodes.map((node) => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
                    </div>
                    <div className="button-row compact">
                      <Button variant="danger" size="compact" onClick={removeSelectedDraftSelection}>Delete Edge</Button>
                    </div>
                  </section>
                </div>
              ) : (
                <p className="muted-copy">Select a draft node or edge in the canvas to edit its properties here.</p>
              )}
            </div>
            </>
          ) : null}
          <div className="inspector-section-label">Checks</div>
          <div className="inspector-block">
            <h3>Validation Issues</h3>
            {issues.length > 0 ? (
              <ul className="issue-list">
                {issues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    <strong>{issue.code}</strong>
                    <span>{issue.path}</span>
                    <p>{issue.message}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="muted-copy">No validation issues.</p>}
          </div>
            </>
          )}
        </Panel>
        {studioPage === "runtime" || studioPage === "history" ? (
        <Panel className="timeline-panel">
          <PanelHeader title="Run Timeline" actions={<Badge>{selectedRunEvents.length}</Badge>} />
          <div className="timeline-list">
            {selectedRunEvents.length > 0 ? (
              selectedRunEvents.map((event, index) => (
                <article key={`${event.timestamp}-${index}`} className="timeline-item">
                  <div className="timeline-stamp">
                    <strong>{event.type}</strong>
                    <span>{formatWhen(event.timestamp)}</span>
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-meta">
                      <span>{event.nodeName ?? event.nodeId ?? "pipeline"}</span>
                    </div>
                    <pre>{JSON.stringify(event.payload ?? {}, null, 2)}</pre>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">Select a run to inspect its events.</div>
            )}
          </div>
        </Panel>
        ) : null}
      </main>
    </div>
  );
}
