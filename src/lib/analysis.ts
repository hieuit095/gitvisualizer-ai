import { supabase } from "@/integrations/supabase/client";
import type { AnalysisResult } from "@/types/repo";

export async function analyzeRepository(repoUrl: string): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke("analyze-repo", {
    body: { repoUrl },
  });

  if (error) {
    throw new Error(error.message || "Failed to analyze repository");
  }

  return data as AnalysisResult;
}
