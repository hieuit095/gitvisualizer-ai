import { analyzeSourceFile } from "./api/lib/static-analysis.js";

try {
  const result = analyzeSourceFile(null, "api/lib/static-analysis.ts");
  console.log("Empty result");
} catch(e) {
  console.log("Empty err", e.message);
}
