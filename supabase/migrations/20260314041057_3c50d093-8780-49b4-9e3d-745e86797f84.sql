
ALTER TABLE public.code_chunks DROP COLUMN IF EXISTS search_vector;
ALTER TABLE public.code_chunks ADD COLUMN search_vector tsvector 
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(chunk_name, '') || ' ' || coalesce(summary, '') || ' ' || content)) STORED;
CREATE INDEX idx_code_chunks_search ON public.code_chunks USING gin (search_vector);
