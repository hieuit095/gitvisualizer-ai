import { basename, extname } from "path";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import Java from "tree-sitter-java";
import CSharp from "tree-sitter-c-sharp";

export type StaticSymbolKind =
  | "class"
  | "struct"
  | "interface"
  | "trait"
  | "enum"
  | "type"
  | "impl"
  | "function"
  | "method"
  | "variable"
  | "field"
  | "property";

export interface StaticSymbol {
  kind: StaticSymbolKind;
  name: string;
  signature: string;
  exported: boolean;
  startLine: number;
  endLine: number;
  children: StaticSymbol[];
}

export interface StaticImport {
  source: string;
  startLine: number;
  endLine: number;
}

export interface FileStaticAnalysis {
  parser: string | null;
  supported: boolean;
  usedFallback: boolean;
  imports: string[];
  importsInfo: StaticImport[];
  exports: string[];
  topLevelSymbols: StaticSymbol[];
  declarations: StaticSymbol[];
  classes: string[];
  functions: string[];
  variables: string[];
  skeletonText: string;
}

export interface StaticChunkCandidate {
  chunkType: string;
  chunkName: string;
  content: string;
  startLine: number;
  endLine: number;
}

type SupportedLanguageKey =
  | "javascript"
  | "typescript"
  | "tsx"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "csharp";

type TreeSitterLanguage = unknown;

interface LanguageConfig {
  key: SupportedLanguageKey;
  parserName: string;
  language: TreeSitterLanguage;
}

const TYPE_SCRIPT_LANGUAGE = TypeScript as unknown as {
  typescript: TreeSitterLanguage;
  tsx: TreeSitterLanguage;
};

const LANGUAGE_BY_EXTENSION: Record<string, LanguageConfig> = {
  ".js": { key: "javascript", parserName: "tree-sitter-javascript", language: JavaScript as TreeSitterLanguage },
  ".jsx": { key: "javascript", parserName: "tree-sitter-javascript", language: JavaScript as TreeSitterLanguage },
  ".mjs": { key: "javascript", parserName: "tree-sitter-javascript", language: JavaScript as TreeSitterLanguage },
  ".cjs": { key: "javascript", parserName: "tree-sitter-javascript", language: JavaScript as TreeSitterLanguage },
  ".ts": { key: "typescript", parserName: "tree-sitter-typescript", language: TYPE_SCRIPT_LANGUAGE.typescript },
  ".tsx": { key: "tsx", parserName: "tree-sitter-tsx", language: TYPE_SCRIPT_LANGUAGE.tsx },
  ".py": { key: "python", parserName: "tree-sitter-python", language: Python as TreeSitterLanguage },
  ".go": { key: "go", parserName: "tree-sitter-go", language: Go as TreeSitterLanguage },
  ".rs": { key: "rust", parserName: "tree-sitter-rust", language: Rust as TreeSitterLanguage },
  ".java": { key: "java", parserName: "tree-sitter-java", language: Java as TreeSitterLanguage },
  ".cs": { key: "csharp", parserName: "tree-sitter-c-sharp", language: CSharp as TreeSitterLanguage },
};

const PARSER_CACHE = new Map<SupportedLanguageKey, Parser>();
const MAX_TREE_SITTER_INPUT_BYTES = 32_767;
const BODY_FIELD_NAMES = [
  "body",
  "declaration_list",
  "class_body",
  "interface_body",
  "enum_body",
  "field_declaration_list",
  "enum_member_declaration_list",
  "block",
];

const FALLBACK_DECLARATION_PATTERNS: Array<{
  pattern: RegExp;
  kind: StaticSymbolKind;
  nameGroup: number;
}> = [
  { pattern: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: "class", nameGroup: 1 },
  { pattern: /^(?:export\s+)?interface\s+(\w+)/, kind: "interface", nameGroup: 1 },
  { pattern: /^(?:export\s+)?type\s+(\w+)\s*=/, kind: "type", nameGroup: 1 },
  { pattern: /^(?:export\s+)?enum\s+(\w+)/, kind: "enum", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\b/, kind: "variable", nameGroup: 1 },
  { pattern: /^(?:async\s+)?def\s+(\w+)/, kind: "function", nameGroup: 1 },
  { pattern: /^class\s+(\w+)/, kind: "class", nameGroup: 1 },
  { pattern: /^func\s+(?:\(\s*\w+\s+\*?(\w+)\s*\)\s+)?(\w+)/, kind: "function", nameGroup: 2 },
  { pattern: /^type\s+(\w+)\s+struct\b/, kind: "struct", nameGroup: 1 },
  { pattern: /^type\s+(\w+)\s+interface\b/, kind: "interface", nameGroup: 1 },
  { pattern: /^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, kind: "function", nameGroup: 1 },
  { pattern: /^(?:pub\s+)?struct\s+(\w+)/, kind: "struct", nameGroup: 1 },
  { pattern: /^(?:pub\s+)?trait\s+(\w+)/, kind: "trait", nameGroup: 1 },
  { pattern: /^impl\s+(?:(\w+)\s+for\s+)?(\w+)/, kind: "impl", nameGroup: 2 },
  { pattern: /^(?:public|private|protected)?\s*(?:static\s+)?(?:abstract\s+)?class\s+(\w+)/, kind: "class", nameGroup: 1 },
];

