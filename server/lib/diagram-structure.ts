import { posix } from "node:path";

import { repoFilePriority } from "./github.js";
import type { FileStaticAnalysis } from "./static-analysis.js";

export interface ShallowFileInfo {
  path: string;
  type: string;
  imports: string[];
  exports: string[];
  signatures: string[];
  lineCount?: number;
  exportCount?: number;
  analysis?: FileStaticAnalysis;
}

export interface DiagramNode {
  id: string;
  name: string;
  type: string;
  summary: string;
  keyFunctions: string[];
  path: string;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  type: "imports" | "calls" | "inherits" | "contains";
  label?: string;
}

export interface DiagramPayload {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface ImportConfigFile {
  path: string;
  content: string;
}

interface ImportAliasRule {
  keyPattern: string;
  baseRoot: string;
  targetPatterns: string[];
}

export interface ImportResolutionContext {
  knownPaths: Set<string>;
  aliasRules: ImportAliasRule[];
  baseDirs: string[];
  bareBaseDirs: string[];
}

interface ResolvedImport {
  specifier: string;
  targetPath: string;
}

export interface DeterministicDiagramOptions {
  maxFiles?: number;
  maxFolders?: number;
  preferredPaths?: string[];
}

const DEFAULT_MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".json",
  ".d.ts",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cs",
];

