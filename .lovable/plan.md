

## Enhanced Static Analysis & Anti-Hallucination Prompt Engineering

### 1. Code Skeleton Extractor (Tree-sitter-like Static Analysis)

Tree-sitter itself can't run in Deno edge functions, but we can build a robust **AST-like skeleton extractor** that goes far beyond the current `extractFileHeader` approach. Instead of just keeping the first 60 lines, this will parse the entire file and produce a structured skeleton.

**New function: `extractCodeSkeleton(content, filePath)`**

Returns a structured object with:
- `declarations`: Array of `{ kind, name, params, returnType, startLine, endLine, exported, decorators }`
- `classes`: Array of `{ name, extends, implements, methods[], properties[] }`
- `interfaces/types`: Array of `{ name, fields[] }`
- `imports/exports`: Already exist but will be enriched

The skeleton extractor will:
- Track brace depth to identify function/class boundaries and their nesting
- Extract method signatures with parameter lists (not bodies)
- Detect class hierarchies (`extends`, `implements`)
- Capture type definitions and interfaces fully (they're already declarative)
- Handle Python (`def`, `class`), Go (`func`, `type struct`), Rust (`fn`, `impl`, `struct`) patterns
- Output a compact text skeleton like:

```text
class Router extends EventEmitter {
  constructor(options)
  route(path): Route
  use(...fns): Router
  handle(req, res, done): void
}
function createApplication(): Application
```

**File: `supabase/functions/analyze-repo/index.ts`**
- Replace `extractFileHeader` with `extractCodeSkeleton` 
- Send skeleton text to AI instead of raw header lines
- Include structured declaration counts in `ShallowFileInfo`

### 2. Anti-Hallucination Prompt Engineering

Three techniques applied to both `analyze-repo` and `chat-repo`:

#### a) Negative Constraints
Add to AI prompts:
- "If a dependency is not visible in the imports, mark it as 'External Dependency — not found in source'"
- "Do NOT invent function names or file paths that are not listed in the shallow analysis"
- "If you cannot determine a module's purpose from its skeleton, say 'Purpose unclear from declarations alone'"

#### b) Chain of Verification
Add to `analyze-repo` prompt:
- "Before generating nodes, list which files you identified as architecturally significant and why (based on export count, import count, or entry-point status)"
- AI must justify node selection before producing the diagram

Add to `chat-repo` prompt:
- "Before answering, state which retrieved chunks you are basing your answer on using `[filename:L##]` references"

#### c) Output Format Rigidness with Retry
- The `analyze-repo` function already uses tool calling with strict schema (`additionalProperties: false`), which enforces format
- Add **validation + retry logic**: after parsing the tool call response, validate that:
  - Every node's `path` exists in the file list
  - Every edge's `source` and `target` reference valid node IDs
  - No duplicate node IDs
- If validation fails, retry the AI call once with the validation errors included in the prompt

**Files changed:**
- `supabase/functions/analyze-repo/index.ts` — skeleton extractor, prompt updates, validation + retry
- `supabase/functions/chat-repo/index.ts` — prompt updates with negative constraints and chain-of-verification instructions

### Technical Details

**Skeleton extractor core logic:**
```text
extractCodeSkeleton(content, filePath):
  lines = content.split("\n")
  declarations = []
  currentClass = null
  braceDepth = 0
  
  for each line:
    if matches function/method declaration:
      extract name, params, returnType
      record startLine, mark as exported if "export" prefix
      if inside class (braceDepth context), add to class.methods
      else add to top-level declarations
    if matches class/interface/type/enum:
      create class entry with extends/implements
      push to stack
    track braceDepth to know when class/function ends
    
  return formatted skeleton string
```

**Validation logic (post-AI):**
```text
validateResult(parsed, fileList):
  errors = []
  knownPaths = Set(fileList.map(f => f.path))
  nodeIds = Set()
  
  for node in parsed.nodes:
    if node.path not in knownPaths → error
    if node.id in nodeIds → error (duplicate)
    nodeIds.add(node.id)
  
  for edge in parsed.edges:
    if edge.source not in nodeIds → error
    if edge.target not in nodeIds → error
  
  return errors (empty = valid)
```

**Retry on validation failure:**
- If errors found, call AI again with: "Your previous output had these errors: [list]. Fix them. Only reference files from the provided list."
- Max 1 retry to avoid infinite loops

