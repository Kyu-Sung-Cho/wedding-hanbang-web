-- Public beta trust boundary: vendorCatalog=false.
--
-- UI and Next route guards do not stop an old browser/mobile bundle from using
-- the Supabase anon key directly. Keep every row and keep service-role/admin
-- operations intact, but remove catalog reads from browser roles until a later
-- reviewed migration explicitly reopens a verified catalog.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Clear every surviving browser-role column ACL before the table-level lockdown.
-- PostgreSQL keeps column grants after a table-level REVOKE, so stale catalog
-- columns must be discovered from the catalog and revoked explicitly.
DO $$
DECLARE
  target_schema text;
  target_name text;
  target_columns text;
  policy_row record;
BEGIN
  FOR target_schema, target_name IN
    SELECT relation.schema_name, relation.relation_name
    FROM (VALUES
      ('public', 'vendors'),
      ('public', 'vendor_products'),
      ('public', 'vendor_images'),
      ('public', 'vendor_timeslots'),
      ('public', 'product_timeslots'),
      ('public', 'vendor_reviews'),
      ('public', 'vendor_staff'),
      ('public', 'staff_timeslots'),
      ('public', 'community_vendor_tags')
    ) AS relation(schema_name, relation_name)
  LOOP
    SELECT pg_catalog.string_agg(
      pg_catalog.quote_ident(attribute_row.attname),
      ', ' ORDER BY attribute_row.attnum
    )
    INTO target_columns
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', target_schema, target_name)
      )
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    IF target_columns IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role',
        target_columns,
        target_schema,
        target_name
      );
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role',
      target_schema,
      target_name
    );
  END LOOP;

  FOR policy_row IN
    SELECT
      policy_row.schemaname,
      policy_row.tablename,
      policy_row.policyname
    FROM pg_catalog.pg_policies AS policy_row
    WHERE policy_row.schemaname = 'public'
      AND policy_row.tablename = ANY (ARRAY[
        'vendors',
        'vendor_products',
        'vendor_images',
        'vendor_timeslots',
        'product_timeslots',
        'vendor_reviews',
        'vendor_staff',
        'staff_timeslots',
        'community_vendor_tags'
      ])
      AND policy_row.roles && ARRAY[
        'public'::name,
        'anon'::name,
        'authenticated'::name
      ]
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  END LOOP;
END;
$$;

-- Catalog rows remain available only to trusted server operations.
REVOKE SELECT ON TABLE public.vendors FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.vendor_products FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.vendor_images FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.vendor_timeslots FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.product_timeslots FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.vendor_reviews FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.vendor_staff FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.staff_timeslots FROM PUBLIC, anon, authenticated;
REVOKE SELECT ON TABLE public.community_vendor_tags FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.vendors TO service_role;
GRANT SELECT ON TABLE public.vendor_products TO service_role;

-- The active account-deletion worker removes only the user's legacy review.
-- No active server route mutates catalog rows.
GRANT DELETE ON TABLE public.vendor_reviews TO service_role;

-- Rebuild direct service ACLs for the two retired interactions and the
-- community projection before granting only their live operations below.
DO $rebuild_vendor_related_service_acl$
DECLARE
  relation_name text;
  all_columns text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'vendor_favorites',
    'vendor_photo_likes',
    'community_posts'
  ]
  LOOP
    SELECT pg_catalog.string_agg(
      pg_catalog.quote_ident(attribute_row.attname),
      ', ' ORDER BY attribute_row.attnum
    )
    INTO all_columns
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = pg_catalog.to_regclass(
        pg_catalog.format('public.%I', relation_name)
      )
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    IF all_columns IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL (%s) ON TABLE public.%I FROM PUBLIC, service_role',
        all_columns,
        relation_name
      );
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, service_role',
      relation_name
    );
  END LOOP;
END;
$rebuild_vendor_related_service_acl$;

-- Legacy clients could still toggle these user-owned catalog interactions
-- directly. Existing rows remain readable under their current private RLS;
-- only new browser-role writes are stopped.
DO $$
DECLARE
  target_schema text;
  target_name text;
  target_columns text;
  policy_row record;
BEGIN
  FOR target_schema, target_name IN
    SELECT relation.schema_name, relation.relation_name
    FROM (VALUES
      ('public', 'vendor_favorites'),
      ('public', 'vendor_photo_likes')
    ) AS relation(schema_name, relation_name)
  LOOP
    SELECT pg_catalog.string_agg(
      pg_catalog.quote_ident(attribute_row.attname),
      ', ' ORDER BY attribute_row.attnum
    )
    INTO target_columns
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = pg_catalog.to_regclass(
        pg_catalog.format('%I.%I', target_schema, target_name)
      )
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    IF target_columns IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE INSERT (%s), UPDATE (%s) ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
        target_columns,
        target_columns,
        target_schema,
        target_name
      );
    END IF;
  END LOOP;

  FOR policy_row IN
    SELECT policy_row.tablename, policy_row.policyname
    FROM pg_catalog.pg_policies AS policy_row
    WHERE policy_row.schemaname = 'public'
      AND policy_row.tablename = ANY (ARRAY[
        'vendor_favorites',
        'vendor_photo_likes'
      ])
      AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND policy_row.roles && ARRAY[
        'public'::name,
        'anon'::name,
        'authenticated'::name
      ]
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.%I',
      policy_row.policyname,
      policy_row.tablename
    );
  END LOOP;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_favorites FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.vendor_photo_likes FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.vendor_favorites TO authenticated;