const IMPORTER_EXTENSION_PRIORITY: Record<string, string[]> = {
  ".ts": [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".d.ts", ".json"],
  ".tsx": [".tsx", ".ts", ".jsx", ".js", ".mts", ".cts", ".d.ts", ".json"],
  ".js": [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json"],
  ".jsx": [".jsx", ".js", ".tsx", ".ts", ".mjs", ".cjs", ".json"],
  ".mjs": [".mjs", ".js", ".jsx", ".ts", ".tsx", ".json"],
  ".cjs": [".cjs", ".js", ".jsx", ".ts", ".tsx", ".json"],
  ".mts": [".mts", ".ts", ".tsx", ".js", ".jsx", ".json"],
  ".cts": [".cts", ".ts", ".tsx", ".js", ".jsx", ".json"],
  ".py": [".py"],
  ".go": [".go"],
  ".rs": [".rs"],
  ".java": [".java"],
  ".cs": [".cs"],
};

export function summarizeStaticFile(file: ShallowFileInfo): string {
  const parts: string[] = [];
  if (file.analysis?.parser && file.analysis.parser !== "fallback") parts.push(`parser ${file.analysis.parser}`);
  if (file.analysis?.classes?.length) parts.push(`${file.analysis.classes.length} classes`);
  if (file.analysis?.functions?.length) parts.push(`${file.analysis.functions.length} functions`);
  if (file.analysis?.variables?.length) parts.push(`${file.analysis.variables.length} variables`);
  if (file.exports.length) parts.push(`${file.exports.length} exports`);
  if (file.imports.length) parts.push(`${file.imports.length} imports`);
  return parts.length > 0 ? `Static analysis found ${parts.join(", ")}.` : "Static analysis summary unavailable.";
}

export function makeDiagramId(prefix: string, value: string): string {
  return `${prefix}_${value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node"}`;
}

export function buildImportResolutionContext(
  knownPaths: Set<string>,
  configFiles: ImportConfigFile[] = [],
): ImportResolutionContext {
  const aliasRules: ImportAliasRule[] = [];
  const configuredBaseDirs = new Set<string>();

  for (const configFile of configFiles) {
    const parsed = safeParseJsonConfig(configFile.content);
    const compilerOptions = parsed?.compilerOptions;
    if (!compilerOptions || typeof compilerOptions !== "object") continue;

    const configDir = normalizeDirectory(posix.dirname(configFile.path));
    const baseUrl = typeof compilerOptions.baseUrl === "string"
      ? normalizeDirectory(posix.join(configDir, compilerOptions.baseUrl))
      : configDir;

    if (compilerOptions.baseUrl === "." || compilerOptions.baseUrl === "./") {
      configuredBaseDirs.add(baseUrl);
    } else if (typeof compilerOptions.baseUrl === "string") {
      configuredBaseDirs.add(baseUrl);
    }

    const paths = compilerOptions.paths;
    if (!paths || typeof paths !== "object") continue;

    for (const [keyPattern, value] of Object.entries(paths)) {
      if (!Array.isArray(value)) continue;
      const targetPatterns = value.filter((entry): entry is string => typeof entry === "string");
      if (targetPatterns.length === 0) continue;
      aliasRules.push({
        keyPattern,
        baseRoot: baseUrl,
        targetPatterns,
      });
    }
  }

  const discoveredBaseDirs = collectCommonBaseDirs(knownPaths);
  const baseDirs = uniqueStrings([...configuredBaseDirs, ...discoveredBaseDirs]);
  const bareBaseDirs = uniqueStrings([...configuredBaseDirs]);

  return {
    knownPaths,
    aliasRules,
    baseDirs,
    bareBaseDirs,
  };
}

export function resolveImportSpecifier(
  fromPath: string,
  specifier: string,
  context: ImportResolutionContext,
): string | null {
  const normalizedSpecifier = normalizeImportSpecifier(specifier);
  if (!normalizedSpecifier) return null;

  const importerExt = posix.extname(fromPath).toLowerCase();
  const baseCandidates: string[] = [];

  if (normalizedSpecifier.startsWith(".")) {
    baseCandidates.push(posix.normalize(posix.join(posix.dirname(fromPath), normalizedSpecifier)));
  }

  for (const aliasTarget of applyAliasRules(normalizedSpecifier, context.aliasRules)) {
    baseCandidates.push(aliasTarget);
  }

  if (normalizedSpecifier.startsWith("@/")) {
    baseCandidates.push(posix.join("src", normalizedSpecifier.slice(2)));
  }

  if (normalizedSpecifier.startsWith("~/")) {
    baseCandidates.push(posix.join("src", normalizedSpecifier.slice(2)));
    baseCandidates.push(normalizedSpecifier.slice(2));
  }

  if (!normalizedSpecifier.startsWith(".") && !normalizedSpecifier.startsWith("/") && normalizedSpecifier.includes("/")) {
    baseCandidates.push(posix.normalize(normalizedSpecifier));
    for (const baseDir of context.baseDirs) {
      baseCandidates.push(posix.normalize(posix.join(baseDir, normalizedSpecifier)));
    }
  }

  if (
    importerExt === ".py"
    && !normalizedSpecifier.startsWith(".")
    && !normalizedSpecifier.startsWith("/")
  ) {
    const pythonModulePath = normalizedSpecifier.replace(/\./g, "/");
    baseCandidates.push(pythonModulePath);
    for (const baseDir of context.baseDirs) {
      baseCandidates.push(posix.normalize(posix.join(baseDir, pythonModulePath)));
    }
  }

  if (
    !normalizedSpecifier.startsWith(".")
    && !normalizedSpecifier.startsWith("/")
    && !normalizedSpecifier.includes("/")
    && context.bareBaseDirs.length > 0
  ) {
    for (const baseDir of context.bareBaseDirs) {
      baseCandidates.push(posix.normalize(posix.join(baseDir, normalizedSpecifier)));
    }
  }

  for (const baseCandidate of uniqueStrings(baseCandidates)) {
    if (context.knownPaths.has(baseCandidate)) return baseCandidate;

    for (const candidate of expandModuleCandidates(baseCandidate, importerExt)) {
      if (context.knownPaths.has(candidate)) return candidate;
    }
  }

  return null;
}

export function buildDeterministicDiagram(
  shallowMap: ShallowFileInfo[],
  context: ImportResolutionContext,
  options: DeterministicDiagramOptions = {},
): DiagramPayload {
  const maxFiles = options.maxFiles ?? 30;
  const maxFolders = options.maxFolders ?? 10;
  const filesByPath = new Map(shallowMap.map((file) => [file.path, file]));
  const resolvedImportsByPath = new Map<string, ResolvedImport[]>();
  const importersByPath = new Map<string, Set<string>>();

  for (const file of shallowMap) {
    const resolvedImports = resolveFileImports(file, context);
    resolvedImportsByPath.set(file.path, resolvedImports);

    for (const resolvedImport of resolvedImports) {
      if (!importersByPath.has(resolvedImport.targetPath)) {
        importersByPath.set(resolvedImport.targetPath, new Set());
      }
      importersByPath.get(resolvedImport.targetPath)!.add(file.path);
    }
  }

  const scoreByPath = new Map<string, number>(
    shallowMap.map((file) => [
      file.path,
      computeStructuralScore(
        file,
        resolvedImportsByPath.get(file.path)?.length || 0,
        importersByPath.get(file.path)?.size || 0,
      ),
    ]),
  );

  const rankedPaths = shallowMap
    .map((file) => file.path)
    .sort((left, right) => compareByScoreThenPath(left, right, scoreByPath));

  const selectedPaths = selectDiagramPaths(rankedPaths, resolvedImportsByPath, importersByPath, filesByPath, scoreByPath, {
    maxFiles,
    preferredPaths: options.preferredPaths || [],
  });

  const selectedFiles = Array.from(selectedPaths)
    .map((path) => filesByPath.get(path))
    .filter((file): file is ShallowFileInfo => Boolean(file))
    .sort((left, right) => left.path.localeCompare(right.path));

  const groupedDirectories = collectGroupedDirectories(selectedFiles, maxFolders);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const nodeIdByPath = new Map<string, string>();

  for (const folderPath of groupedDirectories) {
    const folderId = makeDiagramId("folder", folderPath);
    nodeIdByPath.set(folderPath, folderId);
    nodes.push({
      id: folderId,
      name: formatFolderLabel(folderPath),
      type: "folder",
      summary: `Contains ${selectedFiles.filter((file) => posix.dirname(file.path) === folderPath).length} related files in the diagram.`,
      keyFunctions: [],
      path: folderPath,
    });
  }

  for (const file of selectedFiles) {
    const fileId = makeDiagramId("file", file.path);
    nodeIdByPath.set(file.path, fileId);
    nodes.push({
      id: fileId,
      name: posix.basename(file.path),
      type: file.type,
      summary: summarizeStaticFile(file),
      keyFunctions: collectKeyFunctions(file),
      path: file.path,
    });

    const parentDirectory = posix.dirname(file.path);
    if (groupedDirectories.has(parentDirectory)) {
      edges.push({
        id: makeDiagramId("edge_contains", `${parentDirectory}_${file.path}`),
        source: nodeIdByPath.get(parentDirectory)!,
        target: fileId,
        type: "contains",
        label: "contains",
      });
    }
  }

  for (const file of selectedFiles) {
    const sourceId = nodeIdByPath.get(file.path);
    if (!sourceId) continue;

    for (const resolvedImport of resolvedImportsByPath.get(file.path) || []) {
      if (!selectedPaths.has(resolvedImport.targetPath)) continue;

      const targetId = nodeIdByPath.get(resolvedImport.targetPath);
      if (!targetId || targetId === sourceId) continue;

      const edgeId = makeDiagramId("edge_import", `${file.path}_${resolvedImport.targetPath}`);
      if (edges.some((edge) => edge.id === edgeId)) continue;

      edges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        type: "imports",
        label: resolvedImport.specifier,
      });
    }
  }

  return { nodes, edges };
}

