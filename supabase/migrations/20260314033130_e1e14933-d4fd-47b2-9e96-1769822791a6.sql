
CREATE TABLE public.analysis_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url text NOT NULL,
  repo_name text NOT NULL,
  result jsonb NOT NULL,
  total_files integer,
  node_count integer,
  edge_count integer,
  was_truncated boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

-- Index for fast lookups by repo URL
CREATE INDEX idx_analysis_cache_repo_url ON public.analysis_cache (repo_url);
-- Index for expiry cleanup
CREATE INDEX idx_analysis_cache_expires ON public.analysis_cache (expires_at);

-- Enable RLS
ALTER TABLE public.analysis_cache ENABLE ROW LEVEL SECURITY;

-- Public read access (no auth required for this public tool)
CREATE POLICY "Anyone can read cached analyses"
  ON public.analysis_cache FOR SELECT
  USING (true);

-- Allow edge functions (service role) to insert/update/delete
CREATE POLICY "Service role can insert cache"
  ON public.analysis_cache FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can delete expired cache"
  ON public.analysis_cache FOR DELETE
  USING (true);
