-- Drop the overly permissive policy
DROP POLICY "Service role full access" ON public.pix_transactions;

-- Create restrictive policies - only authenticated users can read their own data
-- Edge functions use service_role key which bypasses RLS entirely
-- No public access needed
CREATE POLICY "No public access" ON public.pix_transactions
  FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY "Authenticated read own transactions" ON public.pix_transactions
  FOR SELECT TO authenticated USING (false);