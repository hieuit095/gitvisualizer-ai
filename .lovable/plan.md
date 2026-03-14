

## RAG-Powered Code Analysis — Implementation Plan

### Overview
Replace the current "dump all context into prompt" approach with a proper Retrieval-Augmented Generation pipeline. Code gets chunked, embedded, stored in a vector database, and retrieved on-demand for chat and node summaries.

### Architecture

```text
┌─────────────┐    ┌──────────────┐    ┌─────────────────┐
│ analyze-repo │───▶│ embed-chunks │───▶│ code_chunks tbl │
│  (existing)  │    │ (new fn)     │    │ (pgvector)      │
└─────────────┘    └──────────────┘    └────────┬────────┘
                                                │
┌──────────┐   similarity search    ┌───────────▼────────┐
│ chat-repo│◀──────────────────────▶│ match_code_chunks  │
│ (updated)│   top-K chunks         │ (db function)      │
└──────────┘                        └────────────────────┘
```

### Changes

#### 1. Database: `code_chunks` table + pgvector

New migration:
- Enable `vector` extension
- Create `code_chunks` table: `id`, `repo_url`, `file_path`, `chunk_index`, `chunk_type` (function/class/block/import), `chunk_name`, `content`, `start_line`, `end_line`, `embedding vector(768)`, `created_at`
- Create `match_code_chunks` SQL function for similarity search (cosine distance, filtered by `repo_url`, returns top K with file path + line numbers)
- Index on `repo_url` + HNSW index on `embedding`
- RLS: public SELECT, service_role INSERT/DELETE

#### 2. New edge function: `embed-chunks`

Called after `analyze-repo` completes (fire-and-forget from the client). Accepts `repoUrl` + `githubToken`.

Steps:
1. Fetch top 40 file contents (full, not headers)
2. Chunk each file into semantic segments using a function-boundary parser:
   - Track brace depth / indentation to split at function/class boundaries
   - Each chunk: `{ filePath, name, type, content, startLine, endLine }`
   - Max ~80 lines per chunk; merge small consecutive chunks
3. Generate embeddings via Lovable AI gateway (`/v1/embeddings` with `google/gemini-2.5-flash`)
   - Batch chunks (20 per request) to minimize calls
   - If embeddings endpoint unavailable, fall back to using the chat model to produce a fixed-length summary string and use Supabase full-text search instead
4. Upsert chunks + embeddings into `code_chunks` table
5. Delete old chunks for same `repo_url` before inserting new ones

#### 3. Update `chat-repo` edge function

Instead of sending all nodes/edges in the system prompt:
1. Take the user's latest message
2. Call `match_code_chunks` RPC with the message as query (embed the query first)
3. Retrieve top 10-15 most relevant code chunks
4. Build the system prompt with:
   - High-level repo structure (node names + types, compact)
   - Retrieved code chunks with `[file_path:L{start}-L{end}]` citations
5. Instruct AI to cite sources as `[filename:L##]` in responses

#### 4. Update `summarize-node` edge function

When loading Layer 3 detail for a node:
1. Also retrieve chunks for that specific `file_path` from `code_chunks`
2. Include chunk boundaries in the prompt so AI can reference specific line ranges
3. Add `references` field to `NodeDetail` response: array of `{ filePath, startLine, endLine }` the AI cited

#### 5. Frontend: Citation rendering

- Update `RepoChat.tsx` markdown renderer to detect `[path/file.ts:L42-L58]` patterns and render them as clickable badges
- Clicking a citation opens the InfoPanel for that file (or scrolls to it if already open)
- Update `NodeDetail` type with optional `references` array
- Display line references in InfoPanel's detail view

#### 6. Client-side trigger

- In `useRepoAnalysis.ts`, after a successful analysis, fire `supabase.functions.invoke("embed-chunks", { body: { repoUrl } })` without awaiting — background embedding
- Show a subtle "Indexing for search..." indicator that resolves when embedding completes (poll or ignore)

### Technical Details

**Chunking algorithm** (`chunkFile` function):
```text
chunkFile(content, filePath) → Chunk[]
  Split into lines
  Track brace/indent depth
  When a function/class declaration starts at depth 0-1, begin new chunk
  Include preceding comments as part of chunk
  Cap at 80 lines; overflow starts new chunk
  Record startLine/endLine for each
```

**Embedding model**: Use Lovable AI gateway. Try `/v1/embeddings` with `google/gemini-2.5-flash`. If unsupported, use `google/gemini-2.5-flash-lite` chat completion to generate a brief summary per chunk, then use Supabase `tsvector` full-text search as fallback.

**`match_code_chunks` SQL function**:
```sql
CREATE FUNCTION match_code_chunks(
  query_embedding vector(768),
  match_repo_url text,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 15
) RETURNS TABLE(...)
AS $$ SELECT ... ORDER BY embedding <=> query_embedding LIMIT match_count $$
```

### Impact
- Chat answers become grounded in actual code with verifiable citations
- Eliminates hallucinated code references
- Scales to large repos — only relevant chunks sent to AI
- Users can click citations to verify AI claims against real code

