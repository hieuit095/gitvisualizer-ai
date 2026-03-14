import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
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
      const { data, error: dbError } = await supabase
        .from("analysis_cache")
        .select("repo_url, result, expires_at")
        .eq("id", id)
        .maybeSingle();

      if (dbError || !data) {
        setError("Analysis not found or has expired");
        setLoading(false);
        return;
      }

      // Check expiry
      if (new Date(data.expires_at) < new Date()) {
        setError("This shared analysis has expired. Re-analyze the repo for a new link.");
        setLoading(false);
        return;
      }

      // Redirect to visualize with the repo URL — the cache will be hit
      navigate(`/visualize?repo=${encodeURIComponent(data.repo_url)}`, { replace: true });
    };

    load();
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="font-mono text-sm text-muted-foreground">Loading shared analysis…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h2 className="mb-2 font-mono text-xl font-bold text-foreground">Link Expired</h2>
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
