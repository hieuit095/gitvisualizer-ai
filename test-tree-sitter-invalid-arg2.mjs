import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";

try {
  const parser = new Parser();
  parser.setLanguage(JavaScript);
  parser.parse("a", null, { bufferSize: "not a number" });
} catch(e) {
  console.log("Error buffer size", e);
}