GRANT SELECT ON TABLE public.vendor_photo_likes TO authenticated;

DROP POLICY IF EXISTS vendor_favorites_select_own ON public.vendor_favorites;
CREATE POLICY vendor_favorites_select_own
  ON public.vendor_favorites
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS vendor_photo_likes_select_own ON public.vendor_photo_likes;
CREATE POLICY vendor_photo_likes_select_own
  ON public.vendor_photo_likes
  FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT ON TABLE public.vendor_favorites TO service_role;
GRANT DELETE ON TABLE public.vendor_photo_likes TO service_role;

-- Historical posts remain visible, but their legacy vendor UUID linkage is
-- not part of the public community contract while the catalog is closed.
REVOKE SELECT ON TABLE public.community_posts FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  author_id,
  category,
  title,
  content,
  visibility,
  ad_disclosure,
  sponsorship_detail,
  is_resolved,
  under_review,
  upvote_count,
  downvote_count,
  comment_count,
  view_count,
  bookmark_count,
  is_pinned,
  is_weekly_best,
  tags,
  created_at,
  updated_at
) ON TABLE public.community_posts TO anon, authenticated;
GRANT SELECT ON TABLE public.community_posts TO service_role;

-- A public bucket bypasses object SELECT policies for known URLs. Make both
-- vendor buckets private and remove every browser-role policy that references
-- either bucket without deleting any object. service_role bypass remains.
UPDATE storage.buckets
SET public = false
WHERE id IN ('vendor-images', 'vendor-licenses');

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policy_row.policyname
    FROM pg_catalog.pg_policies AS policy_row
    WHERE policy_row.schemaname = 'storage'
      AND policy_row.tablename = 'objects'
      AND policy_row.roles && ARRAY[
        'public'::name,
        'anon'::name,
        'authenticated'::name
      ]
      AND (
        COALESCE(policy_row.qual, '') LIKE '%vendor-images%'
        OR COALESCE(policy_row.with_check, '') LIKE '%vendor-images%'
        OR COALESCE(policy_row.qual, '') LIKE '%vendor-licenses%'
        OR COALESCE(policy_row.with_check, '') LIKE '%vendor-licenses%'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects',
      policy_row.policyname
    );
  END LOOP;
END;
$$;

DO $assert_vendor_service_acl$
DECLARE
  expected record;
  privilege_name text;
  actual_privileges text[];
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('vendors', ARRAY['SELECT']::text[]),
      ('vendor_products', ARRAY['SELECT']::text[]),
      ('vendor_images', ARRAY[]::text[]),
      ('vendor_timeslots', ARRAY[]::text[]),
      ('product_timeslots', ARRAY[]::text[]),
      ('vendor_reviews', ARRAY['DELETE']::text[]),
      ('vendor_staff', ARRAY[]::text[]),
      ('staff_timeslots', ARRAY[]::text[]),
      ('community_vendor_tags', ARRAY[]::text[]),
      ('vendor_favorites', ARRAY['SELECT']::text[]),
      ('vendor_photo_likes', ARRAY['DELETE']::text[]),
      ('community_posts', ARRAY['SELECT']::text[])
    ) AS required(table_name, privileges)
  LOOP
    SELECT COALESCE(
      pg_catalog.array_agg(
        privilege_row.privilege_type::text
        ORDER BY privilege_row.privilege_type::text
      ),
      ARRAY[]::text[]
    )
    INTO actual_privileges
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
      AS privilege_row
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE relation.oid = pg_catalog.to_regclass(
        pg_catalog.format('public.%I', expected.table_name)
      )
      AND granted_role.rolname = 'service_role';

    IF actual_privileges IS DISTINCT FROM expected.privileges THEN
      RAISE EXCEPTION 'vendor direct service_role ACL mismatch on %',
        expected.table_name;
    END IF;

    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE',
      'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]
    LOOP
      IF pg_catalog.has_table_privilege(
           'service_role',
           pg_catalog.format('public.%I', expected.table_name),
           privilege_name
         ) IS DISTINCT FROM (privilege_name = ANY(expected.privileges)) THEN
        RAISE EXCEPTION 'vendor service_role ACL mismatch on %.%',
          expected.table_name,
          privilege_name;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS privilege_row
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = privilege_row.grantee
      JOIN pg_catalog.pg_roles AS grantor_role
        ON grantor_role.oid = privilege_row.grantor
      WHERE relation.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND granted_role.rolname = 'service_role'
        AND (
          privilege_row.is_grantable
          OR grantor_role.rolname <> 'postgres'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl)
        AS privilege_row
      WHERE relation.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND privilege_row.grantee = 0
    ) THEN
      RAISE EXCEPTION 'vendor service_role table ACL provenance mismatch on %',
        expected.table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        AS privilege_row
      LEFT JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = privilege_row.grantee
      WHERE attribute_row.attrelid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
        AND (
          granted_role.rolname = 'service_role'
          OR privilege_row.grantee = 0
        )
    ) THEN
      RAISE EXCEPTION 'vendor service_role column ACL remains on %',
        expected.table_name;
    END IF;
  END LOOP;
END;
$assert_vendor_service_acl$;

COMMIT;
