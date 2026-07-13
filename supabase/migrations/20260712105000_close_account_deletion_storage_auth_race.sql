BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.account_deletion_jobs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE;

-- The worker intentionally keeps a bounded in-memory inventory. Refuse the
-- migration instead of discovering a deterministic oversized subject while a
-- production deletion is already in progress.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object_row
    WHERE object_row.owner_id ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    GROUP BY lower(object_row.owner_id)
    HAVING count(*) > 20000
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_OWNED_STORAGE_REPAIR_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-image'
      AND CASE
        WHEN COALESCE(object_row.owner_id, '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NOT EXISTS (
          SELECT 1
          FROM auth.users AS auth_owner
          WHERE auth_owner.id = object_row.owner_id::uuid
        )
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_CHAT_STORAGE_PROVENANCE_REPAIR_REQUIRED'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

ALTER TABLE public.account_deletion_jobs
  ADD COLUMN IF NOT EXISTS auth_delete_ready_until timestamptz;

COMMENT ON COLUMN public.account_deletion_jobs.auth_delete_ready_until IS
  'Short-lived service-only proof that owned Storage metadata and application cleanup completed before Auth deletion.';

-- Return exact Storage objects attributed to the deletion subject. Object
-- names are temporary service-only cleanup material and are never persisted in
-- the job row or written to logs.
CREATE OR REPLACE FUNCTION public.list_account_deletion_owned_storage_objects(
  p_job_id uuid,
  p_worker_token uuid,
  p_after_bucket text DEFAULT NULL,
  p_after_name text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  bucket_id text,
  object_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_job_id IS NULL
    OR p_worker_token IS NULL
    OR p_limit IS NULL OR p_limit < 1 OR p_limit > 500
    OR ((p_after_bucket IS NULL) <> (p_after_name IS NULL))
    OR p_after_bucket ~ '[[:cntrl:]]'
    OR p_after_name ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'invalid owned storage inventory arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.user_id INTO v_user_id
  FROM public.account_deletion_jobs AS job
  WHERE job.id = p_job_id
    AND job.status = 'processing'
    AND job.lock_token = p_worker_token
    AND job.locked_until > pg_catalog.clock_timestamp();
  IF NOT FOUND OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'account deletion worker lease is not active'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT object_row.bucket_id, object_row.name
  FROM storage.objects AS object_row
  WHERE lower(object_row.owner_id) = v_user_id::text
    AND (
      p_after_bucket IS NULL
      OR (object_row.bucket_id, object_row.name) >
        (p_after_bucket, p_after_name)
    )
  ORDER BY object_row.bucket_id, object_row.name
  LIMIT p_limit;
END;
$$;

ALTER FUNCTION public.list_account_deletion_owned_storage_objects(
  uuid, uuid, text, text, integer
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_account_deletion_owned_storage_objects(
  uuid, uuid, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_account_deletion_owned_storage_objects(
  uuid, uuid, text, text, integer
) TO service_role;

-- Mark the narrow Auth-delete window only after Postgres independently sees no
-- object still attributed to the subject and no shared chat object whose owner
-- cannot resolve to Auth. The Auth trigger rechecks these facts and consumes
-- the proof in the same transaction as auth.users DELETE.
CREATE OR REPLACE FUNCTION public.mark_account_deletion_cleanup_ready(
  p_job_id uuid,
  p_worker_token uuid,
  p_ttl_seconds integer DEFAULT 60
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF p_job_id IS NULL
    OR p_worker_token IS NULL
    OR p_ttl_seconds IS NULL OR p_ttl_seconds < 15 OR p_ttl_seconds > 120
  THEN
    RAISE EXCEPTION 'invalid account deletion cleanup-ready arguments'
      USING ERRCODE = '22023';
  END IF;

  SELECT job.user_id INTO v_user_id
  FROM public.account_deletion_jobs AS job
  WHERE job.id = p_job_id
    AND job.status = 'processing'
    AND job.lock_token = p_worker_token
    AND job.locked_until > pg_catalog.clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND OR v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-image'
      AND CASE
        WHEN COALESCE(object_row.owner_id, '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NOT EXISTS (
          SELECT 1
          FROM auth.users AS auth_owner
          WHERE auth_owner.id = object_row.owner_id::uuid
        )
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'invalid or orphaned chat storage objects block auth deletion'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object_row
    WHERE lower(object_row.owner_id) = v_user_id::text
  ) THEN
    RAISE EXCEPTION 'owned storage objects remain before auth deletion'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.account_deletion_jobs
  SET auth_delete_ready_until = pg_catalog.clock_timestamp() +
        pg_catalog.make_interval(secs => p_ttl_seconds),
      updated_at = now()
  WHERE id = p_job_id;

  RETURN true;
END;
$$;

ALTER FUNCTION public.mark_account_deletion_cleanup_ready(uuid, uuid, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_account_deletion_cleanup_ready(
  uuid, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_account_deletion_cleanup_ready(
  uuid, uuid, integer
) TO service_role;

-- Supabase Storage accepts an authenticated JWT directly, outside the Next.js
-- route. Lock the profile row used by account-deletion start and reject both a
-- new owner and an old owner so an UPDATE cannot move an object out of cleanup
-- scope. DELETE remains available to the service worker through Storage API.
CREATE OR REPLACE FUNCTION public.block_storage_owner_write_during_account_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_owner_text text;
  v_user_id uuid;
  v_deleting_at timestamptz;
  v_owner_candidates text[];
BEGIN
  -- chat-image is a shared couple prefix, so a broad path delete can erase the
  -- partner's files. Every new/updated object in that bucket must instead carry
  -- the JWT-derived per-object owner provenance used by the deletion worker.
  IF NEW.bucket_id = 'chat-image' THEN
    IF COALESCE(NEW.owner_id::text, '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN
      RAISE EXCEPTION 'chat image owner provenance is required'
        USING ERRCODE = '42501';
    END IF;

    -- The row lock both proves provenance and orders this write before any
    -- concurrent auth.users DELETE for the same subject.
    PERFORM 1
    FROM auth.users AS auth_owner
    WHERE auth_owner.id = NEW.owner_id::uuid
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'chat image owner auth subject is missing'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_owner_candidates := ARRAY[
    NULLIF(NEW.owner_id::text, ''),
    NULLIF(auth.uid()::text, '')
  ];
  IF TG_OP = 'UPDATE' THEN
    v_owner_candidates := v_owner_candidates ||
      ARRAY[NULLIF(OLD.owner_id::text, '')];
  END IF;

  FOR v_owner_text IN
    SELECT DISTINCT lower(candidate.value)
    FROM unnest(v_owner_candidates) AS candidate(value)
    WHERE candidate.value ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY lower(candidate.value)
  LOOP
    v_user_id := v_owner_text::uuid;
    v_deleting_at := NULL;
    SELECT profile.account_deleting_at INTO v_deleting_at
    FROM public.profiles AS profile
    WHERE profile.id = v_user_id
    FOR UPDATE;

    IF v_deleting_at IS NOT NULL OR EXISTS (
      SELECT 1
      FROM public.account_deletion_jobs AS job
      WHERE job.user_id = v_user_id
        AND job.status <> 'completed'
    ) THEN
      RAISE EXCEPTION 'storage owner is locked for account deletion'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.block_storage_owner_write_during_account_deletion()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_storage_owner_write_during_account_deletion()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_block_storage_owner_write_during_account_deletion
  ON storage.objects;
CREATE TRIGGER trg_block_storage_owner_write_during_account_deletion
  BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.block_storage_owner_write_during_account_deletion();

-- An operator or another service-role caller must not erase auth.users while
-- any Storage metadata still names that subject. A durable deletion job also
-- requires a short cleanup-ready state, consumed atomically by the DELETE
-- transaction after the owner/provenance checks.
CREATE OR REPLACE FUNCTION public.block_auth_user_delete_until_account_cleanup_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_job_found boolean := false;
  v_profile_deleting boolean := false;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-image'
      AND CASE
        WHEN COALESCE(object_row.owner_id, '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NOT EXISTS (
          SELECT 1
          FROM auth.users AS auth_owner
          WHERE auth_owner.id = object_row.owner_id::uuid
        )
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'invalid or orphaned chat storage objects block auth deletion'
      USING ERRCODE = '55000';
  END IF;

  -- Match Supabase's documented user-deletion behavior even for direct SQL:
  -- an Auth subject that still owns Storage metadata cannot be deleted.
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object_row
    WHERE lower(object_row.owner_id) = OLD.id::text
  ) THEN
    RAISE EXCEPTION 'owned storage objects remain before auth deletion'
      USING ERRCODE = '55000';
  END IF;

  SELECT profile.account_deleting_at IS NOT NULL
    INTO v_profile_deleting
  FROM public.profiles AS profile
  WHERE profile.id = OLD.id
  FOR UPDATE;
  v_profile_deleting := COALESCE(v_profile_deleting, false);

  SELECT job.* INTO v_job
  FROM public.account_deletion_jobs AS job
  WHERE job.user_id = OLD.id
    AND job.status <> 'completed'
  FOR UPDATE;
  v_job_found := FOUND;

  IF NOT v_profile_deleting AND NOT v_job_found THEN
    RETURN OLD;
  END IF;

  IF NOT v_job_found
    OR v_job.status <> 'processing'
    OR v_job.lock_token IS NULL
    OR v_job.locked_until IS NULL
      OR v_job.locked_until <= pg_catalog.clock_timestamp()
    OR v_job.auth_delete_ready_until IS NULL
    OR v_job.auth_delete_ready_until <= pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION 'account cleanup is not ready for auth deletion'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.account_deletion_jobs
  SET auth_delete_ready_until = NULL,
      updated_at = now()
  WHERE id = v_job.id;

  RETURN OLD;
END;
$$;

ALTER FUNCTION public.block_auth_user_delete_until_account_cleanup_ready()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_auth_user_delete_until_account_cleanup_ready()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_block_auth_user_delete_until_account_cleanup_ready
  ON auth.users;
CREATE TRIGGER trg_block_auth_user_delete_until_account_cleanup_ready
  BEFORE DELETE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.block_auth_user_delete_until_account_cleanup_ready();

-- Completion remains idempotent, but independently proves that Auth and
-- attributed Storage metadata are gone and every shared chat owner still
-- resolves to Auth before scrubbing the job subject.
CREATE OR REPLACE FUNCTION public.complete_account_deletion_job(
  p_job_id uuid,
  p_worker_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_reason text;
  v_email_scopes text[];
  v_email_scope text;
BEGIN
  SELECT user_id, reason, email_scopes
    INTO v_user_id, v_reason, v_email_scopes
  FROM public.account_deletion_jobs
  WHERE id = p_job_id
    AND status = 'processing'
    AND lock_token = p_worker_token
    AND locked_until > now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_user_id IS NULL OR v_email_scopes IS NULL THEN
    RAISE EXCEPTION 'account deletion subject attestation is missing'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'auth subject remains before deletion completion'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects AS object_row
    WHERE object_row.bucket_id = 'chat-image'
      AND CASE
        WHEN COALESCE(object_row.owner_id, '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN NOT EXISTS (
          SELECT 1
          FROM auth.users AS auth_owner
          WHERE auth_owner.id = object_row.owner_id::uuid
        )
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION 'invalid or orphaned chat storage objects block deletion completion'
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects AS object_row
    WHERE lower(object_row.owner_id) = v_user_id::text
  ) THEN
    RAISE EXCEPTION 'owned storage objects remain before deletion completion'
      USING ERRCODE = '55000';
  END IF;

  FOR v_email_scope IN
    SELECT DISTINCT lower(btrim(scope.value))
    FROM unnest(v_email_scopes) AS scope(value)
    ORDER BY 1
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'hanbang:application-email-lifecycle:' || v_email_scope,
        0
      )
    );
  END LOOP;

  DELETE FROM public.preregistrations
  WHERE lower(btrim(email)) = ANY(v_email_scopes);
  DELETE FROM public.research_cohort_applications
  WHERE lower(btrim(email)) = ANY(v_email_scopes);
  UPDATE public.account_deletions
  SET user_id = NULL,
      email = NULL,
      reason = 'unknown'
  WHERE lower(btrim(email)) = ANY(v_email_scopes);

  INSERT INTO public.account_deletions (user_id, email, reason, deleted_at)
  VALUES (NULL, NULL, v_reason, now());

  UPDATE public.account_deletion_jobs
  SET user_id = NULL,
      email_scopes = NULL,
      email_snapshot_at = NULL,
      auth_delete_ready_until = NULL,
      status = 'completed',
      lock_token = NULL,
      locked_until = NULL,
      storage_inventory = NULL,
      next_attempt_at = NULL,
      last_error_code = NULL,
      completed_at = now(),
      dead_lettered_at = NULL,
      updated_at = now()
  WHERE id = p_job_id;

  RETURN true;
END;
$$;

ALTER FUNCTION public.complete_account_deletion_job(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_account_deletion_job(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_account_deletion_job(uuid, uuid)
  TO service_role;

DO $$
DECLARE
  v_storage_trigger pg_catalog.pg_trigger%ROWTYPE;
  v_auth_trigger pg_catalog.pg_trigger%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute_row
    WHERE attribute_row.attrelid =
        'public.account_deletion_jobs'::pg_catalog.regclass
      AND attribute_row.attname = 'auth_delete_ready_until'
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped
      AND pg_catalog.format_type(
        attribute_row.atttypid, attribute_row.atttypmod
      ) = 'timestamp with time zone'
      AND NOT attribute_row.attnotnull
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUTH_READY_COLUMN_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  SELECT trigger_row.* INTO v_storage_trigger
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'storage.objects'::pg_catalog.regclass
    AND trigger_row.tgname =
      'trg_block_storage_owner_write_during_account_deletion'
    AND NOT trigger_row.tgisinternal;
  IF NOT FOUND
    OR v_storage_trigger.tgfoid IS DISTINCT FROM
      'public.block_storage_owner_write_during_account_deletion()'::regprocedure
    OR v_storage_trigger.tgenabled <> 'O'
  THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_STORAGE_WRITE_FENCE_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;

  SELECT trigger_row.* INTO v_auth_trigger
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
    AND trigger_row.tgname =
      'trg_block_auth_user_delete_until_account_cleanup_ready'
    AND NOT trigger_row.tgisinternal;
  IF NOT FOUND
    OR v_auth_trigger.tgfoid IS DISTINCT FROM
      'public.block_auth_user_delete_until_account_cleanup_ready()'::regprocedure
    OR v_auth_trigger.tgenabled <> 'O'
  THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUTH_DELETE_FENCE_CONTRACT_MISMATCH'
      USING ERRCODE = '55000';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.list_account_deletion_owned_storage_objects(
  uuid, uuid, text, text, integer
) IS 'Service-only paged inventory of Storage objects attributed to an actively leased deletion subject.';
COMMENT ON FUNCTION public.mark_account_deletion_cleanup_ready(
  uuid, uuid, integer
) IS 'Creates a short Auth-delete window only after attributed Storage metadata reaches zero and shared chat owner provenance is intact.';
COMMENT ON FUNCTION public.block_storage_owner_write_during_account_deletion() IS
  'Trigger-only fence requiring a live Auth owner and blocking direct Storage writes after account deletion begins.';
COMMENT ON FUNCTION public.block_auth_user_delete_until_account_cleanup_ready() IS
  'Trigger-only fence that preserves Storage ownership and consumes a short cleanup proof before managed auth.users deletion.';

COMMIT;
