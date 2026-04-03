const state = {
  pipelines: [],
  runs: [],
  health: null,
  selectedPipelineId: null,
  selectedRunId: null,
  selectedPipelineDetail: null,
  selectedRunDetail: null,
  selectedRunEvents: [],
  selectedPipelineGraph: null,
  selectedRunGraph: null,
  selectedEditorNodeId: null,
  editorDraftText: "",
  editorIssues: [],
  editorDirty: false,
  busy: false,
};

let autoRefreshTimer = null;

const el = {
  pipelineList: document.getElementById("pipelineList"),
  runList: document.getElementById("runList"),
  graphCanvas: document.getElementById("graphCanvas"),
  selectionDetails: document.getElementById("selectionDetails"),
  timeline: document.getElementById("timeline"),
  heroTitle: document.getElementById("heroTitle"),
  heroMeta: document.getElementById("heroMeta"),
  graphBadge: document.getElementById("graphBadge"),
  selectionBadge: document.getElementById("selectionBadge"),
  timelineBadge: document.getElementById("timelineBadge"),
  refreshPipelines: document.getElementById("refreshPipelines"),
  refreshRuns: document.getElementById("refreshRuns"),
  refreshSelection: document.getElementById("refreshSelection"),
  pipelineSelect: document.getElementById("pipelineSelect"),
  pipelineCwdInput: document.getElementById("pipelineCwdInput"),
  modelProfileSelect: document.getElementById("modelProfileSelect"),
  createRun: document.getElementById("createRun"),
  pauseRun: document.getElementById("pauseRun"),
  resumeRun: document.getElementById("resumeRun"),
  cancelRun: document.getElementById("cancelRun"),
  retryRun: document.getElementById("retryRun"),
  controlBadge: document.getElementById("controlBadge"),
  actionStatus: document.getElementById("actionStatus"),
  editorBadge: document.getElementById("editorBadge"),
  editorTarget: document.getElementById("editorTarget"),
  editorDraft: document.getElementById("editorDraft"),
  editorIssues: document.getElementById("editorIssues"),
  loadEditor: document.getElementById("loadEditor"),
  validateEditor: document.getElementById("validateEditor"),
  saveEditor: document.getElementById("saveEditor"),
  addNode: document.getElementById("addNode"),
  addEdge: document.getElementById("addEdge"),
  editorNodeList: document.getElementById("editorNodeList"),
  editorEdgeList: document.getElementById("editorEdgeList"),
  editorNodeBadge: document.getElementById("editorNodeBadge"),
  editorNodeId: document.getElementById("editorNodeId"),
  editorNodeName: document.getElementById("editorNodeName"),
  editorNodeProvider: document.getElementById("editorNodeProvider"),
  editorNodeModel: document.getElementById("editorNodeModel"),
  editorNodeCwd: document.getElementById("editorNodeCwd"),
  editorNodeTimeout: document.getElementById("editorNodeTimeout"),
  editorNodeEnabled: document.getElementById("editorNodeEnabled"),
  editorNodeIsEntry: document.getElementById("editorNodeIsEntry"),
  editorNodePrompt: document.getElementById("editorNodePrompt"),
  removeNode: document.getElementById("removeNode"),
};

