BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Disabled cohort browser lockdown.
-- The public-beta capability is off. Preserve every row for export/deletion,
-- while making browser roles unable to discover, read, or mutate cohort data.
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
      ('public', 'cohort_rooms'),
      ('public', 'cohort_members'),
      ('public', 'cohort_messages'),
      ('public', 'cohort_contracts'),
      ('public', 'cohort_timeline_events'),
      ('public', 'cohort_member_reports'),
      ('public', 'cohort_stats'),
      ('public', 'cohort_room_contributor_stats')
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
        'cohort_rooms',
        'cohort_members',
        'cohort_messages',
        'cohort_contracts',
        'cohort_timeline_events',
        'cohort_member_reports'
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

GRANT SELECT, UPDATE ON TABLE
  public.cohort_rooms,
  public.cohort_members,
  public.cohort_member_reports
TO service_role;

REVOKE ALL ON FUNCTION public.is_cohort_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_cohort_member(uuid) TO service_role;

UPDATE storage.buckets
SET public = false
WHERE id = 'cohort-images';

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
        COALESCE(policy_row.qual, '') LIKE '%cohort-images%'
        OR COALESCE(policy_row.with_check, '') LIKE '%cohort-images%'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects',
      policy_row.policyname
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables AS publication_table
    WHERE publication_table.pubname = 'supabase_realtime'
      AND publication_table.schemaname = 'public'
      AND publication_table.tablename = 'cohort_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.cohort_messages;
  END IF;
END;
$$;
-- End disabled cohort browser lockdown.

-- Shared journey writes are server-owned.
-- Supported clients read the shared row directly but mutate it through
-- ownership-checked server routes and atomic RPCs. Remove legacy browser writes
-- so a stale client cannot replace progress arrays or clobber partner changes.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wedding_journeys FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target_columns text;
  policy_row record;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.quote_ident(attribute_row.attname),
    ', ' ORDER BY attribute_row.attnum
  )
  INTO target_columns
  FROM pg_catalog.pg_attribute AS attribute_row
  WHERE attribute_row.attrelid = pg_catalog.to_regclass('public.wedding_journeys')
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped;

  IF target_columns IS NOT NULL THEN
    EXECUTE pg_catalog.format(
      'REVOKE ALL (%s) ON TABLE public.wedding_journeys FROM PUBLIC, anon, authenticated, service_role',
      target_columns
    );
  END IF;

  FOR policy_row IN
    SELECT policy_row.policyname
    FROM pg_catalog.pg_policies AS policy_row
    WHERE policy_row.schemaname = 'public'
      AND policy_row.tablename = 'wedding_journeys'
      AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND policy_row.roles && ARRAY[
        'public'::name,
        'anon'::name,
        'authenticated'::name
      ]
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.wedding_journeys',
      policy_row.policyname
    );
  END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.wedding_journeys TO authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.wedding_journeys FROM PUBLIC, service_role;
GRANT SELECT, UPDATE ON TABLE public.wedding_journeys TO service_role;
-- End shared journey write lockdown.

-- Legacy chat writes are closed.
-- Current web/mobile clients use /api/chat/messages. Keep authenticated reads
-- and Realtime delivery, but remove the unmetered direct INSERT compatibility
-- path and the dormant persistent attachment mutation surface.
REVOKE INSERT ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target_columns text;
  policy_row record;
BEGIN
  SELECT pg_catalog.string_agg(
    pg_catalog.quote_ident(attribute_row.attname),
    ', ' ORDER BY attribute_row.attnum
  )
  INTO target_columns
  FROM pg_catalog.pg_attribute AS attribute_row
  WHERE attribute_row.attrelid = pg_catalog.to_regclass('public.chat_messages')
    AND attribute_row.attnum > 0
    AND NOT attribute_row.attisdropped;

  IF target_columns IS NOT NULL THEN
    EXECUTE pg_catalog.format(
      'REVOKE INSERT (%s) ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated',
      target_columns
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL (%s) ON TABLE public.chat_messages FROM PUBLIC, service_role',
      target_columns
    );
  END IF;

  FOR policy_row IN
    SELECT policy_row.policyname
    FROM pg_catalog.pg_policies AS policy_row
    WHERE policy_row.schemaname = 'public'
      AND policy_row.tablename = 'chat_messages'
      AND policy_row.cmd IN ('INSERT', 'ALL')
      AND policy_row.roles && ARRAY[
        'public'::name,
        'anon'::name,
        'authenticated'::name
      ]
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.chat_messages',
      policy_row.policyname
    );
  END LOOP;
