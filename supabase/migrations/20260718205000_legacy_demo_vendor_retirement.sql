-- Historical demo seeds are immutable migration history. Do not rewrite rows
-- based on a fixed UUID alone: an operator may have claimed or curated one of
-- those rows after the seed ran. This forward-only fence takes a write-blocking
-- table lock briefly and aborts deployment if any legacy namespace row is
-- publicly approved. It intentionally performs no data mutation.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.vendors IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMPORARY TABLE legacy_demo_vendor_retirement_ids (
  id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO legacy_demo_vendor_retirement_ids (id)
VALUES
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333'),
  ('44440001-0000-0000-0000-000000000000'),
  ('44440002-0000-0000-0000-000000000000'),
  ('44440003-0000-0000-0000-000000000000'),
  ('44440004-0000-0000-0000-000000000000'),
  ('44440005-0000-0000-0000-000000000000'),
  ('55550001-0000-0000-0000-000000000000'),
  ('55550002-0000-0000-0000-000000000000'),
  ('55550003-0000-0000-0000-000000000000'),
  ('55550004-0000-0000-0000-000000000000'),
  ('55550005-0000-0000-0000-000000000000'),
  ('66660001-0000-0000-0000-000000000000'),
  ('66660002-0000-0000-0000-000000000000'),
  ('66660003-0000-0000-0000-000000000000'),
  ('66660004-0000-0000-0000-000000000000'),
  ('77770001-0000-0000-0000-000000000000'),
  ('77770002-0000-0000-0000-000000000000'),
  ('88880001-0000-0000-0000-000000000000'),
  ('88880002-0000-0000-0000-000000000000'),
  ('99990001-0000-0000-0000-000000000000'),
  ('99990002-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

DO $legacy_demo_vendor_publication_fence$
DECLARE
  exposed_vendor_id uuid;
BEGIN
  SELECT vendor.id
  INTO exposed_vendor_id
  FROM public.vendors AS vendor
  JOIN legacy_demo_vendor_retirement_ids AS legacy
    ON legacy.id = vendor.id
  WHERE vendor.status = 'approved'
  ORDER BY vendor.id
  LIMIT 1;

  IF exposed_vendor_id IS NOT NULL THEN
    RAISE EXCEPTION
      'LEGACY_DEMO_VENDOR_PUBLICATION_BLOCKED: vendor % requires provenance review before deployment',
      exposed_vendor_id
      USING ERRCODE = 'P0001';
  END IF;
END
$legacy_demo_vendor_publication_fence$;

COMMIT;