function statusClass(status) {
  if (status === "completed" || status === "success") return "success";
  if (status === "failed" || status === "canceled" || status === "canceling") return "failed";
  if (status === "running" || status === "paused" || status === "pending") return "running";
  return "muted";
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

async function sendJson(url, method, payload) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status} ${url}`);
  }
  return data;
}

function selectedRunSummary() {
  return state.runs.find((run) => run.runId === state.selectedRunId) ?? null;
}

function selectedPipelineSummary() {
  return state.pipelines.find((item) => item.summary.id === state.selectedPipelineId) ?? null;
}

function setActionMessage(message, tone = "muted") {
  el.actionStatus.className = `badge ${tone}`;
  el.actionStatus.textContent = message;
}

function pipelineToDraft(pipeline) {
  return {
    pipeline: {
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description ?? "",
      entryNodeId: pipeline.entryNodeId,
    },
    graph: {
      nodes: (pipeline.nodes ?? []).map((node) => ({
        id: node.id,
        name: node.name,
        enabled: node.enabled ?? true,
        provider: node.provider,
        model: node.model,
        modelProfiles: node.modelProfiles ?? {},
        prompt: node.prompt,
        cwd: node.cwd ?? "",
        timeoutMs: node.timeoutMs ?? null,
      })),
      edges: (pipeline.edges ?? []).map((edge) => ({
        from: edge.from,
        to: edge.to,
      })),
    },
  };
}

function parseEditorDraft() {
  return JSON.parse(state.editorDraftText);
}

function parseEditorDraftSafe() {
  try {
    return parseEditorDraft();
  } catch {
    return null;
  }
}

function getSelectedEditorNode(draft) {
  if (!draft?.graph?.nodes?.length) return null;
  return (
    draft.graph.nodes.find((node) => node.id === state.selectedEditorNodeId) ?? draft.graph.nodes[0] ?? null
  );
}

function ensureSelectedEditorNode(draft) {
  const selectedNode = getSelectedEditorNode(draft);
  state.selectedEditorNodeId = selectedNode?.id ?? null;
  return selectedNode;
}

function writeEditorDraft(draft, { preserveIssues = true } = {}) {
  ensureSelectedEditorNode(draft);
  state.editorDraftText = JSON.stringify(draft, null, 2);
  state.editorDirty = true;
  if (!preserveIssues) {
    state.editorIssues = [];
  }
}

function mutateEditorDraft(mutator) {
  const draft = parseEditorDraft();
  mutator(draft);
  writeEditorDraft(draft);
  render();
}

function nextNodeId(draft) {
  let index = draft.graph.nodes.length + 1;
  while (draft.graph.nodes.some((node) => node.id === `node-${index}`)) {
    index += 1;
  }
  return `node-${index}`;
}

function syncEditorFromSelectedPipeline(force = false) {
  if (!state.selectedPipelineDetail?.pipeline) return;
  if (state.editorDirty && !force) return;
  const draft = pipelineToDraft(state.selectedPipelineDetail.pipeline);
  state.editorDraftText = JSON.stringify(draft, null, 2);
  state.editorIssues = [];
  state.editorDirty = false;
  state.selectedEditorNodeId = draft.graph.nodes[0]?.id ?? null;
}

async function loadPipelines() {
  const data = await fetchJson("/pipelines");
  state.pipelines = data.pipelines ?? [];
  if (!state.selectedPipelineId && state.pipelines.length > 0) {
    state.selectedPipelineId = state.pipelines[0].summary.id;
  }
}

async function loadRuns() {
  const data = await fetchJson("/runs");
  state.runs = data.runs ?? [];
  if (!el.modelProfileSelect.value && data.defaultModelProfile) {
    el.modelProfileSelect.value = data.defaultModelProfile;
  }
  if (!state.selectedRunId && state.runs.length > 0) {
    state.selectedRunId = state.runs[0].runId;
  }
}

async function loadHealth() {
  state.health = await fetchJson("/health");
}

async function loadSelectionDetails() {
  if (state.selectedPipelineId) {
    state.selectedPipelineDetail = await fetchJson(
      `/pipelines/${encodeURIComponent(state.selectedPipelineId)}`,
    );
    state.selectedPipelineGraph = await fetchJson(
      `/pipelines/${encodeURIComponent(state.selectedPipelineId)}/graph`,
    );
  } else {
    state.selectedPipelineDetail = null;
    state.selectedPipelineGraph = null;
  }

  if (state.selectedRunId) {
    state.selectedRunDetail = await fetchJson(`/runs/${encodeURIComponent(state.selectedRunId)}`);
    state.selectedRunEvents = (await fetchJson(
      `/runs/${encodeURIComponent(state.selectedRunId)}/events`,
    )).events;
    state.selectedRunGraph = await fetchJson(`/runs/${encodeURIComponent(state.selectedRunId)}/graph`);
  } else {
    state.selectedRunDetail = null;
    state.selectedRunEvents = [];
    state.selectedRunGraph = null;
  }
}

function renderPipelines() {
  el.pipelineList.innerHTML = "";
  for (const item of state.pipelines) {
    const card = document.createElement("button");
    card.className = `list-card ${item.summary.id === state.selectedPipelineId ? "active" : ""}`;
    card.innerHTML = `
      <strong>${item.summary.name}</strong>
      <div class="meta-row">
        <span>${item.summary.id}</span>
        <span>${item.summary.nodeCount} nodes</span>
        <span>${item.summary.edgeCount} edges</span>
      </div>
    `;
    card.onclick = async () => {
      state.selectedPipelineId = item.summary.id;
      await loadSelectionDetails();
      render();
      ensureAutoRefresh();
    };
    el.pipelineList.appendChild(card);
  }
}

function renderRuns() {
  el.runList.innerHTML = "";
  for (const run of state.runs) {
    const card = document.createElement("button");
    card.className = `list-card ${run.runId === state.selectedRunId ? "active" : ""}`;
    card.innerHTML = `
      <strong>${run.pipelineName}</strong>
      <div class="meta-row">
        <span>${run.runId}</span>
        <span class="badge ${statusClass(run.status)}">${run.status}</span>
      </div>
    `;
    card.onclick = async () => {
      state.selectedRunId = run.runId;
      await loadSelectionDetails();
      render();
      ensureAutoRefresh();
    };
    el.runList.appendChild(card);
  }
}

function renderControls() {
  const selectedRun = selectedRunSummary();
  const selectedPipelineProviders = [
    ...new Set((state.selectedPipelineGraph?.graph?.nodes ?? []).map((node) => node.provider).filter(Boolean)),
  ];
  const unavailableProviders = selectedPipelineProviders.filter((provider) => {
    const availability = state.health?.providerAvailability?.[provider];
    return availability && availability.available === false;
  });
  const pipelineOptions = state.pipelines
    .map((item) => {
      const selected = item.summary.id === state.selectedPipelineId ? "selected" : "";
      return `<option value="${item.summary.id}" ${selected}>${item.summary.name}</option>`;
    })
    .join("");

  el.pipelineSelect.innerHTML =
    pipelineOptions || '<option value="">No persisted pipelines</option>';
  el.pipelineSelect.disabled = state.busy || state.pipelines.length === 0;
  el.pipelineCwdInput.disabled = state.busy;
  el.modelProfileSelect.disabled = state.busy;
  el.createRun.disabled = state.busy || !state.selectedPipelineId || unavailableProviders.length > 0;

  const canPause = selectedRun && (selectedRun.status === "running" || selectedRun.status === "pending");
  const canResume = selectedRun && selectedRun.status === "paused";
  const canCancel =
    selectedRun &&
    (selectedRun.status === "running" ||
      selectedRun.status === "pending" ||
      selectedRun.status === "paused");
  const canRetry =
    selectedRun &&
    (selectedRun.status === "failed" ||
      selectedRun.status === "canceled" ||
      selectedRun.status === "completed");

  el.pauseRun.disabled = state.busy || !canPause;
  el.resumeRun.disabled = state.busy || !canResume;
  el.cancelRun.disabled = state.busy || !canCancel;
  el.retryRun.disabled = state.busy || !canRetry;
  el.controlBadge.className = `badge ${state.busy ? "running" : "muted"}`;
  el.controlBadge.textContent = state.busy
    ? "Working"
    : unavailableProviders.length > 0
      ? `Unavailable: ${unavailableProviders.join(", ")}`
      : selectedRun
        ? `Selected ${selectedRun.status}`
        : "Ready";
}

function renderEditor() {
  const pipeline = state.selectedPipelineDetail?.pipeline ?? null;
  const hasPipeline = Boolean(pipeline);
  const draft = hasPipeline && state.editorDraftText.trim() ? parseEditorDraftSafe() : null;
  const selectedNode = draft ? ensureSelectedEditorNode(draft) : null;
  el.editorTarget.textContent = hasPipeline
    ? `${pipeline.name} (${pipeline.id})`
    : "No pipeline selected";
  if (el.editorDraft.value !== state.editorDraftText) {
    el.editorDraft.value = state.editorDraftText;
  }

  el.loadEditor.disabled = state.busy || !hasPipeline;
  el.validateEditor.disabled = state.busy || !hasPipeline || !state.editorDraftText.trim();
  el.saveEditor.disabled = state.busy || !hasPipeline || !state.editorDraftText.trim();
  el.editorDraft.disabled = state.busy || !hasPipeline;
  el.addNode.disabled = state.busy || !hasPipeline;
  el.addEdge.disabled = state.busy || !hasPipeline;
  el.removeNode.disabled = state.busy || !selectedNode;

  [
    el.editorNodeId,
    el.editorNodeName,
    el.editorNodeProvider,
    el.editorNodeModel,
    el.editorNodeCwd,
    el.editorNodeTimeout,
    el.editorNodeEnabled,
    el.editorNodeIsEntry,
    el.editorNodePrompt,
  ].forEach((input) => {
    input.disabled = state.busy || !selectedNode;
  });

  if (!hasPipeline) {
    el.editorBadge.className = "badge muted";
    el.editorBadge.textContent = "Idle";
  } else if (state.editorDirty) {
    el.editorBadge.className = "badge running";
    el.editorBadge.textContent = "Unsaved";
  } else {
    el.editorBadge.className = "badge success";
    el.editorBadge.textContent = "Synced";
  }

  if (hasPipeline && state.editorDraftText.trim() && !draft) {
    el.editorBadge.className = "badge failed";
    el.editorBadge.textContent = "Invalid JSON";
  }

  el.editorNodeBadge.className = `badge ${selectedNode ? "success" : "muted"}`;
  el.editorNodeBadge.textContent = selectedNode ? selectedNode.id : "No node";

  el.editorNodeList.innerHTML = "";
  (draft?.graph?.nodes ?? []).forEach((node) => {
    const button = document.createElement("button");
    button.className = `editor-item ${node.id === state.selectedEditorNodeId ? "active" : ""}`;
    button.innerHTML = `
      <strong>${node.name}</strong>
      <div class="meta-row">
        <code>${node.id}</code>
        <span>${node.provider}</span>
      </div>
    `;
    button.onclick = () => {
      state.selectedEditorNodeId = node.id;
      render();
    };
    el.editorNodeList.appendChild(button);
  });

  el.editorEdgeList.innerHTML = "";
  (draft?.graph?.edges ?? []).forEach((edge, index) => {
    const button = document.createElement("button");
    button.className = "editor-item";
    button.innerHTML = `
      <strong>${edge.from} → ${edge.to}</strong>
      <div class="meta-row">
        <code>edge-${index + 1}</code>
        <span>Tap to remove</span>
      </div>
    `;
    button.onclick = () => {
      mutateEditorDraft((currentDraft) => {
        currentDraft.graph.edges.splice(index, 1);
      });
    };
    el.editorEdgeList.appendChild(button);
  });

  el.editorNodeId.value = selectedNode?.id ?? "";
  el.editorNodeName.value = selectedNode?.name ?? "";
  el.editorNodeProvider.value = selectedNode?.provider ?? "codex-cli";
  el.editorNodeModel.value = selectedNode?.model ?? "";
  el.editorNodeCwd.value = selectedNode?.cwd ?? "";
  el.editorNodeTimeout.value =
    selectedNode?.timeoutMs !== null && selectedNode?.timeoutMs !== undefined
      ? String(selectedNode.timeoutMs)
      : "";
  el.editorNodeEnabled.checked = Boolean(selectedNode?.enabled ?? true);
  el.editorNodeIsEntry.checked = Boolean(selectedNode && draft?.pipeline.entryNodeId === selectedNode.id);
  el.editorNodePrompt.value = selectedNode?.prompt ?? "";

  if (!state.editorIssues.length) {
    el.editorIssues.className = "issue-list empty-state compact-empty";
    el.editorIssues.textContent = hasPipeline && !draft && state.editorDraftText.trim()
      ? "Draft JSON is invalid. Fix the syntax before validating or saving."
      : hasPipeline
      ? "Validate the current draft to inspect machine-readable pipeline issues."
      : "Select a pipeline to load its editable graph draft.";
    return;
  }

  el.editorIssues.className = "issue-list";
  el.editorIssues.innerHTML = "";
  state.editorIssues.forEach((item) => {
    const card = document.createElement("article");
    card.className = "issue-card";
    card.innerHTML = `
      <strong>${item.code}</strong>
      <small>${item.path}</small>
      <div>${item.message}</div>
    `;
    el.editorIssues.appendChild(card);
  });
}

function computeLevels(graph) {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const adjacency = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    adjacency.get(edge.from)?.push(edge.to);
  }

  const queue = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0).map((node) => node.id);
  const levels = new Map(queue.map((id) => [id, 0]));

  while (queue.length > 0) {
    const id = queue.shift();
    for (const next of adjacency.get(id) ?? []) {
      incoming.set(next, (incoming.get(next) ?? 0) - 1);
      levels.set(next, Math.max(levels.get(next) ?? 0, (levels.get(id) ?? 0) + 1));
      if ((incoming.get(next) ?? 0) === 0) {
        queue.push(next);
      }
    }
  }

  return levels;
}

function renderGraph() {
  const graphSource = state.selectedRunGraph ?? state.selectedPipelineGraph;
  if (!graphSource?.graph?.nodes?.length) {
    el.graphCanvas.className = "graph-canvas empty-state";
    el.graphCanvas.textContent = "Select a pipeline or run to render the graph.";
    el.graphBadge.className = "badge muted";
    el.graphBadge.textContent = "No data";
    return;
  }

  const graph = graphSource.graph;
  const levels = computeLevels(graph);
  const grouped = new Map();

  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    if (!grouped.has(level)) grouped.set(level, []);
    grouped.get(level).push(node);
  }

  el.graphCanvas.className = "graph-canvas";
  el.graphCanvas.innerHTML = "";
  [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([level, nodes]) => {
      const col = document.createElement("section");
      col.className = "graph-column";
      col.innerHTML = `<div class="graph-column-label">Layer ${level}</div>`;
      nodes.forEach((node) => {
        const article = document.createElement("article");
        article.className = "graph-node";
        const runtimeStatus = node.runtimeStatus ?? (node.enabled === false ? "skipped" : "idle");
        article.innerHTML = `
          <header>
            <strong>${node.name}</strong>
            <span class="badge ${statusClass(runtimeStatus)}">${runtimeStatus}</span>
          </header>
          <p>${node.id}</p>
          <div class="meta-row">
            <span>${node.provider ?? "agent"}</span>
            <span>${node.model ?? "n/a"}</span>
          </div>
        `;
        col.appendChild(article);
      });
      el.graphCanvas.appendChild(col);
    });

  if (graph.edges?.length) {
    const edgeWrap = document.createElement("div");
    edgeWrap.className = "edge-map";
    graph.edges.forEach((edge) => {
      const pill = document.createElement("div");
      pill.className = "edge-pill";
      pill.textContent = `${edge.from} → ${edge.to}`;
      edgeWrap.appendChild(pill);
    });
    el.graphCanvas.appendChild(edgeWrap);
  }

  el.graphBadge.className = "badge success";
  el.graphBadge.textContent = `${graph.nodes.length} nodes`;
}

function renderSelectionDetails() {
  const detail = state.selectedRunDetail ?? state.selectedPipelineGraph ?? {};
  el.selectionDetails.textContent = JSON.stringify(detail, null, 2);

  if (state.selectedRunDetail?.run) {
    el.selectionBadge.className = `badge ${statusClass(state.selectedRunDetail.run.status)}`;
    el.selectionBadge.textContent = state.selectedRunDetail.run.status;
    el.heroTitle.textContent = state.selectedRunDetail.run.pipelineName;
    el.heroMeta.textContent = `${state.selectedRunDetail.run.runId} • ${state.selectedRunDetail.run.config.pipelinePath}`;
  } else if (state.selectedPipelineGraph?.pipeline) {
    el.selectionBadge.className = "badge muted";
    el.selectionBadge.textContent = "Pipeline";
    el.heroTitle.textContent = state.selectedPipelineGraph.pipeline.name;
    el.heroMeta.textContent = `${state.selectedPipelineGraph.pipeline.id} • entry ${state.selectedPipelineGraph.pipeline.entryNodeId}`;
  } else {
    el.selectionBadge.className = "badge muted";
    el.selectionBadge.textContent = "Idle";
    el.heroTitle.textContent = "No Run Selected";
    el.heroMeta.textContent = "Choose a run to inspect graph state and event flow.";
  }

  if (!state.selectedRunDetail?.run && state.selectedPipelineGraph?.pipeline) {
    const providers = [
      ...new Set((state.selectedPipelineGraph?.graph?.nodes ?? []).map((node) => node.provider).filter(Boolean)),
    ];
    const unavailableProviders = providers
      .map((provider) => state.health?.providerAvailability?.[provider])
      .filter((availability) => availability && availability.available === false);
    if (unavailableProviders.length > 0) {
      const details = unavailableProviders
        .map((availability) => `${availability.provider}: ${availability.details ?? "unavailable"}`)
        .join(" | ");
      el.heroMeta.textContent = `${el.heroMeta.textContent} • ${details}`;
    }
  }
}

function renderTimeline() {
  if (!state.selectedRunEvents?.length) {
    el.timeline.className = "timeline empty-state";
    el.timeline.textContent = "Select a run to load events.";
    el.timelineBadge.className = "badge muted";
    el.timelineBadge.textContent = "No events";
    return;
  }

  el.timeline.className = "timeline";
  el.timeline.innerHTML = "";
  state.selectedRunEvents.forEach((event) => {
    const item = document.createElement("article");
    item.className = "timeline-item";
    item.innerHTML = `
      <strong>${event.type}</strong>
      <small>${event.timestamp}${event.nodeName ? ` • ${event.nodeName}` : ""}</small>
      <pre class="code-view">${JSON.stringify(event.payload ?? {}, null, 2)}</pre>
    `;
    el.timeline.appendChild(item);
  });
  el.timelineBadge.className = "badge success";
  el.timelineBadge.textContent = `${state.selectedRunEvents.length} events`;
}

function render() {
  renderPipelines();
  renderRuns();
  renderControls();
  renderEditor();
  renderGraph();
  renderSelectionDetails();
  renderTimeline();
}

function selectedRunIsActive() {
  const run = selectedRunSummary();
  if (!run) return false;
  return run.status === "pending" || run.status === "running" || run.status === "paused" || run.status === "canceling";
}

function ensureAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }

  if (!selectedRunIsActive() || state.busy) return;

  autoRefreshTimer = setInterval(async () => {
    try {
      await loadRuns();
      await loadSelectionDetails();
      render();
    } catch (error) {
      setActionMessage(
        `Auto refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        "failed",
      );
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }, 3000);
}