const FALLBACK_METHOD_PATTERNS: RegExp[] = [
  /^\s+(?:public|private|protected|static|async|abstract|readonly|\s)*(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\s{;]+))?/,
  /^\s+(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/,
  /^\s+(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*->\s*(\S+))?/,
];

export function analyzeSourceFile(content: string, filePath: string): FileStaticAnalysis {
  const config = LANGUAGE_BY_EXTENSION[extname(filePath).toLowerCase()];
  if (!config) {
    return analyzeWithFallback(content);
  }

  if (Buffer.byteLength(content, "utf8") > MAX_TREE_SITTER_INPUT_BYTES) {
    return analyzeWithFallback(content, config.parserName);
  }

  try {
    const parser = getParser(config);
    const root = parser.parse(content).rootNode;
    const importsInfo: StaticImport[] = [];
    const topLevelSymbols = extractTreeSitterSymbols(config.key, root, content, importsInfo);

    return finalizeAnalysis({
      parser: config.parserName,
      supported: true,
      usedFallback: false,
      importsInfo,
      topLevelSymbols,
    });
  } catch (error) {
    console.warn(`Tree-sitter analysis failed for ${filePath}:`, error);
    return analyzeWithFallback(content, config.parserName);
  }
}

export function buildStaticChunks(
  content: string,
  filePath: string,
  analysis = analyzeSourceFile(content, filePath),
): StaticChunkCandidate[] {
  const lines = content.split("\n");
  const chunks: StaticChunkCandidate[] = [];
  const seen = new Set<string>();

  const importGroups = mergeRanges(
    analysis.importsInfo.map((entry) => ({
      startLine: entry.startLine,
      endLine: entry.endLine,
      chunkName: "imports",
      chunkType: "import",
    })),
  );

  for (const group of importGroups) {
    const contentSlice = sliceLines(lines, group.startLine, group.endLine);
    if (!contentSlice.trim()) continue;
    const key = `${group.chunkType}:${group.chunkName}:${group.startLine}:${group.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chunks.push({
      chunkType: group.chunkType,
      chunkName: group.chunkName,
      content: contentSlice,
      startLine: group.startLine,
      endLine: group.endLine,
    });
  }

  for (const symbol of analysis.topLevelSymbols) {
    const contentSlice = sliceLines(lines, symbol.startLine, symbol.endLine);
    if (!contentSlice.trim()) continue;
    const chunkType = mapSymbolKindToChunkType(symbol.kind);
    const key = `${chunkType}:${symbol.name}:${symbol.startLine}:${symbol.endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chunks.push({
      chunkType,
      chunkName: symbol.name || basename(filePath),
      content: contentSlice,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    });
  }

  return chunks.sort((a, b) => a.startLine - b.startLine);
}

function getParser(config: LanguageConfig): Parser {
  const cached = PARSER_CACHE.get(config.key);
  if (cached) return cached;

  const parser = new Parser();
  parser.setLanguage(config.language);
  PARSER_CACHE.set(config.key, parser);
  return parser;
}

function extractTreeSitterSymbols(
  languageKey: SupportedLanguageKey,
  root: Parser.SyntaxNode,
  content: string,
  importsInfo: StaticImport[],
): StaticSymbol[] {
  switch (languageKey) {
    case "javascript":
    case "typescript":
    case "tsx":
      return extractJavaScriptSymbols(languageKey, root, content, importsInfo);
    case "python":
      return extractPythonSymbols(root, importsInfo);
    case "go":
      return extractGoSymbols(root, content, importsInfo);
    case "rust":
      return extractRustSymbols(root, content, importsInfo);
    case "java":
      return extractJavaSymbols(root, content, importsInfo);
    case "csharp":
      return extractCSharpSymbols(root, content, importsInfo);
    default:
      return [];
  }
}

function extractJavaScriptSymbols(
  languageKey: SupportedLanguageKey,
  root: Parser.SyntaxNode,
  content: string,
  importsInfo: StaticImport[],
): StaticSymbol[] {
  const symbols: StaticSymbol[] = [];

  for (const top of root.namedChildren) {
    if (top.type === "import_statement") {
      addImports(importsInfo, extractQuotedSources(top.text), top);
      continue;
    }

    if (top.type === "export_statement") {
      if (top.text.includes(" from ")) {
        addImports(importsInfo, extractQuotedSources(top.text), top);
      }

      const declaration = top.namedChildren[0];
      if (!declaration || declaration.type === "export_clause") continue;
      symbols.push(...extractJavaScriptTopLevel(languageKey, declaration, content, true, top));
      continue;
    }

    symbols.push(...extractJavaScriptTopLevel(languageKey, top, content, false, top));
  }

  return symbols;
}

function extractJavaScriptTopLevel(
  languageKey: SupportedLanguageKey,
  node: Parser.SyntaxNode,
  content: string,
  exported: boolean,
  rangeNode: Parser.SyntaxNode,
): StaticSymbol[] {
  switch (node.type) {
    case "class_declaration":
      return [extractJavaScriptClass(languageKey, node, content, exported, rangeNode)];
    case "interface_declaration":
      return [createSymbol({
        kind: "interface",
        name: node.childForFieldName("name")?.text || "anonymous",
        signature: decorateJavaScriptExport(extractHeaderText(node, content), exported, languageKey),
        exported,
        node: rangeNode,
      })];
    case "type_alias_declaration":
      return [createSymbol({
        kind: "type",
        name: node.childForFieldName("name")?.text || "anonymous",
        signature: decorateJavaScriptExport(extractHeaderText(node, content), exported, languageKey),
        exported,
        node: rangeNode,
      })];
    case "enum_declaration":
      return [createSymbol({
        kind: "enum",
        name: node.childForFieldName("name")?.text || "anonymous",
        signature: decorateJavaScriptExport(extractHeaderText(node, content), exported, languageKey),
        exported,
        node: rangeNode,
      })];
    case "function_declaration":
      return [createSymbol({
        kind: "function",
        name: node.childForFieldName("name")?.text || "anonymous",
        signature: decorateJavaScriptExport(buildCallableSignature("function", node), exported, languageKey),
        exported,
        node: rangeNode,
      })];
    case "lexical_declaration":
    case "variable_declaration":
      return extractJavaScriptVariables(languageKey, node, exported, rangeNode);
    default:
      return [];
  }
}

function extractJavaScriptClass(
  languageKey: SupportedLanguageKey,
  node: Parser.SyntaxNode,
  content: string,
  exported: boolean,
  rangeNode: Parser.SyntaxNode,
): StaticSymbol {
  const name = node.childForFieldName("name")?.text || "anonymous";
  const body = node.childForFieldName("body");
  const children: StaticSymbol[] = [];

  for (const member of body?.namedChildren || []) {
    if (isJavaScriptMethodNode(member.type)) {
      children.push(createSymbol({
        kind: "method",
        name: member.childForFieldName("name")?.text || "anonymous",
        signature: buildCallableSignature("method", member),
        exported: false,
        node: member,
      }));
      continue;
    }

    if (isJavaScriptFieldNode(member.type)) {
      const memberName = member.childForFieldName("name")?.text || "value";
      const typeText = cleanTypeText(member.childForFieldName("type")?.text);
      children.push(createSymbol({
        kind: member.type === "property_signature" ? "property" : "field",
        name: memberName,
        signature: buildDataSignature(member.type === "property_signature" ? "property" : "field", memberName, typeText),
        exported: false,
        node: member,
      }));
    }
  }

  return createSymbol({
    kind: "class",
    name,
    signature: decorateJavaScriptExport(extractHeaderText(node, content), exported, languageKey),
    exported,
    node: rangeNode,
    children,
  });
}

function extractJavaScriptVariables(
  languageKey: SupportedLanguageKey,
  declarationNode: Parser.SyntaxNode,
  exported: boolean,
  rangeNode: Parser.SyntaxNode,
): StaticSymbol[] {
  const declarationKind = declarationNode.text.match(/^(const|let|var)\b/)?.[1] || "const";
  const symbols: StaticSymbol[] = [];

  for (const declarator of declarationNode.namedChildren.filter((child) => child.type === "variable_declarator")) {
    const name = declarator.childForFieldName("name")?.text || "value";
    const valueNode = declarator.childForFieldName("value");

    if (valueNode?.type === "arrow_function" || valueNode?.type === "function") {
      symbols.push(createSymbol({
        kind: "function",
        name,
        signature: decorateJavaScriptExport(buildCallableSignature("function", valueNode, name), exported, languageKey),
        exported,
        node: rangeNode,
      }));
      continue;
    }

    if (valueNode?.type === "class") {
      symbols.push(createSymbol({
        kind: "class",
        name,
        signature: decorateJavaScriptExport(`class ${name}`, exported, languageKey),
        exported,
        node: rangeNode,
      }));
      continue;
    }

    symbols.push(createSymbol({
      kind: "variable",
      name,
      signature: decorateJavaScriptExport(`${declarationKind} ${name}`, exported, languageKey),
      exported,
      node: rangeNode,
    }));
  }

  return symbols;
}

function extractPythonSymbols(root: Parser.SyntaxNode, importsInfo: StaticImport[]): StaticSymbol[] {
  const symbols: StaticSymbol[] = [];

  for (const top of root.namedChildren) {
    if (top.type === "import_statement") {
      addImports(importsInfo, top.text.replace(/^import\s+/, "").split(",").map((part) => part.trim()), top);
      continue;
    }

    if (top.type === "import_from_statement") {
      const moduleName = top.childForFieldName("module_name")?.text;
      addImports(importsInfo, moduleName ? [moduleName] : [], top);
      continue;
    }

    const node = top.type === "decorated_definition" ? top.namedChildren[top.namedChildren.length - 1] : top;
    if (!node) continue;

    if (node.type === "class_definition") {
      symbols.push(extractPythonClass(node));
      continue;
    }

    if (node.type === "function_definition") {
      const name = node.childForFieldName("name")?.text || "anonymous";
      symbols.push(createSymbol({
        kind: "function",
        name,
        signature: buildCallableSignature("function", node),
        exported: !name.startsWith("_"),
        node,
      }));
      continue;
    }

    if (node.type === "expression_statement") {
      const assignment = node.namedChildren.find((child) => child.type === "assignment");
      const names = extractAssignmentNames(assignment);
      for (const name of names) {
        symbols.push(createSymbol({
          kind: "variable",
          name,
          signature: buildDataSignature("variable", name),
          exported: !name.startsWith("_"),
          node,
        }));
      }
    }
  }

  return symbols;
}

function extractPythonClass(node: Parser.SyntaxNode): StaticSymbol {
  const name = node.childForFieldName("name")?.text || "anonymous";
  const body = node.childForFieldName("body");
  const children: StaticSymbol[] = [];

  for (const child of body?.namedChildren || []) {
    if (child.type === "function_definition") {
      const childName = child.childForFieldName("name")?.text || "anonymous";
      children.push(createSymbol({
        kind: "method",
        name: childName,
        signature: buildCallableSignature("method", child),
        exported: false,
        node: child,
      }));
      continue;
    }

    if (child.type === "expression_statement") {
      const assignment = child.namedChildren.find((namedChild) => namedChild.type === "assignment");
      for (const fieldName of extractAssignmentNames(assignment)) {
        children.push(createSymbol({
          kind: "field",
          name: fieldName,
          signature: buildDataSignature("field", fieldName),
          exported: false,
          node: child,
        }));
      }
    }
  }

  return createSymbol({
    kind: "class",
    name,
    signature: `class ${name}${extractPythonSuperclasses(node)}`,
    exported: !name.startsWith("_"),
    node,
    children,
  });
}

function extractGoSymbols(
  root: Parser.SyntaxNode,
  content: string,
  importsInfo: StaticImport[],
): StaticSymbol[] {
  const symbols: StaticSymbol[] = [];
  const implBlocks = new Map<string, StaticSymbol>();

  for (const top of root.namedChildren) {
    if (top.type === "import_declaration") {
      addImports(importsInfo, extractQuotedSources(top.text), top);
      continue;
    }

    if (top.type === "type_declaration") {
      for (const spec of top.namedChildren.filter((child) => child.type === "type_spec")) {
        const name = spec.childForFieldName("name")?.text || "anonymous";
        const typeNode = spec.childForFieldName("type");
        if (!typeNode) continue;

        if (typeNode.type === "struct_type") {
          symbols.push(createSymbol({
            kind: "struct",
            name,
            signature: `type ${name} struct`,
            exported: isGoExported(name),
            node: top,
            children: extractGoStructFields(typeNode),
          }));
        } else if (typeNode.type === "interface_type") {
          symbols.push(createSymbol({
            kind: "interface",
            name,
            signature: `type ${name} interface`,
            exported: isGoExported(name),
            node: top,
            children: extractGoInterfaceMethods(typeNode),
          }));
        } else {
          symbols.push(createSymbol({
            kind: "type",
            name,
            signature: shorten(`type ${name} ${cleanText(typeNode.text)}`),
            exported: isGoExported(name),
            node: top,
          }));
        }
      }
      continue;
    }

    if (top.type === "function_declaration") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      symbols.push(createSymbol({
        kind: "function",
        name,
        signature: buildCallableSignature("function", top),
        exported: isGoExported(name),
        node: top,
      }));
      continue;
    }

    if (top.type === "method_declaration") {
      const receiverName = extractGoReceiverName(top.childForFieldName("receiver")?.text || "");
      const block = getOrCreateImplBlock(implBlocks, receiverName || "receiver", top);
      block.children.push(createSymbol({
        kind: "method",
        name: top.childForFieldName("name")?.text || "anonymous",
        signature: buildCallableSignature("method", top),
        exported: false,
        node: top,
      }));
      continue;
    }

    if (top.type === "var_declaration" || top.type === "const_declaration") {
      const keyword = top.type === "const_declaration" ? "const" : "var";
      for (const spec of top.namedChildren) {
        const name = spec.childForFieldName("name")?.text;
        if (!name) continue;
        symbols.push(createSymbol({
          kind: "variable",
          name,
          signature: buildDataSignature(keyword, name, cleanTypeText(spec.childForFieldName("type")?.text)),
          exported: isGoExported(name),
          node: top,
        }));
      }
    }
  }

  symbols.push(...implBlocks.values());
  return symbols;
}

