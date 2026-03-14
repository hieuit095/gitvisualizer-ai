import { describe, expect, it } from "vitest";

import {
  buildDeterministicDiagram,
  buildImportResolutionContext,
  mergeDiagramWithStaticStructure,
  resolveImportSpecifier,
  type DiagramPayload,
  type ShallowFileInfo,
} from "../../server/lib/diagram-structure";

describe("diagram structure", () => {
  it("resolves tsconfig path aliases", () => {
    const knownPaths = new Set([
      "src/pages/Home.tsx",
      "src/components/Button.tsx",
      "src/lib/util.ts",
    ]);

    const context = buildImportResolutionContext(knownPaths, [
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["src/*"],
            },
          },
        }),
      },
    ]);

    expect(resolveImportSpecifier("src/pages/Home.tsx", "@/components/Button", context)).toBe("src/components/Button.tsx");
    expect(resolveImportSpecifier("src/pages/Home.tsx", "@/lib/util", context)).toBe("src/lib/util.ts");
  });

  it("resolves python module imports inside the repo", () => {
    const knownPaths = new Set([
      "workers/main.py",
      "services/base.py",
      "services/__init__.py",
    ]);

    const context = buildImportResolutionContext(knownPaths);

    expect(resolveImportSpecifier("workers/main.py", "services.base", context)).toBe("services/base.py");
  });

  it("builds a connected deterministic graph and keeps AI summaries", () => {
    const shallowMap: ShallowFileInfo[] = [
      {
        path: "src/pages/Index.tsx",
        type: "component",
        imports: ["@/components/Header", "@/components/Footer", "@/lib/client"],
        exports: ["IndexPage"],
        signatures: ["IndexPage"],
      },
      {
        path: "src/components/Header.tsx",
        type: "component",
        imports: ["@/lib/client"],
        exports: ["Header"],
        signatures: ["Header"],
      },
      {
        path: "src/components/Footer.tsx",
        type: "component",
        imports: ["@/lib/client"],
        exports: ["Footer"],
        signatures: ["Footer"],
      },
      {
        path: "src/lib/client.ts",
        type: "utility",
        imports: [],
        exports: ["client"],
        signatures: ["client"],
      },
    ];

    const knownPaths = new Set(shallowMap.map((file) => file.path));
    const context = buildImportResolutionContext(knownPaths, [
      {
        path: "tsconfig.json",
        content: JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: {
              "@/*": ["src/*"],
            },
          },
        }),
      },
    ]);

    const aiDiagram: DiagramPayload = {
      nodes: [
        {
          id: "index_node",
          name: "Index.tsx",
          type: "component",
          summary: "Main application page.",
          keyFunctions: ["IndexPage"],
          path: "src/pages/Index.tsx",
        },
        {
          id: "header_node",
          name: "Header.tsx",
          type: "component",
          summary: "Primary navigation header.",
          keyFunctions: ["Header"],
          path: "src/components/Header.tsx",
        },
      ],
      edges: [],
    };

    const merged = mergeDiagramWithStaticStructure(aiDiagram, shallowMap, context, {
      maxFiles: 4,
      maxFolders: 4,
    });

    const nodePaths = new Set(merged.nodes.map((node) => node.path));
    expect(nodePaths.has("src/pages/Index.tsx")).toBe(true);
    expect(nodePaths.has("src/components/Header.tsx")).toBe(true);
    expect(nodePaths.has("src/components/Footer.tsx")).toBe(true);
    expect(nodePaths.has("src/lib/client.ts")).toBe(true);
    expect(nodePaths.has("src/components")).toBe(true);

    const indexNode = merged.nodes.find((node) => node.path === "src/pages/Index.tsx");
    expect(indexNode?.summary).toBe("Main application page.");

    const edgePairs = merged.edges.map((edge) => `${edge.source}->${edge.target}:${edge.type}`);
    expect(edgePairs.some((edge) => edge.endsWith(":imports"))).toBe(true);
    expect(merged.edges.filter((edge) => edge.type === "contains")).toHaveLength(2);
  });

  it("keeps directly connected files together when using preferred paths", () => {
    const shallowMap: ShallowFileInfo[] = [
      {
        path: "src/main.ts",
        type: "entry",
        imports: ["./app"],
        exports: ["bootstrap"],
        signatures: ["bootstrap"],
      },
      {
        path: "src/app.ts",
        type: "component",
        imports: ["./state/store"],
        exports: ["App"],
        signatures: ["App"],
      },
      {
        path: "src/state/store.ts",
        type: "utility",
        imports: [],
        exports: ["store"],
        signatures: ["store"],
      },
    ];

    const diagram = buildDeterministicDiagram(
      shallowMap,
      buildImportResolutionContext(new Set(shallowMap.map((file) => file.path))),
      {
        maxFiles: 3,
        preferredPaths: ["src/main.ts"],
      },
    );

    const paths = new Set(diagram.nodes.filter((node) => node.type !== "folder").map((node) => node.path));
    expect(paths).toEqual(new Set(["src/main.ts", "src/app.ts", "src/state/store.ts"]));
  });
});
