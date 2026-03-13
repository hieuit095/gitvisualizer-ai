import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Folder } from "lucide-react";
import type { RepoNode } from "@/types/repo";

const FolderNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as RepoNode & { direction?: string };
  const isHorizontal = nodeData.direction === "LR";

  return (
    <div className="group relative min-w-[160px] cursor-pointer rounded-lg border border-secondary/30 bg-secondary/5 px-4 py-3 backdrop-blur-sm transition-all hover:border-secondary/60 hover:shadow-[0_0_20px_rgba(139,92,246,0.15)]">
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="!h-2 !w-2 !border-secondary !bg-secondary"
      />

      <div className="flex items-center gap-2.5">
        <Folder className="h-4 w-4 shrink-0 text-secondary" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-semibold text-foreground">{nodeData.name}</p>
          <span className="text-[10px] font-medium text-secondary">Directory</span>
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
        className="!h-2 !w-2 !border-secondary !bg-secondary"
      />
    </div>
  );
});

FolderNode.displayName = "FolderNode";

export default FolderNode;
