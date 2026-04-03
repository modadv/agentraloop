import * as path from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { getRuntimeLogFile } from "./logger.js";
import { resolvePackagePath } from "./package-paths.js";
import { runPipeline } from "./runtime.js";
import { loadPipelineDefinition } from "./schema.js";

export function resolvePipelinePath(cwd = process.cwd()): string {
  if (process.env.PIPELINE_PATH) {
    return path.resolve(cwd, process.env.PIPELINE_PATH);
  }

  const localDefault = path.resolve(cwd, "pipelines", "default.pipeline.json");
  if (existsSync(localDefault)) {
    return localDefault;
  }

  return resolvePackagePath("pipelines", "default.pipeline.json");
}

export async function runDefaultPipeline(): Promise<void> {
  const pipelinePath = resolvePipelinePath();
  if (!existsSync(pipelinePath)) {
    throw new Error(`Pipeline definition not found: ${pipelinePath}`);
  }

  const definition = loadPipelineDefinition(pipelinePath);
  const defaultCwd = path.resolve(process.cwd(), process.env.PIPELINE_CWD ?? "runtime-workspaces/default");
  const runRecord = await runPipeline({
    definition,
    config: {
      pipelinePath,
      pipelineCwd: defaultCwd,
      modelProfile: (process.env.PIPELINE_MODEL_PROFILE as "fast" | "standard" | undefined) ?? "standard",
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: runRecord.status === "completed",
        runId: runRecord.runId,
        pipelineId: runRecord.pipelineId,
        pipelineName: runRecord.pipelineName,
        status: runRecord.status,
        nodeRuns: runRecord.nodeRuns.map((node) => ({
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          status: node.status,
          provider: node.provider,
          model: node.model,
        })),
        logFile: getRuntimeLogFile(),
      },
      null,
      2,
    ),
  );

  if (runRecord.status !== "completed") {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  void runDefaultPipeline();
}