END;
$$;

REVOKE ALL PRIVILEGES ON TABLE public.chat_messages FROM PUBLIC, service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.chat_messages TO service_role;

UPDATE storage.buckets
SET public = false
WHERE id = 'chat-image';

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
        COALESCE(policy_row.qual, '') LIKE '%chat-image%'
        OR COALESCE(policy_row.with_check, '') LIKE '%chat-image%'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects',
      policy_row.policyname
    );
  END LOOP;
END;
$$;
-- End legacy chat write lockdown.

-- Community writes are server-owned.
-- Public and authenticated feeds remain readable through their existing RLS and
-- reviewed column grants. Mutations must pass the validated, rate-limited API.
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
      ('public', 'community_posts'),
      ('public', 'community_comments'),
      ('public', 'community_profiles'),
      ('public', 'community_votes'),
      ('public', 'community_bookmarks'),
      ('public', 'community_reports'),
      ('public', 'community_polls'),
      ('public', 'community_poll_options'),
      ('public', 'community_poll_votes'),
      ('public', 'community_xp_log'),
      ('public', 'community_streaks'),
      ('public', 'community_achievements')
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
      EXECUTE pg_catalog.format(
        'REVOKE ALL (%s) ON TABLE %I.%I FROM PUBLIC, service_role',
        target_columns,
        target_schema,
        target_name
      );
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
      target_schema,
      target_name
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, service_role',
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
        'community_posts',
        'community_comments',
        'community_profiles',
        'community_votes',
        'community_bookmarks',
        'community_reports',
        'community_polls',
        'community_poll_options',
        'community_poll_votes',
        'community_xp_log',
        'community_streaks',
        'community_achievements'
      ])
      AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
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

-- The legacy bookmark FOR ALL policy carried both read and write authority.
-- Restore only the private read half after removing the mutation policy.
DROP POLICY IF EXISTS community_bookmarks_select_own ON public.community_bookmarks;
CREATE POLICY community_bookmarks_select_own
  ON public.community_bookmarks
  FOR SELECT TO authenticated USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.community_posts TO service_role;
GRANT SELECT ON TABLE public.community_comments TO service_role;
GRANT UPDATE (content, updated_at) ON TABLE public.community_comments TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.community_profiles TO service_role;
GRANT SELECT ON TABLE
  public.community_votes,
  public.community_polls,
  public.community_poll_options,
  public.community_poll_votes
TO service_role;
GRANT SELECT, INSERT, DELETE ON TABLE public.community_bookmarks TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.community_reports TO service_role;

