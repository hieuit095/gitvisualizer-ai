import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

const FILE_NODE_WIDTH = 220;
const FOLDER_NODE_WIDTH = 200;
const BASE_NODE_HEIGHT = 88;
const EXTRA_SUMMARY_HEIGHT = 14;
const GROUP_PADDING_X = 28;
const GROUP_PADDING_TOP = 44;
const GROUP_PADDING_BOTTOM = 28;
const GROUP_GAP_X = 24;
const GROUP_GAP_Y = 18;

interface NodeSize {
  width: number;
  height: number;
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = "TB",
  parentMap?: Map<string, string>,
) {
  if (!parentMap || parentMap.size === 0) {
    return flatLayout(nodes, edges, direction);
  }
  return groupedLayout(nodes, edges, direction, parentMap);
}

function flatLayout(nodes: Node[], edges: Edge[], direction: string) {
  const graph = createGraph(direction, false);
  const nodeSizes = new Map(nodes.map((node) => [node.id, getNodeSize(node)]));

  nodes.forEach((node) => {
    const size = nodeSizes.get(node.id)!;
    graph.setNode(node.id, size);
  });

  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return {
    nodes: nodes.map((node) => {
      const size = nodeSizes.get(node.id)!;
      const position = graph.node(node.id);
      return applyNodeFrame(node, size, {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
      });
    }),
    edges,
  };
}

function groupedLayout(
  nodes: Node[],
  edges: Edge[],
  direction: string,
  parentMap: Map<string, string>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeSizes = new Map(nodes.map((node) => [node.id, getNodeSize(node)]));
  const groupIds = new Set(parentMap.values());
  const childIds = new Set(parentMap.keys());
  const groupChildren = new Map<string, string[]>();

  for (const [childId, parentId] of parentMap.entries()) {
    if (!groupChildren.has(parentId)) groupChildren.set(parentId, []);
    groupChildren.get(parentId)!.push(childId);
  }

  const groupSizes = new Map<string, NodeSize>();
  const childRelativePositions = new Map<string, { x: number; y: number }>();

  for (const [groupId, childIdsForGroup] of groupChildren.entries()) {
    const childIdSet = new Set(childIdsForGroup);
    const childNodes = childIdsForGroup
      .map((childId) => nodeById.get(childId))
      .filter((node): node is Node => Boolean(node))
      .sort((left, right) => {
        const leftName = String((left.data as { name?: string })?.name || left.id);
        const rightName = String((right.data as { name?: string })?.name || right.id);
        return leftName.localeCompare(rightName);
      });

    const internalEdges = edges.filter((edge) => childIdSet.has(edge.source) && childIdSet.has(edge.target));
    const useGridLayout = internalEdges.length < Math.max(1, Math.ceil(childNodes.length / 2));
    const positionedChildren = useGridLayout
      ? layoutChildrenInGrid(childNodes, nodeSizes, direction)
      : layoutChildrenWithDagre(childNodes, internalEdges, nodeSizes, direction);

    const bounds = getChildBounds(positionedChildren, nodeSizes);
    groupSizes.set(groupId, {
      width: bounds.width + GROUP_PADDING_X * 2,
      height: bounds.height + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM,
    });

    positionedChildren.forEach(({ id, x, y }) => {
      childRelativePositions.set(id, {
        x: x - bounds.minX + GROUP_PADDING_X,
        y: y - bounds.minY + GROUP_PADDING_TOP,
      });
    });
  }

  const topLevelGraph = createGraph(direction, true);

  nodes.forEach((node) => {
    if (childIds.has(node.id)) return;

    const size = groupSizes.get(node.id) || nodeSizes.get(node.id)!;
    topLevelGraph.setNode(node.id, size);
  });

  edges.forEach((edge) => {
    const sourceTop = parentMap.get(edge.source) || edge.source;
    const targetTop = parentMap.get(edge.target) || edge.target;
    if (sourceTop === targetTop) return;
    if (childIds.has(sourceTop) || childIds.has(targetTop)) return;
    if (!topLevelGraph.hasEdge(sourceTop, targetTop)) {
      topLevelGraph.setEdge(sourceTop, targetTop);
    }
  });

  dagre.layout(topLevelGraph);

  return {
    nodes: nodes.map((node) => {
      if (groupIds.has(node.id)) {
        const size = groupSizes.get(node.id) || nodeSizes.get(node.id)!;
        const position = topLevelGraph.node(node.id);
        return {
          ...node,
          position: {
            x: position.x - size.width / 2,
            y: position.y - size.height / 2,
          },
          style: {
            ...node.style,
            width: size.width,
            height: size.height,
          },
        };
      }

      if (childIds.has(node.id)) {
        return {
          ...applyNodeFrame(node, nodeSizes.get(node.id)!, childRelativePositions.get(node.id) || { x: 0, y: 0 }),
          position: childRelativePositions.get(node.id) || { x: 0, y: 0 },
        };
      }

      const size = nodeSizes.get(node.id)!;
      const position = topLevelGraph.node(node.id);
      return applyNodeFrame(node, size, {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
      });
    }),
    edges,
  };
}

