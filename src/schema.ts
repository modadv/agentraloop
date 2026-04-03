import { readFileSync } from "node:fs";
import {
  type AgentNodeDefinition,
  type ModelProfile,
  type PipelineDefinition,
  type PipelineEdge,
  type PipelineGraphDraft,
  type PipelineValidationIssue,
} from "./types.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export class PipelineValidationError extends Error {
  constructor(readonly issues: PipelineValidationIssue[]) {
    super(issues[0]?.message ?? "Pipeline validation failed.");
    this.name = "PipelineValidationError";
  }
}

function issue(code: string, path: string, message: string): PipelineValidationIssue {
  return { code, path, message };
}

function collectNodeShapeIssues(node: unknown, index: number): PipelineValidationIssue[] {
  const issues: PipelineValidationIssue[] = [];
  if (!node || typeof node !== "object") {
    issues.push(issue("invalid_node", `nodes[${index}]`, `Invalid node at index ${index}: expected object.`));
    return issues;
  }

  const record = node as Record<string, unknown>;
  const required = ["id", "name", "provider", "model", "prompt"] as const;
  for (const key of required) {
    if (!isNonEmptyString(record[key])) {
      issues.push(
        issue(
          "missing_field",
          `nodes[${index}].${key}`,
          `Invalid node at index ${index}: missing string field "${key}".`,
        ),
      );
    }
  }

  if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
    issues.push(
      issue(
        "invalid_field_type",
        `nodes[${index}].enabled`,
        `Invalid node at index ${index}: "enabled" must be boolean when provided.`,
      ),
    );
  }

  if (record.timeoutMs !== undefined && (typeof record.timeoutMs !== "number" || Number.isNaN(record.timeoutMs))) {
    issues.push(
      issue(
        "invalid_field_type",
        `nodes[${index}].timeoutMs`,
        `Invalid node at index ${index}: "timeoutMs" must be a number when provided.`,
      ),
    );
  }

  if (record.maxTurns !== undefined && (typeof record.maxTurns !== "number" || Number.isNaN(record.maxTurns))) {
    issues.push(
      issue(
        "invalid_field_type",
        `nodes[${index}].maxTurns`,
        `Invalid node at index ${index}: "maxTurns" must be a number when provided.`,
      ),
    );
  }

  if (record.position !== undefined) {
    if (!record.position || typeof record.position !== "object") {
      issues.push(
        issue(
          "invalid_field_type",
          `nodes[${index}].position`,
          `Invalid node at index ${index}: "position" must be an object when provided.`,
        ),
      );
    } else {
      const position = record.position as Record<string, unknown>;
      if (typeof position.x !== "number" || Number.isNaN(position.x)) {
        issues.push(
          issue(
            "invalid_field_type",
            `nodes[${index}].position.x`,
            `Invalid node at index ${index}: "position.x" must be a number.`,
          ),
        );
      }
      if (typeof position.y !== "number" || Number.isNaN(position.y)) {
        issues.push(
          issue(
            "invalid_field_type",
            `nodes[${index}].position.y`,
            `Invalid node at index ${index}: "position.y" must be a number.`,
          ),
        );
      }
    }
  }

  if (record.modelProfiles !== undefined) {
    if (!record.modelProfiles || typeof record.modelProfiles !== "object") {
      issues.push(
        issue(
          "invalid_field_type",
          `nodes[${index}].modelProfiles`,
          `Invalid node at index ${index}: "modelProfiles" must be an object.`,
        ),
      );
    } else {
      const profiles = record.modelProfiles as Record<string, unknown>;
      const allowedProfiles: ModelProfile[] = ["fast", "standard"];
      for (const [profile, value] of Object.entries(profiles)) {
        if (!allowedProfiles.includes(profile as ModelProfile)) {
          issues.push(
            issue(
              "unsupported_model_profile",
              `nodes[${index}].modelProfiles.${profile}`,
              `Invalid node at index ${index}: unsupported model profile "${profile}".`,
            ),
          );
        }
        if (!isNonEmptyString(value)) {
          issues.push(
            issue(
              "invalid_field_type",
              `nodes[${index}].modelProfiles.${profile}`,
              `Invalid node at index ${index}: model profile "${profile}" must be a non-empty string.`,
            ),
          );
        }
      }
    }
  }

  return issues;
}

function collectEdgeShapeIssues(edge: unknown, index: number): PipelineValidationIssue[] {
  const issues: PipelineValidationIssue[] = [];
  if (!edge || typeof edge !== "object") {
    issues.push(issue("invalid_edge", `edges[${index}]`, `Invalid edge at index ${index}: expected object.`));
    return issues;
  }

  const record = edge as Record<string, unknown>;
  if (!isNonEmptyString(record.from)) {
    issues.push(issue("missing_field", `edges[${index}].from`, `Invalid edge at index ${index}: "from" is required.`));
  }
  if (!isNonEmptyString(record.to)) {
    issues.push(issue("missing_field", `edges[${index}].to`, `Invalid edge at index ${index}: "to" is required.`));
  }

  return issues;
}