async function refreshAll() {
  await Promise.all([loadHealth(), loadPipelines(), loadRuns()]);
  await loadSelectionDetails();
  syncEditorFromSelectedPipeline();
  if (!el.pipelineCwdInput.value.trim()) {
    el.pipelineCwdInput.value = ".";
  }
  render();
  ensureAutoRefresh();
}

async function mutate(action, work) {
  state.busy = true;
  setActionMessage(action, "running");
  renderControls();
  try {
    await work();
    setActionMessage(`${action}: OK`, "success");
  } catch (error) {
    setActionMessage(`${action}: ${error instanceof Error ? error.message : String(error)}`, "failed");
  } finally {
    state.busy = false;
    renderControls();
    ensureAutoRefresh();
  }
}

el.refreshPipelines.onclick = async () => {
  await Promise.all([loadHealth(), loadPipelines()]);
  render();
  ensureAutoRefresh();
};

el.refreshRuns.onclick = async () => {
  await Promise.all([loadHealth(), loadRuns()]);
  await loadSelectionDetails();
  render();
  ensureAutoRefresh();
};

el.refreshSelection.onclick = async () => {
  await Promise.all([loadHealth(), loadSelectionDetails()]);
  render();
  ensureAutoRefresh();
};

el.pipelineSelect.onchange = async (event) => {
  state.selectedPipelineId = event.target.value || null;
  await loadSelectionDetails();
  syncEditorFromSelectedPipeline();
  render();
  ensureAutoRefresh();
};