REVOKE ALL ON FUNCTION public.community_vote_post(uuid, uuid, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.community_record_login(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_post(uuid, uuid, smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_vote_comment(uuid, uuid, smallint) TO service_role;
GRANT EXECUTE ON FUNCTION public.community_record_login(uuid) TO service_role;

DO $$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policy_row.policyname
    FROM pg_catalog.pg_policies AS policy_row
    WHERE policy_row.schemaname = 'storage'
      AND policy_row.tablename = 'objects'
      AND policy_row.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND policy_row.roles && ARRAY[
        'public'::name,
        'anon'::name,
        'authenticated'::name
      ]
      AND (
        COALESCE(policy_row.qual, '') LIKE '%community-images%'
        OR COALESCE(policy_row.with_check, '') LIKE '%community-images%'
        OR COALESCE(policy_row.qual, '') LIKE '%community-videos%'
        OR COALESCE(policy_row.with_check, '') LIKE '%community-videos%'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON storage.objects',
      policy_row.policyname
    );
  END LOOP;
END;
$$;
-- End community browser-write lockdown.

DO $assert_disabled_surface_service_acl$
DECLARE
  expected record;
  actual_table_privileges text[];
  actual_column_privileges text[];
  privilege_name text;
BEGIN
  FOR expected IN
    SELECT *
    FROM (VALUES
      ('cohort_rooms', ARRAY['SELECT', 'UPDATE']::text[], ARRAY[]::text[]),
      ('cohort_members', ARRAY['SELECT', 'UPDATE']::text[], ARRAY[]::text[]),
      ('cohort_messages', ARRAY[]::text[], ARRAY[]::text[]),
      ('cohort_contracts', ARRAY[]::text[], ARRAY[]::text[]),
      ('cohort_timeline_events', ARRAY[]::text[], ARRAY[]::text[]),
      ('cohort_member_reports', ARRAY['SELECT', 'UPDATE']::text[], ARRAY[]::text[]),
      ('cohort_stats', ARRAY[]::text[], ARRAY[]::text[]),
      ('cohort_room_contributor_stats', ARRAY[]::text[], ARRAY[]::text[]),
      ('wedding_journeys', ARRAY['SELECT', 'UPDATE']::text[], ARRAY[]::text[]),
      ('chat_messages', ARRAY['DELETE', 'INSERT', 'SELECT']::text[], ARRAY[]::text[]),
      ('community_posts', ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[], ARRAY[]::text[]),
      ('community_comments', ARRAY['SELECT']::text[], ARRAY['content:UPDATE', 'updated_at:UPDATE']::text[]),
      ('community_profiles', ARRAY['INSERT', 'SELECT', 'UPDATE']::text[], ARRAY[]::text[]),
      ('community_votes', ARRAY['SELECT']::text[], ARRAY[]::text[]),
      ('community_bookmarks', ARRAY['DELETE', 'INSERT', 'SELECT']::text[], ARRAY[]::text[]),
      ('community_reports', ARRAY['INSERT', 'SELECT', 'UPDATE']::text[], ARRAY[]::text[]),
      ('community_polls', ARRAY['SELECT']::text[], ARRAY[]::text[]),
      ('community_poll_options', ARRAY['SELECT']::text[], ARRAY[]::text[]),
      ('community_poll_votes', ARRAY['SELECT']::text[], ARRAY[]::text[]),
      ('community_xp_log', ARRAY[]::text[], ARRAY[]::text[]),
      ('community_streaks', ARRAY[]::text[], ARRAY[]::text[]),
      ('community_achievements', ARRAY[]::text[], ARRAY[]::text[])
    ) AS required(table_name, table_privileges, column_privileges)
  LOOP
    SELECT COALESCE(
      pg_catalog.array_agg(
        DISTINCT privilege_row.privilege_type::text
        ORDER BY privilege_row.privilege_type::text
      ) FILTER (WHERE granted_role.rolname = 'service_role'),
      ARRAY[]::text[]
    )
    INTO actual_table_privileges
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE relation.oid = pg_catalog.to_regclass(
      pg_catalog.format('public.%I', expected.table_name)
    );

    SELECT COALESCE(
      pg_catalog.array_agg(
        DISTINCT pg_catalog.format(
          '%s:%s',
          attribute_row.attname,
          privilege_row.privilege_type
        )
        ORDER BY pg_catalog.format(
          '%s:%s',
          attribute_row.attname,
          privilege_row.privilege_type
        )
      ) FILTER (WHERE granted_role.rolname = 'service_role'),
      ARRAY[]::text[]
    )
    INTO actual_column_privileges
    FROM pg_catalog.pg_attribute AS attribute_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
      AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE attribute_row.attrelid = pg_catalog.to_regclass(
        pg_catalog.format('public.%I', expected.table_name)
      )
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped;

    IF actual_table_privileges IS DISTINCT FROM expected.table_privileges
       OR actual_column_privileges IS DISTINCT FROM expected.column_privileges THEN
      RAISE EXCEPTION 'disabled-surface service_role ACL mismatch on %',
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
         ) IS DISTINCT FROM (
           privilege_name = ANY(expected.table_privileges)
         ) THEN
        RAISE EXCEPTION 'disabled-surface effective service_role ACL mismatch on %.%',
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
      FROM pg_catalog.pg_attribute AS attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        AS privilege_row
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = privilege_row.grantee
      JOIN pg_catalog.pg_roles AS grantor_role
        ON grantor_role.oid = privilege_row.grantor
      WHERE attribute_row.attrelid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
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
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(attribute_row.attacl)
        AS privilege_row
      WHERE attribute_row.attrelid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
        AND attribute_row.attnum > 0
        AND NOT attribute_row.attisdropped
        AND privilege_row.grantee = 0
    ) THEN
      RAISE EXCEPTION 'disabled-surface service_role ACL provenance mismatch on %',
        expected.table_name;
    END IF;
  END LOOP;
END;
$assert_disabled_surface_service_acl$;

COMMIT;
