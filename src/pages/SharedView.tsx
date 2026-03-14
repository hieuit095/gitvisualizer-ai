import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cacheAnalysis } from "@/lib/analysisCache";
import type { AnalysisResult } from "@/types/repo";

const SharedView = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setError("No analysis ID provided");
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const response = await fetch(`/api/shared?id=${encodeURIComponent(id)}`);
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(data.error || "Analysis not found or has expired");
          setLoading(false);
          return;
        }

        const data = await response.json();
        if (data?.repo_url && data?.result) {
          cacheAnalysis(data.repo_url, data.result as AnalysisResult);
        }
        navigate(`/visualize?repo=${encodeURIComponent(data.repo_url)}`, {
          replace: true,
        });
      } catch {
        setError("Failed to load shared analysis");
        setLoading(false);
      }
    };

    load();
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="font-mono text-sm text-muted-foreground">
            Loading shared analysis...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h2 className="mb-2 font-mono text-xl font-bold text-foreground">
            Link Expired
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">{error}</p>
          <button
            onClick={() => navigate("/")}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default SharedView;
