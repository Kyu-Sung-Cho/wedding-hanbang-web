BEGIN;

-- Durable, retryable account-deletion boundary for community media and
-- manually reviewed chat attachments.
-- Storage is external to the Auth/database transaction, so Auth deletion may
-- start only after an exact allowlisted manifest has been absence-checked.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE public.account_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  reason text,
  status text NOT NULL DEFAULT 'inventorying',
  ready_after timestamptz,
  quarantine_count integer NOT NULL DEFAULT 0,
  claim_token uuid,
  claimed_at timestamptz,
  storage_verified_at timestamptz,
  auth_deleted_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT account_deletion_jobs_status
    CHECK (status IN (
      'inventorying', 'inventory_ready', 'deleting',
      'auth_deleting', 'manual_review', 'completed'
    )),
  CONSTRAINT account_deletion_jobs_reason
    CHECK (reason IS NULL OR reason IN (
      'unknown', 'unsatisfied', 'alternative', 'wedding_done',
      'privacy', 'low_usage', 'other', 'mobile_request'
    )),
  CONSTRAINT account_deletion_jobs_quarantine
    CHECK (quarantine_count >= 0),
  CONSTRAINT account_deletion_jobs_error_code
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,64}$'),
  CONSTRAINT account_deletion_jobs_claim_state
    CHECK (
      (claim_token IS NULL AND claimed_at IS NULL)
      OR (claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    ),
  CONSTRAINT account_deletion_jobs_identity_state
    CHECK (
      (
        status = 'completed'
        AND user_id IS NULL
        AND reason IS NULL
        AND claim_token IS NULL
        AND completed_at IS NOT NULL
        AND auth_deleted_at IS NOT NULL
      )
      OR (
        status <> 'completed'
        AND user_id IS NOT NULL
        AND reason IS NOT NULL
        AND completed_at IS NULL
      )
    )
);

CREATE UNIQUE INDEX account_deletion_jobs_active_user_idx
  ON public.account_deletion_jobs (user_id)
  WHERE status <> 'completed';
CREATE INDEX account_deletion_jobs_worker_idx
  ON public.account_deletion_jobs (status, ready_after, updated_at)
  WHERE status IN ('inventorying', 'inventory_ready', 'deleting', 'auth_deleting');

CREATE TABLE public.account_deletion_media_manifest (
  job_id uuid NOT NULL REFERENCES public.account_deletion_jobs(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  path text NOT NULL,
  source text NOT NULL,
  not_before timestamptz NOT NULL,
  cleaned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (job_id, bucket, path),
  CONSTRAINT account_deletion_media_bucket
    CHECK (bucket IN (
      'community-media-staging', 'community-images', 'community-videos',
      'chat-image'
    )),
  CONSTRAINT account_deletion_media_source
    CHECK (source IN (
      'session_staging', 'session_final', 'legacy_prefix', 'quarantine'
    )),
  CONSTRAINT account_deletion_media_path_shape
    CHECK (
      (
        bucket = 'chat-image'
        AND char_length(path) BETWEEN 111 AND 512
        AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$'
      )
      OR
      (
        bucket <> 'chat-image'
        AND char_length(path) BETWEEN 38 AND 512
        AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/\\[:cntrl:]]+$'
        AND split_part(path, '/', 2) NOT IN ('.', '..')
      )
    ),
  CONSTRAINT account_deletion_media_quarantine_state
    CHECK (source <> 'quarantine' OR cleaned_at IS NULL),
  CONSTRAINT account_deletion_media_chat_quarantine_only
    CHECK (bucket <> 'chat-image' OR source = 'quarantine')
);

CREATE INDEX account_deletion_media_pending_idx
  ON public.account_deletion_media_manifest (job_id, not_before)
  WHERE cleaned_at IS NULL AND source <> 'quarantine';

ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_media_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_media_manifest FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletion_jobs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_deletion_media_manifest FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_media_manifest TO service_role;

-- Direct authenticated Storage policies call this predicate before accepting
-- a new object. The advisory lock is deliberately identical to the intake RPC
-- lock below: either the upload commits first and is visible to the later
-- inventory, or deletion intake commits first and the upload is denied.
CREATE OR REPLACE FUNCTION public.account_deletion_storage_writes_allowed()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $storage_write_fence$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  RETURN NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_jobs AS job
    WHERE job.user_id = v_user_id
      AND job.status <> 'completed'
  );
