import { useCallback, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, GitBranch, ArrowDownUp, ArrowRightLeft, AlertTriangle, RotateCcw, AlertCircle, Lock } from "lucide-react";
import Legend from "@/components/Legend";
import ExportButton from "@/components/ExportButton";
import NodeSearch from "@/components/NodeSearch";
import { Button } from "@/components/ui/button";
import FileNode from "@/components/nodes/FileNode";
import FolderNode from "@/components/nodes/FolderNode";
import GroupNode from "@/components/nodes/GroupNode";
import InfoPanel from "@/components/InfoPanel";
import AnalysisProgress from "@/components/AnalysisProgress";
import GitHubTokenDialog, { getStoredToken } from "@/components/GitHubTokenDialog";
import RepoChat from "@/components/RepoChat";
import { useRepoAnalysis } from "@/hooks/useRepoAnalysis";
import { useGraphLayout } from "@/hooks/useGraphLayout";
import type { RepoNode, NodeDetail } from "@/types/repo";

const nodeTypes = { fileNode: FileNode, folderNode: FolderNode, groupNode: GroupNode };

const VisualizeInner = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const repoUrl = searchParams.get("repo") || "";

  const {
    loading,
    error,
    progressStep,
    progressEvents,
    analysisResult,
    repoName,
    repoMeta,
    runAnalysis,
    handleNodeDetailLoaded,
  } = useRepoAnalysis(repoUrl);

  const {
    nodes,
    edges,
    direction,
    onNodesChange,
    onEdgesChange,
    toggleDirection,
  } = useGraphLayout(analysisResult);

  const [selectedNode, setSelectedNode] = useState<RepoNode | null>(null);
  const [askAboutNode, setAskAboutNode] = useState<string | null>(null);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    setSelectedNode(node.data as unknown as RepoNode);
  }, []);

  const onNodeDetailLoadedWrapper = useCallback(
    (nodeId: string, detail: NodeDetail) => {
      handleNodeDetailLoaded(nodeId, detail);
      setSelectedNode((prev) => {
        if (!prev || prev.id !== nodeId) return prev;
        return { ...prev, ...detail, detailLoaded: true };
      });
    },
    [handleNodeDetailLoaded]
  );

  if (loading) {
    return <AnalysisProgress currentStep={progressStep} progressEvents={progressEvents} />;
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6">
        <div className="animated-grid absolute inset-0 opacity-40" />
        <div className="relative z-10 max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <h2 className="mb-2 font-mono text-xl font-bold text-foreground">Analysis Failed</h2>
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{error}</p>
          {(error.includes("private") || error.includes("Access denied")) && (
            <div className="mb-6">
              <GitHubTokenDialog
                trigger={
                  <Button variant="outline" className="gap-2">
                    <Lock className="h-4 w-4" />
                    {getStoredToken() ? "Update GitHub token" : "Add GitHub token"}
                  </Button>
                }
              />
            </div>
          )}
          <div className="flex items-center justify-center gap-3">
            <Button variant="outline" onClick={() => navigate("/")} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Go Back
            </Button>
            <Button onClick={() => runAnalysis(true)} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
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
            {repoMeta.totalFiles} files ({repoMeta.filteredOut} filtered)
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          <NodeSearch />
          <GitHubTokenDialog />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => runAnalysis(true)} title="Re-analyze repository">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={toggleDirection}
            title={direction === "TB" ? "Switch to horizontal" : "Switch to vertical"}
          >
            {direction === "TB" ? <ArrowRightLeft className="h-4 w-4" /> : <ArrowDownUp className="h-4 w-4" />}
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
        defaultEdgeOptions={{ type: "smoothstep" }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-background [&>pattern>circle]:fill-muted" />
        <Controls />
        <MiniMap
          nodeColor={(n) => (n.type === "folderNode" ? "var(--color-secondary)" : "var(--color-primary)")}
          maskColor="rgba(0, 0, 0, 0.7)"
          pannable
          zoomable
        />
      </ReactFlow>

      <Legend />
      <InfoPanel
        node={selectedNode}
        repoUrl={repoUrl}
        onClose={() => setSelectedNode(null)}
        onNodeDetailLoaded={onNodeDetailLoadedWrapper}
        onAskChat={(question) => setAskAboutNode(question)}
      />
      <RepoChat
        analysisResult={analysisResult}
        askAboutNode={askAboutNode}
        onAskHandled={() => setAskAboutNode(null)}
      />
    </div>
  );
};

const Visualize = () => (
  <ReactFlowProvider>
    <VisualizeInner />
  </ReactFlowProvider>
);

export default Visualize;
