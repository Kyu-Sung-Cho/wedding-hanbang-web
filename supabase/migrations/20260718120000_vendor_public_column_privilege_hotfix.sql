-- Emergency direct-read fence for the public vendors table.
--
-- The approved-row RLS policy is necessary but cannot hide payout, ownership,
-- or future columns on an approved row. Revoke every broad/historical SELECT
-- grant. Public reads must use an explicitly projected public view or a
-- server-owned service-role query; browser/mobile roles never read this base
-- table directly. This migration changes privileges only; it does not read or
-- rewrite rows.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Child-table RLS policies historically queried vendors.owner_id/status as the
-- calling role. Once private vendor columns are revoked, PostgreSQL evaluates
-- those subqueries with insufficient privileges and the whole child query can
-- fail (even when another permissive policy branch would allow the row). Keep
-- the sensitive lookup behind non-enumerating boolean functions owned by the
-- migration role instead of granting owner_id back to clients.
CREATE OR REPLACE FUNCTION public.is_vendor_owner(p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $is_vendor_owner$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.vendors AS vendor
      WHERE vendor.id = p_vendor_id
        AND vendor.owner_id = auth.uid()
    )
$is_vendor_owner$;

CREATE OR REPLACE FUNCTION public.is_vendor_public(p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $is_vendor_public$
  SELECT EXISTS (
    SELECT 1
    FROM public.vendors AS vendor
    WHERE vendor.id = p_vendor_id
      AND vendor.status = 'approved'
  )
$is_vendor_public$;

ALTER FUNCTION public.is_vendor_owner(uuid) OWNER TO postgres;
ALTER FUNCTION public.is_vendor_public(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_vendor_owner(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_vendor_public(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_vendor_owner(uuid)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_vendor_public(uuid)
  TO anon, authenticated;

DO $vendor_child_policy_compatibility$
DECLARE
  policy_rewrite record;
  policy_relation regclass;
  alter_statement text;
  unsafe_policy text;
BEGIN
  FOR policy_rewrite IN
    SELECT *
    FROM (VALUES
      -- vendor_products: the Korean and English policy sets coexist.
      ('vendor_products', '공개: 활성 상품 조회',
        $$is_active = true AND public.is_vendor_public(vendor_id)$$, NULL),
      ('vendor_products', '업체: 본인 상품 조회',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('vendor_products', '업체: 본인 상품 추가',
        NULL, $$public.is_vendor_owner(vendor_id)$$),
      ('vendor_products', '업체: 본인 상품 수정',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),
      ('vendor_products', '업체: 본인 상품 삭제',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('vendor_products', 'vendor_products_select',
        $$public.is_vendor_public(vendor_id) OR public.is_vendor_owner(vendor_id)$$,
        NULL),
      ('vendor_products', 'vendor_products_insert',
        NULL, $$public.is_vendor_owner(vendor_id)$$),
      ('vendor_products', 'vendor_products_update',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),
      ('vendor_products', 'vendor_products_delete',
        $$public.is_vendor_owner(vendor_id)$$, NULL),

      ('vendor_images', '공개: 승인 업체 이미지 조회',
        $$public.is_vendor_public(vendor_id)$$, NULL),
      ('vendor_images', '업체: 본인 이미지 관리',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),

      -- vendor_timeslots: preserve both generations of policies.
      ('vendor_timeslots', '공개: 승인 업체 타임슬롯 조회',
        $$public.is_vendor_public(vendor_id)$$, NULL),
      ('vendor_timeslots', '업체: 본인 타임슬롯 관리',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),
      ('vendor_timeslots', 'vendor_timeslots_select',
        $$public.is_vendor_public(vendor_id) OR public.is_vendor_owner(vendor_id)$$,
        NULL),
      ('vendor_timeslots', 'vendor_timeslots_manage',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),

      -- The English product-timeslot SELECT intentionally had no is_active
      -- predicate. Do not silently change that legacy meaning here.
      ('product_timeslots', '공개: 활성 상품 타임슬롯 조회',
        $$EXISTS (
          SELECT 1
          FROM public.vendor_products AS product
          WHERE product.id = product_timeslots.product_id
            AND product.is_active = true
            AND public.is_vendor_public(product.vendor_id)
        )$$,
        NULL),
      ('product_timeslots', '업체: 본인 상품 타임슬롯 관리',
        $$EXISTS (
          SELECT 1
          FROM public.vendor_products AS product
          WHERE product.id = product_timeslots.product_id
            AND public.is_vendor_owner(product.vendor_id)
        )$$,
        $$EXISTS (
          SELECT 1
          FROM public.vendor_products AS product
          WHERE product.id = product_timeslots.product_id
            AND public.is_vendor_owner(product.vendor_id)
        )$$),
      ('product_timeslots', 'product_timeslots_select',
        $$EXISTS (
          SELECT 1
          FROM public.vendor_products AS product
          WHERE product.id = product_timeslots.product_id
            AND (
              public.is_vendor_public(product.vendor_id)
              OR public.is_vendor_owner(product.vendor_id)
            )
        )$$,
        NULL),
      ('product_timeslots', 'product_timeslots_manage',
        $$EXISTS (
          SELECT 1
          FROM public.vendor_products AS product
          WHERE product.id = product_timeslots.product_id
            AND public.is_vendor_owner(product.vendor_id)
        )$$,
        $$EXISTS (
          SELECT 1
          FROM public.vendor_products AS product
          WHERE product.id = product_timeslots.product_id
            AND public.is_vendor_owner(product.vendor_id)
        )$$),

      ('vendor_reviews', '업체: 본인 리뷰 조회',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('vendor_reviews', '업체: 리뷰 답변',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),

      ('vendor_bookings', 'vendor_bookings_select',
        $$public.is_couple_member(couple_id)
          OR public.is_vendor_owner(vendor_id)$$,
        NULL),
      ('vendor_bookings', 'vendor_bookings_update',
        $$public.is_couple_member(couple_id)
          OR public.is_vendor_owner(vendor_id)$$,
        $$public.is_couple_member(couple_id)
          OR public.is_vendor_owner(vendor_id)$$),

      ('vendor_messages', 'vendor_messages_select',
        $$customer_id = auth.uid() OR public.is_vendor_owner(vendor_id)$$,
        NULL),
      ('vendor_messages', 'vendor_messages_insert',
        NULL,
        $$customer_id = auth.uid() OR public.is_vendor_owner(vendor_id)$$),
      ('vendor_messages', 'vendor_messages_update',
        $$customer_id = auth.uid() OR public.is_vendor_owner(vendor_id)$$,
        $$customer_id = auth.uid() OR public.is_vendor_owner(vendor_id)$$),
      ('vendor_views', 'vendor_views_select',
        $$public.is_vendor_owner(vendor_id)$$, NULL),

      ('customer_events', 'Vendor owners can view their events',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('search_logs', 'Vendor owners can view search logs for their vendor',
        $$public.is_vendor_owner(clicked_vendor_id) OR auth.uid() = user_id$$,
        NULL),
      ('vendor_daily_stats', 'Vendor owners can view own stats',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('vendor_staff', 'Public can view active staff',
        $$is_active = true AND public.is_vendor_public(vendor_id)$$, NULL),
      ('vendor_staff', 'Vendor owners can manage staff',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),
      ('staff_timeslots', 'Public can view staff timeslots',
        $$EXISTS (
          SELECT 1
          FROM public.vendor_staff AS staff
          WHERE staff.id = staff_timeslots.staff_id
            AND staff.is_active = true
            AND public.is_vendor_public(staff.vendor_id)
        )$$,
        NULL),
      ('staff_timeslots', 'Vendor owners can manage staff timeslots',
        $$EXISTS (
          SELECT 1
          FROM public.vendor_staff AS staff
          WHERE staff.id = staff_timeslots.staff_id
            AND public.is_vendor_owner(staff.vendor_id)
        )$$,
        $$EXISTS (
          SELECT 1
          FROM public.vendor_staff AS staff
          WHERE staff.id = staff_timeslots.staff_id
            AND public.is_vendor_owner(staff.vendor_id)
        )$$),

      ('vendor_contract_templates', '업체: 본인 템플릿 조회',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('vendor_contract_templates', '업체: 본인 템플릿 관리',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),
      ('contracts', '업체: 본인 계약 조회',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('contracts', '업체: 본인 계약 관리',
        $$public.is_vendor_owner(vendor_id)$$,
        $$public.is_vendor_owner(vendor_id)$$),
      ('payments', '업체: 본인 결제 조회',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('settlements', '업체: 본인 정산 조회',
        $$public.is_vendor_owner(vendor_id)$$, NULL),
      ('vendor_settlements', 'vendor_settlements_select',
        $$public.is_vendor_owner(vendor_id)$$, NULL)
    ) AS rewrite(
      table_name,
      policy_name,
      using_expression,
      check_expression
    )
  LOOP
    policy_relation := pg_catalog.to_regclass(
      format('public.%I', policy_rewrite.table_name)
    );
    IF policy_relation IS NULL OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS existing
      WHERE existing.polrelid = policy_relation
        AND existing.polname = policy_rewrite.policy_name
    ) THEN
      CONTINUE;
    END IF;

    alter_statement := format(
      'ALTER POLICY %I ON public.%I',
      policy_rewrite.policy_name,
      policy_rewrite.table_name
    );
    IF policy_rewrite.using_expression IS NOT NULL THEN
      alter_statement := alter_statement || format(
        ' USING (%s)',
        policy_rewrite.using_expression
      );
    END IF;
    IF policy_rewrite.check_expression IS NOT NULL THEN
      alter_statement := alter_statement || format(
        ' WITH CHECK (%s)',
        policy_rewrite.check_expression
      );
    END IF;
    EXECUTE alter_statement;
  END LOOP;

  -- An unlisted legacy policy would become a runtime outage after owner/status
  -- column privileges are revoked. Abort atomically instead of deploying a
  -- partial compatibility rewrite.
  SELECT format('%I.%I policy %I', namespace.nspname, relation.relname, policy.polname)
  INTO unsafe_policy
  FROM pg_catalog.pg_policy AS policy
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = policy.polrelid
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relname <> 'vendors'
    AND (
      COALESCE(
        pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
        ''
      ) ~ '(^|[^[:alnum:]_])vendors([^[:alnum:]_]|$)'
      OR COALESCE(
        pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid),
        ''
      ) ~ '(^|[^[:alnum:]_])vendors([^[:alnum:]_]|$)'
    )
  ORDER BY namespace.nspname, relation.relname, policy.polname
  LIMIT 1;

  IF unsafe_policy IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_PRIVATE_COLUMN_POLICY_REFERENCE_REMAINS: %',
      unsafe_policy
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_child_policy_compatibility$;

-- Privilege DDL is atomic in this transaction. Do not take an explicit
-- ACCESS EXCLUSIVE table lock: that would unnecessarily block live reads and
-- writes; the 5-second lock timeout bounds the catalog locks used by GRANT.
REVOKE SELECT ON TABLE public.vendors FROM PUBLIC, anon, authenticated;

DO $vendor_public_column_privilege_hotfix$
DECLARE
  all_columns text;
  exposed_column text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO all_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'vendors';

  IF all_columns IS NULL THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_COLUMNS_TABLE_MISSING'
      USING ERRCODE = '55000';
  END IF;

  -- REVOKE ON TABLE does not remove historical per-column grants.
  EXECUTE format(
    'REVOKE SELECT (%s) ON TABLE public.vendors FROM PUBLIC, anon, authenticated',
    all_columns
  );

  IF has_table_privilege('anon', 'public.vendors', 'SELECT')
    OR has_table_privilege('authenticated', 'public.vendors', 'SELECT')
  THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_TABLE_SELECT_STILL_GRANTED'
      USING ERRCODE = '55000';
  END IF;

  SELECT existing.column_name
  INTO exposed_column
  FROM information_schema.columns AS existing
  WHERE existing.table_schema = 'public'
    AND existing.table_name = 'vendors'
    AND (
      has_column_privilege(
        'anon', 'public.vendors', existing.column_name, 'SELECT'
      )
      OR has_column_privilege(
        'authenticated', 'public.vendors', existing.column_name, 'SELECT'
      )
    )
  ORDER BY existing.ordinal_position
  LIMIT 1;

  IF exposed_column IS NOT NULL THEN
    RAISE EXCEPTION 'VENDOR_PUBLIC_COLUMN_SELECT_STILL_GRANTED: %',
      exposed_column
      USING ERRCODE = '55000';
  END IF;
END;
$vendor_public_column_privilege_hotfix$;

COMMIT;
