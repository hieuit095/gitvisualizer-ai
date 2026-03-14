import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import { getLayoutedElements } from "@/lib/layout";

function getRect(node: Node) {
  const style = (node.style || {}) as { width?: number; minHeight?: number };
  const width = Number(style.width || 220);
  const height = Number(style.minHeight || 88);
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + width,
    bottom: node.position.y + height,
  };
}

function overlaps(left: ReturnType<typeof getRect>, right: ReturnType<typeof getRect>) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

describe("layout", () => {
  it("keeps grouped children from overlapping when a folder has sparse edges", () => {
    const nodes: Node[] = [
      {
        id: "folder_src_components",
        type: "groupNode",
        position: { x: 0, y: 0 },
        data: { name: "src/components", summary: "" },
      },
      {
        id: "header",
        type: "fileNode",
        position: { x: 0, y: 0 },
        data: { name: "Header.tsx", summary: "Component" },
        parentId: "folder_src_components",
      },
      {
        id: "footer",
        type: "fileNode",
        position: { x: 0, y: 0 },
        data: { name: "Footer.tsx", summary: "Component" },
        parentId: "folder_src_components",
      },
      {
        id: "sidebar",
        type: "fileNode",
        position: { x: 0, y: 0 },
        data: { name: "Sidebar.tsx", summary: "Component" },
        parentId: "folder_src_components",
      },
      {
        id: "nav",
        type: "fileNode",
        position: { x: 0, y: 0 },
        data: { name: "Nav.tsx", summary: "Component" },
        parentId: "folder_src_components",
      },
    ];

    const edges: Edge[] = [];
    const parentMap = new Map([
      ["header", "folder_src_components"],
      ["footer", "folder_src_components"],
      ["sidebar", "folder_src_components"],
      ["nav", "folder_src_components"],
    ]);

    const { nodes: layouted } = getLayoutedElements(nodes, edges, "TB", parentMap);
    const children = layouted.filter((node) => parentMap.has(node.id));

    for (let index = 0; index < children.length; index++) {
      for (let inner = index + 1; inner < children.length; inner++) {
        expect(overlaps(getRect(children[index]), getRect(children[inner]))).toBe(false);
      }
    }
  });
});
