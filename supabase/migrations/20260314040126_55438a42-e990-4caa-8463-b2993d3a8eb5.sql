
-- Enable vector extension
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Create code_chunks table
CREATE TABLE public.code_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url text NOT NULL,
  file_path text NOT NULL,
  chunk_index integer NOT NULL DEFAULT 0,
  chunk_type text NOT NULL DEFAULT 'block',
  chunk_name text,
  content text NOT NULL,
  start_line integer NOT NULL DEFAULT 1,
  end_line integer NOT NULL DEFAULT 1,
  embedding vector(768),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(chunk_name, '') || ' ' || content)) STORED,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_code_chunks_repo_url ON public.code_chunks (repo_url);
CREATE INDEX idx_code_chunks_file_path ON public.code_chunks (repo_url, file_path);
CREATE INDEX idx_code_chunks_search ON public.code_chunks USING gin (search_vector);

-- Enable RLS
ALTER TABLE public.code_chunks ENABLE ROW LEVEL SECURITY;

-- Public SELECT
CREATE POLICY "Anyone can read code chunks"
  ON public.code_chunks FOR SELECT
  TO public
  USING (true);

-- Service role INSERT
CREATE POLICY "Only service role can insert chunks"
  ON public.code_chunks FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Service role DELETE
CREATE POLICY "Only service role can delete chunks"
  ON public.code_chunks FOR DELETE
  TO service_role
  USING (true);

-- Full-text search function
CREATE OR REPLACE FUNCTION public.match_code_chunks(
  query_text text,
  match_repo_url text,
  match_count integer DEFAULT 15
)
RETURNS TABLE (
  id uuid,
  file_path text,
  chunk_name text,
  chunk_type text,
  content text,
  start_line integer,
  end_line integer,
  rank real
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.file_path,
    c.chunk_name,
    c.chunk_type,
    c.content,
    c.start_line,
    c.end_line,
    ts_rank(c.search_vector, websearch_to_tsquery('english', query_text)) AS rank
  FROM public.code_chunks c
  WHERE c.repo_url = match_repo_url
    AND c.search_vector @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT match_count;
$$;
