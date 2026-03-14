import { useCallback, useState } from "react";
import { useReactFlow, getNodesBounds, getViewportForBounds } from "@xyflow/react";
import { toPng, toSvg } from "html-to-image";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const IMAGE_WIDTH = 4096;
const IMAGE_HEIGHT = 3072;

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.setAttribute("download", filename);
  a.setAttribute("href", dataUrl);
  a.click();
}

const ExportButton = ({ repoName }: { repoName: string }) => {
  const { getNodes } = useReactFlow();
  const [exporting, setExporting] = useState(false);

  const exportImage = useCallback(
    async (format: "png" | "svg") => {
      const el = document.querySelector<HTMLElement>(".react-flow__viewport");
      if (!el) return;

      setExporting(true);
      try {
        const nodes = getNodes();
        const bounds = getNodesBounds(nodes);
        const viewport = getViewportForBounds(bounds, IMAGE_WIDTH, IMAGE_HEIGHT, 0.5, 2, 0.2);

        const fn = format === "png" ? toPng : toSvg;
        const bgColor = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
        const dataUrl = await fn(el, {
          backgroundColor: bgColor ? `hsl(${bgColor})` : "hsl(240, 20%, 4%)",
          width: IMAGE_WIDTH,
          height: IMAGE_HEIGHT,
          style: {
            width: `${IMAGE_WIDTH}px`,
            height: `${IMAGE_HEIGHT}px`,
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          },
        });

        const safeName = repoName.replace(/[^a-zA-Z0-9_-]/g, "_") || "diagram";
        downloadDataUrl(dataUrl, `${safeName}.${format}`);
        toast({ title: `Exported as ${format.toUpperCase()}` });
      } catch (err) {
        console.error("Export failed:", err);
        toast({ title: "Export failed", description: "Could not generate image", variant: "destructive" });
      } finally {
        setExporting(false);
      }
    },
    [getNodes, repoName],
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={exporting}>
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        <DropdownMenuItem onClick={() => exportImage("png")} disabled={exporting}>
          Export PNG
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportImage("svg")} disabled={exporting}>
          Export SVG
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ExportButton;
