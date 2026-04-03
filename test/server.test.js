import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectSeedPipelineFiles } from "../dist/server.js";

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agentraloop-server-test-"));
}

test("collectSeedPipelineFiles includes configured pipelinePath outside discovery directories", () => {
  const tempDir = createTempDir();
  const customDir = path.join(tempDir, "custom");
  const projectDir = path.join(tempDir, "project-pipelines");
  const userDir = path.join(tempDir, "user-pipelines");

  fs.mkdirSync(customDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });

  const customPipeline = path.join(customDir, "default.pipeline.json");
  const projectPipeline = path.join(projectDir, "case1.pipeline.json");
  const userPipeline = path.join(userDir, "case2.pipeline.json");

  fs.writeFileSync(customPipeline, "{}");
  fs.writeFileSync(projectPipeline, "{}");
  fs.writeFileSync(userPipeline, "{}");

  const files = collectSeedPipelineFiles({
    port: 8787,
    pipelinePath: customPipeline,
    pipelineDirectories: [projectDir, userDir],
    pipelineCwd: tempDir,
    modelProfile: "standard",
    databasePath: path.join(tempDir, "pipeline.db"),
    publicDir: path.join(tempDir, "public"),
  });

  assert.deepEqual(files, [customPipeline, projectPipeline, userPipeline].sort((a, b) => a.localeCompare(b)));
});

test("collectSeedPipelineFiles deduplicates pipelinePath already present in discovery directories", () => {
  const tempDir = createTempDir();
  const projectDir = path.join(tempDir, "pipelines");
  fs.mkdirSync(projectDir, { recursive: true });

  const defaultPipeline = path.join(projectDir, "default.pipeline.json");
  fs.writeFileSync(defaultPipeline, "{}");

  const files = collectSeedPipelineFiles({
    port: 8787,
    pipelinePath: defaultPipeline,
    pipelineDirectories: [projectDir],
    pipelineCwd: tempDir,
    modelProfile: "fast",
    databasePath: path.join(tempDir, "pipeline.db"),
    publicDir: path.join(tempDir, "public"),
  });

  assert.deepEqual(files, [defaultPipeline]);
});
