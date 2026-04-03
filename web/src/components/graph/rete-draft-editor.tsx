import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClassicPreset, NodeEditor, type GetSchemes } from "rete";
import { AreaExtensions, AreaPlugin, Drag } from "rete-area-plugin";
import {
  ReactPlugin,
  Presets as ReactPresets,
  type RenderEmit,
  useRete,
} from "rete-react-plugin";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { PipelineGraphDraft } from "../../types";

const socket = new ClassicPreset.Socket("pipeline");

export type ReteCanvasNodeData = {
  id: string;
  name: string;
  provider: string;
  enabled?: boolean;
  position?: {
    x: number;
    y: number;
  } | null;
  runtimeStatus?: string;
};

export type ReteCanvasEdgeData = {
  id?: string;
  from: string;
  to: string;
};

export type ReteCanvasGraph = {
  entryNodeId?: string | null;
  nodes: ReteCanvasNodeData[];
  edges: ReteCanvasEdgeData[];
};

class DraftNode extends ClassicPreset.Node<{ in: ClassicPreset.Socket }, { out: ClassicPreset.Socket }, {}> {
  nameText: string;
  providerText: string;
  enabledState: boolean;
  statusText: string;
  statusTone: "ready" | "accent" | "warning" | "danger" | "disabled";

  constructor(node: ReteCanvasNodeData) {
    super(node.name);
    this.id = node.id;
    this.nameText = node.name;
    this.providerText = node.provider;
    this.enabledState = node.enabled !== false;
    const runtimeStatus = node.runtimeStatus?.toLowerCase() ?? "";
    if (!this.enabledState) {
      this.statusText = "DISABLED";
      this.statusTone = "disabled";
    } else if (runtimeStatus === "running") {
      this.statusText = "RUNNING";
      this.statusTone = "warning";
    } else if (runtimeStatus === "pending") {
      this.statusText = "PENDING";
      this.statusTone = "accent";
    } else if (runtimeStatus === "completed" || runtimeStatus === "success") {
      this.statusText = "SUCCESS";
      this.statusTone = "ready";
    } else if (runtimeStatus === "failed" || runtimeStatus === "canceled" || runtimeStatus === "canceling") {
      this.statusText = runtimeStatus.toUpperCase();
      this.statusTone = "danger";
    } else {
      this.statusText = "READY";
      this.statusTone = "ready";
    }
    this.addInput("in", new ClassicPreset.Input(socket, "IN"));
    this.addOutput("out", new ClassicPreset.Output(socket, "OUT"));
    this.selected = false;
  }
}

type DraftConnection = ClassicPreset.Connection<DraftNode, DraftNode>;
type Schemes = GetSchemes<DraftNode, DraftConnection>;

type ReteEditorInstance = {
  editor: NodeEditor<Schemes>;
  area: AreaPlugin<Schemes, ReactArea2D<Schemes>>;
  destroy: () => void;
};

type ReactArea2D<S extends Schemes> = import("rete-react-plugin").ReactArea2D<S>;

type Props = {
  graph: ReteCanvasGraph;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  onNodeMove?: (nodeId: string, position: { x: number; y: number }) => void;
  onConnect?: (from: string, to: string) => void;
  editable?: boolean;
};

type ConnectionDragState = {
  sourceNodeId: string;
  start: { x: number; y: number };
  pointer: { x: number; y: number };
  targetNodeId: string | null;
  targetPoint: { x: number; y: number } | null;
};

type NodeDragState = {
  nodeId: string;
  pointerStart: { x: number; y: number };
  nodeStart: { x: number; y: number };
};

type DragTarget = {
  nodeId: string;
  point: { x: number; y: number };
};

function autoPosition(index: number) {
  return { x: index * 320, y: 40 + ((index % 2) * 180) };
}

