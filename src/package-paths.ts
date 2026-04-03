import * as path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRootDir = path.resolve(moduleDir, "..");

export function getPackageRootDir(): string {
  return packageRootDir;
}

export function resolvePackagePath(...segments: string[]): string {
  return path.resolve(packageRootDir, ...segments);
}