el.loadEditor.onclick = async () => {
  syncEditorFromSelectedPipeline(true);
  render();
};

el.editorDraft.oninput = (event) => {
  state.editorDraftText = event.target.value;
  state.editorDirty = true;
};

el.addNode.onclick = () => {
  mutateEditorDraft((draft) => {
    const id = nextNodeId(draft);
    draft.graph.nodes.push({
      id,
      name: `Node ${draft.graph.nodes.length + 1}`,
      enabled: true,
      provider: "codex-cli",
      model: "gpt-5.4-mini",
      modelProfiles: {},
      prompt: "",
      cwd: "",
      timeoutMs: null,
    });
    if (!draft.pipeline.entryNodeId) {
      draft.pipeline.entryNodeId = id;
    }
    state.selectedEditorNodeId = id;
  });
};

el.addEdge.onclick = () => {
  mutateEditorDraft((draft) => {
    if (draft.graph.nodes.length < 2) return;
    const from = state.selectedEditorNodeId ?? draft.graph.nodes[0].id;
    const fallbackTarget = draft.graph.nodes.find((node) => node.id !== from)?.id;
    if (!fallbackTarget) return;
    draft.graph.edges.push({ from, to: fallbackTarget });
  });
};

el.removeNode.onclick = () => {
  if (!state.selectedEditorNodeId) return;
  mutateEditorDraft((draft) => {
    draft.graph.nodes = draft.graph.nodes.filter((node) => node.id !== state.selectedEditorNodeId);
    draft.graph.edges = draft.graph.edges.filter(
      (edge) => edge.from !== state.selectedEditorNodeId && edge.to !== state.selectedEditorNodeId,
    );
    if (draft.pipeline.entryNodeId === state.selectedEditorNodeId) {
      draft.pipeline.entryNodeId = draft.graph.nodes[0]?.id ?? "";
    }
    state.selectedEditorNodeId = draft.graph.nodes[0]?.id ?? null;
  });
};

