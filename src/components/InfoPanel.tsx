import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Code2,
  FileText,
  Link2,
  Loader2,
  MapPin,
  MessageCircle,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import { fetchNodeDetail } from "@/lib/analysis";
import { getStoredToken } from "@/lib/githubToken";
import { SyntaxHighlighter, oneDark } from "@/lib/syntaxHighlighter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { NodeDetail, RepoNode } from "@/types/repo";

interface InfoPanelProps {
  node: RepoNode | null;
  repoUrl: string;
  onClose: () => void;
  onNodeDetailLoaded?: (nodeId: string, detail: NodeDetail) => void;
  onAskChat?: (question: string) => void;
}

interface LineRange {
  start: number;
  end: number;
}

const LINE_REF_REGEX =
  /\b(?:lines?\s+(\d+)(?:\s*[-\u2013]\s*(\d+))?|L(\d+)(?:\s*[-\u2013]\s*L(\d+))?)\b/gi;

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
  const extension = path.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    rb: "ruby",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "markup",
    css: "css",
    scss: "scss",
    html: "markup",
    md: "markdown",
  };
  return languageMap[extension] || "typescript";
}

function TextWithLineRefs({
  text,
  onLineClick,
  activeRange,
}: {
  text: string;
  onLineClick: (range: LineRange) => void;
  activeRange: LineRange | null;
}) {
  const parts: Array<string | { text: string; range: LineRange }> = [];
  const matcher = new RegExp(LINE_REF_REGEX.source, LINE_REF_REGEX.flags);
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const start = parseInt(match[1] || match[3], 10);
    const end = match[2] || match[4] ? parseInt(match[2] || match[4], 10) : start;
    parts.push({ text: match[0], range: { start, end } });
    lastIndex = matcher.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return (
    <>
      {parts.map((part, index) => {
        if (typeof part === "string") return <span key={index}>{part}</span>;

        const isActive =
          activeRange?.start === part.range.start &&
          activeRange.end === part.range.end;

        return (
          <button
            key={index}
            onClick={() => onLineClick(part.range)}
            className={`inline-flex cursor-pointer items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[11px] font-medium transition-colors ${
              isActive
                ? "border-primary/50 bg-primary/25 text-primary"
                : "border-primary/20 bg-primary/10 text-primary/80 hover:bg-primary/20 hover:text-primary"
            }`}
          >
            <Code2 className="h-2.5 w-2.5" />
            {part.text}
          </button>
        );
      })}
    </>
  );
}

