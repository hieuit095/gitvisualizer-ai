import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { analyzeRepository } from "@/lib/analysis";
import { cacheAnalysis, loadCachedAnalysis } from "@/lib/analysisCache";
import { getStoredToken } from "@/lib/githubToken";
import type { AnalysisResult, NodeDetail, ProgressEvent } from "@/types/repo";

const stepMapping: Record<string, number> = {
  fetch: 0,
  fetch_done: 0,
  filter: 1,
  filter_done: 1,
  extract: 2,
  extract_done: 2,
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
  const [indexingStatus, setIndexingStatus] = useState<"idle" | "indexing" | "done">("idle");

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

      if (!forceRefresh) {
        const cached = loadCachedAnalysis(repoUrl);
        if (cached) {
          applyResult(cached);
          setTimeout(() => setLoading(false), 200);
          toast({
            title: "Loaded from cache",
            description:
              "Using cached analysis. Click re-analyze for a fresh scan.",
          });
          return;
        }
      }

      try {
        const result = await analyzeRepository(
          repoUrl,
          getStoredToken() || undefined,
          (event) => {
            setProgressEvents((previous) => [...previous, event]);
            const stepIndex = stepMapping[event.step];
            if (stepIndex !== undefined) {
              setProgressStep(stepIndex);
            }
          },
          forceRefresh,
        );

        applyResult(result);
        cacheAnalysis(repoUrl, result);

        setIndexingStatus("indexing");
        fetch("/api/embed-chunks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            repoUrl,
            githubToken: getStoredToken() || undefined,
          }),
        })
          .then((response) => {
            if (!response.ok) {
              console.error("Embed-chunks error:", response.status);
            }
            setIndexingStatus("done");
          })
          .catch((error) => {
            console.error("Embed-chunks error:", error);
            setIndexingStatus("done");
          });

        setTimeout(() => {
          setLoading(false);
          if (result.wasTruncated) {
            toast({
              title: "Large repository",
              description: `${result.totalFiles} files found -> ${result.filteredOut} filtered out -> ${result.nodes.length} nodes shown.`,
            });
          }
        }, 600);
      } catch (error: unknown) {
        console.error(error);
        const message =
          error instanceof Error
            ? error.message
            : "Failed to analyze repository";
        setError(message);
        setLoading(false);
      }
    },
    [applyResult, navigate, repoUrl],
  );

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  const handleNodeDetailLoaded = useCallback((nodeId: string, detail: NodeDetail) => {
    setAnalysisResult((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        nodes: previous.nodes.map((node) =>
          node.id === nodeId ? { ...node, ...detail, detailLoaded: true } : node,
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
    indexingStatus,
    runAnalysis,
    handleNodeDetailLoaded,
    setAnalysisResult,
  };
}
