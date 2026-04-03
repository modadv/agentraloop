import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runPipeline } from "../dist/runtime.js";

function createPipelineDefinition() {
  return {
    id: "pipeline-runtime",
    name: "Runtime Pipeline",
    entryNodeId: "node-a",
    nodes: [
      {
        id: "node-a",
        name: "Node A",
        provider: "codex-cli",
        model: "base-a",
        modelProfiles: {
          fast: "fast-a",
        },
        prompt: "Prompt A",
      },
      {
        id: "node-b",
        name: "Node B",
        provider: "codex-cli",
        model: "base-b",
        prompt: "Prompt B",
        cwd: "relative-node-dir",
      },
      {
        id: "node-c",
        name: "Node C",
        provider: "codex-cli",
        model: "base-c",
        prompt: "Prompt C",
        enabled: false,
      },
      {
        id: "node-d",
        name: "Node D",
        provider: "codex-cli",
        model: "base-d",
        prompt: "Prompt D",
      },
      {
        id: "node-unreachable",
        name: "Unreachable",
        provider: "codex-cli",
        model: "base-u",
        prompt: "Should not run",
      },
    ],
    edges: [
      { from: "node-a", to: "node-b" },
      { from: "node-a", to: "node-c" },
      { from: "node-b", to: "node-d" },
      { from: "node-c", to: "node-d" },
    ],
  };
}

function createConfig() {
  return {
    pipelinePath: "pipelines/runtime-test.pipeline.json",
    pipelineCwd: path.resolve("workspace/project"),
    modelProfile: "fast",
  };
}

test("runPipeline executes reachable DAG nodes, assembles upstream output, and skips disabled nodes", async () => {
  const invocations = [];
  const eventTypes = [];

  const runRecord = await runPipeline({
    definition: createPipelineDefinition(),
    config: createConfig(),
    providerResolver: () => ({
      async invoke(invocation) {
        invocations.push(invocation);
        return {
          ok: true,
          outputMarkdown: `output:${invocation.nodeId}`,
          rawOutput: `raw:${invocation.nodeId}`,
          metadata: { cwd: invocation.cwd },
        };
      },
    }),
    eventSink: {
      append(event) {
        eventTypes.push(event.type);
      },
    },
  });

  assert.equal(runRecord.status, "completed");
  assert.deepEqual(
    runRecord.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun.status]),
    [
      ["node-a", "success"],
      ["node-b", "success"],
      ["node-c", "skipped"],
      ["node-d", "success"],
    ],
  );
  assert.deepEqual(
    invocations.map((invocation) => invocation.nodeId),
    ["node-a", "node-b", "node-d"],
  );
  assert.equal(invocations[0].model, "fast-a");
  assert.equal(
    invocations[1].cwd,
    path.resolve(createConfig().pipelineCwd, "relative-node-dir"),
  );
  assert.match(
    invocations[2].prompt,
    /### From: Node C \(node-c\)[\s\S]*Status: skipped[\s\S]*\[Node skipped\]/,
  );
  assert.ok(
    !runRecord.nodeRuns.some((nodeRun) => nodeRun.nodeId === "node-unreachable"),
    "unreachable nodes should never be scheduled",
  );
  assert.deepEqual(eventTypes, [
    "run_started",
    "node_started",
    "node_succeeded",
    "node_started",
    "node_succeeded",
    "node_skipped",
    "node_started",
    "node_succeeded",
    "run_completed",
  ]);
});

test("runPipeline stops after a provider failure and marks the run failed", async () => {
  const invocations = [];

  const runRecord = await runPipeline({
    definition: {
      id: "pipeline-failure",
      name: "Failure Pipeline",
      entryNodeId: "node-a",
      nodes: [
        {
          id: "node-a",
          name: "Node A",
          provider: "codex-cli",
          model: "base-a",
          prompt: "Prompt A",
        },
        {
          id: "node-b",
          name: "Node B",
          provider: "codex-cli",
          model: "base-b",
          prompt: "Prompt B",
        },
      ],
      edges: [{ from: "node-a", to: "node-b" }],
    },
    config: createConfig(),
    providerResolver: () => ({
      async invoke(invocation) {
        invocations.push(invocation.nodeId);
        if (invocation.nodeId === "node-b") {
          return {
            ok: false,
            outputMarkdown: "",
            rawOutput: "boom",
            errorMessage: "provider failed",
          };
        }

        return {
          ok: true,
          outputMarkdown: "ok",
          rawOutput: "ok",
        };
      },
    }),
  });

  assert.deepEqual(invocations, ["node-a", "node-b"]);
  assert.equal(runRecord.status, "failed");
  assert.equal(runRecord.nodeRuns.at(-1)?.nodeId, "node-b");
  assert.equal(runRecord.nodeRuns.at(-1)?.status, "failed");
  assert.equal(runRecord.nodeRuns.at(-1)?.errorMessage, "provider failed");
});
