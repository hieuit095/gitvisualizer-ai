

## Layered Context Strategy — Implementation Plan

### Current State

The pipeline already has some layering, but it's incomplete:
- **Layer 1 (structural)**: Exists — regex-based `extractShallowInfo` extracts imports/exports/signatures without AI.
- **Layer 2 (module summarization)**: Partially exists — the AI prompt currently receives full file contents (up to 1500 chars each for top 15 files, plus 3000 chars for top 25 files). It generates summaries but reads too much code.
- **Layer 3 (deep dive)**: Exists — `summarize-node` edge function loads full file content on click. Already lazy.

The main optimization target is **reducing what gets sent to AI in Pass 2** by only sending file headers/signatures instead of full content blocks.

### Changes

#### 1. Edge Function: `analyze-repo/index.ts` — Reduce AI input to headers only

**Replace the content fetching strategy (lines 390-414):**
- Instead of fetching full file content (3000 chars) for top 25 files, fetch only the **first 60 lines** (the "header") of each file
- Increase coverage from 25 files to 40 files since headers are much smaller
- A new `extractFileHeader()` function will trim content to the first ~60 lines, capturing imports, class/function declarations, and type definitions without implementation bodies

**Replace the AI prompt content section (lines 440-443):**
- Instead of `content.slice(0, 1500)`, send only the extracted header (imports + signatures block)
- Label the section "File Headers (declarations only)" to guide the AI

**Update the AI prompt instructions (lines 457-479):**
- Explicitly tell the AI: "You are given only file headers (imports, exports, type/class/function declarations). Do not attempt to describe implementation details — only architectural role and relationships."
- Reduce expected summary length guidance to "1-sentence architectural role"

#### 2. New helper function: `extractFileHeader()`

```text
extractFileHeader(content: string, maxLines = 60): string
  - Split content into lines
  - Keep first N lines that contain: import/export statements,
    function/class/interface/type declarations, decorators, comments
  - Skip function bodies (track brace depth, skip when depth > 1)
  - Return trimmed header string
```

This ensures AI sees declarations but not implementation logic, cutting token usage by ~60-70%.

#### 3. Shallow map enhancement

Enrich the `ShallowFileInfo` sent to AI with:
- File line count (from fetched content) — helps AI gauge file complexity
- Export count — helps identify key modules
- Already have: imports, exports, signatures, type classification

#### 4. No frontend changes needed

- Layer 3 (deep dive via `summarize-node`) already works correctly — it fetches full file content only when a user clicks a node
- The `RepoNode` type already has `detailLoaded?: boolean` to track lazy loading state
- No UI changes required

### Technical Details

**File: `supabase/functions/analyze-repo/index.ts`**

New function `extractFileHeader`:
```typescript
function extractFileHeader(content: string, maxLines = 60): string {
  const lines = content.split("\n");
  const header: string[] = [];
  let braceDepth = 0;
  for (const line of lines) {
    if (header.length >= maxLines) break;
    const trimmed = line.trim();
    // Track brace depth to skip function bodies
    const opens = (line.match(/{/g) || []).length;
    const closes = (line.match(/}/g) || []).length;
    if (braceDepth <= 1 || /^(import|export|interface|type|class|enum|const|let|var|function|async|abstract|public|private|protected|def |fn |func )/.test(trimmed) || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed === "") {
      header.push(line);
    }
    braceDepth += opens - closes;
    if (braceDepth < 0) braceDepth = 0;
  }
  return header.join("\n");
}
```

Modify content fetching (line 390-414):
- Change `contentTargets` from `limitedFiles.slice(0, 25)` → `limitedFiles.slice(0, 40)`
- Change `decoded.slice(0, 3000)` → `extractFileHeader(decoded, 60)`

Modify AI prompt content section (line 440-443):
- Change label to `## File Headers (declarations & imports only)`
- Change `content.slice(0, 1500)` → just use the already-header-only content directly

Update prompt instructions to emphasize architectural-role-only summaries.

### Impact
- ~60-70% reduction in AI input tokens per analysis
- More files covered (40 vs 25) with less total token cost
- Faster AI response times
- No change to user experience — deep details still load on click via Layer 3

