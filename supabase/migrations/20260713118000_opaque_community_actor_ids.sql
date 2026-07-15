-- Public community identity must never reveal auth.users UUIDs. A random,
-- immutable actor ID is the only identity exposed by PostgREST and community
-- DTOs; internal ownership continues to use auth UUIDs behind server/RLS seams.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE public.community_posts IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.community_comments IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.community_profiles IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.community_profiles
  ADD COLUMN IF NOT EXISTS public_actor_id uuid DEFAULT extensions.gen_random_uuid();

-- Repair incomplete/unsafe preparations without rotating already published,
-- non-linkable IDs on a replay. Posts/comments are synchronized from the safe
-- profile value later in this same transaction.
UPDATE public.community_profiles AS profile
SET public_actor_id = extensions.gen_random_uuid()
WHERE profile.public_actor_id IS NULL
   OR EXISTS (
     SELECT 1
     FROM auth.users AS auth_user
     WHERE auth_user.id = profile.public_actor_id
   );

-- Retry any exceptionally unlikely collision with a private auth UUID until
-- none of the public values can expose an internal identifier.
DO $exclude_private_uuid_collisions$
BEGIN
  WHILE EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    JOIN auth.users AS auth_user
      ON auth_user.id = profile.public_actor_id
  ) LOOP
    UPDATE public.community_profiles AS profile
       SET public_actor_id = extensions.gen_random_uuid()
     WHERE EXISTS (
       SELECT 1
       FROM auth.users AS auth_user
       WHERE auth_user.id = profile.public_actor_id
     );
  END LOOP;
END;
$exclude_private_uuid_collisions$;

ALTER TABLE public.community_profiles
  ALTER COLUMN public_actor_id SET DEFAULT extensions.gen_random_uuid(),
  ALTER COLUMN public_actor_id SET NOT NULL;

DO $add_profile_actor_key$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_profiles'::pg_catalog.regclass
      AND conname = 'community_profiles_public_actor_id_key'
  ) THEN
    ALTER TABLE public.community_profiles
      ADD CONSTRAINT community_profiles_public_actor_id_key
      UNIQUE (public_actor_id);
  END IF;
END;
$add_profile_actor_key$;

-- Historical defaults were either copied from profiles.name (possibly a real
-- name) or deterministically derived from the auth UUID. Rotate both classes
-- before exposing the new actor projection. The replacement uses independent
-- CSPRNG entropy and retries the existing nickname uniqueness boundary.
DO $rotate_linkable_community_nicknames$
DECLARE
  profile_row record;
  candidate text;
  rotated boolean;
  attempt integer;
BEGIN
  FOR profile_row IN
    SELECT community_profile.user_id
    FROM public.community_profiles AS community_profile
    LEFT JOIN public.profiles AS account_profile
      ON account_profile.id = community_profile.user_id
    WHERE community_profile.nickname IS NULL
       OR pg_catalog.btrim(community_profile.nickname) = ''
       OR (
      account_profile.name IS NOT NULL
      AND pg_catalog.btrim(community_profile.nickname) = pg_catalog.btrim(account_profile.name)
    ) OR community_profile.nickname ~ '^웨딩친구-[a-z0-9]{12}$'
  LOOP
    rotated := false;
    FOR attempt IN 1..10 LOOP
      candidate := '웨딩친구-' || pg_catalog.substr(
        pg_catalog.replace(extensions.gen_random_uuid()::text, '-', ''),
        1,
        15
      );
      BEGIN
        UPDATE public.community_profiles
        SET nickname = candidate
        WHERE user_id = profile_row.user_id;
        rotated := true;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- A preserved custom nickname may already equal the random candidate.
        -- Retry with fresh entropy instead of overwriting either identity.
        NULL;
      END;
    END LOOP;

    IF NOT rotated THEN
      RAISE EXCEPTION 'could not rotate linkable community nickname for %',
        profile_row.user_id;
    END IF;
  END LOOP;
