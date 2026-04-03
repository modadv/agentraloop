import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { RunManager, WorkspaceConflictError } from "../dist/run-manager.js";

function createPipelineDefinition() {
  return {
    id: "pipeline-lock-test",
    name: "Pipeline Lock Test",
    entryNodeId: "node-a",
    nodes: [
      {
        id: "node-a",
        name: "Node A",
        provider: "codex-cli",
        model: "base-a",
        prompt: "Prompt A",
      },
    ],
    edges: [],
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createRunRecord(definition, config, runId) {
  const startedAt = new Date().toISOString();
  return {
    runId,
    pipelineId: definition.id,
    pipelineName: definition.name,
    status: "completed",
    startedAt,
    endedAt: startedAt,
    controlState: "running",
    config,
    nodeRuns: [],
  };
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition.");
}

function createTestHarness(runPipelineImpl) {
  const definition = createPipelineDefinition();
  const runs = new Map();
  const pipelines = new Map();
  const events = [];
  const queues = new Map();
  const tasks = new Map();
  const manager = new RunManager(
    {
      pipelinePath: path.resolve("pipeline.json"),
      pipelineCwd: path.resolve("workspace"),
      modelProfile: "fast",
    },
    {
      loadPipelineDefinition: () => definition,
      runPipeline: runPipelineImpl,
      runStore: {
        save(run) {
          runs.set(run.runId, structuredClone(run));
        },
        list() {
          return [...runs.values()].map((run) => structuredClone(run));
        },
        get(runId) {
          const run = runs.get(runId);
          return run ? structuredClone(run) : undefined;
        },
        getDatabasePath() {
          return ":memory:";
        },
      },
      pipelineStore: {
        save(pipeline) {
          pipelines.set(pipeline.id, structuredClone(pipeline));
        },
        list() {
          return [...pipelines.values()].map((pipeline) => structuredClone(pipeline));
        },
        get(pipelineId) {
          const pipeline = pipelines.get(pipelineId);
          return pipeline ? structuredClone(pipeline) : undefined;
        },
        delete(pipelineId) {
          return pipelines.delete(pipelineId);
        },
      },
      eventStore: {
        append(event) {
          events.push(structuredClone(event));
        },
        listForRun(runId) {
          return events
            .filter((event) => event.runId === runId)
            .map((event) => structuredClone(event));
        },
      },
      taskQueueStore: {
        saveQueue(queue) {
          queues.set(queue.queueId, structuredClone(queue));
        },
        listQueues() {
          return [...queues.values()].map((queue) => structuredClone(queue));
        },
        getQueue(queueId) {
          const queue = queues.get(queueId);
          return queue ? structuredClone(queue) : undefined;
        },
        saveTask(task) {
          tasks.set(task.taskId, structuredClone(task));
        },
        listTasks(queueId) {
          return [...tasks.values()]
            .filter((task) => (queueId ? task.queueId === queueId : true))
            .map((task) => structuredClone(task));
        },
        getTask(taskId) {
          const task = tasks.get(taskId);
          return task ? structuredClone(task) : undefined;
        },
        deleteTask(taskId) {
          return tasks.delete(taskId);
        },
      },
    },
  );

  return {
    manager,
    definition,
  };
}

test("RunManager rejects concurrent runs for the same workspace and releases the lock after completion", async () => {
  const firstRunGate = createDeferred();
  let invocationCount = 0;
  const harness = createTestHarness(async ({ definition, config, existingRunId }) => {
    invocationCount += 1;
    if (invocationCount === 1) {
      await firstRunGate.promise;
    }
    return createRunRecord(definition, config, existingRunId);
  });

  const firstRun = harness.manager.createRun({
    pipelineCwd: "D:\\Workspace\\Repo",
  });

  assert.throws(
    () => harness.manager.createRun({ pipelineCwd: "d:/workspace/repo/." }),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.equal(error.workspacePath, "d:/workspace/repo/.");
      assert.equal(error.conflictingRunId, firstRun.runId);
      assert.equal(error.conflictingPipelineId, harness.definition.id);
      return true;
    },
  );

  firstRunGate.resolve();
  await waitFor(() => harness.manager.getRun(firstRun.runId)?.status === "completed");

  const secondRun = harness.manager.createRun({
    pipelineCwd: "d:/workspace/repo",
  });

  await waitFor(() => harness.manager.getRun(secondRun.runId)?.status === "completed");
  assert.notEqual(secondRun.runId, firstRun.runId);
});

test("RunManager blocks retry when another active run holds the same workspace lock", async () => {
  const activeRunGate = createDeferred();
  let invocationCount = 0;
  const harness = createTestHarness(async ({ definition, config, existingRunId }) => {
    invocationCount += 1;
    if (invocationCount === 2) {
      await activeRunGate.promise;
    }
    return createRunRecord(definition, config, existingRunId);
  });

  const completedRun = harness.manager.createRun({
    pipelineCwd: "D:\\Workspace\\Repo",
  });
  await waitFor(() => harness.manager.getRun(completedRun.runId)?.status === "completed");

  const activeRun = harness.manager.createRun({
    pipelineCwd: "D:\\Workspace\\Repo",
  });

  assert.throws(
    () => harness.manager.retryRun(completedRun.runId),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.equal(error.conflictingRunId, activeRun.runId);
      assert.equal(error.conflictingPipelineId, harness.definition.id);
      return true;
    },
  );

  activeRunGate.resolve();
  await waitFor(() => harness.manager.getRun(activeRun.runId)?.status === "completed");
});

test("RunManager normalizes slash styles when checking workspace conflicts", async () => {
  const firstRunGate = createDeferred();
  let invocationCount = 0;
  const harness = createTestHarness(async ({ definition, config, existingRunId }) => {
    invocationCount += 1;
    if (invocationCount === 1) {
      await firstRunGate.promise;
    }
    return createRunRecord(definition, config, existingRunId);
  });

  const firstRun = harness.manager.createRun({
    pipelineCwd: "C:\\Workspace\\Repo\\nested",
  });

  assert.throws(
    () => harness.manager.createRun({ pipelineCwd: "c:/workspace/repo/nested/./" }),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.equal(error.conflictingRunId, firstRun.runId);
      return true;
    },
  );

  firstRunGate.resolve();
  await waitFor(() => harness.manager.getRun(firstRun.runId)?.status === "completed");
});
