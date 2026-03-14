CREATE OR REPLACE FUNCTION public.match_code_chunks(
  query_text text,
  match_repo_url text,
  match_count integer DEFAULT 15
)
RETURNS TABLE(
  id uuid,
  file_path text,
  chunk_name text,
  chunk_type text,
  content text,
  start_line integer,
  end_line integer,
  rank real
)
LANGUAGE plpgsql
STABLE
SET search_path = 'public'
AS $function$
DECLARE
  ts_query tsquery;
BEGIN
  -- Try websearch first (handles quoted phrases, etc)
  BEGIN
    ts_query := websearch_to_tsquery('english', query_text);
  EXCEPTION WHEN OTHERS THEN
    ts_query := plainto_tsquery('english', query_text);
  END;
  
  -- If strict AND query returns nothing, fall back to OR query
  IF NOT EXISTS (
    SELECT 1 FROM public.code_chunks c 
    WHERE c.repo_url = match_repo_url AND c.search_vector @@ ts_query
    LIMIT 1
  ) THEN
    -- Build OR query from individual words
    SELECT string_agg(lexeme::text, ' | ')::tsquery
    INTO ts_query
    FROM unnest(ts_query) AS lexeme;
    
    -- If that fails too, use plain OR
    IF ts_query IS NULL THEN
      ts_query := plainto_tsquery('english', query_text);
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.file_path,
    c.chunk_name,
    c.chunk_type,
    c.content,
    c.start_line,
    c.end_line,
    ts_rank(c.search_vector, ts_query) AS rank
  FROM public.code_chunks c
  WHERE c.repo_url = match_repo_url
    AND c.search_vector @@ ts_query
  ORDER BY rank DESC
  LIMIT match_count;
END;
$function$;