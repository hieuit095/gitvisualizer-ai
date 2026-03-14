-- GitVisualizer AI — Database Migration
-- Run this on any PostgreSQL instance with pgvector extension

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Analysis Cache ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  result JSONB NOT NULL,
  total_files INTEGER,
  node_count INTEGER,
  edge_count INTEGER,
  was_truncated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_analysis_cache_repo_url ON analysis_cache(repo_url);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires ON analysis_cache(expires_at);

-- ─── Analysis History ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analysis_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  cache_id UUID REFERENCES analysis_cache(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  node_count INTEGER,
  edge_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analysis_history_repo_url ON analysis_history(repo_url);

-- ─── Code Chunks (for RAG) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS code_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url TEXT NOT NULL,
  file_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_type TEXT NOT NULL DEFAULT 'block',
  chunk_name TEXT,
  content TEXT NOT NULL,
  start_line INTEGER NOT NULL DEFAULT 1,
  end_line INTEGER NOT NULL DEFAULT 1,
  summary TEXT,
  embedding vector(768),
  search_vector tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_code_chunks_repo ON code_chunks(repo_url);
CREATE INDEX IF NOT EXISTS idx_code_chunks_file ON code_chunks(repo_url, file_path);
CREATE INDEX IF NOT EXISTS idx_code_chunks_search ON code_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding ON code_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Auto-generate tsvector on insert/update
CREATE OR REPLACE FUNCTION update_code_chunks_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.chunk_name, '') || ' ' ||
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(NEW.content, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_code_chunks_search ON code_chunks;
CREATE TRIGGER trg_code_chunks_search
  BEFORE INSERT OR UPDATE ON code_chunks
  FOR EACH ROW EXECUTE FUNCTION update_code_chunks_search_vector();

-- ─── Vector search function ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_code_chunks_vector(
  query_embedding vector(768),
  match_repo_url TEXT,
  match_threshold DOUBLE PRECISION DEFAULT 0.3,
  match_count INTEGER DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  file_path TEXT,
  chunk_name TEXT,
  chunk_type TEXT,
  content TEXT,
  start_line INTEGER,
  end_line INTEGER,
  similarity DOUBLE PRECISION
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.file_path, c.chunk_name, c.chunk_type, c.content,
    c.start_line, c.end_line,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM code_chunks c
  WHERE c.repo_url = match_repo_url
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> query_embedding))::float > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─── Text search function ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_code_chunks(
  query_text TEXT,
  match_repo_url TEXT,
  match_count INTEGER DEFAULT 15
)
RETURNS TABLE (
  id UUID,
  file_path TEXT,
  chunk_name TEXT,
  chunk_type TEXT,
  content TEXT,
  start_line INTEGER,
  end_line INTEGER,
  rank REAL
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  strict_query tsquery;
  loose_query tsquery;
BEGIN
  strict_query := plainto_tsquery('english', query_text);

  IF EXISTS (
    SELECT 1 FROM code_chunks c
    WHERE c.repo_url = match_repo_url AND c.search_vector @@ strict_query
    LIMIT 1
  ) THEN
    RETURN QUERY
    SELECT c.id, c.file_path, c.chunk_name, c.chunk_type, c.content, c.start_line, c.end_line,
           ts_rank(c.search_vector, strict_query) AS rank
    FROM code_chunks c
    WHERE c.repo_url = match_repo_url AND c.search_vector @@ strict_query
    ORDER BY rank DESC
    LIMIT match_count;
    RETURN;
  END IF;

  loose_query := replace(strict_query::text, '&', '|')::tsquery;

  RETURN QUERY
  SELECT c.id, c.file_path, c.chunk_name, c.chunk_type, c.content, c.start_line, c.end_line,
         ts_rank(c.search_vector, loose_query) AS rank
  FROM code_chunks c
  WHERE c.repo_url = match_repo_url AND c.search_vector @@ loose_query
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;