function bindNodeField(input, updater) {
  input.oninput = () => {
    if (!state.selectedEditorNodeId) return;
    mutateEditorDraft((draft) => {
      const node = draft.graph.nodes.find((item) => item.id === state.selectedEditorNodeId);
      if (!node) return;
      updater(node, draft);
    });
  };
}

bindNodeField(el.editorNodeName, (node) => {
  node.name = el.editorNodeName.value;
});

bindNodeField(el.editorNodeProvider, (node) => {
  node.provider = el.editorNodeProvider.value;
});

bindNodeField(el.editorNodeModel, (node) => {
  node.model = el.editorNodeModel.value;
});

bindNodeField(el.editorNodeCwd, (node) => {
  node.cwd = el.editorNodeCwd.value;
});

bindNodeField(el.editorNodeTimeout, (node) => {
  node.timeoutMs = el.editorNodeTimeout.value ? Number(el.editorNodeTimeout.value) : null;
});

bindNodeField(el.editorNodePrompt, (node) => {
  node.prompt = el.editorNodePrompt.value;
});

el.editorNodeEnabled.onchange = () => {
  if (!state.selectedEditorNodeId) return;
  mutateEditorDraft((draft) => {
    const node = draft.graph.nodes.find((item) => item.id === state.selectedEditorNodeId);
    if (!node) return;
    node.enabled = el.editorNodeEnabled.checked;
  });
};