function extractRustSymbols(
  root: Parser.SyntaxNode,
  content: string,
  importsInfo: StaticImport[],
): StaticSymbol[] {
  const symbols: StaticSymbol[] = [];

  for (const top of root.namedChildren) {
    if (top.type === "use_declaration") {
      addImports(importsInfo, [cleanText(top.text.replace(/^use\s+/, "").replace(/;$/, ""))], top);
      continue;
    }

    if (top.type === "struct_item") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      const body = top.childForFieldName("body");
      const children = (body?.namedChildren || []).filter((child) => child.type === "field_declaration").map((child) =>
        createSymbol({
          kind: "field",
          name: child.childForFieldName("name")?.text || "field",
          signature: buildDataSignature("field", child.childForFieldName("name")?.text || "field", cleanTypeText(child.childForFieldName("type")?.text)),
          exported: false,
          node: child,
        }),
      );

      symbols.push(createSymbol({
        kind: "struct",
        name,
        signature: extractHeaderText(top, content),
        exported: top.text.trimStart().startsWith("pub "),
        node: top,
        children,
      }));
      continue;
    }

    if (top.type === "trait_item") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      const body = top.childForFieldName("body");
      const children = (body?.namedChildren || []).map((child) => {
        if (child.type === "function_signature_item" || child.type === "function_item") {
          return createSymbol({
            kind: "method",
            name: child.childForFieldName("name")?.text || "anonymous",
            signature: buildCallableSignature("method", child),
            exported: false,
            node: child,
          });
        }

        return createSymbol({
          kind: "field",
          name: child.childForFieldName("name")?.text || "item",
          signature: buildDataSignature("field", child.childForFieldName("name")?.text || "item", cleanTypeText(child.childForFieldName("type")?.text)),
          exported: false,
          node: child,
        });
      });

      symbols.push(createSymbol({
        kind: "trait",
        name,
        signature: extractHeaderText(top, content),
        exported: top.text.trimStart().startsWith("pub "),
        node: top,
        children,
      }));
      continue;
    }

    if (top.type === "enum_item") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      symbols.push(createSymbol({
        kind: "enum",
        name,
        signature: extractHeaderText(top, content),
        exported: top.text.trimStart().startsWith("pub "),
        node: top,
      }));
      continue;
    }

    if (top.type === "type_item") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      symbols.push(createSymbol({
        kind: "type",
        name,
        signature: shorten(`type ${name} = ${cleanText(top.childForFieldName("type")?.text || "")}`),
        exported: false,
        node: top,
      }));
      continue;
    }

    if (top.type === "impl_item") {
      const target = top.childForFieldName("type")?.text || "impl";
      const body = top.childForFieldName("body");
      const children = (body?.namedChildren || []).map((child) => {
        if (child.type === "function_item" || child.type === "function_signature_item") {
          return createSymbol({
            kind: "method",
            name: child.childForFieldName("name")?.text || "anonymous",
            signature: buildCallableSignature("method", child),
            exported: false,
            node: child,
          });
        }

        return createSymbol({
          kind: "field",
          name: child.childForFieldName("name")?.text || "item",
          signature: buildDataSignature("field", child.childForFieldName("name")?.text || "item", cleanTypeText(child.childForFieldName("type")?.text)),
          exported: false,
          node: child,
        });
      });

      symbols.push(createSymbol({
        kind: "impl",
        name: target,
        signature: `impl ${target}`,
        exported: false,
        node: top,
        children,
      }));
      continue;
    }

    if (top.type === "function_item") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      symbols.push(createSymbol({
        kind: "function",
        name,
        signature: buildCallableSignature("function", top),
        exported: top.text.trimStart().startsWith("pub "),
        node: top,
      }));
      continue;
    }

    if (top.type === "const_item" || top.type === "static_item") {
      const name = top.childForFieldName("name")?.text || "value";
      const keyword = top.type === "static_item" ? "static" : "const";
      symbols.push(createSymbol({
        kind: "variable",
        name,
        signature: buildDataSignature(keyword, name, cleanTypeText(top.childForFieldName("type")?.text)),
        exported: top.text.trimStart().startsWith("pub "),
        node: top,
      }));
    }
  }

  return symbols;
}

