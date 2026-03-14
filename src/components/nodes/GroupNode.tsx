import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Folder, ChevronRight } from "lucide-react";
import type { RepoNode } from "@/types/repo";

const GroupNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as RepoNode & { direction?: string };
  const isHorizontal = nodeData.direction === "LR";

  return (
    <div className="relative h-full w-full rounded-xl border border-secondary/25 bg-secondary/[0.03]">
      <Handle
        type="target"
        position={isHorizontal ? Position.Left : Position.Top}
        className="!h-2 !w-2 !border-secondary !bg-secondary"
      />

      {/* Group label */}
      <div className="absolute left-3 top-2 z-10 flex items-center gap-1.5 rounded-md border border-secondary/20 bg-card/90 px-2.5 py-1 backdrop-blur-sm">
        <Folder className="h-3.5 w-3.5 text-secondary" />
        <span className="font-mono text-[11px] font-semibold text-foreground">{nodeData.name}</span>
        <ChevronRight className="h-3 w-3 text-secondary/60" />
      </div>

      <Handle
        type="source"
        position={isHorizontal ? Position.Right : Position.Bottom}
        className="!h-2 !w-2 !border-secondary !bg-secondary"
      />
    </div>
  );
});

GroupNode.displayName = "GroupNode";

export default GroupNode;
