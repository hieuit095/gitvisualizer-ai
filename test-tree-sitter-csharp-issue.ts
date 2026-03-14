import { analyzeSourceFile } from "./api/lib/static-analysis.ts";

try {
  analyzeSourceFile(undefined as any, "test.ts");
} catch(e) {
  console.log("Error analyze undefined", e.message);
}
