import Parser from "tree-sitter";
import CSharp from "tree-sitter-c-sharp";

const parser = new Parser();
try {
  parser.setLanguage(CSharp);
  console.log("CSharp language set");
  const tree = parser.parse("const a = 1;");
  console.log("CSharp parsed");
} catch (e) {
  console.error("CSharp Error:", e.message);
}
