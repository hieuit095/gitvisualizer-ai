import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion } from "./lib/ai-client";
import { getCachedAnalysis, storeAnalysis, addHistory } from "./lib/store";

// ─── Smart Ignore Engine (same as Supabase version) ───────────────────

const BLOCKED_DIRS = new Set([
  "node_modules", "venv", ".venv", "env", ".git", "dist", "build", "out",
  "target", ".next", ".nuxt", "vendor", "coverage", "__pycache__", ".cache",
  ".idea", ".vscode", ".gradle", "bower_components", ".terraform", ".serverless",
  "eggs", ".eggs", ".tox", ".mypy_cache", ".pytest_cache",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico",
  ".mp4", ".mp3", ".wav", ".avi", ".mov", ".wmv",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt",
  ".zip", ".tar", ".gz", ".rar", ".7z", ".bz2",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".map", ".min.js", ".min.css",
]);

const LOCK_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock",
  "Pipfile.lock", "composer.lock", "Gemfile.lock", "Cargo.lock",
  "bun.lockb", "bun.lock", "shrinkwrap.json",
]);

const ALLOWED_HIDDEN_FILES = new Set([
  ".gitignore", ".env.example", ".editorconfig", ".eslintrc",
  ".eslintrc.js", ".eslintrc.json", ".prettierrc", ".prettierrc.json",
]);

function isBlockedByEngine(path: string, size?: number): boolean {
  const segments = path.split("/");
  for (const seg of segments.slice(0, -1)) {
    if (BLOCKED_DIRS.has(seg)) return true;
    if (seg.startsWith(".") && seg.length > 1 && seg !== ".github") return true;
  }
  const filename = segments[segments.length - 1];
  if (LOCK_FILES.has(filename)) return true;
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx !== -1) {
    const ext = filename.slice(dotIdx).toLowerCase();
    if (BLOCKED_EXTENSIONS.has(ext)) return true;
    const prevDot = filename.lastIndexOf(".", dotIdx - 1);
    if (prevDot !== -1) {
      const doubleExt = filename.slice(prevDot).toLowerCase();
      if (BLOCKED_EXTENSIONS.has(doubleExt)) return true;
    }
  }
  if (size !== undefined && size > 100 * 1024) return true;
  if (filename.startsWith(".") && !ALLOWED_HIDDEN_FILES.has(filename)) return true;
  return false;
}

const SOURCE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs",
  "py", "go", "rs", "java", "kt", "scala", "rb", "php",
  "json", "yaml", "yml", "toml", "xml",
  "css", "scss", "less", "html", "vue", "svelte",
  "sql", "graphql", "gql", "proto",
  "sh", "bash", "zsh", "ps1",
  "md", "mdx", "txt", "env",
  "c", "cpp", "h", "hpp", "cs", "swift", "dart", "lua", "ex", "exs", "erl", "hs",
]);

function isSourceFile(path: string): boolean {
  const name = path.split("/").pop() || "";
  if (["Makefile", "Dockerfile", "Procfile", "Rakefile", "Gemfile", "Pipfile"].includes(name)) return true;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return SOURCE_EXTENSIONS.has(ext);
}

function classifyFile(path: string): string {
  const name = path.split("/").pop() || "";
  if (/\.test\.|\.spec\.|__tests__|_test\./.test(path)) return "test";
  if (/\.css$|\.scss$|\.less$|\.styled\./i.test(name)) return "style";
  if (/^(index|main|app|server)\.(ts|tsx|js|jsx|py|go|rs)$/i.test(name)) return "entry";
  if (/config|\.config\.|\.env|tsconfig|package\.json|vite\.config|webpack|babel|jest\.config/i.test(name)) return "config";
  if (/hook|use[A-Z]/i.test(name)) return "hook";
  if (/model|schema|entity|types?\.(ts|js)/i.test(name)) return "model";
  if (/api|route|controller|handler|endpoint/i.test(name)) return "api";
  if (/database|migration|seed|prisma|drizzle/i.test(path)) return "database";
  if (/util|helper|lib/i.test(path)) return "utility";
  if (/component|page|view|layout|widget/i.test(path) || /\.(tsx|jsx|vue|svelte)$/.test(name)) return "component";
  return "other";
}

