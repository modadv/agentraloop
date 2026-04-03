import * as fs from "node:fs";
import * as path from "node:path";
import { type UserCreateRequest, type UserProfile } from "./types.js";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sanitizeUserId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
    throw new Error(
      `Invalid user id "${value}". Use 2-64 chars: lowercase letters, digits, "_" or "-".`,
    );
  }
  return normalized;
}

export function createUserProfile(
  request: UserCreateRequest,
  usersRootDir: string,
  existing?: UserProfile,
): UserProfile {
  const id = sanitizeUserId(request.id);
  const now = new Date().toISOString();
  const baseDir = path.resolve(usersRootDir, id);
  const workspacePath = request.workspacePath
    ? path.resolve(request.workspacePath)
    : path.join(baseDir, "workspace");
  const dataDir = path.join(baseDir, "data");
  const logsDir = path.join(baseDir, "logs");
  const pipelineDir = path.join(baseDir, "pipelines");

  return {
    id,
    isAdmin: id === "admin",
    workspacePath,
    dataDir,
    logsDir,
    pipelineDir,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export class JsonUserStore {
  constructor(private readonly filePath: string, private readonly usersRootDir: string) {
    ensureDir(path.dirname(filePath));
    this.initialize();
  }

  list(): UserProfile[] {
    return this.readAll().sort((left, right) => left.id.localeCompare(right.id));
  }

  get(userId: string): UserProfile | undefined {
    const normalizedId = sanitizeUserId(userId);
    return this.readAll().find((user) => user.id === normalizedId);
  }

  save(request: UserCreateRequest): UserProfile {
    const users = this.readAll();
    const normalizedId = sanitizeUserId(request.id);
    const existing = users.find((user) => user.id === normalizedId);
    const profile = createUserProfile({ ...request, id: normalizedId }, this.usersRootDir, existing);
    this.ensureUserDirectories(profile);

    const nextUsers = users.filter((user) => user.id !== normalizedId);
    nextUsers.push(profile);
    this.writeAll(nextUsers);
    return profile;
  }

  ensureAdmin(): UserProfile {
    const existing = this.get("admin");
    if (existing) {
      this.ensureUserDirectories(existing);
      return existing;
    }
    return this.save({ id: "admin" });
  }

  private initialize(): void {
    if (!fs.existsSync(this.filePath)) {
      this.writeAll([]);
    }
  }

  private ensureUserDirectories(profile: UserProfile): void {
    ensureDir(profile.workspacePath);
    ensureDir(profile.dataDir);
    ensureDir(profile.logsDir);
    ensureDir(profile.pipelineDir);
  }

  private readAll(): UserProfile[] {
    const raw = fs.readFileSync(this.filePath, "utf-8");
    const parsed = JSON.parse(raw) as UserProfile[];
    return Array.isArray(parsed) ? parsed : [];
  }

  private writeAll(users: UserProfile[]): void {
    fs.writeFileSync(this.filePath, `${JSON.stringify(users, null, 2)}\n`, "utf-8");
  }
}