const InfoPanel = ({
  node,
  repoUrl,
  onClose,
  onNodeDetailLoaded,
  onAskChat,
}: InfoPanelProps) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [highlightedRange, setHighlightedRange] = useState<LineRange | null>(null);
  const codePreviewRef = useRef<HTMLDivElement>(null);

  const loadDetail = useCallback(
    async (targetNode: RepoNode) => {
      setLoading(true);
      setError(null);
      setDetail(null);
      try {
        const result = await fetchNodeDetail(
          repoUrl,
          targetNode.path,
          targetNode.summary,
          getStoredToken() || undefined,
        );
        setDetail(result);
        onNodeDetailLoaded?.(targetNode.id, result);
      } catch (error: unknown) {
        setError(
          error instanceof Error ? error.message : "Failed to load details",
        );
      } finally {
        setLoading(false);
      }
    },
    [onNodeDetailLoaded, repoUrl],
  );

  useEffect(() => {
    if (!node) {
      setDetail(null);
      setError(null);
      setHighlightedRange(null);
      return;
    }

    if (node.detailLoaded && node.tutorial) {
      setDetail({
        summary: node.summary,
        keyFunctions: node.keyFunctions || [],
        tutorial: node.tutorial || "",
        codeSnippet: node.codeSnippet || "",
      });
      setError(null);
      setHighlightedRange(null);
      return;
    }

    if (node.type === "folder") {
      setDetail(null);
      setError(null);
      setHighlightedRange(null);
      return;
    }

    setHighlightedRange(null);
    loadDetail(node);
  }, [loadDetail, node]);

  const handleLineClick = useCallback((range: LineRange) => {
    setHighlightedRange((current) =>
      current &&
      current.start === range.start &&
      current.end === range.end
        ? null
        : range,
    );

    setTimeout(() => {
      codePreviewRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);
  }, []);

  const highlightedLines = useMemo(() => {
    if (!highlightedRange) return new Set<number>();

    const lines = new Set<number>();
    for (let line = highlightedRange.start; line <= highlightedRange.end; line += 1) {
      lines.add(line);
    }
    return lines;
  }, [highlightedRange]);

  if (!node) return null;

  const colorClass = typeColors[node.type] || typeColors.other;
  const displaySummary = detail?.summary || node.summary;
  const displayFunctions = detail?.keyFunctions?.length
    ? detail.keyFunctions
    : node.keyFunctions;
  const displayTutorial = detail?.tutorial || node.tutorial;
  const displaySnippet = detail?.codeSnippet || node.codeSnippet;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
        onClick={onClose}
      />

      <div className="fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-border bg-card/95 backdrop-blur-md sm:w-96 md:absolute">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0 flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="truncate font-mono text-sm font-semibold text-foreground">
              {node.name}
            </h3>
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
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Zap className="h-3 w-3" /> Summary
              </h4>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {displaySummary ? (
                  <TextWithLineRefs
                    text={displaySummary}
                    onLineClick={handleLineClick}
                    activeRange={highlightedRange}
                  />
                ) : (
                  "No summary available."
                )}
              </p>
            </div>

            <Separator className="bg-border" />

            {loading && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-3">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">
                  Loading detailed AI analysis...
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3">
                <span className="text-xs text-destructive">{error}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => loadDetail(node)}
                >
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            )}

            {displayFunctions && displayFunctions.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  Key Functions
                </h4>
                <ul className="space-y-1.5">
                  {displayFunctions.map((item, index) => (
                    <li
                      key={`${item}-${index}`}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <code className="font-mono text-xs text-foreground">
                        <TextWithLineRefs
                          text={item}
                          onLineClick={handleLineClick}
                          activeRange={highlightedRange}
                        />
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {displayTutorial && (
              <>
                <Separator className="bg-border" />
                <div>
                  <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                    <Link2 className="h-3 w-3" /> How It Connects
                  </h4>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    <TextWithLineRefs
                      text={displayTutorial}
                      onLineClick={handleLineClick}
                      activeRange={highlightedRange}
                    />
                  </p>
                </div>
              </>
            )}

            {displaySnippet && (
              <>
                <Separator className="bg-border" />
                <div ref={codePreviewRef}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                      <Code2 className="h-3 w-3" /> Code Preview
                    </h4>
                    {highlightedRange && (
                      <Badge
                        variant="outline"
                        className="cursor-pointer border-primary/30 text-[10px] text-primary hover:bg-primary/10"
                        onClick={() => setHighlightedRange(null)}
                      >
                        Lines {highlightedRange.start}
                        {highlightedRange.end !== highlightedRange.start
                          ? `-${highlightedRange.end}`
                          : ""}
                        {" "}x
                      </Badge>
                    )}
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    <SyntaxHighlighter
                      language={detectLanguage(node.path)}
                      style={oneDark}
                      showLineNumbers
                      wrapLines
                      lineProps={(lineNumber: number) => {
                        const isHighlighted = highlightedLines.has(lineNumber);
                        return {
                          style: {
                            display: "block",
                            backgroundColor: isHighlighted
                              ? "hsl(var(--primary) / 0.15)"
                              : undefined,
                            borderLeft: isHighlighted
                              ? "3px solid hsl(var(--primary))"
                              : "3px solid transparent",
                            paddingLeft: isHighlighted ? "9px" : "12px",
                          },
                        };
                      }}
                      customStyle={{
                        margin: 0,
                        padding: "12px 0",
                        fontSize: "11px",
                        background: "hsl(var(--background))",
                      }}
                    >
                      {displaySnippet}
                    </SyntaxHighlighter>
                  </div>
                </div>
              </>
            )}

            {node.type !== "folder" && onAskChat && (
              <>
                <Separator className="bg-border" />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 border-primary/30 text-primary hover:bg-primary/10"
                  onClick={() =>
                    onAskChat(
                      `Tell me about the file "${node.name}" at ${node.path}. What does it do, how does it connect to the rest of the codebase, and what are its key responsibilities?`,
                    )
                  }
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  Ask AI about this file
                </Button>
              </>
            )}

            <Separator className="bg-border" />
            <div>
              <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <MapPin className="h-3 w-3" /> Path
              </h4>
              <p className="break-all font-mono text-xs text-muted-foreground">
                {node.path}
              </p>
            </div>
          </div>
        </ScrollArea>
      </div>
    </>
  );
};

export default InfoPanel;
