import fs from "fs";
import Parser from "tree-sitter";
import ts from "tree-sitter-typescript";

const content = fs.readFileSync("./api/lib/static-analysis.ts", "utf8");

try {
  const parser = new Parser();
  parser.setLanguage(ts.typescript);

  let i = 0;
  const tree = parser.parse((index, position) => {
    let chunk = content.slice(index, index + 32767);
    return chunk || null;
  });
  console.log("Chunked ok:", tree.rootNode.type);
} catch (e) {
  console.log(e.message);
}