END;
$storage_write_fence$;

ALTER FUNCTION public.account_deletion_storage_writes_allowed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_deletion_storage_writes_allowed()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_storage_writes_allowed()
  TO authenticated;

-- Permanent bridge between the temporary database release fence and Storage
-- RLS. Final Storage policies may be installed before deploy, but remain
-- closed until every temporary database-fence object has been removed by the
-- exact paired rollback after canary verification.
CREATE OR REPLACE FUNCTION public.production_storage_writes_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $production_storage_write_fence$
  SELECT NOT (
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_record
      WHERE trigger_record.tgname = 'trg_production_write_fence_20260717'
        AND NOT trigger_record.tgisinternal
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.pg_event_trigger AS event_trigger_record
      WHERE event_trigger_record.evtname = 'evt_production_write_fence_20260717'
    )
    OR pg_catalog.to_regprocedure(
      'public.production_write_fence_guard_20260717()'
    ) IS NOT NULL
    OR pg_catalog.to_regprocedure(
      'public.production_write_fence_attach_20260717()'
    ) IS NOT NULL
  )
$production_storage_write_fence$;

ALTER FUNCTION public.production_storage_writes_allowed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.production_storage_writes_allowed()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_storage_writes_allowed()
  TO authenticated;

CREATE OR REPLACE FUNCTION public.begin_account_deletion_job(
  p_user_id uuid,
  p_reason text
)
RETURNS SETOF public.account_deletion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $begin_job$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF p_user_id IS NULL OR v_reason NOT IN (
       'unknown', 'unsatisfied', 'alternative', 'wedding_done',
       'privacy', 'low_usage', 'other', 'mobile_request'
     ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_REQUEST_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE user_id = p_user_id
     AND status <> 'completed'
   FOR UPDATE;
  IF FOUND THEN
    RETURN NEXT v_job;
    RETURN;
  END IF;

  INSERT INTO public.account_deletion_jobs(user_id, reason)
  VALUES (p_user_id, v_reason)
  RETURNING * INTO v_job;
  RETURN NEXT v_job;
END;
$begin_job$;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_stale_before timestamptz
)
RETURNS SETOF public.account_deletion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $claim_job$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
BEGIN
  IF p_job_id IS NULL OR p_claim_token IS NULL OR p_stale_before IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_CLAIM_INVALID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE id = p_job_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_job.status IN ('manual_review', 'completed')
     OR (v_job.status = 'inventory_ready' AND v_job.ready_after > clock_timestamp())
     OR (
       v_job.claim_token IS NOT NULL
       AND v_job.claimed_at > LEAST(
         p_stale_before,
         clock_timestamp() - interval '15 minutes'
       )
     ) THEN
    RETURN;
  END IF;

  UPDATE public.account_deletion_jobs
     SET status = CASE WHEN status = 'inventory_ready' THEN 'deleting' ELSE status END,
         claim_token = p_claim_token,
         claimed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE id = p_job_id
   RETURNING * INTO v_job;
  RETURN NEXT v_job;
END;
$claim_job$;

CREATE OR REPLACE FUNCTION public.replace_account_deletion_media_manifest(
  p_job_id uuid,
  p_claim_token uuid,
  p_manifest jsonb
)
RETURNS SETOF public.account_deletion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $replace_manifest$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_item jsonb;
  v_bucket text;
  v_path text;
  v_source text;
  v_not_before timestamptz;
  v_session public.community_upload_sessions%ROWTYPE;
  v_quarantine_count integer;
  v_ready_after timestamptz;
