import { analyzeSourceFile } from "./api/lib/static-analysis.ts";
try {
  const t = analyzeSourceFile(null as any, "test.ts");
  console.log("null ok", t.skeletonText.length === 0);
} catch (e) {
  console.error("Null error:", e.message);
}
