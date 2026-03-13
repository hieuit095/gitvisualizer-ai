import { useCallback, useEffect, useState } from "react";
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
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, GitBranch, ArrowDownUp, ArrowRightLeft, AlertTriangle, RotateCcw, AlertCircle, Lock } from "lucide-react";
import Legend from "@/components/Legend";
import ExportButton from "@/components/ExportButton";
import NodeSearch from "@/components/NodeSearch";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import FileNode from "@/components/nodes/FileNode";
import FolderNode from "@/components/nodes/FolderNode";
import InfoPanel from "@/components/InfoPanel";
import AnalysisProgress from "@/components/AnalysisProgress";
import GitHubTokenDialog, { getStoredToken } from "@/components/GitHubTokenDialog";
import { getLayoutedElements } from "@/lib/layout";
import { analyzeRepository } from "@/lib/analysis";
import type { AnalysisResult, RepoNode } from "@/types/repo";

const nodeTypes = { fileNode: FileNode, folderNode: FolderNode };

const edgeDefaults = {
  style: { stroke: "hsl(187, 80%, 48%)", strokeWidth: 1.5 },
  animated: true,
};

function buildFlowElements(result: AnalysisResult, direction: "TB" | "LR" = "TB") {
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
    ...edgeDefaults,
    labelStyle: { fill: "hsl(215, 16%, 56%)", fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: "hsl(240, 15%, 8%)", fillOpacity: 0.9 },
    labelBgPadding: [6, 3] as [number, number],
    labelBgBorderRadius: 4,
    style: {
      ...edgeDefaults.style,
      stroke: e.type === "contains" ? "hsl(263, 70%, 58%)" : "hsl(187, 80%, 48%)",
    },
  }));

  return getLayoutedElements(flowNodes, flowEdges, direction);
}

const VisualizeInner = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fitView } = useReactFlow();
  const repoUrl = searchParams.get("repo") || "";

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<RepoNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState(0);
  const [repoName, setRepoName] = useState("");
  const [direction, setDirection] = useState<"TB" | "LR">("TB");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [repoMeta, setRepoMeta] = useState<{ totalFiles?: number; wasTruncated?: boolean }>({});

  const runAnalysis = useCallback(async () => {
    if (!repoUrl) {
      navigate("/");
      return;
    }

    setLoading(true);
    setError(null);
    setProgressStep(0);
    setDirection("TB");

    try {
      const stepTimer = setInterval(() => {
        setProgressStep((s) => Math.min(s + 1, 2));
      }, 2000);

      const result = await analyzeRepository(repoUrl);

      clearInterval(stepTimer);

      setProgressStep(3);
      setRepoName(result.repoName);
      setAnalysisResult(result);
      setRepoMeta({ totalFiles: result.totalFiles, wasTruncated: result.wasTruncated });

      const { nodes: ln, edges: le } = buildFlowElements(result, "TB");
      setNodes(ln);
      setEdges(le);

      setTimeout(() => {
        setLoading(false);
        if (result.wasTruncated) {
          toast({
            title: "Large repository",
            description: `This repo has ${result.totalFiles} files. Showing the ${result.nodes.length} most important nodes.`,
          });
        }
      }, 600);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to analyze repository");
      setLoading(false);
    }
  }, [repoUrl, navigate, setNodes, setEdges]);

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.data as unknown as RepoNode);
  }, []);

  const toggleDirection = useCallback(() => {
    if (!analysisResult) return;
    const newDir = direction === "TB" ? "LR" : "TB";
    setDirection(newDir);
    const { nodes: ln, edges: le } = buildFlowElements(analysisResult, newDir);
    setNodes(ln);
    setEdges(le);
    setTimeout(() => fitView({ duration: 300, padding: 0.2 }), 50);
  }, [analysisResult, direction, setNodes, setEdges, fitView]);

  if (loading) {
    return <AnalysisProgress currentStep={progressStep} />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="animated-grid absolute inset-0 opacity-40" />
        <div className="relative z-10 max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="mb-2 font-mono text-xl font-bold text-foreground">Analysis Failed</h2>
          <p className="mb-6 text-sm leading-relaxed text-muted-foreground">{error}</p>
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Button>
            <Button onClick={runAnalysis} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <RotateCcw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen bg-background">
      {/* Top bar */}
      <div
        className="absolute left-0 top-0 z-40 flex items-center gap-3 border-b border-border/50 bg-card/80 px-4 py-2.5 backdrop-blur-sm"
        style={{ width: selectedNode ? "calc(100% - 384px)" : "100%" }}
      >
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <GitBranch className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm font-semibold text-foreground">{repoName}</span>
        <span className="text-xs text-muted-foreground">
          {nodes.length} nodes · {edges.length} edges
        </span>

        {repoMeta.wasTruncated && (
          <span className="flex items-center gap-1 rounded-full border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-[10px] font-medium text-yellow-400">
            <AlertCircle className="h-3 w-3" />
            {repoMeta.totalFiles} files (truncated)
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <NodeSearch />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={runAnalysis}
            title="Re-analyze repository"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleDirection}
            title={direction === "TB" ? "Switch to horizontal" : "Switch to vertical"}
          >
            {direction === "TB" ? (
              <ArrowRightLeft className="h-4 w-4" />
            ) : (
              <ArrowDownUp className="h-4 w-4" />
            )}
          </Button>
          <ExportButton repoName={repoName} />
        </div>
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

const Visualize = () => (
  <ReactFlowProvider>
    <VisualizeInner />
  </ReactFlowProvider>
);

export default Visualize;