function filePriority(path: string): number {
  const name = path.split("/").pop() || "";
  let score = 0;
  if (/^(index|main|app|server)\./i.test(name)) score += 10;
  if (/package\.json|tsconfig|Cargo\.toml|go\.mod|pyproject\.toml/i.test(name)) score += 8;
  if (/route|controller|handler|api/i.test(name)) score += 6;
  if (/hook|use[A-Z]/i.test(name)) score += 5;
  if (/component|page|view/i.test(path)) score += 4;
  if (/model|schema|types/i.test(name)) score += 4;
  if (/util|helper|lib/i.test(path)) score += 3;
  if (/\.test\.|\.spec\./i.test(name)) score -= 3;
  score -= Math.max(0, path.split("/").length - 3);
  return score;
}

function decodeBase64Utf8(base64: string): string {
  return Buffer.from(base64.replace(/\n/g, ""), "base64").toString("utf-8");
}

function parseGitignore(content: string): ((path: string) => boolean) {
  const rules: { pattern: RegExp; negate: boolean }[] = [];
  for (const raw of content.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const negate = line.startsWith("!");
    if (negate) line = line.slice(1);
    let regex = line
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "§§")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/§§/g, ".*");
    if (line.endsWith("/")) regex = regex.slice(0, -2) + "(/|$)";
    if (!line.includes("/")) regex = "(^|.*/)" + regex;
    else if (!line.startsWith("/")) regex = "(^|.*/)" + regex;
    else regex = "^" + regex.slice(2);
    try { rules.push({ pattern: new RegExp(regex), negate }); } catch { }
  }
  return (path: string) => {
    let ignored = false;
    for (const rule of rules) {
      if (rule.pattern.test(path)) ignored = !rule.negate;
    }
    return ignored;
  };
}

async function fetchWithConcurrency<T>(
  items: T[], fn: (item: T) => Promise<void>, concurrency = 5, retries = 2
): Promise<void> {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      let attempt = 0;
      while (attempt <= retries) {
        try { await fn(item); break; } catch (e: any) {
          if (attempt < retries && (e?.status === 429 || e?.message?.includes("rate limit"))) {
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
            attempt++;
          } else { break; }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

// ─── Code Skeleton ────────────────────────────────────────────────────

interface SkeletonDeclaration {
  kind: string; name: string; signature: string; exported: boolean; startLine: number; children?: SkeletonDeclaration[];
}
interface CodeSkeleton { declarations: SkeletonDeclaration[]; skeletonText: string; }

const DECLARATION_PATTERNS: Array<{ pattern: RegExp; kind: string; nameGroup: number }> = [
  { pattern: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w,\s.]+))?/, kind: "class", nameGroup: 1 },
  { pattern: /^(?:export\s+)?interface\s+(\w+)(?:\s+extends\s+([\w,\s.]+))?/, kind: "interface", nameGroup: 1 },
  { pattern: /^(?:export\s+)?type\s+(\w+)\s*=/, kind: "type", nameGroup: 1 },
  { pattern: /^(?:export\s+)?enum\s+(\w+)/, kind: "enum", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(([^)]*)\)(?:\s*:\s*([^\s{]+))?/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+?))?\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*([^\s=>]+))?\s*=>/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*([^=]+?))?\s*=\s*(?:async\s+)?function/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*([^=;]+))?\s*[=;]/, kind: "const", nameGroup: 1 },
  { pattern: /^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/, kind: "function", nameGroup: 1 },
  { pattern: /^class\s+(\w+)(?:\(([^)]*)\))?/, kind: "class", nameGroup: 1 },
  { pattern: /^func\s+(?:\(\s*\w+\s+\*?(\w+)\s*\)\s+)?(\w+)\s*\(([^)]*)\)(?:\s*(?:\(([^)]*)\)|(\S+)))?/, kind: "function", nameGroup: 2 },
  { pattern: /^type\s+(\w+)\s+struct\s*\{/, kind: "class", nameGroup: 1 },
  { pattern: /^type\s+(\w+)\s+interface\s*\{/, kind: "interface", nameGroup: 1 },
  { pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:pub\s+)?struct\s+(\w+)/, kind: "class", nameGroup: 1 },
  { pattern: /^(?:pub\s+)?trait\s+(\w+)/, kind: "interface", nameGroup: 1 },
  { pattern: /^(?:pub\s+)?enum\s+(\w+)/, kind: "enum", nameGroup: 1 },
  { pattern: /^impl\s+(?:(\w+)\s+for\s+)?(\w+)/, kind: "impl", nameGroup: 2 },
  { pattern: /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: "class", nameGroup: 1 },
];