function createGraph(direction: string, grouped: boolean) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: grouped ? 96 : 84,
    ranksep: grouped ? 140 : 120,
    marginx: 24,
    marginy: 24,
  });
  return graph;
}

function getNodeSize(node: Node): NodeSize {
  if (node.type === "groupNode") {
    return { width: FILE_NODE_WIDTH + GROUP_PADDING_X * 2, height: 180 };
  }

  const data = node.data as { summary?: string } | undefined;
  const summary = data?.summary?.trim() || "";
  const summaryHeight = summary.length > 110 ? EXTRA_SUMMARY_HEIGHT : 0;
  const width = node.type === "folderNode" ? FOLDER_NODE_WIDTH : FILE_NODE_WIDTH;

  return {
    width,
    height: BASE_NODE_HEIGHT + summaryHeight,
  };
}

function layoutChildrenWithDagre(
  childNodes: Node[],
  internalEdges: Edge[],
  nodeSizes: Map<string, NodeSize>,
  direction: string,
) {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: direction,
    nodesep: 42,
    ranksep: 70,
    marginx: 0,
    marginy: 0,
  });

  childNodes.forEach((node) => {
    graph.setNode(node.id, nodeSizes.get(node.id)!);
  });

  internalEdges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  dagre.layout(graph);

  return childNodes.map((node) => {
    const size = nodeSizes.get(node.id)!;
    const position = graph.node(node.id);
    return {
      id: node.id,
      x: position.x - size.width / 2,
      y: position.y - size.height / 2,
    };
  });
}

function layoutChildrenInGrid(
  childNodes: Node[],
  nodeSizes: Map<string, NodeSize>,
  direction: string,
) {
  const count = Math.max(1, childNodes.length);
  const primarySpan = Math.max(1, Math.ceil(Math.sqrt(count)));
  const columns = direction === "TB"
    ? primarySpan
    : Math.max(1, Math.ceil(count / primarySpan));

  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights: number[] = [];
  const placements: Array<{ id: string; row: number; column: number }> = [];

  childNodes.forEach((node, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const size = nodeSizes.get(node.id)!;
    columnWidths[column] = Math.max(columnWidths[column], size.width);
    rowHeights[row] = Math.max(rowHeights[row] || 0, size.height);
    placements.push({ id: node.id, row, column });
  });

  return placements.map(({ id, row, column }) => {
    const size = nodeSizes.get(id)!;
    const x = sum(columnWidths.slice(0, column)) + column * GROUP_GAP_X + (columnWidths[column] - size.width) / 2;
    const y = sum(rowHeights.slice(0, row)) + row * GROUP_GAP_Y + (rowHeights[row] - size.height) / 2;
    return { id, x, y };
  });
}

function getChildBounds(
  positions: Array<{ id: string; x: number; y: number }>,
  nodeSizes: Map<string, NodeSize>,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  positions.forEach(({ id, x, y }) => {
    const size = nodeSizes.get(id)!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }

  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function applyNodeFrame(node: Node, size: NodeSize, position: { x: number; y: number }) {
  return {
    ...node,
    position,
    style: {
      ...node.style,
      width: size.width,
      minHeight: size.height,
    },
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