END;
$rotate_linkable_community_nicknames$;

ALTER TABLE public.community_profiles
  DROP CONSTRAINT IF EXISTS community_profiles_public_nickname_nonempty;
ALTER TABLE public.community_profiles
  ADD CONSTRAINT community_profiles_public_nickname_nonempty
  CHECK (pg_catalog.btrim(nickname) <> '');

-- Public avatars are text-only emoji. Remove legacy URLs/tracking pixels and
-- arbitrary labels at the database boundary, then prevent them returning.
UPDATE public.community_profiles
SET avatar_url = pg_catalog.btrim(avatar_url)
WHERE avatar_url IS NOT NULL
  AND pg_catalog.btrim(avatar_url) <> ''
  AND pg_catalog.char_length(pg_catalog.btrim(avatar_url)) <= 8
  AND pg_catalog.btrim(avatar_url) ~ U&'[\+01F000-\+01FAFF\2600-\27BF]'
  AND pg_catalog.btrim(avatar_url) !~ U&'[^\+01F000-\+01FAFF\2600-\27BF\200D\FE0F]';

UPDATE public.community_profiles
SET avatar_url = NULL
WHERE avatar_url IS NOT NULL
  AND (
    pg_catalog.btrim(avatar_url) = ''
    OR pg_catalog.char_length(pg_catalog.btrim(avatar_url)) > 8
    OR pg_catalog.btrim(avatar_url) !~ U&'[\+01F000-\+01FAFF\2600-\27BF]'
    OR pg_catalog.btrim(avatar_url) ~ U&'[^\+01F000-\+01FAFF\2600-\27BF\200D\FE0F]'
  );

ALTER TABLE public.community_profiles
  DROP CONSTRAINT IF EXISTS community_profiles_public_avatar_emoji_only;
ALTER TABLE public.community_profiles
  ADD CONSTRAINT community_profiles_public_avatar_emoji_only
  CHECK (
    avatar_url IS NULL
    OR (
      avatar_url = pg_catalog.btrim(avatar_url)
      AND pg_catalog.char_length(avatar_url) BETWEEN 1 AND 8
      AND avatar_url ~ U&'[\+01F000-\+01FAFF\2600-\27BF]'
      AND avatar_url !~ U&'[^\+01F000-\+01FAFF\2600-\27BF\200D\FE0F]'
    )
  );

ALTER TABLE public.community_posts
  ADD COLUMN IF NOT EXISTS author_public_id uuid;
ALTER TABLE public.community_comments
  ADD COLUMN IF NOT EXISTS author_public_id uuid;

-- Fail closed if historical content has no profile. Inventing a nickname or
-- identity during a privacy migration would silently publish an unreviewed
-- account representation.
DO $assert_every_author_has_profile$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.community_posts AS post
    LEFT JOIN public.community_profiles AS profile
      ON profile.user_id = post.author_id
    WHERE profile.user_id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.community_comments AS comment
    LEFT JOIN public.community_profiles AS profile
      ON profile.user_id = comment.author_id
    WHERE profile.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'community content author has no community profile';
  END IF;
END;
$assert_every_author_has_profile$;

UPDATE public.community_posts AS post
SET author_public_id = profile.public_actor_id
FROM public.community_profiles AS profile
WHERE profile.user_id = post.author_id
  AND post.author_public_id IS DISTINCT FROM profile.public_actor_id;

UPDATE public.community_comments AS comment
SET author_public_id = profile.public_actor_id
FROM public.community_profiles AS profile
WHERE profile.user_id = comment.author_id
  AND comment.author_public_id IS DISTINCT FROM profile.public_actor_id;

ALTER TABLE public.community_posts
  ALTER COLUMN author_public_id SET NOT NULL;
ALTER TABLE public.community_comments
  ALTER COLUMN author_public_id SET NOT NULL;

