import { X, FileText, Zap, Link2 } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { RepoNode } from "@/types/repo";

interface InfoPanelProps {
  node: RepoNode | null;
  onClose: () => void;
}

const InfoPanel = ({ node, onClose }: InfoPanelProps) => {
  if (!node) return null;

  return (
    <div className="absolute right-0 top-0 z-50 flex h-full w-96 flex-col border-l border-border bg-card/95 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h3 className="font-mono text-sm font-semibold text-foreground">{node.name}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-5">
          {/* Summary */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
              <Zap className="h-3 w-3" /> Summary
            </h4>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {node.summary || "No summary available."}
            </p>
          </div>

          <Separator className="bg-border" />

          {/* Key Functions */}
          {node.keyFunctions && node.keyFunctions.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                Key Functions
              </h4>
              <ul className="space-y-1.5">
                {node.keyFunctions.map((fn, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <code className="font-mono text-xs text-foreground">{fn}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tutorial / Interactions */}
          {node.tutorial && (
            <>
              <Separator className="bg-border" />
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                  <Link2 className="h-3 w-3" /> How It Connects
                </h4>
                <p className="text-sm leading-relaxed text-muted-foreground">{node.tutorial}</p>
              </div>
            </>
          )}

          {/* Code Snippet */}
          {node.codeSnippet && (
            <>
              <Separator className="bg-border" />
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">
                  Code Preview
                </h4>
                <div className="overflow-hidden rounded-md border border-border">
                  <SyntaxHighlighter
                    language="typescript"
                    style={oneDark}
                    customStyle={{ margin: 0, padding: "12px", fontSize: "11px", background: "hsl(240, 15%, 6%)" }}
                  >
                    {node.codeSnippet}
                  </SyntaxHighlighter>
                </div>
              </div>
            </>
          )}

          {/* Path */}
          <Separator className="bg-border" />
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Path
            </h4>
            <p className="font-mono text-xs text-muted-foreground">{node.path}</p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default InfoPanel;