export function mergeDiagramWithStaticStructure(
  aiDiagram: DiagramPayload | null | undefined,
  shallowMap: ShallowFileInfo[],
  context: ImportResolutionContext,
  options: DeterministicDiagramOptions = {},
): DiagramPayload {
  const aiPreferredPaths = uniqueStrings(
    (aiDiagram?.nodes || [])
      .filter((node) => node.type !== "folder" && typeof node.path === "string")
      .map((node) => node.path),
  );

  const structuralDiagram = buildDeterministicDiagram(shallowMap, context, {
    ...options,
    preferredPaths: aiPreferredPaths,
  });

  if (!aiDiagram || aiDiagram.nodes.length === 0) {
    return structuralDiagram;
  }

  const aiNodesByPath = new Map(
    aiDiagram.nodes
      .filter((node) => typeof node.path === "string")
      .map((node) => [node.path, node]),
  );

  const mergedNodes = structuralDiagram.nodes.map((node) => {
    if (node.type === "folder") return node;

    const aiNode = aiNodesByPath.get(node.path);
    if (!aiNode) return node;

    return {
      ...node,
      name: aiNode.name || node.name,
      type: aiNode.type && aiNode.type !== "folder" ? aiNode.type : node.type,
      summary: aiNode.summary || node.summary,
      keyFunctions: aiNode.keyFunctions?.length ? aiNode.keyFunctions.slice(0, 6) : node.keyFunctions,
    };
  });

  const fileNodeIdByPath = new Map(
    mergedNodes
      .filter((node) => node.type !== "folder")
      .map((node) => [node.path, node.id]),
  );

  const aiNodePathById = new Map(
    aiDiagram.nodes
      .filter((node) => typeof node.id === "string" && typeof node.path === "string")
      .map((node) => [node.id, node.path]),
  );

  const mergedEdges = [...structuralDiagram.edges];
  const edgeKeys = new Set(mergedEdges.map((edge) => `${edge.source}::${edge.target}::${edge.type}`));

  for (const aiEdge of aiDiagram.edges || []) {
    if (aiEdge.type === "contains") continue;

    const sourcePath = aiNodePathById.get(aiEdge.source);
    const targetPath = aiNodePathById.get(aiEdge.target);
    if (!sourcePath || !targetPath) continue;

    const sourceId = fileNodeIdByPath.get(sourcePath);
    const targetId = fileNodeIdByPath.get(targetPath);
    if (!sourceId || !targetId || sourceId === targetId) continue;

    const edgeKey = `${sourceId}::${targetId}::${aiEdge.type}`;
    if (edgeKeys.has(edgeKey)) continue;
    edgeKeys.add(edgeKey);

    mergedEdges.push({
      id: makeDiagramId(`edge_${aiEdge.type}`, `${sourcePath}_${targetPath}`),
      source: sourceId,
      target: targetId,
      type: aiEdge.type,
      label: aiEdge.label,
    });
  }

  return {
    nodes: mergedNodes,
    edges: mergedEdges,
  };
}

