export interface RepoNode {
  id: string;
  name: string;
  type: "folder" | "component" | "utility" | "hook" | "config" | "entry" | "style" | "test" | "database" | "api" | "model" | "other";
  summary: string;
  keyFunctions?: string[];
  tutorial?: string;
  codeSnippet?: string;
  path: string;
  /** Whether detailed AI analysis has been loaded for this node */
  detailLoaded?: boolean;
}

export interface RepoEdge {
  id: string;
  source: string;
  target: string;
  type: "imports" | "calls" | "inherits" | "contains";
  label?: string;
}

export interface ProgressEvent {
  type: "progress";
  step: string;
  message: string;
  totalFiles?: number;
  filteredOut?: number;
  kept?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AnalysisResult {
  repoName: string;
  repoUrl: string;
  totalFiles?: number;
  wasTruncated?: boolean;
  filteredFiles?: number;
  filteredOut?: number;
  nodes: RepoNode[];
  edges: RepoEdge[];
}

export interface CodeReference {
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface NodeDetail {
  summary: string;
  keyFunctions: string[];
  tutorial: string;
  codeSnippet: string;
  references?: CodeReference[];
}
