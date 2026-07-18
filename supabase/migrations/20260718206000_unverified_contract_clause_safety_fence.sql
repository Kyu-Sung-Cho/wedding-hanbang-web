-- The legacy contract-clause seed explicitly described itself as an unverified
-- draft but marked every row active. Fail closed until a separately audited
-- migration records legal_review_approved=true for an exact clause version.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

UPDATE public.standard_contract_clauses
SET
  is_active = false,
  metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
    'safety_status', 'legal_review_required',
    'safety_fenced_by', '20260718206000'
  ),
  updated_at = now()
WHERE clause_code IN (
    'CANCEL_PRE_90D',
    'CANCEL_30_90D',
    'CANCEL_WITHIN_30D',
    'REFUND_VENDOR_FAULT',
    'DELIVERY_DATE_CHANGE',
    'SERVICE_CHANGE_SCOPE',
    'DAMAGE_ORIGINAL_LOSS',
    'DAMAGE_QUALITY_DISPUTE',
    'TIP_EXTRA_SHOOTING',
    'TIP_EXTRA_DRESS'
  )
  AND NOT (COALESCE(metadata, '{}'::jsonb) @> '{"legal_review_approved": true}'::jsonb);

COMMIT;
