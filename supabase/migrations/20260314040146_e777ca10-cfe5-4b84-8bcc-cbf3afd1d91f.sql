
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
SET search_path = public
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
