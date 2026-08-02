-- Close the dormant guestbook's historical public read surface.
--
-- There is no shipped guestbook route in the current web or mobile clients.
-- Keep existing records readable only by their owner, retain service-role
-- access for deletion/export operations, and make both legacy media buckets
-- private until a moderated publication flow is deliberately reintroduced.

BEGIN;

DO $preflight$
DECLARE
  target_table text;
  missing_columns text;
  bucket_count integer;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'guestbooks',
    'guestbook_messages',
    'guestbook_message_reactions',
    'guestbook_photos'
  ]::text[]
  LOOP
    IF to_regclass(format('public.%I', target_table)) IS NULL THEN
      RAISE EXCEPTION 'GUESTBOOK_PRIVACY_FENCE_TABLE_MISSING: %', target_table
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  SELECT string_agg(required.column_name, ', ' ORDER BY required.column_name)
  INTO missing_columns
  FROM (VALUES
    ('guestbooks', 'id'),
    ('guestbooks', 'owner_id'),
    ('guestbook_messages', 'id'),
    ('guestbook_messages', 'guestbook_id'),
    ('guestbook_messages', 'ip_hash'),
    ('guestbook_message_reactions', 'message_id'),
    ('guestbook_message_reactions', 'ip_hash'),
    ('guestbook_photos', 'guestbook_id')
  ) AS required(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS actual
    WHERE actual.table_schema = 'public'
      AND actual.table_name = required.table_name
      AND actual.column_name = required.column_name
  );

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'GUESTBOOK_PRIVACY_FENCE_COLUMNS_MISSING: %', missing_columns
      USING ERRCODE = '55000';
  END IF;

  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION 'GUESTBOOK_PRIVACY_FENCE_STORAGE_BUCKETS_MISSING'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)::integer
  INTO bucket_count
  FROM storage.buckets
  WHERE id IN ('guestbook-images', 'guestbook-uploads');

  IF bucket_count <> 2 THEN
    RAISE EXCEPTION 'GUESTBOOK_PRIVACY_FENCE_BUCKET_SET_DRIFT: %', bucket_count
      USING ERRCODE = '55000';
  END IF;
END;
$preflight$;

-- Remove every historical client-side mutation path. A future guestbook must
-- use bounded, rate-limited server endpoints with moderation before these are
-- granted again.
DROP POLICY IF EXISTS guestbooks_select_active ON public.guestbooks;
DROP POLICY IF EXISTS guestbooks_insert ON public.guestbooks;
DROP POLICY IF EXISTS guestbooks_update ON public.guestbooks;
DROP POLICY IF EXISTS guestbooks_delete ON public.guestbooks;
DROP POLICY IF EXISTS guestbooks_select_owner ON public.guestbooks;

DROP POLICY IF EXISTS gb_messages_select ON public.guestbook_messages;
DROP POLICY IF EXISTS gb_messages_insert_anon ON public.guestbook_messages;
DROP POLICY IF EXISTS gb_messages_owner_update ON public.guestbook_messages;
DROP POLICY IF EXISTS gb_messages_owner_delete ON public.guestbook_messages;
DROP POLICY IF EXISTS guestbook_messages_select_owner ON public.guestbook_messages;

DROP POLICY IF EXISTS gb_reactions_select ON public.guestbook_message_reactions;
DROP POLICY IF EXISTS guestbook_reactions_select_owner ON public.guestbook_message_reactions;

DROP POLICY IF EXISTS gb_photos_select ON public.guestbook_photos;
DROP POLICY IF EXISTS gb_photos_insert_owner ON public.guestbook_photos;
DROP POLICY IF EXISTS gb_photos_update_owner ON public.guestbook_photos;
DROP POLICY IF EXISTS gb_photos_delete_owner ON public.guestbook_photos;
DROP POLICY IF EXISTS guestbook_photos_select_owner ON public.guestbook_photos;

REVOKE ALL PRIVILEGES ON TABLE
  public.guestbooks,
  public.guestbook_messages,
  public.guestbook_message_reactions,
  public.guestbook_photos
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.guestbooks,
  public.guestbook_messages,
  public.guestbook_message_reactions,
  public.guestbook_photos
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.guestbooks,
  public.guestbook_messages,
  public.guestbook_message_reactions,
  public.guestbook_photos
TO service_role;

CREATE POLICY guestbooks_select_owner
  ON public.guestbooks
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY guestbook_messages_select_owner
  ON public.guestbook_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.guestbooks AS guestbook
      WHERE guestbook.id = guestbook_id
        AND guestbook.owner_id = auth.uid()
    )
  );

CREATE POLICY guestbook_reactions_select_owner
  ON public.guestbook_message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.guestbook_messages AS message
      JOIN public.guestbooks AS guestbook ON guestbook.id = message.guestbook_id
      WHERE message.id = message_id
        AND guestbook.owner_id = auth.uid()
    )
  );

CREATE POLICY guestbook_photos_select_owner
  ON public.guestbook_photos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.guestbooks AS guestbook
      WHERE guestbook.id = guestbook_id
        AND guestbook.owner_id = auth.uid()
    )
  );

UPDATE storage.buckets
SET public = FALSE
WHERE id IN ('guestbook-images', 'guestbook-uploads');

DO $postflight$
DECLARE
  exposed_bucket_count integer;
  target_role text;
BEGIN
  SELECT count(*)::integer
  INTO exposed_bucket_count
  FROM storage.buckets
  WHERE id IN ('guestbook-images', 'guestbook-uploads')
    AND public IS DISTINCT FROM FALSE;

  IF exposed_bucket_count <> 0 THEN
    RAISE EXCEPTION 'GUESTBOOK_PRIVACY_FENCE_PUBLIC_BUCKET_REMAINS: %', exposed_bucket_count
      USING ERRCODE = '55000';
  END IF;

  -- anon inherits PUBLIC grants, so this effective privilege check covers both
  -- without treating the PostgreSQL PUBLIC pseudo-role as a login role.
  FOREACH target_role IN ARRAY ARRAY['anon']::text[]
  LOOP
    IF has_table_privilege(target_role, 'public.guestbooks', 'SELECT')
       OR has_table_privilege(target_role, 'public.guestbook_messages', 'SELECT')
       OR has_table_privilege(target_role, 'public.guestbook_message_reactions', 'SELECT')
       OR has_table_privilege(target_role, 'public.guestbook_photos', 'SELECT') THEN
      RAISE EXCEPTION 'GUESTBOOK_PRIVACY_FENCE_PUBLIC_SELECT_REMAINS: %', target_role
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd IN ('ALL', 'SELECT')
      AND (
        COALESCE(qual, '') LIKE '%guestbook-images%'
        OR COALESCE(qual, '') LIKE '%guestbook-uploads%'
      )
      AND array_to_string(roles, ',') ~* '(^|,)(public|anon)(,|$)'
  ) THEN
    RAISE EXCEPTION 'GUESTBOOK_PRIVACY_FENCE_STORAGE_SELECT_POLICY_REQUIRES_REVIEW'
      USING ERRCODE = '55000';
  END IF;
END;
$postflight$;

COMMIT;