export function loadPipelineDefinition(filePath: string): PipelineDefinition {
  const rawText = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(rawText) as Record<string, unknown>;

  const definition = parsed as unknown as PipelineDefinition;
  validatePipelineDefinition(definition);
  return definition;
}

export function validatePipelineDefinitionDetailed(
  definition: PipelineDefinition,
): { ok: boolean; issues: PipelineValidationIssue[] } {
  const issues: PipelineValidationIssue[] = [];
  if (!isNonEmptyString(definition.id)) {
    issues.push(issue("missing_field", "pipeline.id", "Pipeline id is required."));
  }
  if (!isNonEmptyString(definition.name)) {
    issues.push(issue("missing_field", "pipeline.name", "Pipeline name is required."));
  }
  if (!isNonEmptyString(definition.entryNodeId)) {
    issues.push(issue("missing_field", "pipeline.entryNodeId", "Pipeline entryNodeId is required."));
  }
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    issues.push(issue("missing_nodes", "graph.nodes", "Pipeline must contain at least one node."));
  }
  if (!Array.isArray(definition.edges)) {
    issues.push(issue("invalid_field_type", "graph.edges", "Pipeline edges must be an array."));
  }

  if (Array.isArray(definition.nodes)) {
    definition.nodes.forEach((node, index) => {
      issues.push(...collectNodeShapeIssues(node, index));
    });
  }
  if (Array.isArray(definition.edges)) {
    definition.edges.forEach((edge, index) => {
      issues.push(...collectEdgeShapeIssues(edge, index));
    });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const nodeMap = new Map<string, AgentNodeDefinition>();

  for (const [index, node] of definition.nodes.entries()) {
    if (nodeMap.has(node.id)) {
      issues.push(issue("duplicate_node_id", `graph.nodes[${index}].id`, `Duplicate node id detected: ${node.id}`));
    }
    nodeMap.set(node.id, node);
  }

  if (!nodeMap.has(definition.entryNodeId)) {
    issues.push(issue("entry_node_not_found", "pipeline.entryNodeId", `Entry node not found: ${definition.entryNodeId}`));
  }

  const adjacency = new Map<string, string[]>();
  const predecessorCount = new Map<string, number>();

  for (const node of definition.nodes) {
    adjacency.set(node.id, []);
    predecessorCount.set(node.id, 0);
  }

  for (const [index, edge] of definition.edges.entries()) {
    if (!nodeMap.has(edge.from)) {
      issues.push(issue("edge_source_not_found", `graph.edges[${index}].from`, `Edge source node not found: ${edge.from}`));
    }
    if (!nodeMap.has(edge.to)) {
      issues.push(issue("edge_target_not_found", `graph.edges[${index}].to`, `Edge target node not found: ${edge.to}`));
    }

    if (nodeMap.has(edge.from) && nodeMap.has(edge.to)) {
      adjacency.get(edge.from)?.push(edge.to);
      predecessorCount.set(edge.to, (predecessorCount.get(edge.to) ?? 0) + 1);
    }
  }

  if (issues.length === 0 && (predecessorCount.get(definition.entryNodeId) ?? 0) > 0) {
    issues.push(
      issue(
        "entry_node_has_incoming_edges",
        "pipeline.entryNodeId",
        `Entry node must not have incoming edges: ${definition.entryNodeId}`,
      ),
    );
  }

  if (issues.length === 0) {
    const cycleIssue = validateAcyclicGraph(adjacency);
    if (cycleIssue) {
      issues.push(cycleIssue);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validatePipelineDefinition(definition: PipelineDefinition): void {
  const result = validatePipelineDefinitionDetailed(definition);
  if (!result.ok) {
    throw new PipelineValidationError(result.issues);
  }
}

export function pipelineGraphDraftToDefinition(draft: PipelineGraphDraft): PipelineDefinition {
  return {
    id: draft.pipeline.id,
    name: draft.pipeline.name,
    description: draft.pipeline.description,
    entryNodeId: draft.pipeline.entryNodeId,
    nodes: draft.graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      enabled: node.enabled,
      provider: node.provider,
      model: node.model,
      modelProfiles: node.modelProfiles,
      prompt: node.prompt,
      cwd: node.cwd,
      timeoutMs: node.timeoutMs ?? undefined,
      maxTurns: node.maxTurns ?? undefined,
      position: node.position,
    })),
    edges: draft.graph.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
    })),
  };
}

function validateAcyclicGraph(adjacency: Map<string, string[]>): PipelineValidationIssue | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const trail: string[] = [];

  function dfs(nodeId: string): void {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) {
      const cycleStart = trail.indexOf(nodeId);
      const cyclePath = [...trail.slice(cycleStart), nodeId].join(" -> ");
      throw issue("graph_cycle", "graph.edges", `Pipeline graph contains a cycle: ${cyclePath}`);
    }

    visiting.add(nodeId);
    trail.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      dfs(next);
    }

    trail.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  try {
    for (const nodeId of adjacency.keys()) {
      dfs(nodeId);
    }
    return null;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && "path" in error && "message" in error) {
      return error as PipelineValidationIssue;
    }
    throw error;
  }
}