const METHOD_PATTERNS: RegExp[] = [
  /^\s+(?:public|private|protected|static|async|abstract|readonly|\s)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{;]+))?/,
  /^\s+(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/,
  /^\s+(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/,
];

function extractCodeSkeleton(content: string, _filePath: string): CodeSkeleton {
  const lines = content.split("\n");
  const declarations: SkeletonDeclaration[] = [];
  const skeletonLines: string[] = [];
  let braceDepth = 0;
  let currentContainer: SkeletonDeclaration | null = null;
  let containerStartDepth = 0;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (inBlockComment) { if (trimmed.includes("*/")) inBlockComment = false; continue; }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) { inBlockComment = true; continue; }
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
      braceDepth += opens - closes; if (braceDepth < 0) braceDepth = 0; continue;
    }
    const isExported = /^export\s/.test(trimmed) || /^pub\s/.test(trimmed);

    if (currentContainer && braceDepth > containerStartDepth) {
      for (const mp of METHOD_PATTERNS) {
        const mm = trimmed.match(mp);
        if (mm) {
          const methodName = mm[1]; const params = mm[2] ? mm[2].replace(/\s+/g, " ").trim() : ""; const ret = mm[3] || "";
          const sig = `  ${methodName}(${params})${ret ? ": " + ret : ""}`;
          if (!currentContainer.children) currentContainer.children = [];
          currentContainer.children.push({ kind: "method", name: methodName, signature: sig, exported: false, startLine: i + 1 });
          skeletonLines.push(sig); break;
        }
      }
      braceDepth += opens - closes; if (braceDepth < 0) braceDepth = 0;
      if (braceDepth <= containerStartDepth) { skeletonLines.push("}"); currentContainer = null; }
      continue;
    }

    if (braceDepth <= 1) {
      for (const dp of DECLARATION_PATTERNS) {
        const dm = trimmed.match(dp.pattern);
        if (dm) {
          const name = dm[dp.nameGroup] || "anonymous";
          if (dp.kind === "class" || dp.kind === "impl") {
            const ext = dm[2] ? ` extends ${dm[2]}` : "";
            const impl = dm[3] ? ` implements ${dm[3].trim()}` : "";
            const signature = dp.kind === "impl"
              ? (dm[1] ? `impl ${dm[1]} for ${name} {` : `impl ${name} {`)
              : `class ${name}${ext}${impl} {`;
            const decl: SkeletonDeclaration = { kind: dp.kind, name, signature, exported: isExported, startLine: i + 1, children: [] };
            declarations.push(decl); currentContainer = decl; containerStartDepth = braceDepth;
            skeletonLines.push(`${isExported ? "export " : ""}${signature}`);
          } else if (dp.kind === "function") {
            const params = (dm[2] || dm[3] || "").replace(/\s+/g, " ").trim();
            const ret = dm[3] || dm[4] || "";
            const signature = `function ${name}(${params})${ret ? ": " + ret : ""}`;
            declarations.push({ kind: "function", name, signature, exported: isExported, startLine: i + 1 });
            skeletonLines.push(`${isExported ? "export " : ""}${signature}`);
          } else {
            const signature = `${dp.kind} ${name}${dp.kind === "interface" && dm[2] ? ` extends ${dm[2].trim()}` : ""} ${dp.kind === "interface" || dp.kind === "enum" ? "{ ... }" : ""}`.trim();
            declarations.push({ kind: dp.kind, name, signature, exported: isExported, startLine: i + 1 });
            skeletonLines.push(`${isExported ? "export " : ""}${signature}`);
          }
          break;
        }
      }
    }
    braceDepth += opens - closes; if (braceDepth < 0) braceDepth = 0;
    if (currentContainer && braceDepth <= containerStartDepth) { skeletonLines.push("}"); currentContainer = null; }
  }
  return { declarations, skeletonText: skeletonLines.join("\n") };
}

interface ShallowFileInfo {
  path: string; type: string; imports: string[]; exports: string[]; signatures: string[];
  lineCount?: number; exportCount?: number; skeleton?: CodeSkeleton;
}

