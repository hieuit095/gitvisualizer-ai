import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";

const TooltipEdge = memo((props: EdgeProps) => {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    label,
    data,
  } = props;

  const [hovered, setHovered] = useState(false);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const edgeType = (data?.edgeType as string) || "imports";
  const sourceName = (data?.sourceName as string) || "";
  const targetName = (data?.targetName as string) || "";

  return (
    <>
      {/* Invisible wider path for easier hover */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ cursor: "pointer" }}
      />
      <BaseEdge id={id} path={edgePath} style={style} />

      {/* Always show label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
            className="rounded bg-card/90 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Hover tooltip */}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -120%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
              zIndex: 1000,
            }}
            className="max-w-[240px] rounded-lg border border-border/50 bg-card px-3 py-2 shadow-lg"
          >
            <div className="mb-1 flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  edgeType === "imports"
                    ? "bg-primary"
                    : edgeType === "calls"
                    ? "bg-accent"
                    : edgeType === "inherits"
                    ? "bg-secondary"
                    : "bg-muted-foreground"
                }`}
              />
              <span className="font-mono text-[11px] font-semibold capitalize text-foreground">
                {edgeType}
              </span>
            </div>
            {sourceName && targetName && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">{sourceName}</span>
                {" → "}
                <span className="font-medium text-foreground">{targetName}</span>
              </p>
            )}
            {label && (
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/80">
                {label}
              </p>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

TooltipEdge.displayName = "TooltipEdge";

export default TooltipEdge;
