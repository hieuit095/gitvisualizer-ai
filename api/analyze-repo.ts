import type { VercelRequest, VercelResponse } from "@vercel/node";
import { chatCompletion } from "./lib/ai-client.js";
import { getCachedAnalysis, storeAnalysis, addHistory } from "./lib/store.js";
import {
  decodeBase64Utf8,
  extractOwnerRepo,
  getGitHubHeaders,
  isBlockedRepoPath as isBlockedByEngine,
  isLikelySourceFile as isSourceFile,
  repoFilePriority as filePriority,
} from "./lib/github.js";
import { analyzeSourceFile, type FileStaticAnalysis } from "./lib/static-analysis.js";

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
    send({ type: "progress", step: "extract", message: `Running Tree-sitter static analysis on ${limitedFiles.length} files...` });
    const contentTargets = limitedFiles.slice(0, 40);
    const fileContents: Record<string, string> = {};
    const fileAnalyses: Record<string, FileStaticAnalysis> = {};

    await fetchWithConcurrency(contentTargets, async (f: any) => {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`, { headers: ghHeaders });
      if (r.ok) {
        const d = await r.json();
        if (d.content) {
          const decoded = decodeBase64Utf8(d.content);
          fileContents[f.path] = decoded;
          fileAnalyses[f.path] = analyzeSourceFile(decoded, f.path);
        }
      } else { await r.text(); }
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

    const aiData = await callAI(buildPrompt());
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
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
