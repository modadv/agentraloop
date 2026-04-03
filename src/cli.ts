import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { runDefaultPipeline } from "./main.js";
import { resolvePackagePath } from "./package-paths.js";
import { startServer } from "./server.js";

function readPackageVersion(): string {
  const packageJsonPath = resolvePackagePath("package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

function printHelp(): void {
  console.log(`AgentraLoop CLI

Usage:
  agentraloop [command]

Commands:
  serve      Start the AgentraLoop server and web studio
  run        Execute the default pipeline once
  help       Show this help message
  version    Print the package version

Environment:
  PORT
  PIPELINE_PATH
  PIPELINE_CWD
  PIPELINE_DB_PATH
  AGENTRALOOP_USERS_ROOT
  AGENTRALOOP_USERS_FILE`);
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const [command = "serve"] = argv;

  switch (command) {
    case "serve":
    case "server":
      await startServer();
      return;
    case "run":
      await runDefaultPipeline();
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "version":
    case "--version":
    case "-v":
      console.log(readPackageVersion());
      return;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process.argv[1] === "string" && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectExecution) {
  void runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
