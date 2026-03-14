export interface GitHubTreeEntry {
  path: string;
  type: string;
  size?: number;
}

const BLOCKED_DIRS = new Set([
  "node_modules",
  "venv",
  ".venv",
  "env",
  ".git",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  "vendor",
  "coverage",
  "__pycache__",
  ".cache",
  ".idea",
  ".vscode",
  ".gradle",
  "bower_components",
  ".terraform",
  ".serverless",
  "eggs",
  ".eggs",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".ico",
  ".mp4",
  ".mp3",
  ".wav",
  ".avi",
  ".mov",
  ".wmv",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".bz2",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".map",
  ".min.js",
  ".min.css",
]);

const LOCK_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "Pipfile.lock",
  "composer.lock",
  "Gemfile.lock",
  "Cargo.lock",
  "bun.lockb",
  "bun.lock",
  "shrinkwrap.json",
]);

const ALLOWED_HIDDEN_FILES = new Set([
  ".gitignore",
  ".env.example",
  ".editorconfig",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.json",
  ".prettierrc",
  ".prettierrc.json",
]);

const SOURCE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "scala",
  "rb",
  "php",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "css",
  "scss",
  "less",
  "html",
  "vue",
  "svelte",
  "sql",
  "graphql",
  "gql",
  "proto",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "md",
  "mdx",
  "txt",
  "env",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "swift",
  "dart",
  "lua",
  "ex",
  "exs",
  "erl",
  "hs",
]);

export function decodeBase64Utf8(base64: string): string {
  return Buffer.from(base64.replace(/\n/g, ""), "base64").toString("utf-8");
}

export function extractOwnerRepo(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

export function getGitHubHeaders(
  userToken?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "GitVisualizer-AI",
  };
  const token = userToken || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function isBlockedRepoPath(path: string, size?: number): boolean {
  const segments = path.split("/");
  for (const segment of segments.slice(0, -1)) {
    if (BLOCKED_DIRS.has(segment)) return true;
    if (segment.startsWith(".") && segment.length > 1 && segment !== ".github") {
      return true;
    }
  }

  const filename = segments[segments.length - 1];
  if (LOCK_FILES.has(filename)) return true;

  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex !== -1) {
    const extension = filename.slice(lastDotIndex).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(extension)) return true;

    const previousDotIndex = filename.lastIndexOf(".", lastDotIndex - 1);
    if (previousDotIndex !== -1) {
      const doubleExtension = filename.slice(previousDotIndex).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(doubleExtension)) return true;
    }
  }

  if (size !== undefined && size > 100 * 1024) return true;
  if (filename.startsWith(".") && !ALLOWED_HIDDEN_FILES.has(filename)) {
    return true;
  }

  return false;
}

export function isLikelySourceFile(path: string): boolean {
  const name = path.split("/").pop() || "";
  if (
    ["Makefile", "Dockerfile", "Procfile", "Rakefile", "Gemfile", "Pipfile"].includes(
      name,
    )
  ) {
    return true;
  }

  const extension = name.split(".").pop()?.toLowerCase() || "";
  return SOURCE_EXTENSIONS.has(extension);
}

export function repoFilePriority(path: string): number {
  const name = path.split("/").pop() || "";
  let score = 0;

  if (/^(index|main|app|server)\./i.test(name)) score += 10;
  if (/package\.json|tsconfig|Cargo\.toml|go\.mod|pyproject\.toml/i.test(name)) {
    score += 8;
  }
  if (/route|controller|handler|api/i.test(name)) score += 6;
  if (/hook|use[A-Z]/i.test(name)) score += 5;
  if (/component|page|view/i.test(path)) score += 4;
  if (/model|schema|types/i.test(name)) score += 4;
  if (/util|helper|lib/i.test(path)) score += 3;
  if (/\.test\.|\.spec\./i.test(name)) score -= 3;

  score -= Math.max(0, path.split("/").length - 3);
  return score;
}
