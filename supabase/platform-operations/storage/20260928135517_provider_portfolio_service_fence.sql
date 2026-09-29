-- Storage owner operation; run only through an authorized release procedure.
-- Normal migrations must not assume ownership of Supabase-managed objects.
-- This restrictive fence keeps the new private bucket inaccessible even if a
-- separate permissive policy is added later. Service role bypasses RLS.
CREATE POLICY provider_portfolio_service_only ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'provider-portfolio')
  WITH CHECK (bucket_id <> 'provider-portfolio');