function ReteBlueprintNode({
  data,
  emit,
  onStartNodeDrag,
  editable,
}: {
  data: DraftNode;
  emit: RenderEmit<Schemes>;
  onStartNodeDrag: (nodeId: string, event: React.PointerEvent<HTMLDivElement>) => void;
  editable: boolean;
}) {
  const RefSocket = ReactPresets.classic.RefSocket;
  const inputs = Object.entries(data.inputs);
  const outputs = Object.entries(data.outputs);

  return (
    <div className={`rete-blueprint-node ${data.selected ? "is-selected" : ""}`} data-node-id={data.id}>
      <div
        className={`rete-blueprint-node__header ${editable ? "is-draggable" : ""}`}
        onPointerDown={(event) => {
          if (!editable) return;
          if (event.button !== 0) return;
          onStartNodeDrag(data.id, event);
        }}
      >
        <span className="rete-blueprint-node__provider">{data.providerText}</span>
        <strong>{data.label}</strong>
        <span className={`rete-blueprint-node__state is-${data.statusTone}`}>
          {data.statusText}
        </span>
      </div>
      <div className="rete-blueprint-node__body">
        <div className="rete-blueprint-node__column is-input">
          {inputs.map(([key, input]) =>
            input ? (
              <div key={key} className="rete-blueprint-node__socket-row is-input">
                <RefSocket
                  name="rete-blueprint-node__socket"
                  side="input"
                  socketKey={key}
                  nodeId={data.id}
                  emit={emit}
                  payload={input.socket}
                  data-node-id={data.id}
                  data-side="input"
                  role="button"
                  tabIndex={0}
                  aria-label={`Input ${data.label}`}
                />
                <span>{input.label ?? key}</span>
              </div>
            ) : null,
          )}
        </div>
        <div className="rete-blueprint-node__meta">
          <span>NODE</span>
          <strong>{data.id}</strong>
        </div>
        <div className="rete-blueprint-node__column is-output">
          {outputs.map(([key, output]) =>
            output ? (
              <div key={key} className="rete-blueprint-node__socket-row is-output">
                <span>{output.label ?? key}</span>
                <RefSocket
                  name="rete-blueprint-node__socket"
                  side="output"
                  socketKey={key}
                  nodeId={data.id}
                  emit={emit}
                  payload={output.socket}
                  data-node-id={data.id}
                  data-side="output"
                  role="button"
                  tabIndex={0}
                  aria-label={`Output ${data.label}`}
                />
              </div>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

export function ReteDraftEditor({
  graph,
  selectedNodeId,
  onSelectNode,
  onNodeMove,
  onConnect,
  editable = false,
}: Props) {
  const hostElementRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({
    onSelectNode,
    onNodeMove: onNodeMove ?? (() => {}),
    onConnect: onConnect ?? (() => {}),
  });
  const syncingRef = useRef(false);
  const previousNodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const pendingNodePositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const editorRef = useRef<ReteEditorInstance | null>(null);
  const connectionPointerStateRef = useRef<ConnectionDragState | null>(null);
  const nodeDragStateRef = useRef<NodeDragState | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<ConnectionDragState | null>(null);

  callbacksRef.current = {
    onSelectNode,
    onNodeMove: onNodeMove ?? (() => {}),
    onConnect: onConnect ?? (() => {}),
  };

  const clearConnectionNodeClasses = useCallback(() => {
    const host = hostElementRef.current;
    if (!host) return;
    host.querySelectorAll(".rete-blueprint-node.is-routing").forEach((element) => {
      element.classList.remove("is-routing");
    });
    host.querySelectorAll(".rete-blueprint-node.is-target-lock").forEach((element) => {
      element.classList.remove("is-target-lock");
    });
  }, []);

  const markConnectionNodes = useCallback(
    (state: ConnectionDragState | null) => {
      const host = hostElementRef.current;
      if (!host) return;
      clearConnectionNodeClasses();
      if (!state) return;

      const source = host.querySelector<HTMLElement>(`.rete-blueprint-node[data-node-id="${state.sourceNodeId}"]`);
      source?.classList.add("is-routing");

      if (state.targetNodeId) {
        const target = host.querySelector<HTMLElement>(`.rete-blueprint-node[data-node-id="${state.targetNodeId}"]`);
        target?.classList.add("is-target-lock");
      }
    },
    [clearConnectionNodeClasses],
  );

  const resolveInputSocketAtPoint = useCallback((clientX: number, clientY: number): DragTarget | null => {
    const elements = document.elementsFromPoint(clientX, clientY);
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;

      const inputSocket =
        element.matches("[data-side='input']")
          ? element
          : element.closest<HTMLElement>("[data-side='input']");

      if (inputSocket?.dataset.nodeId) {
        const rect = inputSocket.getBoundingClientRect();
        return {
          nodeId: inputSocket.dataset.nodeId,
          point: {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          },
        };
      }

      const inputRow = element.closest<HTMLElement>(".rete-blueprint-node__socket-row.is-input");
      if (inputRow) {
        const node = inputRow.closest<HTMLElement>(".rete-blueprint-node[data-node-id]");
        const nodeId = node?.dataset.nodeId ?? null;
        if (nodeId) {
          const rect = inputRow.getBoundingClientRect();
          return {
            nodeId,
            point: {
              x: rect.left + 12,
              y: rect.top + rect.height / 2,
            },
          };
        }
      }

      const node = element.closest<HTMLElement>(".rete-blueprint-node[data-node-id]");
      const nodeId = node?.dataset.nodeId ?? null;
      if (nodeId) {
        const rect = node.getBoundingClientRect();
        return {
          nodeId,
          point: {
            x: rect.left + 14,
            y: rect.top + rect.height / 2,
          },
        };
      }
    }

    return null;
  }, []);

  const stopConnectionDrag = useCallback(
    (event?: PointerEvent) => {
      const current = connectionPointerStateRef.current;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      clearConnectionNodeClasses();
      setConnectionDrag(null);
      connectionPointerStateRef.current = null;

      if (!current || !event) return;

      const target = resolveInputSocketAtPoint(event.clientX, event.clientY);
      if (target && target.nodeId !== current.sourceNodeId) {
        callbacksRef.current.onConnect(current.sourceNodeId, target.nodeId);
      }
    },
    [clearConnectionNodeClasses, resolveInputSocketAtPoint],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const current = connectionPointerStateRef.current;
      if (!current) return;

      const target = resolveInputSocketAtPoint(event.clientX, event.clientY);
      const nextState: ConnectionDragState = {
        ...current,
        pointer: { x: event.clientX, y: event.clientY },
        targetNodeId: target?.nodeId ?? null,
        targetPoint: target?.point ?? null,
      };
      connectionPointerStateRef.current = nextState;
      setConnectionDrag(nextState);
      markConnectionNodes(nextState);
    },
    [markConnectionNodes, resolveInputSocketAtPoint],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      stopConnectionDrag(event);
    },
    [stopConnectionDrag],
  );

  const handleNodeDragMove = useCallback((event: PointerEvent) => {
    const active = nodeDragStateRef.current;
    const instance = editorRef.current;
    if (!active || !instance) return;

    const view = instance.area.nodeViews.get(active.nodeId);
    if (!view) return;

    const dx = event.clientX - active.pointerStart.x;
    const dy = event.clientY - active.pointerStart.y;
    void view.translate(active.nodeStart.x + dx, active.nodeStart.y + dy);
  }, []);

  const flushPendingNodeMoves = useCallback(() => {
    if (syncingRef.current || pendingNodePositionsRef.current.size === 0) return;

    for (const [nodeId, nextPosition] of pendingNodePositionsRef.current.entries()) {
      const previous = previousNodePositionsRef.current.get(nodeId);
      if (!previous || previous.x !== nextPosition.x || previous.y !== nextPosition.y) {
        previousNodePositionsRef.current.set(nodeId, nextPosition);
        callbacksRef.current.onNodeMove(nodeId, nextPosition);
      }
    }

    pendingNodePositionsRef.current.clear();
  }, []);

  const stopNodeDrag = useCallback(() => {
    window.removeEventListener("pointermove", handleNodeDragMove);
    window.removeEventListener("pointerup", stopNodeDrag);
    nodeDragStateRef.current = null;
    flushPendingNodeMoves();
  }, [flushPendingNodeMoves, handleNodeDragMove]);

  const startConnectionDrag = useCallback(
    (nodeId: string, socketElement: HTMLElement) => {
      const rect = socketElement.getBoundingClientRect();
      const start = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };

      callbacksRef.current.onSelectNode(nodeId);

      const nextState: ConnectionDragState = {
        sourceNodeId: nodeId,
        start,
        pointer: start,
        targetNodeId: null,
        targetPoint: null,
      };

      connectionPointerStateRef.current = nextState;
      setConnectionDrag(nextState);
      markConnectionNodes(nextState);

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [handlePointerMove, handlePointerUp, markConnectionNodes],
  );

  const startNodeDrag = useCallback(
    (nodeId: string, event: React.PointerEvent<HTMLDivElement>) => {
      const instance = editorRef.current;
      if (!instance) return;

      const view = instance.area.nodeViews.get(nodeId);
      if (!view) return;

      event.preventDefault();
      event.stopPropagation();
      callbacksRef.current.onSelectNode(nodeId);

      nodeDragStateRef.current = {
        nodeId,
        pointerStart: { x: event.clientX, y: event.clientY },
        nodeStart: { x: view.position.x, y: view.position.y },
      };

      window.addEventListener("pointermove", handleNodeDragMove);
      window.addEventListener("pointerup", stopNodeDrag);
    },
    [handleNodeDragMove, stopNodeDrag],
  );

  const draftKey = useMemo(
    () =>
      JSON.stringify({
        entryNodeId: graph.entryNodeId ?? null,
        editable,
        nodes: graph.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          provider: node.provider,
          enabled: node.enabled !== false,
          runtimeStatus: node.runtimeStatus ?? null,
          position: node.position ?? null,
        })),
        edges: graph.edges,
      }),
    [editable, graph],
  );

  const createEditor = useCallback(async (container: HTMLElement) => {
    container.classList.add("rete-draft-surface");
    container.addEventListener("contextmenu", (event) => event.preventDefault());

    const editor = new NodeEditor<Schemes>();
    const area = new AreaPlugin<Schemes, ReactArea2D<Schemes>>(container);
    const render = new ReactPlugin<Schemes, ReactArea2D<Schemes>>({
      createRoot: (container) => {
        const root = createRoot(container as Element);
        return {
          render(children) {
            flushSync(() => {
              root.render(children);
            });
          },
          unmount() {
            flushSync(() => {
              root.unmount();
            });
          },
        };
      },
    });

    render.addPreset(
      ReactPresets.classic.setup({
        customize: {
          node() {
            return (props) => (
              <ReteBlueprintNode
                data={props.data}
                emit={props.emit}
                onStartNodeDrag={startNodeDrag}
                editable={editable}
              />
            );
          },
        },
      }),
    );

    AreaExtensions.simpleNodesOrder(area);
    editor.use(area);
    area.use(render);

    area.area.setDragHandler(
      new Drag({
        down: (event) => event.button === 2,
        move: () => true,
      }),
    );

    area.addPipe((context) => {
      if (context.type === "nodepicked") {
        callbacksRef.current.onSelectNode(context.data.id);
      }
      if (editable && context.type === "nodetranslated" && !syncingRef.current) {
        pendingNodePositionsRef.current.set(context.data.id, {
          x: Math.round(context.data.position.x),
          y: Math.round(context.data.position.y),
        });
      }
      if (editable && context.type === "nodedragged" && !syncingRef.current) {
        flushPendingNodeMoves();
      }
      return context;
    });

    editorRef.current = {
      editor,
      area,
      destroy: () => {
        area.destroy();
      },
    };

    return editorRef.current;
  }, [flushPendingNodeMoves, startConnectionDrag, startNodeDrag]);

  const [containerRef, editorInstance] = useRete(createEditor);

  useEffect(() => {
    const instance = editorRef.current;
    if (!instance || !editorInstance) return;

    let cancelled = false;

    void (async () => {
      syncingRef.current = true;
      try {
        await instance.editor.clear();
        previousNodePositionsRef.current = new Map(
          graph.nodes.map((node, index) => [node.id, node.position ?? autoPosition(index)]),
        );

        const nodeMap = new Map<string, DraftNode>();

        for (const [index, node] of graph.nodes.entries()) {
          const reteNode = new DraftNode(node);
          reteNode.selected = node.id === selectedNodeId;
          nodeMap.set(node.id, reteNode);
          await instance.editor.addNode(reteNode);
          const position = node.position ?? autoPosition(index);
          await instance.area.translate(reteNode.id, position);
        }

        for (const edge of graph.edges) {
          const source = nodeMap.get(edge.from);
          const target = nodeMap.get(edge.to);
          if (!source || !target) continue;
          const connection = new ClassicPreset.Connection(source, "out", target, "in");
          connection.id = edge.id ?? `graph-edge-${edge.from}-${edge.to}`;
          await instance.editor.addConnection(connection);
        }

        if (!cancelled && graph.nodes.length > 0) {
          await AreaExtensions.zoomAt(instance.area, instance.editor.getNodes());
        }
      } finally {
        syncingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey, editable, editorInstance, graph, selectedNodeId]);

  useEffect(() => {
    const instance = editorRef.current;
    if (!instance) return;

    for (const node of instance.editor.getNodes()) {
      node.selected = node.id === selectedNodeId;
      const element = hostElementRef.current?.querySelector<HTMLElement>(
        `.rete-blueprint-node[data-node-id="${node.id}"]`,
      );
      element?.classList.toggle("is-selected", node.selected);
    }
  }, [selectedNodeId]);

  useEffect(
    () => () => {
      stopConnectionDrag();
      stopNodeDrag();
    },
    [stopConnectionDrag, stopNodeDrag],
  );

  useEffect(() => {
    const host = hostElementRef.current;
    if (!host) return;

    const handleHostPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const outputSocket = target.closest<HTMLElement>("[data-side='output']");
      if (!outputSocket || !host.contains(outputSocket)) return;

      if (!editable) return;

      const nodeId = outputSocket.dataset.nodeId ?? null;
      if (!nodeId) return;

      event.preventDefault();
      event.stopPropagation();
      try {
        outputSocket.setPointerCapture?.(event.pointerId);
      } catch {
        // Best effort only. Some synthetic or delegated pointer paths don't expose an active pointer.
      }
      startConnectionDrag(nodeId, outputSocket);
    };

    host.addEventListener("pointerdown", handleHostPointerDown, true);
    return () => {
      host.removeEventListener("pointerdown", handleHostPointerDown, true);
    };
  }, [editable, startConnectionDrag]);

  useEffect(() => {
    const handleGlobalPointerUp = () => {
      flushPendingNodeMoves();
    };

    window.addEventListener("pointerup", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
    };
  }, [flushPendingNodeMoves]);

  const overlayLine = useMemo(() => {
    if (!connectionDrag || !hostElementRef.current) return null;
    const hostRect = hostElementRef.current.getBoundingClientRect();
    const target = connectionDrag.targetPoint ?? connectionDrag.pointer;
    return {
      x1: connectionDrag.start.x - hostRect.left,
      y1: connectionDrag.start.y - hostRect.top,
      x2: target.x - hostRect.left,
      y2: target.y - hostRect.top,
      targetLocked: Boolean(connectionDrag.targetPoint),
    };
  }, [connectionDrag]);

  return (
    <div
      ref={(element) => {
        hostElementRef.current = element;
      }}
      className="rete-draft-host"
    >
      <div ref={containerRef} className="rete-draft-surface" />
      {editable && overlayLine ? (
        <svg className="rete-draft-overlay" aria-hidden="true">
          <path
            className={`rete-draft-overlay__path ${overlayLine.targetLocked ? "is-locked" : ""}`}
            d={`M ${overlayLine.x1} ${overlayLine.y1} C ${overlayLine.x1 + 120} ${overlayLine.y1}, ${overlayLine.x2 - 120} ${overlayLine.y2}, ${overlayLine.x2} ${overlayLine.y2}`}
          />
        </svg>
      ) : null}
    </div>
  );
}