function extractJavaSymbols(
  root: Parser.SyntaxNode,
  content: string,
  importsInfo: StaticImport[],
): StaticSymbol[] {
  const symbols: StaticSymbol[] = [];

  for (const top of root.namedChildren) {
    if (top.type === "import_declaration") {
      addImports(importsInfo, [cleanText(top.text.replace(/^import\s+/, "").replace(/;$/, ""))], top);
      continue;
    }

    if (top.type === "class_declaration") {
      symbols.push(extractJavaClassLike(top, content, "class"));
      continue;
    }

    if (top.type === "interface_declaration") {
      symbols.push(extractJavaClassLike(top, content, "interface"));
      continue;
    }

    if (top.type === "enum_declaration") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      symbols.push(createSymbol({
        kind: "enum",
        name,
        signature: extractHeaderText(top, content),
        exported: top.text.includes("public "),
        node: top,
      }));
    }
  }

  return symbols;
}

function extractCSharpSymbols(
  root: Parser.SyntaxNode,
  content: string,
  importsInfo: StaticImport[],
): StaticSymbol[] {
  const symbols: StaticSymbol[] = [];

  for (const top of root.namedChildren) {
    if (top.type === "using_directive") {
      addImports(importsInfo, [cleanText(top.text.replace(/^using\s+/, "").replace(/;$/, ""))], top);
      continue;
    }

    if (top.type === "class_declaration" || top.type === "struct_declaration") {
      symbols.push(extractCSharpClassLike(top, content, top.type === "struct_declaration" ? "struct" : "class"));
      continue;
    }

    if (top.type === "interface_declaration") {
      symbols.push(extractCSharpClassLike(top, content, "interface"));
      continue;
    }

    if (top.type === "enum_declaration") {
      const name = top.childForFieldName("name")?.text || "anonymous";
      symbols.push(createSymbol({
        kind: "enum",
        name,
        signature: extractHeaderText(top, content),
        exported: top.text.includes("public "),
        node: top,
      }));
    }
  }

  return symbols;
}

