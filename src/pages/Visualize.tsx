import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, GitBranch } from "lucide-react";
import Legend from "@/components/Legend";
import ExportButton from "@/components/ExportButton";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import FileNode from "@/components/nodes/FileNode";
import FolderNode from "@/components/nodes/FolderNode";
import InfoPanel from "@/components/InfoPanel";
import AnalysisProgress from "@/components/AnalysisProgress";
import { getLayoutedElements } from "@/lib/layout";
import { analyzeRepository } from "@/lib/analysis";
import type { AnalysisResult, RepoNode } from "@/types/repo";

const nodeTypes = { fileNode: FileNode, folderNode: FolderNode };

const edgeDefaults = {
  style: { stroke: "hsl(187, 80%, 48%)", strokeWidth: 1.5 },
  animated: true,
};

function buildFlowElements(result: AnalysisResult) {
  const flowNodes: Node[] = result.nodes.map((n) => ({
    id: n.id,
    type: n.type === "folder" ? "folderNode" : "fileNode",
    position: { x: 0, y: 0 },
    data: { ...n } as Record<string, unknown>,
  }));

  const flowEdges: Edge[] = result.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label,
    ...edgeDefaults,
    style: {
      ...edgeDefaults.style,
      stroke: e.type === "contains" ? "hsl(263, 70%, 58%)" : "hsl(187, 80%, 48%)",
    },
  }));

  return getLayoutedElements(flowNodes, flowEdges);
}

const VisualizeInner = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const repoUrl = searchParams.get("repo") || "";

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<RepoNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [progressStep, setProgressStep] = useState(0);
  const [repoName, setRepoName] = useState("");

  useEffect(() => {
    if (!repoUrl) {
      navigate("/");
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setProgressStep(0);
        const stepTimer = setInterval(() => {
          setProgressStep((s) => Math.min(s + 1, 2));
        }, 2000);

        const result = await analyzeRepository(repoUrl);

        clearInterval(stepTimer);
        if (cancelled) return;

        setProgressStep(3);
        setRepoName(result.repoName);

        const { nodes: ln, edges: le } = buildFlowElements(result);
        setNodes(ln);
        setEdges(le);

        setTimeout(() => setLoading(false), 600);
      } catch (err: any) {
        if (cancelled) return;
        console.error(err);
        toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
        setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [repoUrl]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.data as unknown as RepoNode);
  }, []);

  if (loading) {
    return <AnalysisProgress currentStep={progressStep} />;
  }

  return (
    <div className="relative h-screen w-screen bg-background">
      {/* Top bar */}
      <div className="absolute left-0 top-0 z-40 flex items-center gap-3 border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm" style={{ width: selectedNode ? "calc(100% - 384px)" : "100%" }}>
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <GitBranch className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm font-semibold text-foreground">{repoName}</span>
        <span className="text-xs text-muted-foreground">
          {nodes.length} nodes · {edges.length} edges
        </span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="hsl(240, 12%, 14%)" />
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.type === "folderNode" ? "hsl(263, 70%, 58%)" : "hsl(187, 80%, 48%)")}
          maskColor="rgba(0, 0, 0, 0.7)"
          pannable
          zoomable
        />
      </ReactFlow>

      <Legend />
      <InfoPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
};

export default Visualize;
