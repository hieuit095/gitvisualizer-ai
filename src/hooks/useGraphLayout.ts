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

  // Build parent map from "contains" edges
  const parentMap = new Map<string, string>();
  const containsEdgeIds = new Set<string>();
  const folderNodeIds = new Set(
    result.nodes.filter((n) => n.type === "folder").map((n) => n.id)
  );

  for (const e of result.edges) {
    if (e.type === "contains" && folderNodeIds.has(e.source)) {
      parentMap.set(e.target, e.source);
      containsEdgeIds.add(e.id);
    }
  }

  // Build nodes — folders with children become group nodes, children get parentId
  const flowNodes: Node[] = result.nodes.map((n) => {
    const isGroup = folderNodeIds.has(n.id) && [...parentMap.values()].includes(n.id);
    const parentId = parentMap.get(n.id);

    const base: Node = {
      id: n.id,
      type: isGroup ? "groupNode" : n.type === "folder" ? "folderNode" : "fileNode",
      position: { x: 0, y: 0 },
      data: { ...n, direction } as Record<string, unknown>,
    };

    if (isGroup) {
      // Group nodes need explicit dimensions (set by layout)
      base.style = { width: 300, height: 200 };
    }

    if (parentId) {
      base.parentId = parentId;
      base.extent = "parent";
    }

    return base;
  });

  // Sort so parents come before children (React Flow requirement)
  flowNodes.sort((a, b) => {
    const aIsParent = !parentMap.has(a.id) && folderNodeIds.has(a.id);
    const bIsParent = !parentMap.has(b.id) && folderNodeIds.has(b.id);
    if (aIsParent && !bIsParent) return -1;
    if (!aIsParent && bIsParent) return 1;
    // Parents of the current node should come before it
    if (a.id === parentMap.get(b.id)) return -1;
    if (b.id === parentMap.get(a.id)) return 1;
    return 0;
  });

  // Build edges — filter out "contains" edges (replaced by visual grouping)
  const flowEdges: Edge[] = result.edges
    .filter((e) => !containsEdgeIds.has(e.id))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      type: "smoothstep",
      animated: true,
      style: {
        stroke: primaryColor,
        strokeWidth: 1.5,
      },
      labelStyle: { fill: mutedFgColor, fontSize: 10, fontWeight: 500 },
      labelBgStyle: { fill: cardColor, fillOpacity: 0.9 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
    }));

  const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
    flowNodes,
    flowEdges,
    direction,
    parentMap.size > 0 ? parentMap : undefined
  );

  return { nodes: layoutedNodes, edges: layoutedEdges };
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
