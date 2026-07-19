-- Unify every wedding-budget write path on the product ceiling of 10억 원.
-- Production application remains gated by the release controller's verified
-- backup/restore contract before this forward-only cleanup can run.

BEGIN;

LOCK TABLE public.wedding_journeys IN SHARE ROW EXCLUSIVE MODE;

UPDATE public.wedding_journeys
SET total_budget = 0,
    updated_at = now()
WHERE total_budget < 0
   OR total_budget > 1000000000;

ALTER TABLE public.wedding_journeys
  DROP CONSTRAINT IF EXISTS wedding_journeys_total_budget_product_range;

ALTER TABLE public.wedding_journeys
  ADD CONSTRAINT wedding_journeys_total_budget_product_range
  CHECK (total_budget BETWEEN 0 AND 1000000000);

COMMENT ON CONSTRAINT wedding_journeys_total_budget_product_range
  ON public.wedding_journeys IS
  'Product-wide wedding budget contract: integer won between 0 and 1,000,000,000.';

COMMIT;
