import { useState } from "react";
import { Share2, Check, Link, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/hooks/use-toast";

interface ShareButtonProps {
  repoUrl: string;
  cacheId?: string;
}

const ShareButton = ({ repoUrl, cacheId }: ShareButtonProps) => {
  const [copied, setCopied] = useState<string | null>(null);

  const shareUrl = cacheId
    ? `${window.location.origin}/share/${cacheId}`
    : `${window.location.origin}/visualize?repo=${encodeURIComponent(repoUrl)}`;

  const embedCode = `<iframe src="${shareUrl}" width="100%" height="600" frameborder="0" style="border-radius:8px;border:1px solid #333;"></iframe>`;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast({ title: "Copied!", description: `${label} copied to clipboard` });
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Share">
          <Share2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 border-border/50 bg-card" align="end">
        <div className="space-y-3">
          <h4 className="font-mono text-sm font-semibold text-foreground">
            Share Analysis
          </h4>

          <div className="space-y-2">
            <button
              onClick={() => copyToClipboard(shareUrl, "Link")}
              className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
            >
              {copied === "Link" ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Link className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">
                  Copy shareable link
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {shareUrl}
                </p>
              </div>
            </button>

            <button
              onClick={() => copyToClipboard(embedCode, "Embed")}
              className="flex w-full items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-left transition-colors hover:bg-muted/60"
            >
              {copied === "Embed" ? (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              ) : (
                <Code className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">
                  Copy embed code
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {"<iframe src=...>"}
                </p>
              </div>
            </button>
          </div>

          {!cacheId && (
            <p className="text-[10px] text-muted-foreground">
              Link will re-analyze if cache expired. Analyze first for a persistent link.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ShareButton;
