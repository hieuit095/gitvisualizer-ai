import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { getStoredToken } from "@/components/GitHubTokenDialog";
import { analyzeRepository } from "@/lib/analysis";
import { loadCachedAnalysis, cacheAnalysis } from "@/lib/analysisCache";
import type { AnalysisResult, RepoNode, ProgressEvent, NodeDetail } from "@/types/repo";

const stepMapping: Record<string, number> = {
  fetch: 0, fetch_done: 0,
  filter: 1, filter_done: 1,
  extract: 2, extract_done: 2,
  analyze: 3,
  done: 4,
};

export function useRepoAnalysis(repoUrl: string) {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const [progressEvents, setProgressEvents] = useState<ProgressEvent[]>([]);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [repoName, setRepoName] = useState("");
  const [repoMeta, setRepoMeta] = useState<{
    totalFiles?: number;
    wasTruncated?: boolean;
    filteredOut?: number;
  }>({});

  const applyResult = useCallback((result: AnalysisResult) => {
    setProgressStep(4);
    setRepoName(result.repoName);
    setAnalysisResult(result);
    setRepoMeta({
      totalFiles: result.totalFiles,
      wasTruncated: result.wasTruncated,
      filteredOut: result.filteredOut,
    });
  }, []);

  const runAnalysis = useCallback(
    async (forceRefresh = false) => {
      if (!repoUrl) {
        navigate("/");
        return;
      }

      setLoading(true);
      setError(null);
      setProgressStep(0);
      setProgressEvents([]);

      // Try cache first
      if (!forceRefresh) {
        const cached = loadCachedAnalysis(repoUrl);
        if (cached) {
          applyResult(cached);
          setTimeout(() => setLoading(false), 200);
          toast({ title: "Loaded from cache", description: "Using cached analysis. Click re-analyze for a fresh scan." });
          return;
        }
      }

      try {
        const result = await analyzeRepository(
          repoUrl,
          getStoredToken() || undefined,
          (event) => {
            setProgressEvents((prev) => [...prev, event]);
            const stepIdx = stepMapping[event.step];
            if (stepIdx !== undefined) {
              setProgressStep(stepIdx);
            }
          }
        );

        applyResult(result);
        cacheAnalysis(repoUrl, result);

        setTimeout(() => {
          setLoading(false);
          if (result.wasTruncated) {
            toast({
              title: "Large repository",
              description: `${result.totalFiles} files found → ${result.filteredOut} filtered out → ${result.nodes.length} nodes shown.`,
            });
          }
        }, 600);
      } catch (err: unknown) {
        console.error(err);
        const message = err instanceof Error ? err.message : "Failed to analyze repository";
        setError(message);
        setLoading(false);
      }
    },
    [repoUrl, navigate, applyResult]
  );

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  const handleNodeDetailLoaded = useCallback((nodeId: string, detail: NodeDetail) => {
    setAnalysisResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, ...detail, detailLoaded: true } : n
        ),
      };
    });
  }, []);

  return {
    loading,
    error,
    progressStep,
    progressEvents,
    analysisResult,
    repoName,
    repoMeta,
    runAnalysis,
    handleNodeDetailLoaded,
    setAnalysisResult,
  };
}
