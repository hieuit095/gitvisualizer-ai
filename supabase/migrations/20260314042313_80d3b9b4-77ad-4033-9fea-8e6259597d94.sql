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
  strict_query tsquery;
  loose_query tsquery;
BEGIN
  strict_query := plainto_tsquery('english', query_text);
  
  -- Check if strict AND query has results
  IF EXISTS (
    SELECT 1 FROM public.code_chunks c 
    WHERE c.repo_url = match_repo_url AND c.search_vector @@ strict_query
    LIMIT 1
  ) THEN
    RETURN QUERY
    SELECT c.id, c.file_path, c.chunk_name, c.chunk_type, c.content, c.start_line, c.end_line,
           ts_rank(c.search_vector, strict_query) AS rank
    FROM public.code_chunks c
    WHERE c.repo_url = match_repo_url AND c.search_vector @@ strict_query
    ORDER BY rank DESC
    LIMIT match_count;
    RETURN;
  END IF;

  -- Fall back to OR query by replacing & with |
  loose_query := replace(strict_query::text, '&', '|')::tsquery;
  
  RETURN QUERY
  SELECT c.id, c.file_path, c.chunk_name, c.chunk_type, c.content, c.start_line, c.end_line,
         ts_rank(c.search_vector, loose_query) AS rank
  FROM public.code_chunks c
  WHERE c.repo_url = match_repo_url AND c.search_vector @@ loose_query
  ORDER BY rank DESC
  LIMIT match_count;
END;
$function$;