function extractShallowInfo(path: string, content: string): ShallowFileInfo {
  const imports: string[] = []; const exports: string[] = []; const signatures: string[] = [];
  const importRegex = /(?:import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?['"]([^'"]+)['"]|from\s+(\S+)\s+import|require\(['"]([^'"]+)['"]\))/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) { const mod = match[1] || match[2] || match[3]; if (mod) imports.push(mod); }
  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
  while ((match = exportRegex.exec(content)) !== null) { if (match[1]) exports.push(match[1]); }
  const sigRegex = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|def\s+(\w+)|func\s+(\w+)|fn\s+(\w+))/gm;
  while ((match = sigRegex.exec(content)) !== null) {
    const name = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
    if (name) signatures.push(name);
  }
  return { path, type: classifyFile(path), imports, exports, signatures, lineCount: content.split("\n").length, exportCount: exports.length };
}

function extractOwnerRepo(url: string) {
  const match = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/);
  if (!match) throw new Error("Invalid GitHub URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function getGitHubHeaders(userToken?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json", "User-Agent": "GitVisualizer-AI" };
  const token = userToken || process.env.GITHUB_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function validateAnalysisResult(parsed: { nodes: any[]; edges: any[] }, knownPaths: Set<string>) {
  const errors: { type: string; message: string }[] = [];
  const nodeIds = new Set<string>();
  for (const node of parsed.nodes) {
    if (!knownPaths.has(node.path) && !knownPaths.has(node.path + "/")) {
      const isFolder = node.type === "folder";
      const isFolderPrefix = isFolder && [...knownPaths].some(p => p.startsWith(node.path + "/") || p.startsWith(node.path));
      if (!isFolderPrefix) errors.push({ type: "invalid_path", message: `Node "${node.id}" references path "${node.path}" not in file list` });
    }
    if (nodeIds.has(node.id)) errors.push({ type: "duplicate_id", message: `Duplicate node id "${node.id}"` });
    nodeIds.add(node.id);
  }
  for (const edge of parsed.edges) {
    if (!nodeIds.has(edge.source)) errors.push({ type: "invalid_edge_ref", message: `Edge source "${edge.source}" not found` });
    if (!nodeIds.has(edge.target)) errors.push({ type: "invalid_edge_ref", message: `Edge target "${edge.target}" not found` });
  }
  return errors;
}