el.editorNodeIsEntry.onchange = () => {
  if (!state.selectedEditorNodeId || !el.editorNodeIsEntry.checked) return;
  mutateEditorDraft((draft) => {
    draft.pipeline.entryNodeId = state.selectedEditorNodeId;
  });
};

el.editorNodeId.onchange = () => {
  if (!state.selectedEditorNodeId) return;
  mutateEditorDraft((draft) => {
    const nextId = el.editorNodeId.value.trim();
    if (!nextId) return;
    const node = draft.graph.nodes.find((item) => item.id === state.selectedEditorNodeId);
    if (!node) return;
    const previousId = node.id;
    node.id = nextId;
    draft.graph.edges.forEach((edge) => {
      if (edge.from === previousId) edge.from = nextId;
      if (edge.to === previousId) edge.to = nextId;
    });
    if (draft.pipeline.entryNodeId === previousId) {
      draft.pipeline.entryNodeId = nextId;
    }
    state.selectedEditorNodeId = nextId;
  });
};

el.validateEditor.onclick = async () => {
  await mutate("Validate pipeline", async () => {
    const draft = JSON.parse(state.editorDraftText);
    const data = await sendJson("/pipeline-validations", "POST", { draft });
    state.editorIssues = data.issues ?? [];
    state.editorDirty = true;
    if (data.ok) {
      setActionMessage("Validate pipeline: OK", "success");
    } else {
      setActionMessage(`Validate pipeline: ${state.editorIssues.length} issue(s)`, "failed");
    }
    render();
  });
};