DO $add_actor_foreign_keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_posts'::pg_catalog.regclass
      AND conname = 'community_posts_author_public_id_fkey'
  ) THEN
    ALTER TABLE public.community_posts
      ADD CONSTRAINT community_posts_author_public_id_fkey
      FOREIGN KEY (author_public_id)
      REFERENCES public.community_profiles(public_actor_id)
      ON UPDATE RESTRICT ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_comments'::pg_catalog.regclass
      AND conname = 'community_comments_author_public_id_fkey'
  ) THEN
    ALTER TABLE public.community_comments
      ADD CONSTRAINT community_comments_author_public_id_fkey
      FOREIGN KEY (author_public_id)
      REFERENCES public.community_profiles(public_actor_id)
      ON UPDATE RESTRICT ON DELETE CASCADE;
  END IF;
END;
$add_actor_foreign_keys$;

CREATE INDEX IF NOT EXISTS idx_community_posts_author_public_id
  ON public.community_posts (author_public_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_comments_author_public_id
  ON public.community_comments (author_public_id, created_at);

CREATE OR REPLACE FUNCTION public.sync_community_actor_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  expected_actor_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'community_profiles' THEN
    IF TG_OP = 'INSERT' THEN
      -- DEFAULT expressions are evaluated before BEFORE triggers, so checking
      -- only for NULL would trust an explicitly supplied/linkable identifier.
      -- Always replace it with server-generated entropy and exclude the exact
      -- private UUID set even in the vanishingly unlikely collision case.
      LOOP
        NEW.public_actor_id := extensions.gen_random_uuid();
        EXIT WHEN NOT EXISTS (
          SELECT 1
          FROM auth.users AS auth_user
          WHERE auth_user.id = NEW.public_actor_id
        );
      END LOOP;
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.public_actor_id IS DISTINCT FROM OLD.public_actor_id THEN
      RAISE EXCEPTION 'community_actor_identity_is_immutable'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'community_actor_identity_is_immutable'
      USING ERRCODE = '42501';
  END IF;

  SELECT profile.public_actor_id
  INTO expected_actor_id
  FROM public.community_profiles AS profile
  WHERE profile.user_id = NEW.author_id;

  IF expected_actor_id IS NULL THEN
    RAISE EXCEPTION 'community_actor_profile_missing'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.author_public_id IS NOT NULL
     AND NEW.author_public_id IS DISTINCT FROM expected_actor_id THEN
    RAISE EXCEPTION 'community_actor_identity_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.author_public_id IS DISTINCT FROM OLD.author_public_id THEN
    RAISE EXCEPTION 'community_actor_identity_is_immutable'
      USING ERRCODE = '42501';
  END IF;

  NEW.author_public_id := expected_actor_id;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.sync_community_actor_identity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_community_actor_identity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sync_community_profile_actor_id
  ON public.community_profiles;
CREATE TRIGGER sync_community_profile_actor_id
  BEFORE INSERT OR UPDATE OF public_actor_id
  ON public.community_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_community_actor_identity();

DROP TRIGGER IF EXISTS sync_community_post_actor_id
  ON public.community_posts;
CREATE TRIGGER sync_community_post_actor_id
  BEFORE INSERT OR UPDATE OF author_id, author_public_id
  ON public.community_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_community_actor_identity();

DROP TRIGGER IF EXISTS sync_community_comment_actor_id
  ON public.community_comments;
CREATE TRIGGER sync_community_comment_actor_id
  BEFORE INSERT OR UPDATE OF author_id, author_public_id
  ON public.community_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_community_actor_identity();

-- The mute helper accepts only an opaque actor ID. The internal auth UUID is
-- resolved inside the definer function and never returned to its caller.
-- PostgreSQL does not permit CREATE OR REPLACE to rename an existing input
-- parameter. Remove every known policy dependency before replacing the legacy
-- p_author_id(raw auth UUID) function with the public-actor contract.
DROP POLICY IF EXISTS "cp_select_public" ON public.community_posts;
DROP POLICY IF EXISTS "cp_select_members" ON public.community_posts;
DROP POLICY IF EXISTS "cc_select" ON public.community_comments;
DROP FUNCTION IF EXISTS public.community_author_is_muted(uuid);

CREATE FUNCTION public.community_author_is_muted(p_author_public_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.community_profiles AS profile
      JOIN public.community_user_mutes AS mute
        ON mute.muted_user_id = profile.user_id
      WHERE mute.muter_id = auth.uid()
        AND profile.public_actor_id = p_author_public_id
    )
  END;
$function$;

ALTER FUNCTION public.community_author_is_muted(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.community_author_is_muted(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_author_is_muted(uuid)
  TO anon, authenticated;

DROP POLICY IF EXISTS "cp_select_drafts" ON public.community_posts;
CREATE POLICY "cp_select_public" ON public.community_posts FOR SELECT
  USING (
    visibility = 'public'
    AND (NOT COALESCE(under_review, false) OR author_id = auth.uid())
    AND NOT public.community_author_is_muted(author_public_id)
  );
CREATE POLICY "cp_select_members" ON public.community_posts FOR SELECT
  USING (
    visibility = 'members'
    AND auth.role() = 'authenticated'
    AND (NOT COALESCE(under_review, false) OR author_id = auth.uid())
    AND NOT public.community_author_is_muted(author_public_id)
  );
CREATE POLICY "cp_select_drafts" ON public.community_posts FOR SELECT
  USING (visibility = 'draft' AND author_id = auth.uid());

CREATE POLICY "cc_select" ON public.community_comments FOR SELECT
  USING (
    NOT public.community_author_is_muted(community_comments.author_public_id)
    AND EXISTS (
      SELECT 1
      FROM public.community_posts AS post
      WHERE post.id = community_comments.post_id
        AND NOT public.community_author_is_muted(post.author_public_id)
        AND (
          post.visibility = 'public'
          OR (post.visibility = 'members' AND auth.role() = 'authenticated')
        )
        AND (NOT COALESCE(post.under_review, false) OR post.author_id = auth.uid())
    )
  );

-- Remove inherited/table/column grants, then grant only the reviewed public
-- projections. Column-level mutation grants survive a table-level REVOKE, so
-- revoke every column privilege explicitly as well. Service role receives only
-- reviewed DML; comment creation is retired and TRUNCATE would bypass counters.
DO $rebuild_community_actor_acl$
DECLARE
  relation_name text;
  all_columns text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'community_profiles',
    'community_posts',
    'community_comments'
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
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
      EXECUTE pg_catalog.format(
        'REVOKE INSERT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
      EXECUTE pg_catalog.format(
        'REVOKE UPDATE (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
      EXECUTE pg_catalog.format(
        'REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
        all_columns,
        relation_name
      );
    END IF;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role',
      relation_name
    );
  END LOOP;
END;
$rebuild_community_actor_acl$;

GRANT SELECT (
  public_actor_id,
  nickname,
  avatar_url
) ON TABLE public.community_profiles TO anon, authenticated;

GRANT SELECT (
  id,
  author_public_id,
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

GRANT SELECT (
  id,
  post_id,
  parent_id,
  author_public_id,
  content,
  upvote_count,
  is_deleted,
  created_at,
  updated_at
) ON TABLE public.community_comments TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.community_profiles
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.community_posts
  TO service_role;
GRANT SELECT
  ON TABLE public.community_comments
  TO service_role;
GRANT UPDATE (content, updated_at)
  ON TABLE public.community_comments
  TO service_role;

-- Realtime emits physical rows and cannot apply a DTO projection. None of the
-- three actor-bearing tables may be in a FOR ALL TABLES publication or the
-- reviewed explicit publication.
DO $remove_actor_realtime$
DECLARE
  relation_name text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
      AND puballtables
  ) THEN
    RAISE EXCEPTION 'supabase_realtime publishes all tables; community actor IDs cannot be private';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY[
    'community_profiles',
    'community_posts',
    'community_comments'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = relation_name
    ) THEN
      EXECUTE pg_catalog.format(
        'ALTER PUBLICATION supabase_realtime DROP TABLE public.%I',
        relation_name
      );
    END IF;
  END LOOP;
END;
$remove_actor_realtime$;

DO $assert_opaque_actor_boundary$
DECLARE
  browser_role text;
  relation_name text;
  attribute_row record;
  allowed_columns text[];
  should_select boolean;
  actor_sync_function_oid oid;
  mute_function_oid oid;
  service_acl_row record;
BEGIN
  actor_sync_function_oid := pg_catalog.to_regprocedure(
    'public.sync_community_actor_identity()'
  );
  mute_function_oid := pg_catalog.to_regprocedure(
    'public.community_author_is_muted(uuid)'
  );

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'community_profiles',
        'community_posts',
        'community_comments'
      ])
  ) THEN
    RAISE EXCEPTION 'community actor table is exposed through realtime';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.community_profiles WHERE public_actor_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.community_posts WHERE author_public_id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.community_comments WHERE author_public_id IS NULL
  ) THEN
    RAISE EXCEPTION 'community public actor backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS profile
    JOIN auth.users AS auth_user
      ON auth_user.id = profile.public_actor_id
  ) THEN
    RAISE EXCEPTION 'community public actor ID exposes an auth UUID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles AS community_profile
    LEFT JOIN public.profiles AS account_profile
      ON account_profile.id = community_profile.user_id
    WHERE community_profile.nickname IS NULL
       OR pg_catalog.btrim(community_profile.nickname) = ''
       OR (
      account_profile.name IS NOT NULL
      AND pg_catalog.btrim(community_profile.nickname) = pg_catalog.btrim(account_profile.name)
    ) OR community_profile.nickname ~ '^웨딩친구-[a-z0-9]{12}$'
  ) THEN
    RAISE EXCEPTION 'linkable community nickname remediation is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_profiles
    WHERE avatar_url IS NOT NULL
      AND (
        avatar_url <> pg_catalog.btrim(avatar_url)
        OR pg_catalog.char_length(avatar_url) NOT BETWEEN 1 AND 8
        OR avatar_url !~ U&'[\+01F000-\+01FAFF\2600-\27BF]'
        OR avatar_url ~ U&'[^\+01F000-\+01FAFF\2600-\27BF\200D\FE0F]'
      )
  ) THEN
    RAISE EXCEPTION 'unsafe public community avatar remediation is incomplete';
  END IF;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF pg_catalog.has_column_privilege(browser_role, 'public.community_profiles', 'user_id', 'SELECT')
       OR pg_catalog.has_column_privilege(browser_role, 'public.community_profiles', 'rank', 'SELECT')
       OR pg_catalog.has_column_privilege(browser_role, 'public.community_profiles', 'badge', 'SELECT')
       OR pg_catalog.has_column_privilege(browser_role, 'public.community_posts', 'author_id', 'SELECT')
       OR pg_catalog.has_column_privilege(browser_role, 'public.community_comments', 'author_id', 'SELECT') THEN
      RAISE EXCEPTION '% can select private community identity columns', browser_role;
    END IF;

    FOREACH relation_name IN ARRAY ARRAY[
      'community_profiles',
      'community_posts',
      'community_comments'
    ]
    LOOP
      IF relation_name = 'community_profiles' THEN
        allowed_columns := ARRAY[
          'public_actor_id', 'nickname', 'avatar_url'
        ];
      ELSIF relation_name = 'community_posts' THEN
        allowed_columns := ARRAY[
          'id', 'author_public_id', 'category', 'title', 'content',
          'visibility', 'ad_disclosure', 'sponsorship_detail', 'is_resolved',
          'under_review', 'upvote_count', 'downvote_count', 'comment_count',
          'view_count', 'bookmark_count', 'is_pinned', 'is_weekly_best',
          'tags', 'created_at', 'updated_at'
        ];
      ELSE
        allowed_columns := ARRAY[
          'id', 'post_id', 'parent_id', 'author_public_id', 'content',
          'upvote_count', 'is_deleted', 'created_at', 'updated_at'
        ];
      END IF;

      FOR attribute_row IN
        SELECT attribute.attname
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = pg_catalog.to_regclass(
            pg_catalog.format('public.%I', relation_name)
          )
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      LOOP
        should_select := attribute_row.attname = ANY (allowed_columns);
        IF pg_catalog.has_column_privilege(
             browser_role,
             pg_catalog.format('public.%I', relation_name),
             attribute_row.attname,
             'SELECT'
           ) IS DISTINCT FROM should_select THEN
          RAISE EXCEPTION '% SELECT ACL mismatch on %.%',
            browser_role, relation_name, attribute_row.attname;
        END IF;

        IF pg_catalog.has_column_privilege(
             browser_role,
             pg_catalog.format('public.%I', relation_name),
             attribute_row.attname,
             'INSERT'
           )
           OR pg_catalog.has_column_privilege(
             browser_role,
             pg_catalog.format('public.%I', relation_name),
             attribute_row.attname,
             'UPDATE'
           )
           OR pg_catalog.has_column_privilege(
             browser_role,
             pg_catalog.format('public.%I', relation_name),
             attribute_row.attname,
             'REFERENCES'
           ) THEN
          RAISE EXCEPTION '% still has column mutation ACL on %.%',
            browser_role, relation_name, attribute_row.attname;
        END IF;
      END LOOP;

      IF pg_catalog.has_table_privilege(browser_role, pg_catalog.format('public.%I', relation_name), 'INSERT')
         OR pg_catalog.has_table_privilege(browser_role, pg_catalog.format('public.%I', relation_name), 'UPDATE')
         OR pg_catalog.has_table_privilege(browser_role, pg_catalog.format('public.%I', relation_name), 'DELETE')
         OR pg_catalog.has_table_privilege(browser_role, pg_catalog.format('public.%I', relation_name), 'TRUNCATE')
         OR pg_catalog.has_table_privilege(browser_role, pg_catalog.format('public.%I', relation_name), 'REFERENCES')
         OR pg_catalog.has_table_privilege(browser_role, pg_catalog.format('public.%I', relation_name), 'TRIGGER')
         OR pg_catalog.has_table_privilege(browser_role, pg_catalog.format('public.%I', relation_name), 'MAINTAIN') THEN
        RAISE EXCEPTION '% still has mutation ACL on %', browser_role, relation_name;
      END IF;
    END LOOP;
  END LOOP;

  FOR service_acl_row IN
    SELECT *
    FROM (VALUES
      (
        'community_profiles',
        ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
      ),
      (
        'community_posts',
        ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
      ),
      ('community_comments', ARRAY['SELECT']::text[])
    ) AS required(table_name, privileges)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation_row.relacl)
        AS privilege_row
      WHERE relation_row.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', service_acl_row.table_name)
        )
        AND privilege_row.grantee = 0
    ) THEN
      RAISE EXCEPTION 'PUBLIC table ACL remains on %',
        service_acl_row.table_name;
    END IF;

    IF NOT coalesce((
      SELECT
        count(*) = pg_catalog.cardinality(service_acl_row.privileges)
        AND coalesce(bool_and(
          privilege_row.privilege_type = ANY(service_acl_row.privileges)
          AND NOT privilege_row.is_grantable
          AND grantor.rolname = 'postgres'
        ), true)
      FROM pg_catalog.pg_class AS relation_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation_row.relacl)
        AS privilege_row
      JOIN pg_catalog.pg_roles AS grantor
        ON grantor.oid = privilege_row.grantor
      WHERE relation_row.oid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', service_acl_row.table_name)
        )
        AND privilege_row.grantee = (
          SELECT role_row.oid
          FROM pg_catalog.pg_roles AS role_row
          WHERE role_row.rolname = 'service_role'
        )
    ), false) THEN
      RAISE EXCEPTION 'service_role direct table ACL is not exact on %',
        service_acl_row.table_name;
    END IF;
  END LOOP;

  FOREACH relation_name IN ARRAY ARRAY[
    'community_profiles',
    'community_posts',
    'community_comments'
  ]
  LOOP
    IF NOT pg_catalog.has_table_privilege(
         'service_role', pg_catalog.format('public.%I', relation_name), 'SELECT'
       )
       OR pg_catalog.has_table_privilege(
         'service_role', pg_catalog.format('public.%I', relation_name), 'TRUNCATE'
       )
       OR pg_catalog.has_table_privilege(
         'service_role', pg_catalog.format('public.%I', relation_name), 'REFERENCES'
       )
       OR pg_catalog.has_table_privilege(
         'service_role', pg_catalog.format('public.%I', relation_name), 'TRIGGER'
       )
       OR pg_catalog.has_table_privilege(
         'service_role', pg_catalog.format('public.%I', relation_name), 'MAINTAIN'
       ) THEN
      RAISE EXCEPTION 'service_role DML ACL mismatch on %', relation_name;
    END IF;

    IF relation_name = 'community_comments' THEN
      IF pg_catalog.has_table_privilege(
           'service_role', 'public.community_comments', 'INSERT'
         )
         OR pg_catalog.has_table_privilege(
           'service_role', 'public.community_comments', 'UPDATE'
         )
         OR pg_catalog.has_table_privilege(
           'service_role', 'public.community_comments', 'DELETE'
         ) THEN
        RAISE EXCEPTION 'service_role has unscoped community comment mutation';
      END IF;
    ELSIF relation_name = 'community_profiles' THEN
      IF NOT pg_catalog.has_table_privilege(
           'service_role', pg_catalog.format('public.%I', relation_name), 'INSERT'
         )
         OR NOT pg_catalog.has_table_privilege(
           'service_role', pg_catalog.format('public.%I', relation_name), 'UPDATE'
         )
         OR pg_catalog.has_table_privilege(
           'service_role', pg_catalog.format('public.%I', relation_name), 'DELETE'
         ) THEN
        RAISE EXCEPTION 'service_role profile DML ACL mismatch';
      END IF;
    ELSIF NOT pg_catalog.has_table_privilege(
           'service_role', pg_catalog.format('public.%I', relation_name), 'INSERT'
         )
         OR NOT pg_catalog.has_table_privilege(
           'service_role', pg_catalog.format('public.%I', relation_name), 'UPDATE'
         )
         OR NOT pg_catalog.has_table_privilege(
           'service_role', pg_catalog.format('public.%I', relation_name), 'DELETE'
         ) THEN
      RAISE EXCEPTION 'service_role required post DML missing';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
          'public.community_comments'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND pg_catalog.has_column_privilege(
        'service_role',
        'public.community_comments',
        attribute.attname,
        'INSERT'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid =
          'public.community_comments'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND pg_catalog.has_column_privilege(
        'service_role',
        'public.community_comments',
        attribute.attname,
        'UPDATE'
      ) IS DISTINCT FROM (
        attribute.attname = ANY (ARRAY['content', 'updated_at']::name[])
      )
  ) THEN
    RAISE EXCEPTION 'service_role community comment column ACL is not exact';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('community_profiles'),
      ('community_posts'),
      ('community_comments')
    ) AS expected(table_name)
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(
          pg_catalog.format('public.%I', expected.table_name)
        )
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
      AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS grantor
      ON grantor.oid = privilege_row.grantor
    WHERE privilege_row.grantee = 0
       OR (
         privilege_row.grantee = (
           SELECT role_row.oid
           FROM pg_catalog.pg_roles AS role_row
           WHERE role_row.rolname = 'service_role'
         )
         AND (
           expected.table_name <> 'community_comments'
           OR attribute.attname <> ALL(
             ARRAY['content', 'updated_at']::name[]
           )
           OR privilege_row.privilege_type <> 'UPDATE'
           OR privilege_row.is_grantable
           OR grantor.rolname <> 'postgres'
         )
       )
  ) OR 2 <> (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl)
      AS privilege_row
    WHERE attribute.attrelid =
          'public.community_comments'::pg_catalog.regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND privilege_row.grantee = (
        SELECT role_row.oid
        FROM pg_catalog.pg_roles AS role_row
        WHERE role_row.rolname = 'service_role'
      )
  ) THEN
    RAISE EXCEPTION 'community actor direct column ACL is not exact';
  END IF;

  IF actor_sync_function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = actor_sync_function_oid
      AND procedure_row.prosecdef
      AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig =
        ARRAY['search_path=""', 'row_security=off']::text[]
      AND procedure_row.pronargs = 0
      AND pg_catalog.pg_get_function_result(procedure_row.oid) = 'trigger'
      AND NOT pg_catalog.has_function_privilege(
        'anon', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'authenticated', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'service_role', procedure_row.oid, 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'community actor trigger function contract mismatch';
  END IF;

  IF mute_function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    WHERE procedure_row.oid = mute_function_oid
      AND procedure_row.prosecdef
      AND procedure_row.provolatile = 's'
      AND pg_catalog.pg_get_userbyid(procedure_row.proowner) = 'postgres'
      AND procedure_row.proconfig =
        ARRAY['search_path=""', 'row_security=off']::text[]
      AND pg_catalog.pg_get_function_arguments(procedure_row.oid) =
        'p_author_public_id uuid'
      AND pg_catalog.pg_get_function_result(procedure_row.oid) = 'boolean'
      AND pg_catalog.has_function_privilege(
        'anon', procedure_row.oid, 'EXECUTE'
      )
      AND pg_catalog.has_function_privilege(
        'authenticated', procedure_row.oid, 'EXECUTE'
      )
      AND NOT pg_catalog.has_function_privilege(
        'service_role', procedure_row.oid, 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'community actor mute function contract mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE procedure_row.oid = actor_sync_function_oid
      AND (
        privilege_row.privilege_type <> 'EXECUTE'
        OR privilege_row.grantee = 0
        OR granted_role.rolname <> 'postgres'
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    LEFT JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    WHERE procedure_row.oid = mute_function_oid
      AND (
        privilege_row.privilege_type <> 'EXECUTE'
        OR privilege_row.grantee = 0
        OR granted_role.rolname NOT IN ('postgres', 'anon', 'authenticated')
      )
  ) THEN
    RAISE EXCEPTION 'community actor function ACL is not exact';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_proc AS procedure_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) AS privilege_row
    JOIN pg_catalog.pg_roles AS granted_role
      ON granted_role.oid = privilege_row.grantee
    JOIN pg_catalog.pg_roles AS grantor_role
      ON grantor_role.oid = privilege_row.grantor
    WHERE procedure_row.oid = mute_function_oid
      AND granted_role.rolname IN ('anon', 'authenticated')
      AND grantor_role.rolname = 'postgres'
      AND privilege_row.privilege_type = 'EXECUTE'
      AND NOT privilege_row.is_grantable
  ) <> 2 THEN
    RAISE EXCEPTION 'community actor mute grants are not exact';
  END IF;
END;
$assert_opaque_actor_boundary$;

COMMENT ON COLUMN public.community_profiles.public_actor_id IS
  'Random immutable public identifier. It is not an auth.users ID.';
COMMENT ON COLUMN public.community_posts.author_public_id IS
  'Opaque public author identifier synchronized from community_profiles.';
COMMENT ON COLUMN public.community_comments.author_public_id IS
  'Opaque public author identifier synchronized from community_profiles.';
COMMENT ON FUNCTION public.sync_community_actor_identity() IS
  'Keeps public actor IDs synchronized with internal ownership and rejects identity changes.';

COMMIT;