BEGIN
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE id = p_job_id
     AND status = 'inventorying'
     AND claim_token = p_claim_token
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF p_manifest IS NULL
     OR jsonb_typeof(p_manifest) <> 'array'
     OR jsonb_array_length(p_manifest) > 10000 THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.account_deletion_media_manifest WHERE job_id = p_job_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_manifest)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR (v_item - 'bucket' - 'path' - 'source' - 'not_before') <> '{}'::jsonb THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
    END IF;
    v_bucket := v_item->>'bucket';
    v_path := v_item->>'path';
    v_source := v_item->>'source';
    BEGIN
      v_not_before := (v_item->>'not_before')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_INVALID' USING ERRCODE = '22023';
    END;

    IF v_bucket NOT IN (
         'community-media-staging', 'community-images', 'community-videos',
         'chat-image'
       )
       OR v_path IS NULL
       OR char_length(v_path) NOT BETWEEN 38 AND 512
       OR (
         v_bucket = 'chat-image'
         AND v_path !~ (
           '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
           || v_job.user_id::text
           || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$'
         )
       )
       OR (
         v_bucket <> 'chat-image'
         AND (
           v_path !~ ('^' || v_job.user_id::text || '/[^/\\[:cntrl:]]+$')
           OR split_part(v_path, '/', 2) IN ('.', '..')
         )
       ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_PATH_INVALID' USING ERRCODE = '22023';
    END IF;

    IF v_bucket = 'chat-image' THEN
      IF v_source <> 'quarantine' THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_CHAT_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source IN ('session_staging', 'session_final') THEN
      SELECT * INTO v_session
        FROM public.community_upload_sessions
       WHERE user_id = v_job.user_id
         AND (
           (v_source = 'session_staging'
             AND v_bucket = 'community-media-staging'
             AND staging_path = v_path)
           OR
           (v_source = 'session_final'
             AND final_bucket = v_bucket
             AND final_path = v_path)
         );
      IF NOT FOUND OR v_not_before < v_session.expires_at + interval '5 minutes' THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_SESSION_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source = 'legacy_prefix' THEN
      IF NOT (
        (
          v_bucket = 'community-images'
          AND v_path ~* ('^' || v_job.user_id::text || '/[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|gif|webp)$')
        )
        OR (
          v_bucket = 'community-videos'
          AND v_path ~* ('^' || v_job.user_id::text || '/[0-9]{13}_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|mov|webm)$')
        )
      ) THEN
        RAISE EXCEPTION 'ACCOUNT_DELETION_LEGACY_PROOF_INVALID' USING ERRCODE = '23514';
      END IF;
    ELSIF v_source <> 'quarantine' THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MANIFEST_SOURCE_INVALID' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.account_deletion_media_manifest(
      job_id, bucket, path, source, not_before
    ) VALUES (p_job_id, v_bucket, v_path, v_source, v_not_before);
  END LOOP;

  SELECT count(*) FILTER (WHERE source = 'quarantine'),
         coalesce(max(not_before) FILTER (WHERE source <> 'quarantine'), clock_timestamp())
    INTO v_quarantine_count, v_ready_after
    FROM public.account_deletion_media_manifest
   WHERE job_id = p_job_id;

  UPDATE public.account_deletion_jobs
     SET status = CASE WHEN v_quarantine_count > 0
                       THEN 'manual_review' ELSE 'inventory_ready' END,
         quarantine_count = v_quarantine_count,
         ready_after = v_ready_after,
         claim_token = NULL,
         claimed_at = NULL,
         last_error_code = CASE WHEN v_quarantine_count > 0
                                THEN 'unproven_legacy_media' ELSE NULL END,
         updated_at = clock_timestamp()
   WHERE id = p_job_id
   RETURNING * INTO v_job;
  RETURN NEXT v_job;
END;
$replace_manifest$;

CREATE OR REPLACE FUNCTION public.release_account_deletion_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $release_job$
DECLARE
  v_id uuid;
BEGIN
  IF p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ERROR_CODE_INVALID' USING ERRCODE = '22023';
  END IF;
  UPDATE public.account_deletion_jobs
     SET claim_token = NULL,
         claimed_at = NULL,
         last_error_code = p_error_code,
         updated_at = clock_timestamp()
   WHERE id = p_job_id
     AND claim_token = p_claim_token
     AND status NOT IN ('manual_review', 'completed')
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$release_job$;

