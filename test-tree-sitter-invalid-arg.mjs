import Parser from "tree-sitter";

try {
  const parser = new Parser();
  parser.setLanguage({});
} catch(e) {
  console.log("Language obj Error", e);
}

const parser2 = new Parser();
import JavaScript from "tree-sitter-javascript";
parser2.setLanguage(JavaScript);
try {
  parser2.parse(new Uint8Array([1, 2, 3]));
} catch(e) {
  console.log("Buffer Error", e);
}
