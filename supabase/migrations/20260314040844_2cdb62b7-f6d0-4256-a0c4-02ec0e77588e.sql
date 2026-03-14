
SET search_path = public, extensions;
CREATE INDEX IF NOT EXISTS idx_code_chunks_embedding ON public.code_chunks 
  USING hnsw (embedding vector_cosine_ops) 
  WITH (m = 16, ef_construction = 64);