function extractJavaClassLike(
  node: Parser.SyntaxNode,
  content: string,
  kind: "class" | "interface",
): StaticSymbol {
  const name = node.childForFieldName("name")?.text || "anonymous";
  const body = node.childForFieldName("body");
  const children: StaticSymbol[] = [];

  for (const child of body?.namedChildren || []) {
    if (child.type === "method_declaration" || child.type === "constructor_declaration") {
      children.push(createSymbol({
        kind: "method",
        name: child.childForFieldName("name")?.text || name,
        signature: buildCallableSignature("method", child, child.childForFieldName("name")?.text || name),
        exported: false,
        node: child,
      }));
      continue;
    }

    if (child.type === "field_declaration") {
      const typeText = cleanTypeText(child.childForFieldName("type")?.text);
      for (const fieldName of extractDeclaratorNames(child)) {
        children.push(createSymbol({
          kind: "field",
          name: fieldName,
          signature: buildDataSignature("field", fieldName, typeText),
          exported: false,
          node: child,
        }));
      }
    }
  }

  return createSymbol({
    kind,
    name,
    signature: extractHeaderText(node, content),
    exported: node.text.includes("public "),
    node,
    children,
  });
}

function extractCSharpClassLike(
  node: Parser.SyntaxNode,
  content: string,
  kind: "class" | "struct" | "interface",
): StaticSymbol {
  const name = node.childForFieldName("name")?.text || "anonymous";
  const body = node.childForFieldName("body");
  const children: StaticSymbol[] = [];

  for (const child of body?.namedChildren || []) {
    if (child.type === "method_declaration" || child.type === "constructor_declaration") {
      children.push(createSymbol({
        kind: "method",
        name: child.childForFieldName("name")?.text || name,
        signature: buildCallableSignature("method", child, child.childForFieldName("name")?.text || name, child.childForFieldName("return_type")?.text || child.childForFieldName("type")?.text),
        exported: false,
        node: child,
      }));
      continue;
    }

    if (child.type === "property_declaration") {
      const propertyName = child.childForFieldName("name")?.text || "Property";
      children.push(createSymbol({
        kind: "property",
        name: propertyName,
        signature: buildDataSignature("property", propertyName, cleanTypeText(child.childForFieldName("type")?.text)),
        exported: false,
        node: child,
      }));
      continue;
    }

    if (child.type === "field_declaration") {
      const variableDeclaration = child.namedChildren.find((namedChild) => namedChild.type === "variable_declaration");
      const typeText = cleanTypeText(variableDeclaration?.firstNamedChild?.text);
      for (const fieldName of extractDeclaratorNames(variableDeclaration || child)) {
        children.push(createSymbol({
          kind: "field",
          name: fieldName,
          signature: buildDataSignature("field", fieldName, typeText),
          exported: false,
          node: child,
        }));
      }
    }
  }

  return createSymbol({
    kind,
    name,
    signature: extractHeaderText(node, content),
    exported: node.text.includes("public "),
    node,
    children,
  });
}

