import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";

try {
  const parser = new Parser();
  parser.setLanguage(ts.typescript);
  parser.parse("");
} catch(e) {
  console.log("Error empty", e.message);
}

try {
  const parser = new Parser();
  parser.setLanguage(ts.typescript);
  parser.parse(null);
} catch(e) {
  console.log("Error null", e.message);
}

try {
  const parser = new Parser();
  // Don't set language
  parser.parse("const a = 1;");
} catch(e) {
  console.log("Error no lang", e.message);
}
