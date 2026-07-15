-- Remove three production-only permissive policies that bypass every intended
-- vendor approval boundary. This migration changes policy metadata only: it
-- does not read, rewrite, approve, reject, or delete vendor data.

BEGIN;

SET lock_timeout = '5s';
SET statement_timeout = '30s';

-- Keep the three policy changes atomic and take locks in a fixed order. If any
-- lock cannot be obtained quickly, the migration transaction aborts without a
-- partially hardened state.
LOCK TABLE public.vendors IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.vendor_products IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.vendor_images IN ACCESS EXCLUSIVE MODE;

DROP POLICY IF EXISTS vendors_read ON public.vendors;
DROP POLICY IF EXISTS products_read ON public.vendor_products;
DROP POLICY IF EXISTS images_read ON public.vendor_images;

-- Refuse to enter the migration ledger unless RLS remains enabled, the known
-- drift policies are gone, and the existing approval-scoped policies that keep
-- the current application available still exist.
DO $verify_vendor_public_read_contract$
DECLARE
  v_table REGCLASS;
  v_table_name TEXT;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'public.vendors',
    'public.vendor_products',
    'public.vendor_images'
  ]::TEXT[]
  LOOP
    v_table := pg_catalog.to_regclass(v_table_name);

    IF v_table IS NULL THEN
      RAISE EXCEPTION 'VENDOR_PUBLIC_READ_TABLE_MISSING: table=%', v_table_name
        USING ERRCODE = '55000';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS class_row
      WHERE class_row.oid = v_table
        AND class_row.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'VENDOR_PUBLIC_READ_RLS_DISABLED: table=%', v_table_name
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_row
    WHERE (policy_row.polrelid, policy_row.polname) IN (
      ('public.vendors'::REGCLASS, 'vendors_read'),
      ('public.vendor_products'::REGCLASS, 'products_read'),
      ('public.vendor_images'::REGCLASS, 'images_read')
    )
  ) THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_READ_DRIFT_POLICY_STILL_PRESENT'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.vendors'::REGCLASS
      AND policy_row.polname = 'vendors_select_approved'
      AND policy_row.polcmd = 'r'
  ) THEN
    RAISE EXCEPTION 'VENDOR_APPROVED_READ_POLICY_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.vendor_products'::REGCLASS
      AND policy_row.polname = 'vendor_products_select'
      AND policy_row.polcmd = 'r'
  ) THEN
    RAISE EXCEPTION 'VENDOR_PRODUCT_APPROVED_READ_POLICY_MISSING'
      USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.vendor_images'::REGCLASS
      AND policy_row.polname = '공개: 승인 업체 이미지 조회'
      AND policy_row.polcmd = 'r'
  ) THEN
    RAISE EXCEPTION 'VENDOR_IMAGE_APPROVED_READ_POLICY_MISSING'
      USING ERRCODE = '55000';
  END IF;

  -- Catch another unconditional SELECT policy targeted at PUBLIC/anon or
  -- authenticated even if it is introduced under a different name.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS policy_row
    WHERE policy_row.polrelid IN (
      'public.vendors'::REGCLASS,
      'public.vendor_products'::REGCLASS,
      'public.vendor_images'::REGCLASS
    )
      AND policy_row.polcmd IN ('r', '*')
      AND pg_catalog.pg_get_expr(
        policy_row.polqual,
        policy_row.polrelid,
        true
      ) = 'true'
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(policy_row.polroles) AS policy_role(role_oid)
        WHERE policy_role.role_oid = 0
          OR pg_catalog.pg_get_userbyid(policy_role.role_oid)
            IN ('anon', 'authenticated')
      )
  ) THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_READ_UNCONDITIONAL_POLICY_PRESENT'
      USING ERRCODE = '55000';
  END IF;
END;
$verify_vendor_public_read_contract$;

COMMIT;