CREATE OR REPLACE FUNCTION public.mark_account_deletion_manual_review(
  p_job_id uuid,
  p_claim_token uuid,
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $manual_review$
DECLARE
  v_id uuid;
BEGIN
  IF p_error_code !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_ERROR_CODE_INVALID' USING ERRCODE = '22023';
  END IF;
  UPDATE public.account_deletion_jobs
     SET status = 'manual_review',
         claim_token = NULL,
         claimed_at = NULL,
         last_error_code = p_error_code,
         updated_at = clock_timestamp()
   WHERE id = p_job_id
     AND claim_token = p_claim_token
     AND status <> 'completed'
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$manual_review$;

CREATE OR REPLACE FUNCTION public.resume_account_deletion_after_manual_review(
  p_job_id uuid
)
RETURNS SETOF public.account_deletion_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $resume_manual_review$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE id = p_job_id
     AND status = 'manual_review'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- An operator may call this only after the unproven object was removed or
  -- moved to an approved private/legal-retention location. Evidence is never
  -- trusted here: the worker must inventory Storage from scratch again.
  DELETE FROM public.account_deletion_media_manifest WHERE job_id = p_job_id;
  UPDATE public.account_deletion_jobs
     SET status = 'inventorying',
         ready_after = NULL,
         quarantine_count = 0,
         storage_verified_at = NULL,
         claim_token = NULL,
         claimed_at = NULL,
         last_error_code = NULL,
         updated_at = clock_timestamp()
   WHERE id = p_job_id
   RETURNING * INTO v_job;
  RETURN NEXT v_job;
END;
$resume_manual_review$;

CREATE OR REPLACE FUNCTION public.checkpoint_account_deletion_media(
  p_job_id uuid,
  p_claim_token uuid,
  p_bucket text,
  p_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $checkpoint_media$
DECLARE
  v_path text;
BEGIN
  UPDATE public.account_deletion_media_manifest AS manifest
     SET cleaned_at = coalesce(cleaned_at, clock_timestamp()),
         updated_at = clock_timestamp()
    FROM public.account_deletion_jobs AS job
   WHERE manifest.job_id = p_job_id
     AND manifest.bucket = p_bucket
     AND manifest.path = p_path
     AND manifest.source <> 'quarantine'
     AND manifest.not_before <= clock_timestamp()
     AND job.id = manifest.job_id
     AND job.status IN ('deleting', 'auth_deleting')
     AND job.claim_token = p_claim_token
  RETURNING manifest.path INTO v_path;
  RETURN v_path IS NOT NULL;
END;
$checkpoint_media$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion_auth_delete(
  p_job_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $prepare_auth$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.account_deletion_jobs AS job
     SET status = 'auth_deleting',
         storage_verified_at = coalesce(storage_verified_at, clock_timestamp()),
         updated_at = clock_timestamp()
   WHERE job.id = p_job_id
     AND job.status IN ('deleting', 'auth_deleting')
     AND job.claim_token = p_claim_token
     AND job.quarantine_count = 0
     AND NOT EXISTS (
       SELECT 1
         FROM public.vendors AS vendor
        WHERE vendor.owner_id = job.user_id
     )
     AND NOT EXISTS (
       SELECT 1
         FROM public.account_deletion_media_manifest AS manifest
        WHERE manifest.job_id = job.id
          AND (manifest.source = 'quarantine' OR manifest.cleaned_at IS NULL)
     )
  RETURNING job.id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$prepare_auth$;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion_job(
  p_job_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $finalize_job$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
    FROM public.account_deletion_jobs
   WHERE id = p_job_id
     AND status = 'auth_deleting'
     AND claim_token = p_claim_token
   FOR UPDATE;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.users WHERE id = v_job.user_id) THEN
    RETURN false;
  END IF;

  INSERT INTO public.account_deletions(reason, deleted_at)
  VALUES (v_job.reason, clock_timestamp());
  DELETE FROM public.account_deletion_media_manifest WHERE job_id = p_job_id;
  UPDATE public.account_deletion_jobs
     SET user_id = NULL,
         reason = NULL,
         status = 'completed',
         claim_token = NULL,
         claimed_at = NULL,
         auth_deleted_at = clock_timestamp(),
         completed_at = clock_timestamp(),
         last_error_code = NULL,
         updated_at = clock_timestamp()
   WHERE id = p_job_id;
  RETURN true;
END;
$finalize_job$;

-- CREATE OR REPLACE preserves prior ACL entries, including grants to roles that
-- this migration cannot know by name. Rebuild every account-deletion function
-- to an exact owner + intended-caller EXECUTE ACL and remove grant options.
DO $rebuild_account_deletion_exact_acl$
DECLARE
  acl_contract record;
  procedure_record pg_catalog.pg_proc%ROWTYPE;
  grant_record record;
BEGIN
  FOR acl_contract IN
    SELECT required.signature, required.intended_role
      FROM (VALUES
        ('public.account_deletion_storage_writes_allowed()', 'authenticated'),
        ('public.production_storage_writes_allowed()', 'authenticated'),
        ('public.begin_account_deletion_job(uuid,text)', 'service_role'),
        ('public.claim_account_deletion_job(uuid,uuid,timestamp with time zone)', 'service_role'),
        ('public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)', 'service_role'),
        ('public.release_account_deletion_job(uuid,uuid,text)', 'service_role'),
        ('public.mark_account_deletion_manual_review(uuid,uuid,text)', 'service_role'),
        ('public.resume_account_deletion_after_manual_review(uuid)', 'service_role'),
        ('public.checkpoint_account_deletion_media(uuid,uuid,text,text)', 'service_role'),
        ('public.prepare_account_deletion_auth_delete(uuid,uuid)', 'service_role'),
        ('public.finalize_account_deletion_job(uuid,uuid)', 'service_role')
      ) AS required(signature, intended_role)
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s OWNER TO postgres',
      acl_contract.signature
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC',
      acl_contract.signature
    );

    SELECT *
      INTO STRICT procedure_record
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(acl_contract.signature);

    FOR grant_record IN
      SELECT DISTINCT pg_catalog.pg_get_userbyid(acl_entry.grantee) AS role_name
        FROM pg_catalog.aclexplode(COALESCE(
          procedure_record.proacl,
          pg_catalog.acldefault('f', procedure_record.proowner)
        )) AS acl_entry
       WHERE acl_entry.privilege_type = 'EXECUTE'
         AND acl_entry.grantee <> 0
         AND acl_entry.grantee <> procedure_record.proowner
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM %I CASCADE',
        acl_contract.signature,
        grant_record.role_name
      );
    END LOOP;

    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO %I',
      acl_contract.signature,
      acl_contract.intended_role
    );
  END LOOP;