function extractGoStructFields(typeNode: Parser.SyntaxNode): StaticSymbol[] {
  const fields = typeNode.descendantsOfType("field_declaration");
  return fields.map((field) =>
    createSymbol({
      kind: "field",
      name: field.childForFieldName("name")?.text || "field",
      signature: buildDataSignature("field", field.childForFieldName("name")?.text || "field", cleanTypeText(field.childForFieldName("type")?.text)),
      exported: false,
      node: field,
    }),
  );
}

function extractGoInterfaceMethods(typeNode: Parser.SyntaxNode): StaticSymbol[] {
  return typeNode.namedChildren
    .filter((child) => child.type === "method_elem")
    .map((child) =>
      createSymbol({
        kind: "method",
        name: child.childForFieldName("name")?.text || "anonymous",
        signature: buildCallableSignature("method", child),
        exported: false,
        node: child,
      }),
    );
}

function getOrCreateImplBlock(implBlocks: Map<string, StaticSymbol>, name: string, node: Parser.SyntaxNode): StaticSymbol {
  const existing = implBlocks.get(name);
  if (existing) return existing;

  const block = createSymbol({
    kind: "impl",
    name,
    signature: `impl ${name}`,
    exported: false,
    node,
    children: [],
  });
  implBlocks.set(name, block);
  return block;
}

function extractHeaderText(node: Parser.SyntaxNode, content: string): string {
  const bodyNode = BODY_FIELD_NAMES
    .map((field) => node.childForFieldName(field))
    .find((child): child is Parser.SyntaxNode => Boolean(child));

  if (bodyNode) {
    return cleanHeader(content.slice(node.startIndex, bodyNode.startIndex));
  }

  return cleanHeader(content.slice(node.startIndex, node.endIndex));
}

function cleanHeader(text: string): string {
  return shorten(
    text
      .replace(/\r/g, "")
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*:\s*$/, "")
      .replace(/\s*\{$/, "")
      .replace(/\s*;\s*$/, "")
      .trim(),
  );
}

function buildCallableSignature(
  prefix: "function" | "method",
  node: Parser.SyntaxNode,
  fallbackName?: string,
  fallbackReturnType?: string,
): string {
  const name = fallbackName || node.childForFieldName("name")?.text || "anonymous";
  const parameters = cleanParameters(node.childForFieldName("parameters")?.text);
  const returnType = cleanReturnType(
    node.childForFieldName("return_type")?.text
      || node.childForFieldName("result")?.text
      || fallbackReturnType
      || undefined,
  );
  const asyncPrefix = node.text.trimStart().startsWith("async ") ? "async " : "";

  let signature = `${asyncPrefix}${prefix} ${name}${parameters}`;
  if (returnType) signature += `: ${returnType}`;
  return signature;
}

