import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
console.log("JavaScript:", typeof JavaScript, JavaScript.name || Object.keys(JavaScript));
console.log("TypeScript:", typeof TypeScript, TypeScript.name || Object.keys(TypeScript));
