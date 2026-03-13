export interface RepoNode {
  id: string;
  name: string;
  type: "folder" | "component" | "utility" | "hook" | "config" | "entry" | "style" | "test" | "database" | "api" | "model" | "other";
  summary: string;
  keyFunctions?: string[];
  tutorial?: string;
  codeSnippet?: string;
  path: string;
}

export interface RepoEdge {
  id: string;
  source: string;
  target: string;
  type: "imports" | "calls" | "inherits" | "contains";
  label?: string;
}

export interface AnalysisResult {
  repoName: string;
  repoUrl: string;
  nodes: RepoNode[];
  edges: RepoEdge[];
}
