-- Lock payment/contract state mutations behind trusted server routes.
-- Customers can still read their own records. Browser clients must not be able
-- to directly create payments or change payment/contract status through RLS.

DROP POLICY IF EXISTS "고객: 본인 계약 업데이트" ON contracts;
DROP POLICY IF EXISTS "고객: 본인 결제 생성" ON payments;
DROP POLICY IF EXISTS "고객: 본인 결제 업데이트" ON payments;

-- Keep service/vendor policies from earlier migrations. Payment creation,
-- payment completion/refund, and customer contract signing now run through
-- API routes with the Supabase service role after user ownership is verified.
