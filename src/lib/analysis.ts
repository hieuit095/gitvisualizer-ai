import { supabase } from "@/integrations/supabase/client";
import type { AnalysisResult, ProgressEvent, NodeDetail } from "@/types/repo";

export type ProgressCallback = (event: ProgressEvent) => void;

export async function analyzeRepository(
  repoUrl: string,
  githubToken?: string,
  onProgress?: ProgressCallback
): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke("analyze-repo", {
    body: { repoUrl, githubToken },
  });

  if (error) {
    throw new Error(error.message || "Failed to analyze repository");
  }

  // Handle streaming NDJSON response
  if (typeof data === "string") {
    const lines = data.trim().split("\n");
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

  // Handle non-streaming JSON (fallback)
  if (data?.error) throw new Error(data.error);
  return data as AnalysisResult;
}

export async function fetchNodeDetail(
  repoUrl: string,
  filePath: string,
  nodeSummary?: string,
  githubToken?: string
): Promise<NodeDetail> {
  const { data, error } = await supabase.functions.invoke("summarize-node", {
    body: { repoUrl, filePath, nodeSummary, githubToken },
  });

  if (error) throw new Error(error.message || "Failed to load file details");
  if (data?.error) throw new Error(data.error);
  return data as NodeDetail;
}
