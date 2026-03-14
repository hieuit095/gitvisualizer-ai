import { useCallback, useEffect, useRef } from "react";
import { useReactFlow, type Node } from "@xyflow/react";

interface UseKeyboardNavigationOptions {
  nodes: Node[];
  onSelectNode: (node: Node) => void;
  onDeselectNode: () => void;
  selectedNodeId: string | null;
}

export function useKeyboardNavigation({
  nodes,
  onSelectNode,
  onDeselectNode,
  selectedNodeId,
}: UseKeyboardNavigationOptions) {
  const { fitView, setCenter } = useReactFlow();
  const indexRef = useRef(-1);

  // Keep index in sync with selected node
  useEffect(() => {
    if (!selectedNodeId) {
      indexRef.current = -1;
      return;
    }
    const idx = nodes.findIndex((n) => n.id === selectedNodeId);
    if (idx >= 0) indexRef.current = idx;
  }, [selectedNodeId, nodes]);

  const focusNode = useCallback(
    (node: Node) => {
      const x = (node.position?.x ?? 0) + ((node.measured?.width ?? 200) / 2);
      const y = (node.position?.y ?? 0) + ((node.measured?.height ?? 80) / 2);
      setCenter(x, y, { duration: 300, zoom: 1.2 });
    },
    [setCenter]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Only handle when not typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const navigableNodes = nodes.filter(
        (n) => n.type === "fileNode" || n.type === "folderNode"
      );
      if (navigableNodes.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
        case "j": {
          e.preventDefault();
          indexRef.current = (indexRef.current + 1) % navigableNodes.length;
          const node = navigableNodes[indexRef.current];
          onSelectNode(node);
          focusNode(node);
          break;
        }
        case "ArrowUp":
        case "ArrowLeft":
        case "k": {
          e.preventDefault();
          indexRef.current =
            (indexRef.current - 1 + navigableNodes.length) %
            navigableNodes.length;
          const node = navigableNodes[indexRef.current];
          onSelectNode(node);
          focusNode(node);
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (indexRef.current >= 0 && indexRef.current < navigableNodes.length) {
            const node = navigableNodes[indexRef.current];
            onSelectNode(node);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          onDeselectNode();
          break;
        }
        case "Home": {
          e.preventDefault();
          indexRef.current = 0;
          const first = navigableNodes[0];
          onSelectNode(first);
          focusNode(first);
          break;
        }
        case "End": {
          e.preventDefault();
          indexRef.current = navigableNodes.length - 1;
          const last = navigableNodes[navigableNodes.length - 1];
          onSelectNode(last);
          focusNode(last);
          break;
        }
      }
    },
    [nodes, onSelectNode, onDeselectNode, focusNode]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
