import type { VercelRequest, VercelResponse } from "@vercel/node";
import { posix } from "node:path";
import { chatCompletion } from "../lib/ai-client.js";
import { getCachedAnalysis, storeAnalysis, addHistory } from "../lib/store.js";
import {
  isBlockedRepoPath as isBlockedByEngine,
  isLikelySourceFile as isSourceFile,
  repoFilePriority as filePriority,
} from "../lib/github.js";
import { loadRepositorySnapshot } from "../lib/repository-source.js";
import { analyzeSourceFile, type FileStaticAnalysis } from "../lib/static-analysis.js";
import { extractStructuredArguments } from "../lib/structured-output.js";

// ─── Smart Ignore Engine (same as Supabase version) ───────────────────

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

interface ShallowFileInfo {
  path: string; type: string; imports: string[]; exports: string[]; signatures: string[];
  lineCount?: number; exportCount?: number; analysis?: FileStaticAnalysis;
}

function extractShallowInfo(path: string, content: string, analysis: FileStaticAnalysis): ShallowFileInfo {
  const signatures = analysis.topLevelSymbols.map((symbol) => symbol.name).filter(Boolean);
  return {
    path,
    type: classifyFile(path),
    imports: analysis.imports,
    exports: analysis.exports,
    signatures,
    lineCount: content.split("\n").length,
    exportCount: analysis.exports.length,
    analysis,
  };
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

function normalizeDiagramResult(payload: any): { nodes: any[]; edges: any[] } & Record<string, any> {
  const base = payload?.parameters && typeof payload.parameters === "object"
    ? payload.parameters
    : payload;

  const toArray = (value: any) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    return [];
  };

  return {
    ...(base && typeof base === "object" ? base : {}),
    nodes: toArray(base?.nodes),
    edges: toArray(base?.edges),
  };
}

function summarizeStaticFile(file: ShallowFileInfo): string {
  const parts: string[] = [];
  if (file.analysis?.parser && file.analysis.parser !== "fallback") parts.push(`parser ${file.analysis.parser}`);
  if (file.analysis?.classes?.length) parts.push(`${file.analysis.classes.length} classes`);
  if (file.analysis?.functions?.length) parts.push(`${file.analysis.functions.length} functions`);
  if (file.analysis?.variables?.length) parts.push(`${file.analysis.variables.length} variables`);
  if (file.exports.length) parts.push(`${file.exports.length} exports`);
  if (file.imports.length) parts.push(`${file.imports.length} imports`);
  return parts.length > 0 ? `Static analysis found ${parts.join(", ")}.` : "Static analysis summary unavailable.";
}

function makeDiagramId(prefix: string, value: string): string {
  return `${prefix}_${value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node"}`;
}

