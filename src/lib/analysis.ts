import type { AnalysisResult, ProgressEvent, NodeDetail } from "@/types/repo";

export type ProgressCallback = (event: ProgressEvent) => void;

export async function analyzeRepository(
  repoUrl: string,
  githubToken?: string,
  onProgress?: ProgressCallback,
  forceRefresh = false
): Promise<AnalysisResult> {
  const res = await fetch("/api/analyze-repo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, githubToken, forceRefresh }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to analyze repository (${res.status})`);
  }

  const text = await res.text();
  const lines = text.trim().split("\n");
  let result: AnalysisResult | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "progress" && onProgress) {
        onProgress(parsed as ProgressEvent);
      } else if (parsed.type === "result") {
        result = parsed.data as AnalysisResult;
      } else if (parsed.type === "error") {
        throw new Error(parsed.error);
      }
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }

  if (!result) throw new Error("No result received from analysis");
  return result;
}

export async function fetchNodeDetail(
  repoUrl: string,
  filePath: string,
  nodeSummary?: string,
  githubToken?: string
): Promise<NodeDetail> {
  const res = await fetch("/api/summarize-node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, filePath, nodeSummary, githubToken }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load file details");
  }
  return res.json();
}