function buildDataSignature(prefix: string, name: string, typeText?: string): string {
  return `${prefix} ${name}${typeText ? `: ${typeText}` : ""}`;
}

function createSymbol(args: {
  kind: StaticSymbolKind;
  name: string;
  signature: string;
  exported: boolean;
  node: Parser.SyntaxNode;
  children?: StaticSymbol[];
}): StaticSymbol {
  return {
    kind: args.kind,
    name: args.name,
    signature: args.signature,
    exported: args.exported,
    startLine: args.node.startPosition.row + 1,
    endLine: args.node.endPosition.row + 1,
    children: args.children || [],
  };
}

function finalizeAnalysis(input: {
  parser: string | null;
  supported: boolean;
  usedFallback: boolean;
  importsInfo: StaticImport[];
  topLevelSymbols: StaticSymbol[];
}): FileStaticAnalysis {
  const imports = uniqueStrings(input.importsInfo.map((entry) => entry.source));
  const exports = uniqueStrings(input.topLevelSymbols.filter((symbol) => symbol.exported).map((symbol) => symbol.name));
  const classes = uniqueStrings(
    input.topLevelSymbols
      .filter((symbol) => ["class", "struct", "interface", "trait", "enum", "type", "impl"].includes(symbol.kind))
      .map((symbol) => symbol.name),
  );
  const functions = uniqueStrings(
    input.topLevelSymbols
      .filter((symbol) => symbol.kind === "function")
      .map((symbol) => symbol.name),
  );
  const variables = uniqueStrings(
    input.topLevelSymbols
      .filter((symbol) => symbol.kind === "variable")
      .map((symbol) => symbol.name),
  );

  return {
    parser: input.parser,
    supported: input.supported,
    usedFallback: input.usedFallback,
    imports,
    importsInfo: input.importsInfo,
    exports,
    topLevelSymbols: input.topLevelSymbols,
    declarations: input.topLevelSymbols,
    classes,
    functions,
    variables,
    skeletonText: renderSkeleton(input.topLevelSymbols),
  };
}

function renderSkeleton(symbols: StaticSymbol[]): string {
  const lines: string[] = [];

  for (const symbol of symbols) {
    renderSymbol(symbol, lines, 0);
  }

  return lines.join("\n");
}

function renderSymbol(symbol: StaticSymbol, lines: string[], depth: number): void {
  const indent = "  ".repeat(depth);
  lines.push(`${indent}${symbol.signature}`);

  for (const child of symbol.children) {
    renderSymbol(child, lines, depth + 1);
  }
}

function analyzeWithFallback(content: string, parserName: string | null = null): FileStaticAnalysis {
  const imports = extractImportsWithRegex(content);
  const exports = extractExportsWithRegex(content);
  const topLevelSymbols = extractFallbackDeclarations(content, exports);

  return finalizeAnalysis({
    parser: parserName,
    supported: false,
    usedFallback: true,
    importsInfo: imports.map((source) => ({ source, startLine: 1, endLine: 1 })),
    topLevelSymbols,
  });
}

function extractImportsWithRegex(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /(?:import\s+(?:(?:\{[^}]*\}|[\w*]+)\s+from\s+)?['"]([^'"]+)['"]|from\s+(\S+)\s+import|require\(['"]([^'"]+)['"]\)|using\s+([\w.]+)|use\s+([^;]+);)/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const source = match[1] || match[2] || match[3] || match[4] || match[5];
    if (source) imports.push(source.trim());
  }

  return uniqueStrings(imports);
}

function extractExportsWithRegex(content: string): string[] {
  const exports: string[] = [];
  const exportRegex = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = exportRegex.exec(content)) !== null) {
    if (match[1]) exports.push(match[1]);
  }

  return uniqueStrings(exports);
}

function extractFallbackDeclarations(content: string, exports: string[]): StaticSymbol[] {
  const lines = content.split("\n");
  const declarations: StaticSymbol[] = [];
  let braceDepth = 0;
  let currentContainer: StaticSymbol | null = null;
  let containerDepth = 0;
  let inBlockComment = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }

    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) {
      braceDepth += opens - closes;
      if (braceDepth < 0) braceDepth = 0;
      continue;
    }

    if (currentContainer && braceDepth > containerDepth) {
      for (const pattern of FALLBACK_METHOD_PATTERNS) {
        const match = trimmed.match(pattern);
        if (!match) continue;

        const name = match[1];
        const parameters = cleanParameters(match[2]);
        const returnType = cleanReturnType(match[3]);
        currentContainer.children.push({
          kind: "method",
          name,
          signature: `method ${name}${parameters}${returnType ? `: ${returnType}` : ""}`,
          exported: false,
          startLine: index + 1,
          endLine: index + 1,
          children: [],
        });
        break;
      }
    } else if (braceDepth <= 1) {
      for (const declaration of FALLBACK_DECLARATION_PATTERNS) {
        const match = trimmed.match(declaration.pattern);
        if (!match) continue;

        const name = match[declaration.nameGroup] || "anonymous";
        const symbol: StaticSymbol = {
          kind: declaration.kind,
          name,
          signature: buildFallbackSignature(trimmed, declaration.kind, name),
          exported: exports.includes(name) || /^export\s/.test(trimmed),
          startLine: index + 1,
          endLine: index + 1,
          children: [],
        };
        declarations.push(symbol);

        if (["class", "struct", "interface", "trait", "impl"].includes(declaration.kind)) {
          currentContainer = symbol;
          containerDepth = braceDepth;
        }
        break;
      }
    }

    braceDepth += opens - closes;
    if (braceDepth < 0) braceDepth = 0;

    if (currentContainer && braceDepth <= containerDepth) {
      currentContainer = null;
    }
  }

  return declarations;
}

