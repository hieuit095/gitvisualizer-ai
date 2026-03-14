import { beforeEach, describe, expect, it } from "vitest";
import {
  deleteChunksForRepo,
  searchChunks,
  storeChunk,
  vectorSearchChunks,
} from "../../server/lib/store";

const repoUrl = "https://example.com/test-repo";

describe("store search ranking", () => {
  beforeEach(() => {
    deleteChunksForRepo(repoUrl);
  });

  it("boosts path and symbol matches for semantic search ranking", () => {
    storeChunk({
      repo_url: repoUrl,
      file_path: "src/index/index.ts",
      chunk_index: 0,
      chunk_type: "interface",
      chunk_name: "SWRGlobalConfig",
      content: "export interface SWRGlobalConfig {}",
      start_line: 1,
      end_line: 1,
      embedding: [0.9, 0.1],
    });
    storeChunk({
      repo_url: repoUrl,
      file_path: "src/_internal/utils/global-state.ts",
      chunk_index: 0,
      chunk_type: "variable",
      chunk_name: "SWRGlobalState",
      content: "export const SWRGlobalState = new WeakMap();",
      start_line: 1,
      end_line: 1,
      embedding: [0.82, 0.18],
    });

    const results = vectorSearchChunks(
      repoUrl,
      [1, 0],
      0,
      5,
      "How does global state management work?",
    );

    expect(results[0]?.file_path).toBe("src/_internal/utils/global-state.ts");
  });

  it("includes file paths in text-search scoring", () => {
    storeChunk({
      repo_url: repoUrl,
      file_path: "src/_internal/utils/global-state.ts",
      chunk_index: 0,
      chunk_type: "variable",
      chunk_name: "stateStore",
      content: "const stateStore = new Map();",
      start_line: 1,
      end_line: 1,
    });

    const results = searchChunks(repoUrl, "global state management", 5);

    expect(results[0]?.file_path).toBe("src/_internal/utils/global-state.ts");
  });
});
