-- Add version tracking to analysis_cache
ALTER TABLE public.analysis_cache ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Create analysis_history table to track all versions per repo
CREATE TABLE public.analysis_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_url text NOT NULL,
  repo_name text NOT NULL,
  cache_id uuid REFERENCES public.analysis_cache(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  node_count integer,
  edge_count integer,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX idx_analysis_history_repo ON public.analysis_history(repo_url, created_at DESC);

-- Enable RLS
ALTER TABLE public.analysis_history ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can read analysis history"
  ON public.analysis_history
  FOR SELECT
  TO public
  USING (true);

-- Only service role can insert/delete
CREATE POLICY "Only service role can insert history"
  ON public.analysis_history
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Only service role can delete history"
  ON public.analysis_history
  FOR DELETE
  TO service_role
  USING (true);