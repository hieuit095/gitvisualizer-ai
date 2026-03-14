const JavaScript = require("tree-sitter-javascript");
const TypeScript = require("tree-sitter-typescript");
console.log("JavaScript:", typeof JavaScript, JavaScript.name || Object.keys(JavaScript));
console.log("TypeScript:", typeof TypeScript, TypeScript.name || Object.keys(TypeScript));
