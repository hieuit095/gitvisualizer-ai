import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import Java from "tree-sitter-java";
import CSharp from "tree-sitter-c-sharp";

const langs = {
  javascript: JavaScript,
  typescript: TypeScript.typescript,
  tsx: TypeScript.tsx,
  python: Python,
  go: Go,
  rust: Rust,
  java: Java,
  csharp: CSharp,
};

for (const [key, lang] of Object.entries(langs)) {
  try {
    const parser = new Parser();
    parser.setLanguage(lang);
    console.log(`${key} language set`);
    const tree = parser.parse("const a = 1;");
    console.log(`${key} parsed`);
  } catch (e) {
    console.error(`${key} Error:`, e.message);
  }
}
