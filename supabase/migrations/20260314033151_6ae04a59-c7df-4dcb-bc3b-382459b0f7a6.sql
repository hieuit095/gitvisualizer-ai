
-- Drop the overly permissive policies and replace with service-role-only
DROP POLICY "Service role can insert cache" ON public.analysis_cache;
DROP POLICY "Service role can delete expired cache" ON public.analysis_cache;

-- Only service role (edge functions) can insert — anon/authenticated cannot
CREATE POLICY "Only service role can insert cache"
  ON public.analysis_cache FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Only service role can delete cache"
  ON public.analysis_cache FOR DELETE
  TO service_role
  USING (true);