// ─── Main Handler ──────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { repoUrl, githubToken, forceRefresh } = req.body;
    if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });

    const { owner, repo } = extractOwnerRepo(repoUrl);

    // Check cache first
    if (!forceRefresh) {
      const cached = getCachedAnalysis(repoUrl);
      if (cached?.result) {
        res.setHeader("Content-Type", "application/x-ndjson");
        res.write(JSON.stringify({ type: "progress", step: "done", message: "Loaded from cache" }) + "\n");
        res.write(JSON.stringify({ type: "result", data: { ...cached.result, cached: true, _cacheId: cached.id } }) + "\n");
        return res.end();
      }
    }

    const ghHeaders = getGitHubHeaders(githubToken);
    res.setHeader("Content-Type", "application/x-ndjson");

    const send = (data: Record<string, unknown>) => {
      res.write(JSON.stringify(data) + "\n");
    };

    // Step 1: Fetch repo tree
    send({ type: "progress", step: "fetch", message: "Fetching repository tree..." });
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`, { headers: ghHeaders });
    if (!treeRes.ok) {
      const errText = await treeRes.text();
      if (treeRes.status === 403 && errText.includes("rate limit")) throw new Error("GitHub API rate limit exceeded.");
      if (treeRes.status === 404) throw new Error("Repository not found. For private repos, add a GitHub token.");
      throw new Error(`GitHub API error (${treeRes.status}): ${errText}`);
    }
    const treeData = await treeRes.json();
    const allFiles = (treeData.tree || []).filter((f: any) => f.type === "blob");
    const totalFiles = allFiles.length;
    send({ type: "progress", step: "fetch_done", message: `Fetched ${totalFiles} files`, totalFiles });

    // Step 2: Filter
    send({ type: "progress", step: "filter", message: "Applying Smart Ignore filters..." });
    let gitignoreFilter: ((path: string) => boolean) | null = null;
    try {
      const giRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.gitignore`, { headers: ghHeaders });
      if (giRes.ok) { const d = await giRes.json(); if (d.content) gitignoreFilter = parseGitignore(decodeBase64Utf8(d.content)); }
      else await giRes.text();
    } catch { }

    const afterEngine = allFiles.filter((f: any) => !isBlockedByEngine(f.path, f.size));
    const afterGitignore = gitignoreFilter ? afterEngine.filter((f: any) => !gitignoreFilter!(f.path)) : afterEngine;
    const sourceFiles = afterGitignore.filter((f: any) => isSourceFile(f.path));
    const filteredOut = totalFiles - sourceFiles.length;
    send({ type: "progress", step: "filter_done", message: `Filtered ${filteredOut} files, keeping ${sourceFiles.length}`, filteredOut, kept: sourceFiles.length });

    const prioritized = sourceFiles.sort((a: any, b: any) => filePriority(b.path) - filePriority(a.path));
    const MAX_FILES = 80;
    const limitedFiles = prioritized.slice(0, MAX_FILES);
    const wasTruncated = sourceFiles.length > MAX_FILES;

    // Step 3: Extract
    send({ type: "progress", step: "extract", message: `Extracting from ${limitedFiles.length} files...` });
    const contentTargets = limitedFiles.slice(0, 40);
    const fileContents: Record<string, string> = {};
    const fileSkeletons: Record<string, CodeSkeleton> = {};

    await fetchWithConcurrency(contentTargets, async (f: any) => {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`, { headers: ghHeaders });
      if (r.ok) {
        const d = await r.json();
        if (d.content) {
          const decoded = decodeBase64Utf8(d.content);
          fileContents[f.path] = decoded;
          fileSkeletons[f.path] = extractCodeSkeleton(decoded, f.path);
        }
      } else { await r.text(); }
    }, 5, 2);

    const shallowMap = limitedFiles.map((f: any) => {
      const content = fileContents[f.path];
      if (content) { const info = extractShallowInfo(f.path, content); info.skeleton = fileSkeletons[f.path]; return info; }
      return { path: f.path, type: classifyFile(f.path), imports: [], exports: [], signatures: [] } as ShallowFileInfo;
    });

    send({ type: "progress", step: "extract_done", message: `Extracted data from ${Object.keys(fileSkeletons).length} files` });

    // Step 4: AI analysis
    send({ type: "progress", step: "analyze", message: "AI analyzing architecture..." });

    const shallowSummary = shallowMap.map(f => {
      let line = `- ${f.path} [${f.type}]`;
      if (f.lineCount) line += ` (${f.lineCount} lines)`;
      if (f.exports.length) line += ` exports: ${f.exports.slice(0, 8).join(", ")}`;
      if (f.imports.length) line += ` imports: ${f.imports.slice(0, 8).join(", ")}`;
      if (f.signatures.length) line += ` fns: ${f.signatures.slice(0, 6).join(", ")}`;
      return line;
    }).join("\n");

    const skeletonSection = Object.entries(fileSkeletons)
      .filter(([, sk]) => sk.skeletonText.trim().length > 0)
      .slice(0, 30)
      .map(([path, sk]) => `### ${path}\n\`\`\`\n${sk.skeletonText}\n\`\`\``)
      .join("\n\n");

    const folders = new Set<string>();
    limitedFiles.forEach((f: any) => {
      const parts = f.path.split("/");
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join("/"));
    });

    const knownPaths = new Set<string>(limitedFiles.map((f: any) => f.path));
    [...folders].forEach(f => knownPaths.add(f));

    const truncationNote = wasTruncated ? `\nNote: ${totalFiles} total files, ${sourceFiles.length} after filtering, showing ${limitedFiles.length}.\n` : "";

    const buildPrompt = (retryErrors?: string) => {
      let retryNote = retryErrors ? `\n\n## FIX THESE ERRORS:\n${retryErrors}\n` : "";
      return `Analyze this GitHub repository "${owner}/${repo}" and create a system architecture diagram.
${truncationNote}
## Shallow Analysis
${shallowSummary}

## Key Directories
${[...folders].slice(0, 40).join("\n")}

## Code Skeletons
${skeletonSection}
${retryNote}
## STRICT RULES
1. ONLY reference files from the list above.
2. Every edge source/target must reference a defined node ID.
3. No duplicate node IDs.

## Output Instructions
Generate ~20-35 significant nodes with: id, name, type, summary, keyFunctions, path
Generate edges with: id, source, target, type, label`;
    };

    const toolSchema = {
      type: "function" as const,
      function: {
        name: "create_architecture_diagram",
        description: "Create architecture diagram",
        parameters: {
          type: "object",
          properties: {
            nodes: {
              type: "array", items: {
                type: "object", properties: {
                  id: { type: "string" }, name: { type: "string" },
                  type: { type: "string", enum: ["folder", "component", "utility", "hook", "config", "entry", "style", "test", "database", "api", "model", "other"] },
                  summary: { type: "string" }, keyFunctions: { type: "array", items: { type: "string" } }, path: { type: "string" },
                }, required: ["id", "name", "type", "summary", "path"], additionalProperties: false,
              },
            },
            edges: {
              type: "array", items: {
                type: "object", properties: {
                  id: { type: "string" }, source: { type: "string" }, target: { type: "string" },
                  type: { type: "string", enum: ["imports", "calls", "inherits", "contains"] }, label: { type: "string" },
                }, required: ["id", "source", "target", "type"], additionalProperties: false,
              },
            },
          }, required: ["nodes", "edges"], additionalProperties: false,
        },
      },
    };

    const callAI = async (prompt: string) => {
      const aiRes = await chatCompletion(
        [
          { role: "system", content: "You are a software architecture analyzer. Produce structured architecture diagrams. ONLY reference files that exist in the provided data." },
          { role: "user", content: prompt },
        ],
        { tools: [toolSchema], tool_choice: { type: "function", function: { name: "create_architecture_diagram" } } }
      );
      if (!aiRes.ok) {
        if (aiRes.status === 429) throw new Error("Rate limit exceeded.");
        throw new Error(`AI analysis failed (${aiRes.status})`);
      }
      return aiRes.json();
    };

    let aiData = await callAI(buildPrompt());
    let toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("AI did not return structured data");

    let parsed = JSON.parse(toolCall.function.arguments);

    // Validation + retry
    const validationErrors = validateAnalysisResult(parsed, knownPaths);
    if (validationErrors.length > 0) {
      send({ type: "progress", step: "validate_retry", message: `Fixing ${validationErrors.length} errors...` });
      const errorList = validationErrors.map(e => `- ${e.message}`).join("\n");
      try {
        const retryData = await callAI(buildPrompt(errorList));
        const retryToolCall = retryData.choices?.[0]?.message?.tool_calls?.[0];
        if (retryToolCall?.function?.arguments) {
          const retryParsed = JSON.parse(retryToolCall.function.arguments);
          if (validateAnalysisResult(retryParsed, knownPaths).length < validationErrors.length) parsed = retryParsed;
        }
      } catch { }

      // Auto-fix
      const validNodeIds = new Set<string>();
      parsed.nodes = (parsed.nodes || []).filter((n: any) => {
        const pathValid = knownPaths.has(n.path) || [...knownPaths].some(p => p.startsWith(n.path + "/"));
        if (pathValid) validNodeIds.add(n.id); return pathValid;
      });
      const seenIds = new Set<string>();
      parsed.nodes = parsed.nodes.filter((n: any) => { if (seenIds.has(n.id)) return false; seenIds.add(n.id); return true; });
      parsed.edges = (parsed.edges || []).filter((e: any) => validNodeIds.has(e.source) && validNodeIds.has(e.target));
    }

    send({ type: "progress", step: "done", message: "Building diagram..." });

    const result: any = {
      repoName: `${owner}/${repo}`, repoUrl, totalFiles, wasTruncated,
      filteredFiles: sourceFiles.length, filteredOut,
      nodes: parsed.nodes || [], edges: parsed.edges || [],
    };

    // Store in cache (in-memory + optional disk)
    try {
      const cacheId = storeAnalysis({
        repo_url: repoUrl,
        repo_name: `${owner}/${repo}`,
        result,
        total_files: totalFiles,
        node_count: (parsed.nodes || []).length,
        edge_count: (parsed.edges || []).length,
        was_truncated: wasTruncated,
      });
      result._cacheId = cacheId;
      addHistory({
        repo_url: repoUrl,
        repo_name: `${owner}/${repo}`,
        cache_id: cacheId,
        node_count: (parsed.nodes || []).length,
        edge_count: (parsed.edges || []).length,
      });
    } catch (e) { console.error("Cache store error:", e); }

    send({ type: "result", data: result });
    res.end();
  } catch (e: any) {
    console.error("analyze-repo error:", e);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || "Unknown error" });
    } else {
      res.write(JSON.stringify({ type: "error", error: e.message || "Unknown error" }) + "\n");
      res.end();
    }
  }
}