END;
$rebuild_account_deletion_exact_acl$;

DO $account_deletion_exact_acl_postcondition$
DECLARE
  acl_contract record;
  procedure_record pg_catalog.pg_proc%ROWTYPE;
  actual_grantees name[];
BEGIN
  FOR acl_contract IN
    SELECT required.signature, required.intended_role,
           required.expected_grantees
      FROM (VALUES
        ('public.account_deletion_storage_writes_allowed()', 'authenticated',
         ARRAY['authenticated', 'postgres']::name[]),
        ('public.production_storage_writes_allowed()', 'authenticated',
         ARRAY['authenticated', 'postgres']::name[]),
        ('public.begin_account_deletion_job(uuid,text)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.claim_account_deletion_job(uuid,uuid,timestamp with time zone)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.replace_account_deletion_media_manifest(uuid,uuid,jsonb)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.release_account_deletion_job(uuid,uuid,text)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.mark_account_deletion_manual_review(uuid,uuid,text)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.resume_account_deletion_after_manual_review(uuid)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.checkpoint_account_deletion_media(uuid,uuid,text,text)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.prepare_account_deletion_auth_delete(uuid,uuid)', 'service_role',
         ARRAY['postgres', 'service_role']::name[]),
        ('public.finalize_account_deletion_job(uuid,uuid)', 'service_role',
         ARRAY['postgres', 'service_role']::name[])
      ) AS required(signature, intended_role, expected_grantees)
  LOOP
    SELECT *
      INTO procedure_record
      FROM pg_catalog.pg_proc
     WHERE oid = pg_catalog.to_regprocedure(acl_contract.signature);

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_FUNCTION_ACL_INVALID: %',
        acl_contract.signature;
    END IF;

    SELECT pg_catalog.array_agg(
             DISTINCT pg_catalog.pg_get_userbyid(acl_entry.grantee)
             ORDER BY pg_catalog.pg_get_userbyid(acl_entry.grantee)
           )
      INTO actual_grantees
      FROM pg_catalog.aclexplode(COALESCE(
        procedure_record.proacl,
        pg_catalog.acldefault('f', procedure_record.proowner)
      )) AS acl_entry
     WHERE acl_entry.privilege_type = 'EXECUTE';

    IF pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR actual_grantees IS DISTINCT FROM acl_contract.expected_grantees
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(COALESCE(
             procedure_record.proacl,
             pg_catalog.acldefault('f', procedure_record.proowner)
           )) AS acl_entry
          WHERE acl_entry.privilege_type = 'EXECUTE'
            AND pg_catalog.pg_get_userbyid(acl_entry.grantee) =
              acl_contract.intended_role
            AND acl_entry.is_grantable
       ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_FUNCTION_ACL_INVALID: %',
        acl_contract.signature;
    END IF;
  END LOOP;
