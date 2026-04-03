import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadPipelineDefinition,
  pipelineGraphDraftToDefinition,
  PipelineValidationError,
  validatePipelineDefinition,
  validatePipelineDefinitionDetailed,
} from "../dist/schema.js";

function createPipeline(overrides = {}) {
  return {
    id: "pipeline-1",
    name: "Pipeline 1",
    entryNodeId: "node-a",
    nodes: [
      {
        id: "node-a",
        name: "Node A",
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "Run node A",
      },
      {
        id: "node-b",
        name: "Node B",
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "Run node B",
      },
    ],
    edges: [{ from: "node-a", to: "node-b" }],
    ...overrides,
  };
}

test("validatePipelineDefinition rejects duplicate node ids", () => {
  const definition = createPipeline({
    nodes: [
      {
        id: "node-a",
        name: "Node A",
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "Run node A",
      },
      {
        id: "node-a",
        name: "Node B",
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "Run node B",
      },
    ],
    edges: [],
  });

  assert.throws(
    () => validatePipelineDefinition(definition),
    /Duplicate node id detected: node-a/,
  );
});

test("validatePipelineDefinition reports entry node incoming edges", () => {
  const definition = createPipeline({
    edges: [{ from: "node-b", to: "node-a" }],
  });

  assert.throws(
    () => validatePipelineDefinition(definition),
    /Entry node must not have incoming edges: node-a/,
  );
});

test("validatePipelineDefinition reports cycle paths", () => {
  const definition = createPipeline({
    entryNodeId: "node-c",
    nodes: [
      {
        id: "node-a",
        name: "Node A",
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "Run node A",
      },
      {
        id: "node-b",
        name: "Node B",
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "Run node B",
      },
      {
        id: "node-c",
        name: "Node C",
        provider: "codex-cli",
        model: "gpt-test",
        prompt: "Run node C",
      },
    ],
    edges: [
      { from: "node-c", to: "node-a" },
      { from: "node-a", to: "node-b" },
      { from: "node-b", to: "node-a" },
    ],
  });

  assert.throws(
    () => validatePipelineDefinition(definition),
    /Pipeline graph contains a cycle: node-a -> node-b -> node-a/,
  );
});

test("validatePipelineDefinitionDetailed returns structured issues", () => {
  const result = validatePipelineDefinitionDetailed(
    createPipeline({
      entryNodeId: "missing-entry",
      nodes: [
        {
          id: "node-a",
          name: "Node A",
          provider: "codex-cli",
          model: "gpt-test",
          prompt: "Run node A",
        },
        {
          id: "node-a",
          name: "Node B",
          provider: "codex-cli",
          model: "gpt-test",
          prompt: "Run node B",
        },
      ],
      edges: [{ from: "node-a", to: "missing-node" }],
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.code === "duplicate_node_id"));
  assert.ok(result.issues.some((item) => item.code === "entry_node_not_found"));
  assert.ok(result.issues.some((item) => item.code === "edge_target_not_found"));
});

test("validatePipelineDefinition throws PipelineValidationError with issues", () => {
  try {
    validatePipelineDefinition(
      createPipeline({
        nodes: [],
      }),
    );
    assert.fail("Expected validation to throw.");
  } catch (error) {
    assert.ok(error instanceof PipelineValidationError);
    assert.ok(error.issues.some((item) => item.code === "missing_nodes"));
  }
});

test("pipelineGraphDraftToDefinition converts editor draft shape", () => {
  const definition = pipelineGraphDraftToDefinition({
    pipeline: {
      id: "draft-pipeline",
      name: "Draft Pipeline",
      description: "Draft description",
      entryNodeId: "node-a",
    },
    graph: {
      nodes: [
        {
          id: "node-a",
          name: "Node A",
          enabled: true,
          provider: "codex-cli",
          model: "gpt-test",
          prompt: "Run node A",
          cwd: ".",
          timeoutMs: 120000,
          modelProfiles: {
            fast: "gpt-test-mini",
          },
        },
      ],
      edges: [],
    },
  });

  assert.equal(definition.id, "draft-pipeline");
  assert.equal(definition.nodes[0].cwd, ".");
  assert.equal(definition.nodes[0].timeoutMs, 120000);
  assert.equal(definition.nodes[0].modelProfiles.fast, "gpt-test-mini");
});

test("loadPipelineDefinition validates model profile keys from disk", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pipeline-schema-"));
  const pipelinePath = path.join(tempRoot, "invalid.pipeline.json");

  writeFileSync(
    pipelinePath,
    JSON.stringify(
      createPipeline({
        nodes: [
          {
            id: "node-a",
            name: "Node A",
            provider: "codex-cli",
            model: "gpt-test",
            prompt: "Run node A",
            modelProfiles: {
              turbo: "bad-profile",
            },
          },
        ],
        edges: [],
      }),
      null,
      2,
    ),
    "utf8",
  );

  assert.throws(
    () => loadPipelineDefinition(pipelinePath),
    /unsupported model profile "turbo"/,
  );

  rmSync(tempRoot, { recursive: true, force: true });
});

test("loadPipelineDefinition loads valid pipeline JSON", () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pipeline-schema-"));
  const pipelinePath = path.join(tempRoot, "valid.pipeline.json");

  mkdirSync(tempRoot, { recursive: true });
  writeFileSync(pipelinePath, JSON.stringify(createPipeline(), null, 2), "utf8");

  const definition = loadPipelineDefinition(pipelinePath);

  assert.equal(definition.id, "pipeline-1");
  assert.equal(definition.entryNodeId, "node-a");
  assert.equal(definition.nodes.length, 2);

  rmSync(tempRoot, { recursive: true, force: true });
});