function buildFallbackSignature(line: string, kind: StaticSymbolKind, name: string): string {
  if (kind === "function") {
    return line.startsWith("export ") ? `export function ${name}` : `function ${name}`;
  }

  if (kind === "variable") {
    const declarationKind = line.match(/^(?:export\s+)?(const|let|var)\b/)?.[1] || "variable";
    return line.startsWith("export ") ? `export ${declarationKind} ${name}` : `${declarationKind} ${name}`;
  }

  if (kind === "class" || kind === "struct" || kind === "interface" || kind === "trait" || kind === "impl" || kind === "enum" || kind === "type") {
    return shorten(cleanHeader(line));
  }

  return `${kind} ${name}`;
}

function extractPythonSuperclasses(node: Parser.SyntaxNode): string {
  const superclasses = node.childForFieldName("superclasses")?.text;
  return superclasses ? superclasses : "";
}

function decorateJavaScriptExport(signature: string, exported: boolean, languageKey: SupportedLanguageKey): string {
  if (!exported || !["javascript", "typescript", "tsx"].includes(languageKey)) return signature;
  return signature.startsWith("export ") ? signature : `export ${signature}`;
}

function addImports(importsInfo: StaticImport[], sources: string[], node: Parser.SyntaxNode): void {
  for (const source of sources) {
    if (!source) continue;
    importsInfo.push({
      source: source.trim(),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
    });
  }
}

function extractQuotedSources(text: string): string[] {
  const matches = text.matchAll(/['"]([^'"]+)['"]/g);
  return Array.from(matches, (match) => match[1]).filter(Boolean);
}

function extractAssignmentNames(node?: Parser.SyntaxNode): string[] {
  if (!node) return [];
  const leftNode = node.childForFieldName("left");
  if (!leftNode) return [];

  if (leftNode.type === "identifier") return [leftNode.text];

  return uniqueStrings(
    leftNode
      .descendantsOfType(["identifier", "attribute"])
      .map((child) => child.text)
      .filter((name) => !name.includes(".")),
  );
}

function extractDeclaratorNames(node: Parser.SyntaxNode): string[] {
  const declarators = node.descendantsOfType("variable_declarator");
  if (declarators.length === 0) {
    const name = node.childForFieldName("name")?.text;
    return name ? [name] : [];
  }

  return uniqueStrings(
    declarators
      .map((declarator) => declarator.childForFieldName("name")?.text || declarator.firstNamedChild?.text || "")
      .filter(Boolean),
  );
}

function extractGoReceiverName(receiverText: string): string {
  const match = receiverText.match(/\*\s*([A-Za-z_]\w*)|([A-Za-z_]\w*)\s*\)/);
  return match?.[1] || match?.[2] || "";
}

function isGoExported(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function isJavaScriptMethodNode(type: string): boolean {
  return ["method_definition", "method_signature", "abstract_method_signature"].includes(type);
}

function isJavaScriptFieldNode(type: string): boolean {
  return ["public_field_definition", "property_signature"].includes(type);
}

function cleanParameters(value?: string): string {
  const normalized = cleanText(value || "()");
  if (!normalized.startsWith("(")) return `(${normalized})`;
  return normalized;
}

function cleanReturnType(value?: string): string {
  return cleanText((value || "").replace(/^:\s*/, "").replace(/^->\s*/, ""));
}

function cleanTypeText(value?: string): string {
  return cleanText((value || "").replace(/^:\s*/, ""));
}

function cleanText(value: string): string {
  return value.replace(/\r/g, "").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
}

function shorten(value: string, maxLength = 160): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeRanges(
  ranges: Array<{ startLine: number; endLine: number; chunkName: string; chunkType: string }>,
): Array<{ startLine: number; endLine: number; chunkName: string; chunkType: string }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine);
  const merged = [sorted[0]];

  for (const range of sorted.slice(1)) {
    const current = merged[merged.length - 1];
    if (range.startLine <= current.endLine + 1 && range.chunkType === current.chunkType) {
      current.endLine = Math.max(current.endLine, range.endLine);
      continue;
    }
    merged.push({ ...range });
  }

  return merged;
}

function sliceLines(lines: string[], startLine: number, endLine: number): string {
  return lines.slice(Math.max(0, startLine - 1), endLine).join("\n");
}

function mapSymbolKindToChunkType(kind: StaticSymbolKind): string {
  if (kind === "method") return "function";
  if (kind === "field" || kind === "property") return "variable";
  return kind;
}
