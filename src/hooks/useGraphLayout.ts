import { useCallback, useState, useEffect } from "react";
import { useNodesState, useEdgesState, useReactFlow, type Node, type Edge } from "@xyflow/react";
import { getLayoutedElements } from "@/lib/layout";
import type { AnalysisResult } from "@/types/repo";

// Read CSS variable values from the document
function getCssVar(name: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value ? `hsl(${value})` : "";
}

function buildFlowElements(result: AnalysisResult, direction: "TB" | "LR" = "TB") {
  const primaryColor = getCssVar("--primary") || "hsl(187, 80%, 48%)";
  const secondaryColor = getCssVar("--secondary") || "hsl(263, 70%, 58%)";
  const mutedFgColor = getCssVar("--muted-foreground") || "hsl(215, 16%, 56%)";
  const cardColor = getCssVar("--card") || "hsl(240, 15%, 8%)";

  const flowNodes: Node[] = result.nodes.map((n) => ({
    id: n.id,
    type: n.type === "folder" ? "folderNode" : "fileNode",
    position: { x: 0, y: 0 },
    data: { ...n, direction } as Record<string, unknown>,
  }));

  const flowEdges: Edge[] = result.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    type: "smoothstep",
    animated: true,
    style: {
      stroke: e.type === "contains" ? secondaryColor : primaryColor,
      strokeWidth: 1.5,
    },
    labelStyle: { fill: mutedFgColor, fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: cardColor, fillOpacity: 0.9 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
  }));

  return getLayoutedElements(flowNodes, flowEdges, direction);
}

export function useGraphLayout(analysisResult: AnalysisResult | null) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [direction, setDirection] = useState<"TB" | "LR">("TB");
  const { fitView } = useReactFlow();

  // Apply layout when result changes
  useEffect(() => {
    if (!analysisResult) return;
    setDirection("TB");
    const { nodes: ln, edges: le } = buildFlowElements(analysisResult, "TB");
    setNodes(ln);
    setEdges(le);
  }, [analysisResult, setNodes, setEdges]);

  const toggleDirection = useCallback(() => {
    if (!analysisResult) return;
    const newDir = direction === "TB" ? "LR" : "TB";
    setDirection(newDir);
    const { nodes: ln, edges: le } = buildFlowElements(analysisResult, newDir);
    setNodes(ln);
    setEdges(le);
    setTimeout(() => fitView({ duration: 300, padding: 0.2 }), 50);
  }, [analysisResult, direction, setNodes, setEdges, fitView]);

  return {
    nodes,
    edges,
    direction,
    onNodesChange,
    onEdgesChange,
    toggleDirection,
  };
}
