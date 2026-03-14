

## Decouple from Lovable Cloud for Vercel Deployment

### Overview

Convert the 4 Supabase Edge Functions into Vercel Serverless Functions, replace the Lovable AI gateway with direct OpenAI/Gemini API calls, and replace Supabase DB access with Vercel Postgres (or any Postgres). The frontend will use `fetch('/api/...')` instead of the Supabase client.

### Architecture Change

```text
BEFORE:
  Frontend → supabase.functions.invoke() → Edge Functions → Lovable AI Gateway
  Frontend → supabase.from("table")      → Supabase DB

AFTER:
  Frontend → fetch("/api/...")            → Vercel Serverless Fns → OpenAI / Gemini
  Frontend → fetch("/api/...")            → Vercel Serverless Fns → Vercel Postgres
```

### Environment Variables (user provides)

- `AI_PROVIDER` — `"openai"` or `"gemini"` (default: `"gemini"`)
- `OPENAI_API_KEY` — if using OpenAI
- `GEMINI_API_KEY` — if using Gemini
- `DATABASE_URL` — Postgres connection string (Vercel Postgres, Neon, Supabase, etc.)
- `GITHUB_TOKEN` — optional, for higher rate limits

### File Changes

#### 1. New: `api/` serverless functions (4 files)

- **`api/analyze-repo.ts`** — Port from `supabase/functions/analyze-repo/index.ts`
  - Replace `Deno.env.get()` → `process.env`
  - Replace `serve()` → Vercel handler `export default async function(req, res)`
  - Replace `ai.gateway.lovable.dev` → direct OpenAI (`https://api.openai.com/v1/chat/completions`) or Gemini (`https://generativelanguage.googleapis.com/v1beta/models/...`) based on `AI_PROVIDER`
  - Replace Supabase DB client → `pg` or `@vercel/postgres` for cache read/write
  - Stream NDJSON response via `res.write()` chunks

- **`api/chat-repo.ts`** — Port from `supabase/functions/chat-repo/index.ts`
  - Same env/AI/DB replacements
  - For embeddings: use OpenAI embeddings API or Gemini embedding API
  - For vector search: use `pgvector` extension on Postgres (same `match_code_chunks_vector` function)

- **`api/summarize-node.ts`** — Port from `supabase/functions/summarize-node/index.ts`
  - Same pattern, simpler (no streaming)

- **`api/embed-chunks.ts`** — Port from `supabase/functions/embed-chunks/index.ts`
  - Same pattern, batch embedding + DB insert

#### 2. New: `lib/ai-client.ts` (shared by API routes)

Abstraction layer that routes to OpenAI or Gemini based on `AI_PROVIDER`:
- `chatCompletion(messages, options)` — unified interface
- `createEmbeddings(inputs)` — unified embedding interface
- Model mapping: `gemini-2.0-flash` ↔ `gpt-4o-mini`

#### 3. New: `lib/db.ts` (shared by API routes)

Postgres client wrapper using `pg` or `@vercel/postgres`:
- Exposes methods matching current Supabase usage: `from("table").select/insert/delete`
- Or simpler: raw SQL helpers

#### 4. New: `vercel.json`

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/:path*" }
  ]
}
```

#### 5. New: Database migration script

SQL file to create tables (`analysis_cache`, `analysis_history`, `code_chunks`) and functions (`match_code_chunks`, `match_code_chunks_vector`) on any Postgres with pgvector.

#### 6. Modified: `src/lib/analysis.ts`

Replace `supabase.functions.invoke("analyze-repo")` → `fetch("/api/analyze-repo")`. Replace `supabase.functions.invoke("summarize-node")` → `fetch("/api/summarize-node")`.

#### 7. Modified: `src/hooks/useRepoAnalysis.ts`

Replace `supabase.functions.invoke("embed-chunks")` → `fetch("/api/embed-chunks")`.

#### 8. Modified: `src/components/RepoChat.tsx`

Replace `VITE_SUPABASE_URL/functions/v1/chat-repo` → `/api/chat-repo`.

#### 9. Modified: `src/components/AnalysisHistory.tsx`

Replace direct Supabase DB queries → `fetch("/api/history?repo=...")` (new lightweight API endpoint, or add to analyze-repo).

#### 10. Modified: `src/pages/SharedView.tsx`

Replace Supabase query → `fetch("/api/shared/${id}")`.

#### 11. Remove/ignore Supabase dependencies

- Remove `@supabase/supabase-js` from frontend bundle (no longer imported)
- Keep `supabase/` folder for reference but it won't be deployed
- Add `pg` and optionally `@vercel/postgres` to dependencies

### AI Provider Abstraction

```text
AI_PROVIDER=gemini → Google Generative AI REST API
  - Chat: POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent
  - Embeddings: POST .../models/text-embedding-004:embedContent

AI_PROVIDER=openai → OpenAI API  
  - Chat: POST https://api.openai.com/v1/chat/completions (gpt-4o-mini)
  - Embeddings: POST https://api.openai.com/v1/embeddings (text-embedding-3-small)
```

### Deployment Steps (for user)

1. Create Vercel Postgres (or connect Neon/Supabase Postgres)
2. Run migration SQL to create tables + pgvector
3. Set env vars in Vercel dashboard: `AI_PROVIDER`, API key, `DATABASE_URL`
4. Deploy via `vercel deploy`

### Summary of New/Modified Files

| Action | File |
|--------|------|
| Create | `api/analyze-repo.ts` |
| Create | `api/chat-repo.ts` |
| Create | `api/summarize-node.ts` |
| Create | `api/embed-chunks.ts` |
| Create | `api/lib/ai-client.ts` |
| Create | `api/lib/db.ts` |
| Create | `vercel.json` |
| Create | `scripts/migrate.sql` |
| Modify | `src/lib/analysis.ts` |
| Modify | `src/hooks/useRepoAnalysis.ts` |
| Modify | `src/components/RepoChat.tsx` |
| Modify | `src/components/AnalysisHistory.tsx` |
| Modify | `src/pages/SharedView.tsx` |