END;
$account_deletion_exact_acl_postcondition$;

DO $storage_write_fence_postcondition$
DECLARE
  procedure_record pg_catalog.pg_proc%ROWTYPE;
BEGIN
  SELECT * INTO procedure_record
  FROM pg_catalog.pg_proc
  WHERE oid = pg_catalog.to_regprocedure(
    'public.account_deletion_storage_writes_allowed()'
  );

  IF NOT FOUND
     OR procedure_record.prokind <> 'f'
     OR NOT procedure_record.prosecdef
     OR procedure_record.provolatile <> 'v'
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR procedure_record.proconfig IS DISTINCT FROM ARRAY[
       'search_path=""', 'lock_timeout=5s', 'statement_timeout=10s'
     ]::text[]
     OR pg_catalog.has_function_privilege(
       'anon', procedure_record.oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', procedure_record.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', procedure_record.oid, 'EXECUTE'
     )
     OR position('pg_advisory_xact_lock' IN procedure_record.prosrc) = 0
     OR position('hashtextextended(v_user_id::text, 0)' IN procedure_record.prosrc) = 0
     OR position('job.status <> ''completed''' IN procedure_record.prosrc) = 0
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(
         procedure_record.proacl,
         pg_catalog.acldefault('f', procedure_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.grantee = 0
         AND acl_entry.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_STORAGE_WRITE_FENCE_INVALID';
  END IF;

  SELECT * INTO procedure_record
  FROM pg_catalog.pg_proc
  WHERE oid = pg_catalog.to_regprocedure(
    'public.production_storage_writes_allowed()'
  );

  IF NOT FOUND
     OR procedure_record.prokind <> 'f'
     OR NOT procedure_record.prosecdef
     OR procedure_record.provolatile <> 's'
     OR pg_catalog.pg_get_userbyid(procedure_record.proowner) <> 'postgres'
     OR procedure_record.proconfig IS DISTINCT FROM ARRAY[
       'search_path=""'
     ]::text[]
     OR pg_catalog.has_function_privilege(
       'anon', procedure_record.oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', procedure_record.oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', procedure_record.oid, 'EXECUTE'
     )
     OR position(
       'trg_production_write_fence_20260717' IN procedure_record.prosrc
     ) = 0
     OR position(
       'evt_production_write_fence_20260717' IN procedure_record.prosrc
     ) = 0
     OR position(
       'public.production_write_fence_guard_20260717()' IN procedure_record.prosrc
     ) = 0
     OR position(
       'public.production_write_fence_attach_20260717()' IN procedure_record.prosrc
     ) = 0
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.aclexplode(COALESCE(
         procedure_record.proacl,
         pg_catalog.acldefault('f', procedure_record.proowner)
       )) AS acl_entry
       WHERE acl_entry.grantee = 0
         AND acl_entry.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'PRODUCTION_STORAGE_WRITE_FENCE_INVALID';
  END IF;
END;
$storage_write_fence_postcondition$;

COMMENT ON TABLE public.account_deletion_media_manifest IS
  'Exact community Storage paths plus strict chat attachment evidence; quarantine rows are never deleted automatically.';
COMMENT ON TABLE public.account_deletion_jobs IS
  'Durable account deletion jobs; reason is a non-PII allowlisted code and is anonymized at completion.';
COMMENT ON FUNCTION public.prepare_account_deletion_auth_delete(uuid, uuid) IS
  'Crosses the Auth deletion boundary only after every exact manifest path has a durable absence checkpoint.';
COMMENT ON FUNCTION public.account_deletion_storage_writes_allowed() IS
  'Authenticated Storage write predicate serialized against account deletion intake by the same advisory lock.';
COMMENT ON FUNCTION public.production_storage_writes_allowed() IS
  'Fail-closed Storage RLS bridge: false while any temporary production database write-fence artifact remains.';

COMMIT;
