import { analyzeSourceFile } from "./api/lib/static-analysis.js";

try {
  analyzeSourceFile(undefined, "test.ts");
} catch(e) {
  console.log("Error analyze undefined", e.message);
}
