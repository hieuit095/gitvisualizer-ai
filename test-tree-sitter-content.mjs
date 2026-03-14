import { analyzeSourceFile } from "./api/lib/static-analysis.js";
const t = analyzeSourceFile("", "test.ts");
console.log(t.skeletonText.length === 0);