function resolveRelativeImport(fromPath: string, specifier: string, knownPaths: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null;

  const basePath = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${basePath}.json`,
    posix.join(basePath, "index.ts"),
    posix.join(basePath, "index.tsx"),
    posix.join(basePath, "index.js"),
    posix.join(basePath, "index.jsx"),
  ];

  for (const candidate of candidates) {
    if (knownPaths.has(candidate)) return candidate;
  }

  return null;
}

function buildStaticDiagramFallback(shallowMap: ShallowFileInfo[]) {
  const selectedFiles = shallowMap
    .filter((file) => file.analysis || file.imports.length > 0 || file.exports.length > 0)
    .slice(0, 26);

  const nodes: any[] = [];
  const edges: any[] = [];
  const nodeIdByPath = new Map<string, string>();
  const knownPaths = new Set(shallowMap.map((file) => file.path));

  const folderPaths = [...new Set(
    selectedFiles
      .filter((file) => file.path.includes("/"))
      .map((file) => file.path.split("/")[0])
      .filter((folder) => Boolean(folder)),
  )].slice(0, 6);

  for (const folderPath of folderPaths) {
    const folderId = makeDiagramId("folder", folderPath);
    nodeIdByPath.set(folderPath, folderId);
    nodes.push({
      id: folderId,
      name: folderPath,
      type: "folder",
      summary: `Top-level directory containing ${selectedFiles.filter((file) => file.path.startsWith(`${folderPath}/`)).length} prioritized files.`,
      keyFunctions: [],
      path: folderPath,
    });
  }

  for (const file of selectedFiles) {
    const fileId = makeDiagramId("file", file.path);
    nodeIdByPath.set(file.path, fileId);
    const keyFunctions = [
      ...(file.analysis?.functions || []),
      ...(file.analysis?.classes || []),
      ...file.exports,
      ...file.signatures,
    ].filter(Boolean).slice(0, 6);

    nodes.push({
      id: fileId,
      name: file.path.split("/").pop() || file.path,
      type: file.type,
      summary: summarizeStaticFile(file),
      keyFunctions,
      path: file.path,
    });

    const folderPath = file.path.includes("/") ? file.path.split("/")[0] : null;
    const folderId = folderPath ? nodeIdByPath.get(folderPath) : undefined;
    if (folderId) {
      edges.push({
        id: makeDiagramId("edge_contains", `${folderPath}_${file.path}`),
        source: folderId,
        target: fileId,
        type: "contains",
        label: "contains",
      });
    }
  }

  const selectedPaths = new Set(selectedFiles.map((file) => file.path));
  for (const file of selectedFiles) {
    const sourceId = nodeIdByPath.get(file.path);
    if (!sourceId) continue;

    for (const specifier of file.imports.slice(0, 12)) {
      const targetPath = resolveRelativeImport(file.path, specifier, knownPaths);
      if (!targetPath || !selectedPaths.has(targetPath)) continue;

      const targetId = nodeIdByPath.get(targetPath);
      if (!targetId || targetId === sourceId) continue;

      const edgeId = makeDiagramId("edge_import", `${file.path}_${targetPath}`);
      if (edges.some((edge) => edge.id === edgeId)) continue;

      edges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        type: "imports",
        label: specifier,
      });
    }
  }

  return { nodes, edges };
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

    res.setHeader("Content-Type", "application/x-ndjson");

    const send = (data: Record<string, unknown>) => {
      res.write(JSON.stringify(data) + "\n");
    };

    // Step 1: Fetch repo tree
    send({ type: "progress", step: "fetch", message: "Fetching repository tree..." });
    const repoSnapshot = await loadRepositorySnapshot(repoUrl, githubToken);
    const { owner, repo } = repoSnapshot;
    const allFiles = repoSnapshot.files.filter((f: any) => f.type === "blob");
    const totalFiles = allFiles.length;
    send({
      type: "progress",
      step: "fetch_done",
      message: `Fetched ${totalFiles} files via ${repoSnapshot.source}`,
      totalFiles,
      source: repoSnapshot.source,
    });

    // Step 2: Filter
    send({ type: "progress", step: "filter", message: "Applying Smart Ignore filters..." });
    let gitignoreFilter: ((path: string) => boolean) | null = null;
    try {
      const gitignoreContent = await repoSnapshot.readGitignore();
      if (gitignoreContent) gitignoreFilter = parseGitignore(gitignoreContent);
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
    send({ type: "progress", step: "extract", message: `Running Tree-sitter static analysis on ${limitedFiles.length} files...` });
    const contentTargets = limitedFiles.slice(0, 40);
    const fileContents: Record<string, string> = {};
    const fileAnalyses: Record<string, FileStaticAnalysis> = {};

    await fetchWithConcurrency(contentTargets, async (f: any) => {
      const decoded = await repoSnapshot.readTextFile(f.path);
      if (!decoded) return;
      fileContents[f.path] = decoded;
      fileAnalyses[f.path] = analyzeSourceFile(decoded, f.path);
    }, 5, 2);

    const shallowMap = limitedFiles.map((f: any) => {
      const content = fileContents[f.path];
      if (content) return extractShallowInfo(f.path, content, fileAnalyses[f.path]);
      return { path: f.path, type: classifyFile(f.path), imports: [], exports: [], signatures: [] } as ShallowFileInfo;
    });

    send({ type: "progress", step: "extract_done", message: `Built static skeletons for ${Object.keys(fileAnalyses).length} files` });

    // Step 4: AI analysis
    send({ type: "progress", step: "analyze", message: "AI analyzing architecture..." });

    const shallowSummary = shallowMap.map(f => {
      let line = `- ${f.path} [${f.type}]`;
      if (f.lineCount) line += ` (${f.lineCount} lines)`;
      if (f.analysis?.parser) line += ` parser: ${f.analysis.parser}`;
      if (f.exports.length) line += ` exports: ${f.exports.slice(0, 8).join(", ")}`;
      if (f.imports.length) line += ` imports: ${f.imports.slice(0, 8).join(", ")}`;
      if (f.analysis?.classes?.length) line += ` classes: ${f.analysis.classes.slice(0, 4).join(", ")}`;
      if (f.analysis?.functions?.length) line += ` functions: ${f.analysis.functions.slice(0, 6).join(", ")}`;
      if (f.analysis?.variables?.length) line += ` variables: ${f.analysis.variables.slice(0, 6).join(", ")}`;
      if (f.signatures.length && !f.analysis?.functions?.length) line += ` symbols: ${f.signatures.slice(0, 6).join(", ")}`;
      return line;
    }).join("\n");

    const skeletonSection = Object.entries(fileAnalyses)
      .filter(([, analysis]) => analysis.skeletonText.trim().length > 0)
      .slice(0, 30)
      .map(([path, analysis]) => `### ${path}\n\`\`\`\n${analysis.skeletonText}\n\`\`\``)
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
      const retryNote = retryErrors ? `\n\n## FIX THESE ERRORS:\n${retryErrors}\n` : "";
      return `Analyze this GitHub repository "${owner}/${repo}" and create a system architecture diagram.
${truncationNote}
## Static Analysis Assistant
The following structure was generated with Tree-sitter parsers when possible, with a lightweight fallback for unsupported files.
Treat it as the primary map of classes, functions, variables, imports, and containment relationships.
${shallowSummary}

## Key Directories
${[...folders].slice(0, 40).join("\n")}

## Code Skeletons
These skeletons intentionally omit implementation details so you can reason about structure without reading internal logic.
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
      const messages = [
        { role: "system" as const, content: "You are a software architecture analyzer. Produce structured architecture diagrams. ONLY reference files that exist in the provided data." },
        { role: "user" as const, content: prompt },
      ];
      const aiRes = await chatCompletion(
        messages,
        { tools: [toolSchema], tool_choice: { type: "function", function: { name: "create_architecture_diagram" } } }
      );
      if (!aiRes.ok) {
        if (aiRes.status === 429) throw new Error("Rate limit exceeded.");
        throw new Error(`AI analysis failed (${aiRes.status})`);
      }

      const aiData = await aiRes.json();
      const structuredArguments = extractStructuredArguments(aiData);
      if (structuredArguments) return structuredArguments;
      console.error("analyze-repo primary structured output missing:", JSON.stringify(aiData).slice(0, 4000));

      const fallbackRes = await chatCompletion(
        [
          { role: "system", content: "You are a software architecture analyzer. Return ONLY valid JSON. No markdown, no commentary." },
          {
            role: "user",
            content: `${prompt}\n\nReturn ONLY a JSON object matching this schema:\n${JSON.stringify(toolSchema.function.parameters)}`,
          },
        ],
      );
      if (!fallbackRes.ok) {
        if (fallbackRes.status === 429) throw new Error("Rate limit exceeded.");
        throw new Error(`AI analysis fallback failed (${fallbackRes.status})`);
      }

      const fallbackData = await fallbackRes.json();
      const fallbackArguments = extractStructuredArguments(fallbackData);
      if (!fallbackArguments) {
        console.error("analyze-repo fallback structured output missing:", JSON.stringify(fallbackData).slice(0, 4000));
      }
      if (!fallbackArguments) throw new Error("AI did not return structured data");
      return fallbackArguments;
    };

    let parsed = normalizeDiagramResult(JSON.parse(await callAI(buildPrompt())));

    // Validation + retry
    const validationErrors = validateAnalysisResult(parsed, knownPaths);
    if (validationErrors.length > 0) {
      send({ type: "progress", step: "validate_retry", message: `Fixing ${validationErrors.length} errors...` });
      const errorList = validationErrors.map(e => `- ${e.message}`).join("\n");
      try {
        const retryParsed = normalizeDiagramResult(JSON.parse(await callAI(buildPrompt(errorList))));
        if (validateAnalysisResult(retryParsed, knownPaths).length < validationErrors.length) parsed = retryParsed;
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

    if (parsed.nodes.length === 0 || parsed.edges.length === 0) {
      const fallbackDiagram = buildStaticDiagramFallback(shallowMap);
      if (fallbackDiagram.nodes.length > 0) {
        send({
          type: "progress",
          step: "fallback",
          message: "AI diagram was incomplete. Building a deterministic static-analysis diagram...",
        });
        parsed = fallbackDiagram;
      }
    }

    send({ type: "progress", step: "done", message: "Building diagram..." });

    const result: any = {
      repoName: `${owner}/${repo}`, repoUrl, totalFiles, wasTruncated,
      filteredFiles: sourceFiles.length, filteredOut,
      fetchSource: repoSnapshot.source,
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
