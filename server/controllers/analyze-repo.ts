import type { VercelRequest, VercelResponse } from "@vercel/node";

import { chatCompletion } from "../lib/ai-client.js";
import {
  buildImportResolutionContext,
  mergeDiagramWithStaticStructure,
  type ImportConfigFile,
  type ShallowFileInfo,
} from "../lib/diagram-structure.js";
import {
  isBlockedRepoPath as isBlockedByEngine,
  isLikelySourceFile as isSourceFile,
  repoFilePriority as filePriority,
} from "../lib/github.js";
import { loadRepositorySnapshot } from "../lib/repository-source.js";
import { analyzeSourceFile, type FileStaticAnalysis } from "../lib/static-analysis.js";
import { getCachedAnalysis, storeAnalysis, addHistory } from "../lib/store.js";
import { extractStructuredArguments } from "../lib/structured-output.js";

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
      .replace(/\*\*/g, "__DOUBLE_STAR__")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/__DOUBLE_STAR__/g, ".*");

    if (line.endsWith("/")) regex = regex.slice(0, -2) + "(/|$)";
    if (!line.includes("/")) regex = "(^|.*/)" + regex;
    else if (!line.startsWith("/")) regex = "(^|.*/)" + regex;
    else regex = "^" + regex.slice(2);

    try {
      rules.push({ pattern: new RegExp(regex), negate });
    } catch {
      // Ignore malformed rules and keep the analyzer moving.
    }
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
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency = 5,
  retries = 2,
): Promise<void> {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      const item = items[currentIndex];
      let attempt = 0;

      while (attempt <= retries) {
        try {
          await fn(item);
          break;
        } catch (error: any) {
          if (attempt < retries && (error?.status === 429 || error?.message?.includes("rate limit"))) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
            attempt++;
          } else {
            break;
          }
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
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
      const isFolderPrefix = isFolder && [...knownPaths].some((path) => path.startsWith(node.path + "/") || path.startsWith(node.path));
      if (!isFolderPrefix) {
        errors.push({ type: "invalid_path", message: `Node "${node.id}" references path "${node.path}" not in file list` });
      }
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

async function loadImportConfigFiles(
  configPaths: string[],
  readTextFile: (filePath: string) => Promise<string | null>,
): Promise<ImportConfigFile[]> {
  const configFiles: ImportConfigFile[] = [];

  await fetchWithConcurrency(
    configPaths,
    async (configPath: string) => {
      const content = await readTextFile(configPath);
      if (!content) return;
      configFiles.push({ path: configPath, content });
    },
    3,
    1,
  );

  return configFiles.sort((left, right) => left.path.localeCompare(right.path));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { repoUrl, githubToken, forceRefresh } = req.body;
    if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });

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

    send({ type: "progress", step: "fetch", message: "Fetching repository tree..." });
    const repoSnapshot = await loadRepositorySnapshot(repoUrl, githubToken);
    const { owner, repo } = repoSnapshot;
    const allFiles = repoSnapshot.files.filter((file: any) => file.type === "blob");
    const totalFiles = allFiles.length;

    send({
      type: "progress",
      step: "fetch_done",
      message: `Fetched ${totalFiles} files via ${repoSnapshot.source}`,
      totalFiles,
      source: repoSnapshot.source,
    });

    send({ type: "progress", step: "filter", message: "Applying Smart Ignore filters..." });
    let gitignoreFilter: ((path: string) => boolean) | null = null;

    try {
      const gitignoreContent = await repoSnapshot.readGitignore();
      if (gitignoreContent) gitignoreFilter = parseGitignore(gitignoreContent);
    } catch {
      // A missing or unreadable .gitignore is not fatal.
    }

    const afterEngine = allFiles.filter((file: any) => !isBlockedByEngine(file.path, file.size));
    const afterGitignore = gitignoreFilter ? afterEngine.filter((file: any) => !gitignoreFilter!(file.path)) : afterEngine;
    const sourceFiles = afterGitignore.filter((file: any) => isSourceFile(file.path));
    const filteredOut = totalFiles - sourceFiles.length;

    send({
      type: "progress",
      step: "filter_done",
      message: `Filtered ${filteredOut} files, keeping ${sourceFiles.length}`,
      filteredOut,
      kept: sourceFiles.length,
    });

    const prioritized = sourceFiles.sort((left: any, right: any) => filePriority(right.path) - filePriority(left.path));
    const MAX_FILES = 80;
    const limitedFiles = prioritized.slice(0, MAX_FILES);
    const wasTruncated = sourceFiles.length > MAX_FILES;
    const importConfigPaths = allFiles
      .map((file: any) => file.path)
      .filter((path: string) => /(^|\/)(?:tsconfig|jsconfig)(?:\.[^/]+)?\.json$/i.test(path))
      .sort((left: string, right: string) => left.length - right.length)
      .slice(0, 6);

    send({ type: "progress", step: "extract", message: `Running Tree-sitter static analysis on ${limitedFiles.length} files...` });
    const fileContents: Record<string, string> = {};
    const fileAnalyses: Record<string, FileStaticAnalysis> = {};
    const importConfigFiles = await loadImportConfigFiles(importConfigPaths, repoSnapshot.readTextFile);

    await fetchWithConcurrency(
      limitedFiles,
      async (file: any) => {
        const decoded = await repoSnapshot.readTextFile(file.path);
        if (!decoded) return;
        fileContents[file.path] = decoded;
        fileAnalyses[file.path] = analyzeSourceFile(decoded, file.path);
      },
      5,
      2,
    );

    const shallowMap = limitedFiles.map((file: any) => {
      const content = fileContents[file.path];
      if (content) return extractShallowInfo(file.path, content, fileAnalyses[file.path]);
      return { path: file.path, type: classifyFile(file.path), imports: [], exports: [], signatures: [] } as ShallowFileInfo;
    });

    send({
      type: "progress",
      step: "extract_done",
      message: `Built static skeletons for ${Object.keys(fileAnalyses).length} files`,
    });

    const importContext = buildImportResolutionContext(
      new Set(shallowMap.map((file) => file.path)),
      importConfigFiles,
    );

    send({ type: "progress", step: "analyze", message: "AI analyzing architecture..." });

    const shallowSummary = shallowMap.map((file) => {
      let line = `- ${file.path} [${file.type}]`;
      if (file.lineCount) line += ` (${file.lineCount} lines)`;
      if (file.analysis?.parser) line += ` parser: ${file.analysis.parser}`;
      if (file.exports.length) line += ` exports: ${file.exports.slice(0, 8).join(", ")}`;
      if (file.imports.length) line += ` imports: ${file.imports.slice(0, 8).join(", ")}`;
      if (file.analysis?.classes?.length) line += ` classes: ${file.analysis.classes.slice(0, 4).join(", ")}`;
      if (file.analysis?.functions?.length) line += ` functions: ${file.analysis.functions.slice(0, 6).join(", ")}`;
      if (file.analysis?.variables?.length) line += ` variables: ${file.analysis.variables.slice(0, 6).join(", ")}`;
      if (file.signatures.length && !file.analysis?.functions?.length) line += ` symbols: ${file.signatures.slice(0, 6).join(", ")}`;
      return line;
    }).join("\n");

    const skeletonSection = Object.entries(fileAnalyses)
      .filter(([, analysis]) => analysis.skeletonText.trim().length > 0)
      .slice(0, 30)
      .map(([path, analysis]) => `### ${path}\n\`\`\`\n${analysis.skeletonText}\n\`\`\``)
      .join("\n\n");

    const folders = new Set<string>();
    limitedFiles.forEach((file: any) => {
      const parts = file.path.split("/");
      for (let index = 1; index < parts.length; index++) {
        folders.add(parts.slice(0, index).join("/"));
      }
    });

    const knownPaths = new Set<string>(limitedFiles.map((file: any) => file.path));
    [...folders].forEach((folder) => knownPaths.add(folder));

    const truncationNote = wasTruncated
      ? `\nNote: ${totalFiles} total files, ${sourceFiles.length} after filtering, showing ${limitedFiles.length}.\n`
      : "";

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
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  type: {
                    type: "string",
                    enum: ["folder", "component", "utility", "hook", "config", "entry", "style", "test", "database", "api", "model", "other"],
                  },
                  summary: { type: "string" },
                  keyFunctions: { type: "array", items: { type: "string" } },
                  path: { type: "string" },
                },
                required: ["id", "name", "type", "summary", "path"],
                additionalProperties: false,
              },
            },
            edges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  source: { type: "string" },
                  target: { type: "string" },
                  type: { type: "string", enum: ["imports", "calls", "inherits", "contains"] },
                  label: { type: "string" },
                },
                required: ["id", "source", "target", "type"],
                additionalProperties: false,
              },
            },
          },
          required: ["nodes", "edges"],
          additionalProperties: false,
        },
      },
    };

    const callAI = async (prompt: string) => {
      const messages = [
        {
          role: "system" as const,
          content: "You are a software architecture analyzer. Produce structured architecture diagrams. ONLY reference files that exist in the provided data.",
        },
        { role: "user" as const, content: prompt },
      ];

      const aiRes = await chatCompletion(
        messages,
        { tools: [toolSchema], tool_choice: { type: "function", function: { name: "create_architecture_diagram" } } },
      );

      if (!aiRes.ok) {
        if (aiRes.status === 429) throw new Error("Rate limit exceeded.");
        throw new Error(`AI analysis failed (${aiRes.status})`);
      }

      const aiData = await aiRes.json();
      const structuredArguments = extractStructuredArguments(aiData);
      if (structuredArguments) return structuredArguments;
      console.error("analyze-repo primary structured output missing:", JSON.stringify(aiData).slice(0, 4000));

      const fallbackRes = await chatCompletion([
        { role: "system", content: "You are a software architecture analyzer. Return ONLY valid JSON. No markdown, no commentary." },
        {
          role: "user",
          content: `${prompt}\n\nReturn ONLY a JSON object matching this schema:\n${JSON.stringify(toolSchema.function.parameters)}`,
        },
      ]);

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

    const validationErrors = validateAnalysisResult(parsed, knownPaths);
    if (validationErrors.length > 0) {
      send({ type: "progress", step: "validate_retry", message: `Fixing ${validationErrors.length} errors...` });
      const errorList = validationErrors.map((error) => `- ${error.message}`).join("\n");

      try {
        const retryParsed = normalizeDiagramResult(JSON.parse(await callAI(buildPrompt(errorList))));
        if (validateAnalysisResult(retryParsed, knownPaths).length < validationErrors.length) {
          parsed = retryParsed;
        }
      } catch {
        // Fall through to deterministic cleanup.
      }

      const validNodeIds = new Set<string>();
      parsed.nodes = (parsed.nodes || []).filter((node: any) => {
        const pathValid = knownPaths.has(node.path) || [...knownPaths].some((path) => path.startsWith(node.path + "/"));
        if (pathValid) validNodeIds.add(node.id);
        return pathValid;
      });

      const seenIds = new Set<string>();
      parsed.nodes = parsed.nodes.filter((node: any) => {
        if (seenIds.has(node.id)) return false;
        seenIds.add(node.id);
        return true;
      });
      parsed.edges = (parsed.edges || []).filter((edge: any) => validNodeIds.has(edge.source) && validNodeIds.has(edge.target));
    }

    const mergedDiagram = mergeDiagramWithStaticStructure(parsed, shallowMap, importContext, {
      maxFiles: 30,
      maxFolders: 10,
    });
    if (mergedDiagram.nodes.length > 0) {
      parsed = mergedDiagram;
    }

    send({ type: "progress", step: "done", message: "Building diagram..." });

    const result: any = {
      repoName: `${owner}/${repo}`,
      repoUrl,
      totalFiles,
      wasTruncated,
      filteredFiles: sourceFiles.length,
      filteredOut,
      fetchSource: repoSnapshot.source,
      nodes: parsed.nodes || [],
      edges: parsed.edges || [],
    };

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
    } catch (error) {
      console.error("Cache store error:", error);
    }

    send({ type: "result", data: result });
    res.end();
  } catch (error: any) {
    console.error("analyze-repo error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || "Unknown error" });
    } else {
      res.write(JSON.stringify({ type: "error", error: error.message || "Unknown error" }) + "\n");
      res.end();
    }
  }
}
