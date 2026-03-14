import { describe, expect, it } from "vitest";
import { analyzeSourceFile, buildStaticChunks } from "../../server/lib/static-analysis";

describe("static analysis", () => {
  it("extracts a Tree-sitter skeleton for TypeScript", () => {
    const source = `
      import { BaseService } from "./base";

      export class UserService extends BaseService {
        cache = new Map<string, string>();

        async loadUser(id: string): Promise<string> {
          return id;
        }
      }

      export const createStore = async (name: string): Promise<string> => name;
      const DEFAULT_LIMIT = 25;
    `;

    const analysis = analyzeSourceFile(source, "src/user-service.ts");

    expect(analysis.supported).toBe(true);
    expect(analysis.usedFallback).toBe(false);
    expect(analysis.parser).toBe("tree-sitter-typescript");
    expect(analysis.imports).toContain("./base");
    expect(analysis.classes).toContain("UserService");
    expect(analysis.functions).toContain("createStore");
    expect(analysis.variables).toContain("DEFAULT_LIMIT");
    expect(analysis.skeletonText).toContain("export class UserService extends BaseService");
    expect(analysis.skeletonText).toContain("field cache");
    expect(analysis.skeletonText).toContain("async method loadUser(id: string): Promise<string>");
    expect(analysis.skeletonText).toContain("export async function createStore(name: string): Promise<string>");
  });

  it("extracts Python classes, functions, and variables", () => {
    const source = `
import os
from services.base import BaseWorker

class Worker(BaseWorker):
    retries = 3

    def run(self, payload):
        return payload

def bootstrap(config):
    return Worker()

DEFAULT_TIMEOUT = 10
`;

    const analysis = analyzeSourceFile(source, "workers/main.py");

    expect(analysis.supported).toBe(true);
    expect(analysis.usedFallback).toBe(false);
    expect(analysis.imports).toContain("os");
    expect(analysis.imports).toContain("services.base");
    expect(analysis.classes).toContain("Worker");
    expect(analysis.functions).toContain("bootstrap");
    expect(analysis.variables).toContain("DEFAULT_TIMEOUT");
    expect(analysis.skeletonText).toContain("class Worker(BaseWorker)");
    expect(analysis.skeletonText).toContain("method run(self, payload)");
    expect(analysis.skeletonText).toContain("variable DEFAULT_TIMEOUT");
  });

  it("builds structure-first chunks from Tree-sitter symbols", () => {
    const source = `
package main

import "fmt"

type Service struct {
  Name string
}

func (s *Service) Run(input string) string {
  return input
}

func Start() string {
  return "ok"
}
`;

    const chunks = buildStaticChunks(source, "service.go");

    expect(chunks.map((chunk) => `${chunk.chunkType}:${chunk.chunkName}`)).toEqual([
      "import:imports",
      "struct:Service",
      "impl:Service",
      "function:Start",
    ]);
  });
});
