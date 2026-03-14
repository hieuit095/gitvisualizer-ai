import { useState, useEffect, useCallback } from "react";
import { History, ChevronRight, Clock, GitCompare, X, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import type { AnalysisResult } from "@/types/repo";

interface HistoryEntry {
  id: string;
  cache_id: string;
  version: number;
  node_count: number | null;
  edge_count: number | null;
  created_at: string;
}

interface DiffResult {
  added: string[];
  removed: string[];
  unchanged: string[];
}

function computeDiff(oldResult: AnalysisResult, newResult: AnalysisResult): DiffResult {
  const oldIds = new Set(oldResult.nodes.map((n) => n.id));
  const newIds = new Set(newResult.nodes.map((n) => n.id));

  return {
    added: newResult.nodes.filter((n) => !oldIds.has(n.id)).map((n) => n.name),
    removed: oldResult.nodes.filter((n) => !newIds.has(n.id)).map((n) => n.name),
    unchanged: newResult.nodes.filter((n) => oldIds.has(n.id)).map((n) => n.name),
  };
}

interface AnalysisHistoryProps {
  repoUrl: string;
  currentResult: AnalysisResult | null;
  onLoadVersion: (result: AnalysisResult) => void;
}

const AnalysisHistory = ({ repoUrl, currentResult, onLoadVersion }: AnalysisHistoryProps) => {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDiff, setSelectedDiff] = useState<DiffResult | null>(null);
  const [comparingId, setComparingId] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!repoUrl) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("analysis_history")
      .select("id, cache_id, version, node_count, edge_count, created_at")
      .eq("repo_url", repoUrl)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!error && data) {
      setHistory(data as HistoryEntry[]);
    }
    setLoading(false);
  }, [repoUrl]);

  useEffect(() => {
    if (open) fetchHistory();
  }, [open, fetchHistory]);

  const loadVersion = async (cacheId: string) => {
    const { data, error } = await supabase
      .from("analysis_cache")
      .select("result")
      .eq("id", cacheId)
      .maybeSingle();

    if (!error && data?.result) {
      onLoadVersion(data.result as unknown as AnalysisResult);
      setOpen(false);
    }
  };

  const compareVersion = async (entry: HistoryEntry) => {
    if (!currentResult) return;
    setComparingId(entry.id);

    const { data, error } = await supabase
      .from("analysis_cache")
      .select("result")
      .eq("id", entry.cache_id)
      .maybeSingle();

    if (!error && data?.result) {
      const oldResult = data.result as unknown as AnalysisResult;
      setSelectedDiff(computeDiff(oldResult, currentResult));
    }
    setComparingId(null);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Analysis history">
          <History className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[380px] border-border/50 bg-card sm:w-[420px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-mono text-sm text-foreground">
            <History className="h-4 w-4 text-primary" />
            Analysis History
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}

          {!loading && history.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No analysis history yet.</p>
          )}

          {history.map((entry, idx) => (
            <div
              key={entry.id}
              className="rounded-lg border border-border/50 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs text-foreground">{formatDate(entry.created_at)}</span>
                  {idx === 0 && (
                    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                      Latest
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {entry.node_count} nodes · {entry.edge_count} edges
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-[11px]"
                  onClick={() => loadVersion(entry.cache_id)}
                >
                  <ChevronRight className="h-3 w-3" />
                  Load
                </Button>
                {idx > 0 && currentResult && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => compareVersion(entry)}
                    disabled={comparingId === entry.id}
                  >
                    <GitCompare className="h-3 w-3" />
                    Diff vs current
                  </Button>
                )}
              </div>
            </div>
          ))}

          {/* Diff overlay */}
          {selectedDiff && (
            <div className="mt-4 rounded-lg border border-border/50 bg-background p-4">
              <div className="mb-3 flex items-center justify-between">
                <h4 className="font-mono text-xs font-semibold text-foreground">Diff vs Current</h4>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSelectedDiff(null)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>

              {selectedDiff.added.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] font-medium text-emerald-400">
                    + {selectedDiff.added.length} added
                  </p>
                  {selectedDiff.added.map((name) => (
                    <div key={name} className="flex items-center gap-1.5 py-0.5">
                      <Circle className="h-2 w-2 fill-emerald-400 text-emerald-400" />
                      <span className="font-mono text-[10px] text-muted-foreground">{name}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedDiff.removed.length > 0 && (
                <div className="mb-2">
                  <p className="mb-1 text-[10px] font-medium text-red-400">
                    - {selectedDiff.removed.length} removed
                  </p>
                  {selectedDiff.removed.map((name) => (
                    <div key={name} className="flex items-center gap-1.5 py-0.5">
                      <Circle className="h-2 w-2 fill-red-400 text-red-400" />
                      <span className="font-mono text-[10px] text-muted-foreground">{name}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedDiff.added.length === 0 && selectedDiff.removed.length === 0 && (
                <p className="text-xs text-muted-foreground">No structural changes detected.</p>
              )}

              <p className="mt-1 text-[10px] text-muted-foreground">
                {selectedDiff.unchanged.length} nodes unchanged
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default AnalysisHistory;