el.saveEditor.onclick = async () => {
  if (!state.selectedPipelineId) return;
  await mutate("Save pipeline", async () => {
    const draft = JSON.parse(state.editorDraftText);
    const data = await sendJson(
      `/pipelines/${encodeURIComponent(state.selectedPipelineId)}/graph`,
      "PUT",
      { draft },
    );
    state.editorIssues = [];
    state.editorDirty = false;
    state.selectedPipelineGraph = await fetchJson(
      `/pipelines/${encodeURIComponent(state.selectedPipelineId)}/graph`,
    );
    state.selectedPipelineDetail = {
      pipeline: data.pipeline,
      summary: data.summary,
    };
    await loadPipelines();
    render();
  });
};

el.createRun.onclick = async () => {
  await mutate("Create run", async () => {
    const data = await sendJson("/runs", "POST", {
      pipelineId: state.selectedPipelineId,
      pipelineCwd: el.pipelineCwdInput.value.trim() || ".",
      modelProfile: el.modelProfileSelect.value,
    });
    state.selectedRunId = data.run.runId;
    await refreshAll();
  });
};

el.pauseRun.onclick = async () => {
  if (!state.selectedRunId) return;
  await mutate("Pause run", async () => {
    await sendJson(`/runs/${encodeURIComponent(state.selectedRunId)}/pause`, "POST");
    await refreshAll();
  });
};

el.resumeRun.onclick = async () => {
  if (!state.selectedRunId) return;
  await mutate("Resume run", async () => {
    await sendJson(`/runs/${encodeURIComponent(state.selectedRunId)}/resume`, "POST");
    await refreshAll();
  });
};

el.cancelRun.onclick = async () => {
  if (!state.selectedRunId) return;
  await mutate("Cancel run", async () => {
    await sendJson(`/runs/${encodeURIComponent(state.selectedRunId)}/cancel`, "POST");
    await refreshAll();
  });
};

el.retryRun.onclick = async () => {
  if (!state.selectedRunId) return;
  await mutate("Retry run", async () => {
    const data = await sendJson(`/runs/${encodeURIComponent(state.selectedRunId)}/retry`, "POST");
    state.selectedRunId = data.run.runId;
    await refreshAll();
  });
};

refreshAll().catch((error) => {
  el.selectionDetails.textContent = String(error);
  setActionMessage("Initial load failed", "failed");
});
