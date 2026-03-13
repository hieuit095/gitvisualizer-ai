import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { FileText, Settings, Zap, Puzzle, Database, Globe, FlaskConical, Palette, Box } from "lucide-react";
import type { RepoNode } from "@/types/repo";

const typeConfig: Record<RepoNode["type"], { icon: typeof FileText; color: string; label: string }> = {
  component: { icon: Puzzle, color: "text-primary", label: "Component" },
  utility: { icon: Zap, color: "text-yellow-400", label: "Utility" },
  hook: { icon: Box, color: "text-primary", label: "Hook" },
  config: { icon: Settings, color: "text-muted-foreground", label: "Config" },
  entry: { icon: Globe, color: "text-green-400", label: "Entry" },
  style: { icon: Palette, color: "text-pink-400", label: "Style" },
  test: { icon: FlaskConical, color: "text-orange-400", label: "Test" },
  database: { icon: Database, color: "text-secondary", label: "Database" },
  api: { icon: Globe, color: "text-primary", label: "API" },
  model: { icon: Database, color: "text-secondary", label: "Model" },
  folder: { icon: FileText, color: "text-muted-foreground", label: "Folder" },
  other: { icon: FileText, color: "text-muted-foreground", label: "File" },
};

const FileNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as RepoNode & { direction?: string };
  const config = typeConfig[nodeData.type] || typeConfig.other;
  const Icon = config.icon;
  const isHorizontal = nodeData.direction === "LR";

  return (
    <div className="group relative min-w-[180px] cursor-pointer rounded-lg border border-border/60 bg-card/80 px-4 py-3 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]">
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="!h-2 !w-2 !border-primary !bg-primary"
      />

      <div className="flex items-center gap-2.5">
        <Icon className={`h-4 w-4 shrink-0 ${config.color}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-medium text-foreground">{nodeData.name}</p>
          <span className={`text-[10px] font-medium ${config.color}`}>{config.label}</span>
        </div>
      </div>

      {nodeData.summary && (
        <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
          {nodeData.summary}
        </p>
      )}

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="!h-2 !w-2 !border-primary !bg-primary"
      />
    </div>
  );
});

FileNode.displayName = "FileNode";

export default FileNode;
