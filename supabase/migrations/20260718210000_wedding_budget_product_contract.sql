-- Unify every wedding-budget write path on the product ceiling of 10억 원.
-- Existing outliers are never rewritten automatically: release operators must
-- review and correct them with explicit customer-data authorization first.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  outlier_count bigint;
BEGIN
  SELECT count(*)
  INTO outlier_count
  FROM public.wedding_journeys
  WHERE total_budget < 0
     OR total_budget > 1000000000;

  IF outlier_count > 0 THEN
    RAISE EXCEPTION 'WEDDING_BUDGET_OUTLIER_REVIEW_REQUIRED: % row(s)', outlier_count
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.wedding_journeys
  DROP CONSTRAINT IF EXISTS wedding_journeys_total_budget_product_range;

ALTER TABLE public.wedding_journeys
  ADD CONSTRAINT wedding_journeys_total_budget_product_range
  CHECK (total_budget BETWEEN 0 AND 1000000000)
  NOT VALID;

ALTER TABLE public.wedding_journeys
  VALIDATE CONSTRAINT wedding_journeys_total_budget_product_range;

COMMENT ON CONSTRAINT wedding_journeys_total_budget_product_range
  ON public.wedding_journeys IS
  'Product-wide wedding budget contract: integer won between 0 and 1,000,000,000.';

COMMIT;