function resolveFileImports(
  file: ShallowFileInfo,
  context: ImportResolutionContext,
): ResolvedImport[] {
  const seenTargets = new Set<string>();
  const resolved: ResolvedImport[] = [];

  for (const specifier of file.imports.slice(0, 16)) {
    const targetPath = resolveImportSpecifier(file.path, specifier, context);
    if (!targetPath || seenTargets.has(targetPath)) continue;
    seenTargets.add(targetPath);
    resolved.push({ specifier, targetPath });
  }

  return resolved;
}

function selectDiagramPaths(
  rankedPaths: string[],
  resolvedImportsByPath: Map<string, ResolvedImport[]>,
  importersByPath: Map<string, Set<string>>,
  filesByPath: Map<string, ShallowFileInfo>,
  scoreByPath: Map<string, number>,
  options: { maxFiles: number; preferredPaths: string[] },
): Set<string> {
  const selected = new Set<string>();
  const queue: string[] = [];

  const tryAdd = (path: string) => {
    if (!filesByPath.has(path) || selected.has(path) || selected.size >= options.maxFiles) return false;
    selected.add(path);
    queue.push(path);
    return true;
  };

  for (const preferredPath of options.preferredPaths.sort((left, right) => compareByScoreThenPath(left, right, scoreByPath))) {
    tryAdd(preferredPath);
  }

  if (selected.size === 0) {
    const seedCount = Math.min(options.maxFiles, Math.max(10, Math.ceil(options.maxFiles / 3)));
    for (const path of rankedPaths) {
      if (selected.size >= seedCount) break;
      tryAdd(path);
    }
  }

  while (queue.length > 0 && selected.size < options.maxFiles) {
    const current = queue.shift()!;
    const neighbors = uniqueStrings([
      ...(resolvedImportsByPath.get(current) || []).map((entry) => entry.targetPath),
      ...Array.from(importersByPath.get(current) || []),
    ]).sort((left, right) => compareByScoreThenPath(left, right, scoreByPath));

    for (const neighbor of neighbors) {
      if (selected.size >= options.maxFiles) break;
      tryAdd(neighbor);
    }
  }

  for (const path of rankedPaths) {
    if (selected.size >= options.maxFiles) break;
    tryAdd(path);
  }

  return selected;
}

function collectGroupedDirectories(selectedFiles: ShallowFileInfo[], maxFolders: number): Set<string> {
  const counts = new Map<string, number>();

  for (const file of selectedFiles) {
    const directory = posix.dirname(file.path);
    if (!directory || directory === ".") continue;
    counts.set(directory, (counts.get(directory) || 0) + 1);
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count >= 2)
      .sort((left, right) => {
        if (right[1] !== left[1]) return right[1] - left[1];
        return left[0].localeCompare(right[0]);
      })
      .slice(0, maxFolders)
      .map(([directory]) => directory),
  );
}

