
-- Vector similarity search function using explicit cast
CREATE OR REPLACE FUNCTION public.match_code_chunks_vector(
  query_embedding extensions.vector,
  match_repo_url text,
  match_threshold float DEFAULT 0.3,
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
  similarity float
)
LANGUAGE plpgsql STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.file_path,
    c.chunk_name,
    c.chunk_type,
    c.content,
    c.start_line,
    c.end_line,
    (1 - (c.embedding <=> query_embedding))::float AS similarity
  FROM public.code_chunks c
  WHERE c.repo_url = match_repo_url
    AND c.embedding IS NOT NULL
    AND (1 - (c.embedding <=> query_embedding))::float > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
