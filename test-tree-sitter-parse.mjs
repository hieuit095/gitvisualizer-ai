import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";

const parser = new Parser();
try {
  parser.setLanguage(JavaScript);
  console.log("JavaScript language set");
  const tree = parser.parse("const a = 1;");
  console.log("JavaScript parsed");
} catch (e) {
  console.error("JavaScript Error:", e);
}

const parser2 = new Parser();
try {
  parser2.setLanguage(TypeScript.typescript);
  console.log("TypeScript language set");
  const tree = parser2.parse("const a: number = 1;");
  console.log("TypeScript parsed");
} catch (e) {
  console.error("TypeScript Error:", e);
}
