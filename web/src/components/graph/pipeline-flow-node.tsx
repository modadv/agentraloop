import { Handle, Position, type NodeProps } from "reactflow";
import { cn } from "../../lib/utils";

export type PipelineFlowNodeData = {
  nodeId: string;
  name: string;
  provider: string;
  status?: string | null;
  enabled: boolean;
  isEntry: boolean;
  isDraftMode: boolean;
  connectionModeEnabled: boolean;
  isConnectSource: boolean;
  isConnectTarget: boolean;
  isDragging: boolean;
  isRecentlyChanged: boolean;
  recentChangeLabel?: string | null;
  onActivateNode?: (nodeId: string) => void;
};

function toneFromStatus(status?: string | null): "success" | "danger" | "warning" | "accent" {
  if (!status) return "accent";
  if (status === "completed" || status === "success") return "success";
  if (status === "failed" || status === "canceled") return "danger";
  if (status === "paused" || status === "canceling") return "warning";
  return "accent";
}

export function PipelineFlowNode({ data, selected }: NodeProps<PipelineFlowNodeData>) {
  const tone = toneFromStatus(data.status);
  const statusText = data.status ?? "draft";
  const allowConnectionTargetActivation = data.connectionModeEnabled && !data.isConnectSource;
  const stateDescriptor = data.isDragging
    ? { label: "MOVING", tone: "warning" }
    : data.isConnectTarget
      ? { label: "TARGET LOCK", tone: "success" }
      : data.isConnectSource
        ? { label: "ROUTING", tone: "accent" }
        : selected
          ? { label: "FOCUSED", tone: "accent" }
          : data.isRecentlyChanged
            ? { label: data.recentChangeLabel ?? "UPDATED", tone: "success" }
            : { label: "READY", tone: "neutral" };

  return (
    <div
      className={cn(
        "pipeline-flow-node",
        selected && "is-selected",
        data.enabled === false && "is-disabled",
        data.isDraftMode && "is-draft",
        data.isConnectSource && "is-connecting-source",
        data.isConnectTarget && "is-connecting-target",
        data.isDragging && "is-dragging",
        data.isRecentlyChanged && "is-recently-changed",
      )}
      onMouseDownCapture={(event) => {
        if (!allowConnectionTargetActivation) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClickCapture={(event) => {
        if (!allowConnectionTargetActivation || !data.onActivateNode) return;
        event.preventDefault();
        event.stopPropagation();
        data.onActivateNode(data.nodeId);
      }}
    >
      <Handle type="target" position={Position.Top} className="pipeline-flow-handle pipeline-flow-handle-target" />
      <div className="pipeline-flow-port pipeline-flow-port-top">IN</div>

      <div className="pipeline-flow-drag-handle" title="Drag node">
        <div className="pipeline-flow-meta">
          <span className="pipeline-flow-provider-pill">{data.provider}</span>
          <div className="pipeline-flow-meta-right">
            {data.isRecentlyChanged ? (
              <span className="pipeline-flow-mini recent">{data.recentChangeLabel ?? "UPDATED"}</span>
            ) : null}
            {data.isDraftMode ? <span className="pipeline-flow-mini muted">EDIT</span> : null}
            {data.isEntry ? <span className="pipeline-flow-mini entry">ENTRY</span> : null}
          </div>
        </div>
        <div className="pipeline-flow-drag-grip" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
      <div className="pipeline-flow-idline">
        <span className="pipeline-flow-idlabel">node id</span>
        <strong>{data.nodeId}</strong>
      </div>
      <div className={cn("pipeline-flow-statebar", `is-${stateDescriptor.tone}`)}>
        <span className="pipeline-flow-statebar-label">State</span>
        <strong>{stateDescriptor.label}</strong>
      </div>

      <div className="pipeline-flow-head">
        <div className="pipeline-flow-title-block">
          <strong className="pipeline-flow-name">{data.name}</strong>
          <span className="pipeline-flow-subtitle">Agent node</span>
        </div>
        <span className={cn("pipeline-flow-status-pill", `is-${tone}`)}>{statusText}</span>
      </div>

      <div className="pipeline-flow-divider" />

      <div className="pipeline-flow-body">
        {data.enabled === false ? <span className="pipeline-flow-chip muted">DISABLED</span> : null}
        {data.isConnectSource ? <span className="pipeline-flow-chip is-accent">CONNECTING</span> : null}
        {data.isConnectTarget ? <span className="pipeline-flow-chip is-success">TARGET</span> : null}
        {data.isDragging ? <span className="pipeline-flow-chip is-warning">DRAGGING</span> : null}
      </div>
      <div className="pipeline-flow-footer">
        <span className="pipeline-flow-footer-label">Signal</span>
        <strong className="pipeline-flow-footer-value">
          {data.isConnectSource
            ? "Routing output"
            : data.isConnectTarget
              ? "Awaiting input"
              : data.enabled === false
                ? "Offline"
                : "Ready"}
        </strong>
      </div>

      <div className="pipeline-flow-port pipeline-flow-port-bottom">OUT</div>
      <Handle type="source" position={Position.Bottom} className="pipeline-flow-handle pipeline-flow-handle-source" />
    </div>
  );
}
