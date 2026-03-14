import Parser from "tree-sitter";

try {
  const parser = new Parser();
  parser.parse("const a = 1;");
} catch(e) {
  console.log("Error no lang", e);
}
