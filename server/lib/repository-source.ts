import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import {
  decodeBase64Utf8,
  extractOwnerRepo,
  getGitHubHeaders,
  type GitHubTreeEntry,
} from "./github.js";

export type RepositorySource = "github-api" | "git-clone";

export interface RepositorySnapshot {
  owner: string;
  repo: string;
  source: RepositorySource;
  files: GitHubTreeEntry[];
  readTextFile: (filePath: string) => Promise<string | null>;
  readGitignore: () => Promise<string | null>;
}

const checkoutLocks = new Map<string, { promise: Promise<string>; createdAt: number }>();
const CHECKOUT_TTL_MS = 10 * 60 * 1000;

function pruneCheckoutLocks(): void {
  const now = Date.now();
  for (const [key, entry] of checkoutLocks) {
    if (now - entry.createdAt > CHECKOUT_TTL_MS) {
      checkoutLocks.delete(key);
    }
  }
}

function hasGitHubToken(userToken?: string): boolean {
  return Boolean(userToken || process.env.GITHUB_TOKEN);
}

function shouldUseCloneFallback(
  status: number,
  message: string,
  remainingHeader: string | null,
  userToken?: string,
): boolean {
  if (status === 429) return true;
  if (status === 403 && /rate limit/i.test(message)) return true;
  if (!hasGitHubToken(userToken)) {
    const remaining = Number(remainingHeader ?? "");
    if (Number.isFinite(remaining) && remaining >= 0 && remaining < 50) {
      return true;
    }
  }
  return false;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

async function ensureCheckoutRoot(): Promise<string> {
  const baseDir = process.env.DATA_DIR
    ? join(process.env.DATA_DIR, "repo-checkouts")
    : join(tmpdir(), "gitvisualizer-ai", "repo-checkouts");
  await fs.mkdir(baseDir, { recursive: true });
  return baseDir;
}

function getCheckoutPath(baseDir: string, owner: string, repo: string): string {
  const digest = createHash("sha1").update(`${owner}/${repo}`).digest("hex").slice(0, 12);
  return join(baseDir, `${sanitizeSegment(owner)}-${sanitizeSegment(repo)}-${digest}`);
}

async function runGit(args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args[0]} failed (${code}): ${(stderr || stdout).trim()}`));
    });
  });
}

async function isFreshCheckout(checkoutDir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(join(checkoutDir, ".git"));
    return Date.now() - stat.mtimeMs < CHECKOUT_TTL_MS;
  } catch {
    return false;
  }
}

async function ensurePublicCheckout(owner: string, repo: string): Promise<string> {
  pruneCheckoutLocks();

  const baseDir = await ensureCheckoutRoot();
  const checkoutDir = getCheckoutPath(baseDir, owner, repo);
  const lockKey = `${owner}/${repo}`.toLowerCase();
  const pending = checkoutLocks.get(lockKey);
  if (pending) return pending.promise;

  const promise = (async () => {
    if (await isFreshCheckout(checkoutDir)) return checkoutDir;
    await fs.rm(checkoutDir, { recursive: true, force: true });
    await runGit([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      `https://github.com/${owner}/${repo}.git`,
      checkoutDir,
    ]);
    return checkoutDir;
  })().finally(() => {
    checkoutLocks.delete(lockKey);
  });

  checkoutLocks.set(lockKey, { promise, createdAt: Date.now() });
  return promise;
}

async function listCheckoutFiles(checkoutDir: string): Promise<GitHubTreeEntry[]> {
  const files: GitHubTreeEntry[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const stat = await fs.stat(fullPath);
      files.push({
        path: relative(checkoutDir, fullPath).split(sep).join("/"),
        type: "blob",
        size: stat.size,
      });
    }
  }

  await walk(checkoutDir);
  return files;
}

async function readCheckoutTextFile(checkoutDir: string, filePath: string): Promise<string | null> {
  try {
    const normalizedPath = filePath.split("/").filter(Boolean);
    const absolutePath = join(checkoutDir, ...normalizedPath);
    return await fs.readFile(absolutePath, "utf-8");
  } catch {
    return null;
  }
}

async function loadClonedSnapshot(owner: string, repo: string): Promise<RepositorySnapshot> {
  const checkoutDir = await ensurePublicCheckout(owner, repo);
  const files = await listCheckoutFiles(checkoutDir);
  return {
    owner,
    repo,
    source: "git-clone",
    files,
    readTextFile: async (filePath: string) => await readCheckoutTextFile(checkoutDir, filePath),
    readGitignore: async () => await readCheckoutTextFile(checkoutDir, ".gitignore"),
  };
}

function buildGitHubApiError(status: number, message: string): Error {
  if (status === 404) {
    return new Error("Repository not found. For private repos, add a GitHub token.");
  }
  if (status === 403 && /rate limit/i.test(message)) {
    return new Error("GitHub API rate limit exceeded.");
  }
  return new Error(`GitHub API error (${status}): ${message}`);
}

export async function loadRepositorySnapshot(
  repoUrl: string,
  userToken?: string,
): Promise<RepositorySnapshot> {
  const { owner, repo } = extractOwnerRepo(repoUrl);
  const ghHeaders = getGitHubHeaders(userToken);
  let cloneSnapshotPromise: Promise<RepositorySnapshot> | null = null;
  const getCloneSnapshot = () => {
    if (!cloneSnapshotPromise) cloneSnapshotPromise = loadClonedSnapshot(owner, repo);
    return cloneSnapshotPromise;
  };

  const GITHUB_FETCH_TIMEOUT_MS = 30_000;

  function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  try {
    const treeRes = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, {
      headers: ghHeaders,
    });

    if (!treeRes.ok) {
      const errorText = await treeRes.text();
      if (shouldUseCloneFallback(treeRes.status, errorText, treeRes.headers.get("x-ratelimit-remaining"), userToken)) {
        return await getCloneSnapshot();
      }
      throw buildGitHubApiError(treeRes.status, errorText);
    }

    if (shouldUseCloneFallback(treeRes.status, "", treeRes.headers.get("x-ratelimit-remaining"), userToken)) {
      return await getCloneSnapshot();
    }

    const treeData = await treeRes.json();
    const files = (treeData.tree || []).filter((entry: GitHubTreeEntry) => entry.type === "blob");

    const readTextFile = async (filePath: string): Promise<string | null> => {
      try {
        const response = await fetchWithTimeout(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
          headers: ghHeaders,
        });
        if (!response.ok) {
          const errorText = await response.text();
          if (shouldUseCloneFallback(response.status, errorText, response.headers.get("x-ratelimit-remaining"), userToken)) {
            const cloneSnapshot = await getCloneSnapshot();
            return await cloneSnapshot.readTextFile(filePath);
          }
          return null;
        }

        const payload = await response.json();
        return payload.content ? decodeBase64Utf8(payload.content) : null;
      } catch {
        const cloneSnapshot = await getCloneSnapshot();
        return await cloneSnapshot.readTextFile(filePath);
      }
    };

    return {
      owner,
      repo,
      source: "github-api",
      files,
      readTextFile,
      readGitignore: async () => await readTextFile(".gitignore"),
    };
  } catch (apiError) {
    try {
      return await getCloneSnapshot();
    } catch (cloneError) {
      const combinedMessage = [
        apiError instanceof Error ? apiError.message : String(apiError),
        cloneError instanceof Error ? cloneError.message : String(cloneError),
      ].join("; fallback clone also failed: ");
      throw new Error(combinedMessage);
    }
  }
}