function collectKeyFunctions(file: ShallowFileInfo): string[] {
  return uniqueStrings([
    ...(file.analysis?.functions || []),
    ...(file.analysis?.classes || []),
    ...file.exports,
    ...file.signatures,
  ]).slice(0, 6);
}

function computeStructuralScore(file: ShallowFileInfo, importCount: number, importerCount: number): number {
  const classCount = file.analysis?.classes?.length || 0;
  const functionCount = file.analysis?.functions?.length || 0;
  const variableCount = file.analysis?.variables?.length || 0;
  const symbolCount = classCount + functionCount + variableCount;
  const exportedCount = file.exports.length || file.exportCount || 0;

  let score = repoFilePriority(file.path) * 4;
  score += importCount * 3;
  score += importerCount * 4;
  score += exportedCount * 2;
  score += Math.min(symbolCount, 8);
  if (file.analysis && file.analysis.supported) score += 4;
  if (file.type === "entry") score += 10;
  if (file.type === "api") score += 5;
  if (file.type === "component" || file.type === "hook") score += 3;
  if (importCount === 0 && importerCount === 0 && symbolCount === 0) score -= 2;
  return score;
}

function compareByScoreThenPath(left: string, right: string, scoreByPath: Map<string, number>): number {
  const leftScore = scoreByPath.get(left) || 0;
  const rightScore = scoreByPath.get(right) || 0;
  if (rightScore !== leftScore) return rightScore - leftScore;
  return left.localeCompare(right);
}

function applyAliasRules(specifier: string, aliasRules: ImportAliasRule[]): string[] {
  const results: string[] = [];

  for (const aliasRule of aliasRules) {
    if (aliasRule.keyPattern.includes("*")) {
      const [prefix, suffix] = aliasRule.keyPattern.split("*");
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix || "")) continue;

      const wildcardValue = specifier.slice(prefix.length, specifier.length - (suffix?.length || 0));
      for (const targetPattern of aliasRule.targetPatterns) {
        results.push(normalizeDirectory(posix.join(aliasRule.baseRoot, targetPattern.replace("*", wildcardValue))));
      }
      continue;
    }

    if (specifier !== aliasRule.keyPattern) continue;
    for (const targetPattern of aliasRule.targetPatterns) {
      results.push(normalizeDirectory(posix.join(aliasRule.baseRoot, targetPattern)));
    }
  }

  return uniqueStrings(results);
}

function expandModuleCandidates(basePath: string, importerExt: string): string[] {
  const candidates: string[] = [];
  const extensions = uniqueStrings([
    ...(IMPORTER_EXTENSION_PRIORITY[importerExt] || []),
    ...DEFAULT_MODULE_EXTENSIONS,
  ]);

  candidates.push(basePath);

  if (!posix.extname(basePath)) {
    for (const extension of extensions) {
      candidates.push(`${basePath}${extension}`);
      candidates.push(posix.join(basePath, `index${extension}`));
    }
    candidates.push(posix.join(basePath, "__init__.py"));
  }

  return uniqueStrings(candidates);
}

function collectCommonBaseDirs(knownPaths: Set<string>): string[] {
  const roots = new Set<string>();
  const commonRoots = ["src", "app", "server", "lib"];

  for (const root of commonRoots) {
    if (Array.from(knownPaths).some((path) => path.startsWith(`${root}/`))) {
      roots.add(root);
    }
  }

  for (const path of knownPaths) {
    const match = path.match(/^(packages\/[^/]+\/src)\//);
    if (match) roots.add(match[1]);
  }

  return Array.from(roots);
}

function formatFolderLabel(folderPath: string): string {
  const parts = folderPath.split("/").filter(Boolean);
  if (parts.length <= 2) return folderPath;
  return parts.slice(-2).join("/");
}

function normalizeImportSpecifier(specifier: string): string {
  return specifier.replace(/[?#].*$/, "").trim();
}

function normalizeDirectory(value: string): string {
  const normalized = posix.normalize(value);
  return normalized === "." ? "" : normalized.replace(/\/+$/, "");
}

function safeParseJsonConfig(content: string): Record<string, any> | null {
  try {
    return JSON.parse(stripJsonComments(content));
  } catch {
    return null;
  }
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
