import { useState, useEffect } from "react";
import { X, FileText, Zap, Link2, Code2, MapPin, Loader2, RefreshCw, MessageCircle } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { fetchNodeDetail } from "@/lib/analysis";
import { getStoredToken } from "@/components/GitHubTokenDialog";
import type { RepoNode, NodeDetail } from "@/types/repo";

interface InfoPanelProps {
  node: RepoNode | null;
  repoUrl: string;
  onClose: () => void;
  onNodeDetailLoaded?: (nodeId: string, detail: NodeDetail) => void;
  onAskChat?: (question: string) => void;
}

const typeColors: Record<string, string> = {
  component: "bg-primary/15 text-primary border-primary/30",
  utility: "bg-yellow-400/15 text-yellow-400 border-yellow-400/30",
  hook: "bg-primary/15 text-primary border-primary/30",
  config: "bg-muted text-muted-foreground border-border",
  entry: "bg-green-400/15 text-green-400 border-green-400/30",
  style: "bg-pink-400/15 text-pink-400 border-pink-400/30",
  test: "bg-orange-400/15 text-orange-400 border-orange-400/30",
  database: "bg-secondary/15 text-secondary border-secondary/30",
  api: "bg-primary/15 text-primary border-primary/30",
  model: "bg-secondary/15 text-secondary border-secondary/30",
  folder: "bg-secondary/15 text-secondary border-secondary/30",
  other: "bg-muted text-muted-foreground border-border",
};

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", go: "go", rs: "rust", java: "java", rb: "ruby",
    json: "json", yaml: "yaml", yml: "yaml", toml: "toml",
    css: "css", scss: "scss", html: "html", md: "markdown",
  };
  return map[ext] || "typescript";
}

const InfoPanel = ({ node, repoUrl, onClose, onNodeDetailLoaded }: InfoPanelProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);

  // Reset state when node changes and trigger lazy load
  useEffect(() => {
    if (!node) {
      setDetail(null);
      setError(null);
      return;
    }

    // If detail already loaded on the node, use it
    if (node.detailLoaded && node.tutorial) {
      setDetail({
        summary: node.summary,
        keyFunctions: node.keyFunctions || [],
        tutorial: node.tutorial || "",
        codeSnippet: node.codeSnippet || "",
      });
      setError(null);
      return;
    }

    // For folders, skip lazy load
    if (node.type === "folder") {
      setDetail(null);
      setError(null);
      return;
    }

    // Trigger lazy AI summarization
    loadDetail(node);
  }, [node?.id]);

  const loadDetail = async (targetNode: RepoNode) => {
    setLoading(true);
    setError(null);
    setDetail(null);
    try {
      const result = await fetchNodeDetail(
        repoUrl,
        targetNode.path,
        targetNode.summary,
        getStoredToken() || undefined
      );
      setDetail(result);
      onNodeDetailLoaded?.(targetNode.id, result);
    } catch (e: any) {
      setError(e.message || "Failed to load details");
    } finally {
      setLoading(false);
    }
  };

  if (!node) return null;

  const colorClass = typeColors[node.type] || typeColors.other;
  const displaySummary = detail?.summary || node.summary;
  const displayFunctions = detail?.keyFunctions?.length ? detail.keyFunctions : node.keyFunctions;
  const displayTutorial = detail?.tutorial || node.tutorial;
  const displaySnippet = detail?.codeSnippet || node.codeSnippet;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />

      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border bg-card/95 backdrop-blur-md sm:w-96 md:absolute">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="truncate font-mono text-sm font-semibold text-foreground">{node.name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px] ${colorClass}`}>
              {node.type}
            </Badge>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-5 p-5">
            {/* Summary */}
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Zap className="h-3 w-3" /> Summary
              </h4>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {displaySummary || "No summary available."}
              </p>
            </div>

            <Separator className="bg-border" />

            {/* Loading state for lazy details */}
            {loading && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Loading detailed AI analysis...</span>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3">
                <span className="text-xs text-destructive">{error}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => node && loadDetail(node)}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* Key Functions */}
            {displayFunctions && displayFunctions.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  Key Functions
                </h4>
                <ul className="space-y-1.5">
                  {displayFunctions.map((fn, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <code className="font-mono text-xs text-foreground">{fn}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tutorial / Interactions */}
            {displayTutorial && (
              <>
                <Separator className="bg-border" />
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                    <Link2 className="h-3 w-3" /> How It Connects
                  </h4>
                  <p className="text-sm leading-relaxed text-muted-foreground">{displayTutorial}</p>
                </div>
              </>
            )}

            {/* Code Snippet */}
            {displaySnippet && (
              <>
                <Separator className="bg-border" />
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                    <Code2 className="h-3 w-3" /> Code Preview
                  </h4>
                  <div className="overflow-hidden rounded-md border border-border">
                    <SyntaxHighlighter
                      language={detectLanguage(node.path)}
                      style={oneDark}
                      customStyle={{ margin: 0, padding: "12px", fontSize: "11px", background: "hsl(240, 15%, 6%)" }}
                    >
                      {displaySnippet}
                    </SyntaxHighlighter>
                  </div>
                </div>
              </>
            )}

            {/* Ask AI about this file */}
            {node.type !== "folder" && onAskChat && (
              <>
                <Separator className="bg-border" />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() => onAskChat(`Tell me about the file "${node.name}" at ${node.path}. What does it do, how does it connect to the rest of the codebase, and what are its key responsibilities?`)}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Ask AI about this file
                </Button>
              </>
            )}

            {/* Path */}
            <Separator className="bg-border" />
            <div>
              <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3 w-3" /> Path
              </h4>
              <p className="break-all font-mono text-xs text-muted-foreground">{node.path}</p>
            </div>
          </div>
        </ScrollArea>
      </div>
    </>
  );
};

export default InfoPanel;
