import Parser from "tree-sitter";

const parser = new Parser();
try {
  const t = parser.parse("const a = 1;").rootNode;
  console.log("No lang parsed", t);
} catch(e) {
  console.log("Error no lang", e.message);
}
