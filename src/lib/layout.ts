import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const GROUP_PADDING_X = 30;
const GROUP_PADDING_TOP = 50; // extra top for label
const GROUP_PADDING_BOTTOM = 20;

interface LayoutOptions {
  direction?: string;
  /** Map of nodeId → parentId for grouped nodes */
  parentMap?: Map<string, string>;
}

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = "TB",
  parentMap?: Map<string, string>
) {
  if (!parentMap || parentMap.size === 0) {
    return flatLayout(nodes, edges, direction);
  }
  return groupedLayout(nodes, edges, direction, parentMap);
}

/** Original flat layout — no grouping */
function flatLayout(nodes: Node[], edges: Edge[], direction: string) {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}

/** Grouped layout — folders contain children */
function groupedLayout(
  nodes: Node[],
  edges: Edge[],
  direction: string,
  parentMap: Map<string, string>
) {
  // Separate group (folder) nodes and child nodes
  const groupIds = new Set(parentMap.values());
  const childIds = new Set(parentMap.keys());

  // Step 1: Layout children within each group using mini dagre graphs
  const groupChildren = new Map<string, string[]>();
  for (const [childId, parentId] of parentMap) {
    if (!groupChildren.has(parentId)) groupChildren.set(parentId, []);
    groupChildren.get(parentId)!.push(childId);
  }

  // For each group, compute internal layout and group dimensions
  const groupSizes = new Map<string, { width: number; height: number }>();
  const childRelativePositions = new Map<string, { x: number; y: number }>();

  for (const [groupId, children] of groupChildren) {
    const g = new dagre.graphlib.Graph();
    g.setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: direction, nodesep: 30, ranksep: 50 });

    children.forEach((id) => {
      g.setNode(id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });

    // Add edges that are internal to this group
    edges.forEach((edge) => {
      if (children.includes(edge.source) && children.includes(edge.target)) {
        g.setEdge(edge.source, edge.target);
      }
    });

    dagre.layout(g);

    // Get bounding box of all children
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    children.forEach((id) => {
      const pos = g.node(id);
      minX = Math.min(minX, pos.x - NODE_WIDTH / 2);
      minY = Math.min(minY, pos.y - NODE_HEIGHT / 2);
      maxX = Math.max(maxX, pos.x + NODE_WIDTH / 2);
      maxY = Math.max(maxY, pos.y + NODE_HEIGHT / 2);
    });

    const groupWidth = (maxX - minX) + GROUP_PADDING_X * 2;
    const groupHeight = (maxY - minY) + GROUP_PADDING_TOP + GROUP_PADDING_BOTTOM;
    groupSizes.set(groupId, { width: groupWidth, height: groupHeight });

    // Store child positions relative to group origin
    children.forEach((id) => {
      const pos = g.node(id);
      childRelativePositions.set(id, {
        x: pos.x - NODE_WIDTH / 2 - minX + GROUP_PADDING_X,
        y: pos.y - NODE_HEIGHT / 2 - minY + GROUP_PADDING_TOP,
      });
    });
  }

  // Step 2: Layout all top-level nodes (groups + ungrouped nodes) with dagre
  const topLevelGraph = new dagre.graphlib.Graph();
  topLevelGraph.setDefaultEdgeLabel(() => ({}));
  topLevelGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 100 });

  nodes.forEach((node) => {
    if (childIds.has(node.id)) return; // skip children
    const size = groupSizes.get(node.id);
    topLevelGraph.setNode(node.id, {
      width: size?.width || NODE_WIDTH,
      height: size?.height || NODE_HEIGHT,
    });
  });

  // Add inter-group and ungrouped edges
  edges.forEach((edge) => {
    const sourceTop = parentMap.get(edge.source) || edge.source;
    const targetTop = parentMap.get(edge.target) || edge.target;
    if (sourceTop !== targetTop && !childIds.has(sourceTop) && !childIds.has(targetTop)) {
      // Avoid duplicates
      if (!topLevelGraph.hasEdge(sourceTop, targetTop)) {
        topLevelGraph.setEdge(sourceTop, targetTop);
      }
    }
  });

  dagre.layout(topLevelGraph);

  // Step 3: Compute final positions
  const layoutedNodes = nodes.map((node) => {
    if (groupIds.has(node.id)) {
      // This is a group node
      const pos = topLevelGraph.node(node.id);
      const size = groupSizes.get(node.id) || { width: NODE_WIDTH, height: NODE_HEIGHT };
      return {
        ...node,
        position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 },
        style: {
          ...node.style,
          width: size.width,
          height: size.height,
        },
      };
    }

    if (childIds.has(node.id)) {
      // This is a child node — position relative to parent
      const relPos = childRelativePositions.get(node.id) || { x: 0, y: 0 };
      return {
        ...node,
        position: relPos,
      };
    }

    // Ungrouped top-level node
    const pos = topLevelGraph.node(node.id);
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
    };
  });

  return { nodes: layoutedNodes, edges };
}
