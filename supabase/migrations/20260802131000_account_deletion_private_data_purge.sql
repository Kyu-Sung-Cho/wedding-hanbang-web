BEGIN;

-- Account deletion previously crossed the Auth boundary after Storage cleanup,
-- but private couple scopes could survive because Auth FKs intentionally keep
-- shared couple history. Purge the departing actor's private scope and redact
-- raw AI payloads before Auth deletion becomes eligible.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.account_deletion_jobs
  ADD COLUMN IF NOT EXISTS deletion_couple_id uuid,
  ADD COLUMN IF NOT EXISTS deletion_actor_role text,
  ADD COLUMN IF NOT EXISTS private_data_purged_at timestamptz;

ALTER TABLE public.account_deletion_jobs
  DROP CONSTRAINT IF EXISTS account_deletion_jobs_actor_role;
ALTER TABLE public.account_deletion_jobs
  ADD CONSTRAINT account_deletion_jobs_actor_role
  CHECK (deletion_actor_role IS NULL OR deletion_actor_role IN ('bride', 'groom'));

ALTER TABLE public.account_deletion_jobs
  DROP CONSTRAINT IF EXISTS account_deletion_jobs_private_purge_snapshot;
ALTER TABLE public.account_deletion_jobs
  ADD CONSTRAINT account_deletion_jobs_private_purge_snapshot
  CHECK (
    (deletion_couple_id IS NULL) = (deletion_actor_role IS NULL)
    AND (
      private_data_purged_at IS NOT NULL
      OR (deletion_couple_id IS NULL AND deletion_actor_role IS NULL)
    )
  );

-- The legacy route wrote this ledger before it attempted the remaining purge
-- and Auth deletion. A populated identity is therefore evidence of an
-- unfinished or ambiguous workflow, not proof that deletion completed. Never
-- destroy that recovery key automatically: production must reconcile every
-- such row (including the still-active Auth account found during this audit)
-- before this migration is allowed to continue.
CREATE TEMP TABLE legacy_account_deletion_identities
ON COMMIT DROP
AS
SELECT id, user_id, lower(btrim(email)) AS email, deleted_at
FROM public.account_deletions
WHERE user_id IS NOT NULL OR email IS NOT NULL;

DO $legacy_account_deletion_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM legacy_account_deletion_identities AS legacy
    JOIN auth.users AS auth_user ON auth_user.id = legacy.user_id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_LEGACY_ACTIVE_AUTH_USER'
      USING ERRCODE = '55000',
            HINT = 'Do not de-identify the ledger. Reconcile the active account and its retained data in a reviewed runbook, then retry.';
  END IF;

  IF EXISTS (SELECT 1 FROM legacy_account_deletion_identities) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_LEGACY_IDENTITY_UNRECONCILED'
      USING ERRCODE = '55000',
            HINT = 'Use the retained identity to prove and complete the historical purge before nulling the ledger identity, then retry.';
  END IF;
END;
$legacy_account_deletion_guard$;

ALTER TABLE public.account_deletions
  DROP CONSTRAINT IF EXISTS account_deletions_identity_redacted;
ALTER TABLE public.account_deletions
  ADD CONSTRAINT account_deletions_identity_redacted
  CHECK (user_id IS NULL AND email IS NULL) NOT VALID;
ALTER TABLE public.account_deletions
  VALIDATE CONSTRAINT account_deletions_identity_redacted;

-- A retired survey question collected phone/email and the route continued to
-- retain User-Agent strings. They are not needed for the aggregate research
-- purpose and cannot be reliably linked to a later account deletion request.
UPDATE public.customer_survey_responses
SET q23_contact = NULL, user_agent = NULL
WHERE q23_contact IS NOT NULL OR user_agent IS NOT NULL;

ALTER TABLE public.customer_survey_responses
  DROP CONSTRAINT IF EXISTS customer_survey_responses_legacy_pii_redacted;
ALTER TABLE public.customer_survey_responses
  ADD CONSTRAINT customer_survey_responses_legacy_pii_redacted
  CHECK (q23_contact IS NULL AND user_agent IS NULL) NOT VALID;
ALTER TABLE public.customer_survey_responses
  VALIDATE CONSTRAINT customer_survey_responses_legacy_pii_redacted;

-- This retired B2B survey table exists only in some deployed projects. Raw
-- browser fingerprints are not used by the product, so remove and prohibit
-- them when the historical column is present without making fresh installs
-- depend on that legacy table.
DO $retire_b2b_survey_user_agent$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'b2b_survey_responses'
      AND column_name = 'user_agent'
  ) THEN
    EXECUTE 'UPDATE public.b2b_survey_responses
      SET user_agent = NULL WHERE user_agent IS NOT NULL';
    EXECUTE 'ALTER TABLE public.b2b_survey_responses
      DROP CONSTRAINT IF EXISTS b2b_survey_responses_user_agent_null';
    EXECUTE 'ALTER TABLE public.b2b_survey_responses
      ADD CONSTRAINT b2b_survey_responses_user_agent_null
      CHECK (user_agent IS NULL) NOT VALID';
    EXECUTE 'ALTER TABLE public.b2b_survey_responses
      VALIDATE CONSTRAINT b2b_survey_responses_user_agent_null';
  END IF;
END;
$retire_b2b_survey_user_agent$;

-- A worker that already crossed the old Auth boundary could race this rollout
-- and leave us without the actor/role needed for a complete purge. Fail the
-- migration instead; deploy only after the worker is paused and these states
-- have drained.
DO $active_auth_boundary_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_jobs
    WHERE status IN ('deleting', 'auth_deleting')
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_PRIVATE_PURGE_ACTIVE_JOB'
      USING ERRCODE = '55006',
            HINT = 'Pause the deletion worker, drain deleting/auth_deleting jobs, then retry.';
  END IF;
END;
$active_auth_boundary_guard$;

CREATE OR REPLACE FUNCTION public.purge_couple_private_scope(
  p_user_id uuid,
  p_couple_id uuid,
  p_visibility text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '60s'
AS $purge_scope$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_previous_cleanup_setting text := coalesce(
    current_setting('hanbang.account_deletion_cleanup', true), ''
  );
BEGIN
  IF p_couple_id IS NULL
     OR p_visibility NOT IN ('bride_private', 'groom_private') THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_PRIVATE_SCOPE_INVALID'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.set_config(
    'hanbang.account_deletion_cleanup', 'on', true
  );

  -- Stop queued work before deleting its source messages and memories.
  DELETE FROM public.amora_chat_request_claims
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  DELETE FROM public.amora_memory_jobs
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  DELETE FROM public.amora_memory_consents
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  DELETE FROM public.amora_memory_settings
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  DELETE FROM public.amora_couple_profiles
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  DELETE FROM public.chat_summaries
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  -- decision_edges are removed by their ON DELETE CASCADE contract.
  DELETE FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  -- AI replies have a NULL sender_id, so purge the whole role-private scope,
  -- not only rows directly authored by the departing user.
  DELETE FROM public.chat_messages
  WHERE couple_id = p_couple_id
    AND visibility = p_visibility;

  -- Outbound-care jobs copy names, recipient addresses, roster UUIDs and
  -- generated content. This also runs for historical orphan scopes where the
  -- departed UUID is no longer recoverable: reconcile against the authoritative
  -- current roster, cancel work, and scrub every copied payload.
  UPDATE public.amora_care_deliveries AS delivery
  SET status = CASE
        WHEN delivery.status IN ('pending', 'processing') THEN 'cancelled'
        ELSE delivery.status
      END,
      completed_at = CASE
        WHEN delivery.status IN ('pending', 'processing') THEN v_now
        ELSE delivery.completed_at
      END,
      recipient_email = NULL,
      recipient_name = NULL,
      last_error = CASE
        WHEN delivery.status IN ('pending', 'processing') THEN 'account_departed'
        ELSE delivery.last_error
      END,
      updated_at = v_now
  FROM public.amora_care_jobs AS job
  WHERE delivery.job_id = job.id
    AND job.couple_id = p_couple_id;

  UPDATE public.amora_care_jobs AS job
  SET status = CASE
        WHEN job.status IN ('pending', 'processing') THEN 'cancelled'
        ELSE job.status
      END,
      completed_at = CASE
        WHEN job.status IN ('pending', 'processing') THEN v_now
        ELSE job.completed_at
      END,
      roster_member_ids = ARRAY(
        SELECT DISTINCT roster.actor_id
        FROM unnest(job.roster_member_ids) AS roster(actor_id)
        JOIN public.couples AS current_couple
          ON current_couple.id = job.couple_id
        WHERE roster.actor_id IN (
          current_couple.bride_id, current_couple.groom_id
        )
          AND (p_user_id IS NULL OR roster.actor_id <> p_user_id)
        ORDER BY roster.actor_id
      ),
      content = '[redacted]',
      email_subject = NULL,
      email_html = NULL,
      metadata = '{}'::jsonb,
      lease_token = NULL,
      lease_expires_at = NULL,
      chat_message_id = NULL,
      last_error = CASE
        WHEN job.status IN ('pending', 'processing') THEN 'account_departed'
        ELSE job.last_error
      END,
      updated_at = v_now
  WHERE job.couple_id = p_couple_id;

  DELETE FROM public.amora_care_jobs
  WHERE couple_id = p_couple_id
    AND cardinality(roster_member_ids) = 0;

  PERFORM pg_catalog.set_config(
    'hanbang.account_deletion_cleanup', v_previous_cleanup_setting, true
  );
END;
$purge_scope$;

ALTER FUNCTION public.purge_couple_private_scope(uuid, uuid, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.purge_couple_private_scope(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.purge_departed_couple_private_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '60s'
AS $purge_departed_scope$
DECLARE
  v_previous_cleanup_setting text := coalesce(
    current_setting('hanbang.account_deletion_cleanup', true), ''
  );
BEGIN
  PERFORM pg_catalog.set_config(
    'hanbang.account_deletion_cleanup', 'on', true
  );
  IF OLD.bride_id IS DISTINCT FROM NEW.bride_id AND OLD.bride_id IS NOT NULL THEN
    PERFORM public.purge_couple_private_scope(
      OLD.bride_id, OLD.id, 'bride_private'
    );
  END IF;

  IF OLD.groom_id IS DISTINCT FROM NEW.groom_id AND OLD.groom_id IS NOT NULL THEN
    PERFORM public.purge_couple_private_scope(
      OLD.groom_id, OLD.id, 'groom_private'
    );
  END IF;

  DELETE FROM public.amora_chat_request_claims
  WHERE user_id IN (OLD.bride_id, OLD.groom_id)
    AND user_id IS NOT NULL
    AND user_id IS DISTINCT FROM NEW.bride_id
    AND user_id IS DISTINCT FROM NEW.groom_id;

  DELETE FROM public.amora_turn_requests
  WHERE couple_id = OLD.id
    AND (
      (OLD.bride_id IS DISTINCT FROM NEW.bride_id AND OLD.bride_id IS NOT NULL
        AND request_key LIKE 'chat:' || OLD.bride_id::text || ':%')
      OR
      (OLD.groom_id IS DISTINCT FROM NEW.groom_id AND OLD.groom_id IS NOT NULL
        AND request_key LIKE 'chat:' || OLD.groom_id::text || ':%')
      OR
      (OLD.bride_id IS DISTINCT FROM NEW.bride_id AND OLD.bride_id IS NOT NULL
        AND request_key = 'greeting:' || OLD.bride_id::text)
      OR
      (OLD.groom_id IS DISTINCT FROM NEW.groom_id AND OLD.groom_id IS NOT NULL
        AND request_key = 'greeting:' || OLD.groom_id::text)
    );

  DELETE FROM public.amora_conflict_check_claims
  WHERE couple_id = OLD.id
    AND requester_user_id IN (OLD.bride_id, OLD.groom_id)
    AND requester_user_id IS NOT NULL
    AND requester_user_id IS DISTINCT FROM NEW.bride_id
    AND requester_user_id IS DISTINCT FROM NEW.groom_id;

  PERFORM pg_catalog.set_config(
    'hanbang.account_deletion_cleanup', v_previous_cleanup_setting, true
  );

  RETURN NEW;
END;
$purge_departed_scope$;

ALTER FUNCTION public.purge_departed_couple_private_scope()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.purge_departed_couple_private_scope()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_purge_departed_couple_private_scope
  ON public.couples;
CREATE TRIGGER trg_purge_departed_couple_private_scope
  AFTER UPDATE OF bride_id, groom_id ON public.couples
  FOR EACH ROW
  WHEN (
    OLD.bride_id IS DISTINCT FROM NEW.bride_id
    OR OLD.groom_id IS DISTINCT FROM NEW.groom_id
  )
  EXECUTE FUNCTION public.purge_departed_couple_private_scope();

-- Backfill privacy debt that can no longer be attributed to an Auth user: a
-- NULL role slot has no legitimate reader, so retaining that private scope is
-- unnecessary and risks disclosure if membership rules ever regress.
DO $purge_orphan_private_scopes$
DECLARE
  v_scope record;
BEGIN
  FOR v_scope IN
    SELECT id AS couple_id, 'bride_private'::text AS visibility
    FROM public.couples
    WHERE bride_id IS NULL
    UNION ALL
    SELECT id AS couple_id, 'groom_private'::text AS visibility
    FROM public.couples
    WHERE groom_id IS NULL
  LOOP
    PERFORM public.purge_couple_private_scope(
      NULL, v_scope.couple_id, v_scope.visibility
    );
  END LOOP;
END;
$purge_orphan_private_scopes$;

-- Do not silently merge or destroy a replacement member's data in a legacy
-- role scope. A pre-existing reassignment needs isolated-clone review because
-- role-private AI replies have no sender_id and cannot be separated safely.
DO $occupied_private_scope_conflict_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT message.couple_id, message.visibility, message.sender_id AS actor_id
      FROM public.chat_messages AS message
      WHERE message.sender_id IS NOT NULL
      UNION ALL
      SELECT summary.couple_id, summary.visibility, summary.user_id AS actor_id
      FROM public.chat_summaries AS summary
      WHERE summary.user_id IS NOT NULL
      UNION ALL
      SELECT consent.couple_id, consent.visibility, consent.user_id AS actor_id
      FROM public.amora_memory_consents AS consent
      UNION ALL
      SELECT memory_job.couple_id, memory_job.visibility, memory_job.user_id AS actor_id
      FROM public.amora_memory_jobs AS memory_job
      WHERE memory_job.user_id IS NOT NULL
      UNION ALL
      SELECT claim.couple_id, claim.visibility, claim.user_id AS actor_id
      FROM public.amora_chat_request_claims AS claim
    ) AS private_actor
    JOIN public.couples AS couple ON couple.id = private_actor.couple_id
    WHERE (private_actor.visibility = 'bride_private'
           AND couple.bride_id IS NOT NULL
           AND private_actor.actor_id IS DISTINCT FROM couple.bride_id)
       OR (private_actor.visibility = 'groom_private'
           AND couple.groom_id IS NOT NULL
           AND private_actor.actor_id IS DISTINCT FROM couple.groom_id)
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_OCCUPIED_PRIVATE_SCOPE_CONFLICT'
      USING ERRCODE = '23514',
            HINT = 'Quarantine and review reassigned role-private scopes on an isolated clone before retrying.';
  END IF;
END;
$occupied_private_scope_conflict_guard$;

-- events is intentionally append-only for every application caller. Permit
-- only the postgres-owned deletion boundary to remove rows for a privacy
-- request through a transaction-local capability that no exposed RPC sets.
CREATE OR REPLACE FUNCTION public.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $reject_event_mutation$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_user = 'postgres'
     AND coalesce(
       current_setting('hanbang.allow_event_privacy_purge', true), ''
     ) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'EVENTS_ARE_APPEND_ONLY' USING ERRCODE = '42501';
END;
$reject_event_mutation$;

ALTER FUNCTION public.reject_event_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reject_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.account_deletion_retention_block_code(
  p_user_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $retention_block_code$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'account_deletion_identity_invalid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vendors AS vendor WHERE vendor.owner_id = p_user_id
  ) THEN
    RETURN 'vendor_account_manual_review_required';
  END IF;

  -- The retired guestbook feature used two public Storage buckets. One of the
  -- legacy buckets never had a durable object-path ownership contract, so an
  -- automatic cascade could erase the database ownership proof while leaving
  -- personal photos behind (or, worse, guess at another user's object). Keep
  -- the account in manual review until an operator inventories and removes the
  -- exact guestbook media before resuming the deletion job.
  IF EXISTS (
    SELECT 1
    FROM public.guestbooks AS guestbook
    WHERE guestbook.owner_id = p_user_id
  ) THEN
    RETURN 'guestbook_media_manual_review_required';
  END IF;

  IF (
    SELECT count(*)
    FROM (
      SELECT couple.id FROM public.couples AS couple
      WHERE couple.bride_id = p_user_id
      UNION ALL
      SELECT couple.id FROM public.couples AS couple
      WHERE couple.groom_id = p_user_id
    ) AS memberships
  ) > 1 OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = p_user_id
      AND profile.couple_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.couples AS couple
        WHERE couple.id = profile.couple_id
          AND (
            (profile.role = 'bride' AND couple.bride_id = p_user_id)
            OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
          )
      )
  ) THEN
    RETURN 'couple_membership_manual_review_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT message.couple_id, message.visibility, message.sender_id AS actor_id
      FROM public.chat_messages AS message
      WHERE message.sender_id = p_user_id
      UNION ALL
      SELECT summary.couple_id, summary.visibility, summary.user_id AS actor_id
      FROM public.chat_summaries AS summary
      WHERE summary.user_id = p_user_id
      UNION ALL
      SELECT consent.couple_id, consent.visibility, consent.user_id AS actor_id
      FROM public.amora_memory_consents AS consent
      WHERE consent.user_id = p_user_id
      UNION ALL
      SELECT memory_job.couple_id, memory_job.visibility, memory_job.user_id AS actor_id
      FROM public.amora_memory_jobs AS memory_job
      WHERE memory_job.user_id = p_user_id
      UNION ALL
      SELECT claim.couple_id, claim.visibility, claim.user_id AS actor_id
      FROM public.amora_chat_request_claims AS claim
      WHERE claim.user_id = p_user_id
    ) AS private_actor
    JOIN public.couples AS couple ON couple.id = private_actor.couple_id
    WHERE (private_actor.visibility = 'bride_private'
           AND couple.bride_id IS NOT NULL
           AND couple.bride_id IS DISTINCT FROM p_user_id)
       OR (private_actor.visibility = 'groom_private'
           AND couple.groom_id IS NOT NULL
           AND couple.groom_id IS DISTINCT FROM p_user_id)
  ) THEN
    RETURN 'private_scope_owner_conflict';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vendor_alias_proposals
    WHERE reviewed_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.vendor_disclosure_bulk_approval_audits
    WHERE actor_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.official_review_events
    WHERE actor_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.price_upload_confirmations
    WHERE created_by = p_user_id OR resolved_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.price_upload_confirmation_events
    WHERE actor_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.vendor_enrichment_private
    WHERE enriched_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.vendor_dedupe_candidates
    WHERE decided_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.agency_dedupe_candidates
    WHERE decided_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.official_prices
    WHERE reviewed_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.official_agency_packages
    WHERE reviewed_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.community_agent_personas
    WHERE created_by = p_user_id OR backing_user_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.community_agent_content_drafts
    WHERE created_by = p_user_id OR posted_by = p_user_id
    UNION ALL
    SELECT 1 FROM public.vendor_bookings
    WHERE receipt_verified_by = p_user_id
  ) THEN
    RETURN 'administrator_audit_retention_review';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vendor_reviews AS review
    WHERE review.customer_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.contracts AS contract
    WHERE contract.customer_id = p_user_id
    UNION ALL
    SELECT 1 FROM public.payments AS payment
    WHERE payment.customer_id = p_user_id
    UNION ALL
    SELECT 1
    FROM public.vendor_bookings AS booking
    JOIN public.couples AS couple ON couple.id = booking.couple_id
    WHERE couple.bride_id = p_user_id OR couple.groom_id = p_user_id
  ) THEN
    RETURN 'public_or_legal_retention_review';
  END IF;

  RETURN NULL;
END;
$retention_block_code$;

ALTER FUNCTION public.account_deletion_retention_block_code(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.account_deletion_retention_block_code(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preflight_account_deletion_retention(
  p_job_id uuid,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $preflight_retention$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_block_code text;
BEGIN
  SELECT * INTO v_job
  FROM public.account_deletion_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'rejected';
  END IF;

  IF v_job.status = 'manual_review' THEN
    RETURN 'manual_review';
  END IF;

  IF v_job.status NOT IN ('inventorying', 'deleting', 'auth_deleting')
     OR v_job.claim_token IS DISTINCT FROM p_claim_token
     OR v_job.user_id IS NULL THEN
    RETURN 'rejected';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_job.user_id::text, 0)
  );
  v_block_code := public.account_deletion_retention_block_code(v_job.user_id);

  IF v_block_code IS NOT NULL THEN
    UPDATE public.account_deletion_jobs
    SET status = 'manual_review',
        claim_token = NULL,
        claimed_at = NULL,
        last_error_code = v_block_code,
        updated_at = clock_timestamp()
    WHERE id = v_job.id;
    RETURN 'manual_review';
  END IF;

  RETURN 'clear';
END;
$preflight_retention$;

ALTER FUNCTION public.preflight_account_deletion_retention(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.preflight_account_deletion_retention(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preflight_account_deletion_retention(uuid, uuid)
  TO service_role;

-- Legacy chat objects used a shared two-segment path, so their owner cannot be
-- recovered by listing `<couple>/<user>/...`. Expose only a bounded, keyset-
-- paginated owner inventory to the deletion worker. The worker routes legacy
-- paths to manual review; it never treats Storage ownership alone as authority
-- to erase content that may still be visible to the remaining partner.
CREATE OR REPLACE FUNCTION public.list_account_deletion_owned_chat_objects(
  p_user_id uuid,
  p_after_name text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(path text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '30s'
AS $owned_chat_objects$
BEGIN
  IF p_user_id IS NULL
     OR p_limit NOT BETWEEN 1 AND 100
     OR (
       p_after_name IS NOT NULL
       AND (
         char_length(p_after_name) NOT BETWEEN 1 AND 512
         OR p_after_name ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_CHAT_OWNER_INVENTORY_INVALID'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT object_record.name::text
  FROM storage.objects AS object_record
  WHERE object_record.bucket_id = 'chat-image'
    AND (
      nullif(pg_catalog.to_jsonb(object_record) ->> 'owner', '')
        = p_user_id::text
      OR nullif(pg_catalog.to_jsonb(object_record) ->> 'owner_id', '')
        = p_user_id::text
    )
    AND (p_after_name IS NULL OR object_record.name > p_after_name)
  ORDER BY object_record.name
  LIMIT p_limit;
END;
$owned_chat_objects$;

ALTER FUNCTION public.list_account_deletion_owned_chat_objects(uuid, text, integer)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.list_account_deletion_owned_chat_objects(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_account_deletion_owned_chat_objects(uuid, text, integer)
  TO service_role;

ALTER TABLE public.account_deletion_media_manifest
  DROP CONSTRAINT IF EXISTS account_deletion_media_path_shape;
ALTER TABLE public.account_deletion_media_manifest
  ADD CONSTRAINT account_deletion_media_path_shape
  CHECK (
    (
      bucket = 'chat-image'
      AND source = 'quarantine'
      AND (
        (
          char_length(path) BETWEEN 111 AND 512
          AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpeg|jpg|png|gif|webp)$'
        )
        OR (
          char_length(path) BETWEEN 60 AND 78
          AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/([0-9]{13}-[a-z0-9]{5}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpeg|jpg|png|gif|webp)$'
        )
      )
    )
    OR
    (
      bucket <> 'chat-image'
      AND char_length(path) BETWEEN 38 AND 512
      AND path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/\\[:cntrl:]]+$'
      AND split_part(path, '/', 2) NOT IN ('.', '..')
    )
  );

-- A display name is prompt context, not durable message metadata. Historical
-- assistant rows cannot always be attributed to an actor after sender_id was
-- cleared, so remove this direct identifier from every row and prevent its
-- reintroduction at the database boundary.
UPDATE public.chat_messages AS message
SET metadata = message.metadata - 'senderName'
WHERE message.metadata ? 'senderName';

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_metadata_no_sender_name;
ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_metadata_no_sender_name
  CHECK (NOT (metadata ? 'senderName'));

CREATE OR REPLACE FUNCTION public.mark_account_deletion_legacy_chat_manual_review(
  p_job_id uuid,
  p_claim_token uuid,
  p_paths text[],
  p_error_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $mark_legacy_chat_review$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_path text;
  v_quarantine_count integer;
BEGIN
  SELECT * INTO v_job
  FROM public.account_deletion_jobs AS job
  WHERE job.id = p_job_id
    AND job.status IN ('inventorying', 'deleting', 'auth_deleting')
    AND job.claim_token = p_claim_token
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.user_id IS NULL
     OR p_paths IS NULL
     OR p_error_code NOT IN (
       'chat_legacy_owner_manual_review_required',
       'chat_legacy_attachment_manual_review_required'
     )
     OR cardinality(p_paths) NOT BETWEEN 1 AND 10000
     OR cardinality(p_paths) IS DISTINCT FROM (
       SELECT count(DISTINCT candidate) FROM unnest(p_paths) AS candidate
     ) THEN
    RETURN false;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_job.user_id::text, 0)
  );

  FOREACH v_path IN ARRAY p_paths
  LOOP
    IF v_path IS NULL
       OR char_length(v_path) NOT BETWEEN 60 AND 78
       OR v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/([0-9]{13}-[a-z0-9]{5}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpeg|jpg|png|gif|webp)$'
       OR NOT EXISTS (
         SELECT 1
         FROM storage.objects AS object_record
         WHERE object_record.bucket_id = 'chat-image'
           AND object_record.name = v_path
           AND (
             nullif(pg_catalog.to_jsonb(object_record) ->> 'owner', '')
               = v_job.user_id::text
             OR nullif(pg_catalog.to_jsonb(object_record) ->> 'owner_id', '')
               = v_job.user_id::text
             OR EXISTS (
               SELECT 1
               FROM public.chat_messages AS message
               WHERE message.sender_id = v_job.user_id
                 AND message.couple_id::text = split_part(v_path, '/', 1)
                 AND (
                   (
                     pg_catalog.jsonb_typeof(message.metadata -> 'imagePaths')
                       = 'array'
                     AND (message.metadata -> 'imagePaths')
                       @> pg_catalog.to_jsonb(ARRAY[v_path]::text[])
                   )
                   OR EXISTS (
                     SELECT 1
                     FROM pg_catalog.jsonb_array_elements_text(
                       CASE
                         WHEN pg_catalog.jsonb_typeof(
                           message.metadata -> 'imageUrls'
                         ) = 'array'
                         THEN message.metadata -> 'imageUrls'
                         ELSE '[]'::jsonb
                       END
                     ) AS image_url(value)
                     WHERE right(
                       image_url.value,
                       char_length(
                         '/storage/v1/object/public/chat-image/' || v_path
                       )
                     ) = '/storage/v1/object/public/chat-image/' || v_path
                   )
                 )
             )
           )
       ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_LEGACY_CHAT_PROOF_INVALID'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO public.account_deletion_media_manifest(
      job_id, bucket, path, source, not_before
    ) VALUES (
      v_job.id, 'chat-image', v_path, 'quarantine', clock_timestamp()
    )
    ON CONFLICT (job_id, bucket, path) DO UPDATE
      SET source = 'quarantine',
          cleaned_at = NULL,
          updated_at = clock_timestamp();
  END LOOP;

  SELECT count(*)
  INTO v_quarantine_count
  FROM public.account_deletion_media_manifest AS manifest
  WHERE manifest.job_id = v_job.id
    AND manifest.source = 'quarantine';

  UPDATE public.account_deletion_jobs
  SET status = 'manual_review',
      quarantine_count = v_quarantine_count,
      claim_token = NULL,
      claimed_at = NULL,
      last_error_code = p_error_code,
      updated_at = clock_timestamp()
  WHERE id = v_job.id;

  RETURN true;
END;
$mark_legacy_chat_review$;

ALTER FUNCTION public.mark_account_deletion_legacy_chat_manual_review(uuid, uuid, text[], text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mark_account_deletion_legacy_chat_manual_review(uuid, uuid, text[], text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_account_deletion_legacy_chat_manual_review(uuid, uuid, text[], text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.block_active_account_deletion_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '10s'
AS $block_active_deletion$
DECLARE
  v_user_id uuid;
  v_row jsonb;
  v_actor_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  IF coalesce(
       current_setting('hanbang.account_deletion_cleanup', true), ''
     ) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_SCHEMA = 'public'
     AND TG_TABLE_NAME IN (
       'account_deletion_jobs', 'account_deletion_media_manifest'
     )
     AND auth.role() IS DISTINCT FROM 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Service-side deletes and Auth FK cascades only remove data. Permit them so
  -- the final Auth deletion can cascade profiles and user-owned child rows;
  -- authenticated callers remain fenced.
  IF TG_OP = 'DELETE' AND auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN OLD;
  END IF;

  IF auth.role() = 'authenticated' THEN
    v_user_id := auth.uid();
    IF v_user_id IS NOT NULL THEN
      v_actor_ids := ARRAY[v_user_id];
    END IF;
  ELSE
    v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    -- A service-written row can reference several users. Collect every actor;
    -- coalescing to the first one would let a stale second actor bypass the
    -- deletion lock (for example created_by=A, resolved_by=deleted-B).
    SELECT coalesce(array_agg(DISTINCT actor_text::uuid), ARRAY[]::uuid[])
    INTO v_actor_ids
    FROM (VALUES
      (nullif(v_row ->> 'user_id', '')),
      (nullif(v_row ->> 'author_id', '')),
      (nullif(v_row ->> 'sender_id', '')),
      (nullif(v_row ->> 'customer_id', '')),
      (nullif(v_row ->> 'created_by', '')),
      (nullif(v_row ->> 'posted_by', '')),
      (nullif(v_row ->> 'saved_by', '')),
      (nullif(v_row ->> 'owner_id', '')),
      (nullif(v_row ->> 'viewer_id', '')),
      (nullif(v_row ->> 'reporter_id', '')),
      (nullif(v_row ->> 'reported_user_id', '')),
      (nullif(v_row ->> 'backing_user_id', '')),
      (nullif(v_row ->> 'requester_user_id', '')),
      (nullif(v_row ->> 'enabled_by', '')),
      (nullif(v_row ->> 'receipt_verified_by', '')),
      (nullif(v_row ->> 'actor_id', '')),
      (nullif(v_row ->> 'reviewed_by', '')),
      (nullif(v_row ->> 'resolved_by', '')),
      (nullif(v_row ->> 'decided_by', '')),
      (nullif(v_row ->> 'enriched_by', '')),
      (nullif(v_row ->> 'bride_id', '')),
      (nullif(v_row ->> 'groom_id', '')),
      (nullif(v_row #>> '{metadata,target_author_id}', '')),
      (nullif(v_row #>> '{metadata,clearRequest,requestedBy}', '')),
      (nullif(v_row #>> '{metadata,clearRequest,respondedBy}', '')),
      (CASE
        WHEN v_row ->> 'request_key' LIKE 'chat:%'
          OR v_row ->> 'request_key' LIKE 'greeting:%'
        THEN nullif(split_part(v_row ->> 'request_key', ':', 2), '')
      END),
      (CASE
        WHEN v_row ->> 'amora_request_key' LIKE 'chat:%'
          OR v_row ->> 'amora_request_key' LIKE 'greeting:%'
        THEN nullif(split_part(v_row ->> 'amora_request_key', ':', 2), '')
      END),
      (CASE
        WHEN v_row #>> '{metadata,client_request_id}' LIKE 'chat:%'
          OR v_row #>> '{metadata,client_request_id}' LIKE 'greeting:%'
        THEN nullif(
          split_part(v_row #>> '{metadata,client_request_id}', ':', 2), ''
        )
      END),
      (CASE
        WHEN v_row #>> '{metadata,client_visible_request_id}' LIKE 'chat:%'
          OR v_row #>> '{metadata,client_visible_request_id}' LIKE 'greeting:%'
        THEN nullif(
          split_part(
            v_row #>> '{metadata,client_visible_request_id}', ':', 2
          ), ''
        )
      END),
      (CASE WHEN TG_TABLE_SCHEMA = 'public' AND TG_TABLE_NAME = 'profiles'
        THEN nullif(v_row ->> 'id', '') END)
    ) AS candidate(actor_text)
    WHERE actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

    -- Some service-only queues carry the affected actors only as a UUID array.
    -- Include every member so a stale enqueue cannot recreate copied private
    -- content after the account-deletion purge has swept that queue.
    IF jsonb_typeof(v_row -> 'roster_member_ids') = 'array' THEN
      SELECT v_actor_ids || coalesce(array_agg(actor_text::uuid), ARRAY[]::uuid[])
      INTO v_actor_ids
      FROM jsonb_array_elements_text(v_row -> 'roster_member_ids') AS actor(actor_text)
      WHERE actor_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    END IF;
  END IF;

  IF auth.role() = 'authenticated' AND v_user_id IS NULL THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUTH_CONTEXT_INVALID'
      USING ERRCODE = '42501';
  END IF;

  -- Deterministic lock order avoids inversions for rows that reference both
  -- members of a couple.
  FOR v_user_id IN
    SELECT DISTINCT actor_id
    FROM unnest(v_actor_ids) AS actor_id
    ORDER BY actor_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text, 0)
    );

    IF EXISTS (
      SELECT 1
      FROM public.account_deletion_jobs AS job
      WHERE job.user_id = v_user_id
        AND job.status <> 'completed'
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_MUTATION_BLOCKED'
        USING ERRCODE = '42501';
    END IF;

    -- A request can authenticate before Auth deletion, pause, and resume after
    -- the completed job has been de-identified. Do not let that stale request
    -- recreate user-linked rows merely because no active job is discoverable.
    IF NOT EXISTS (
      SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = v_user_id
    ) THEN
      RAISE EXCEPTION 'ACCOUNT_ACTOR_NOT_ACTIVE'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$block_active_deletion$;

ALTER FUNCTION public.block_active_account_deletion_mutation()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.block_active_account_deletion_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

-- Apply the deletion fence to every current public row table, including tables
-- normally written only through authenticated SECURITY DEFINER RPCs. A future
-- table must receive the same trigger and the postcondition below makes drift
-- visible in release rehearsal.
DO $install_active_deletion_mutation_fence$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT namespace_record.nspname, relation_record.relname
    FROM pg_catalog.pg_class AS relation_record
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    WHERE namespace_record.nspname = 'public'
      AND relation_record.relkind IN ('r', 'p')
    ORDER BY relation_record.oid
  LOOP
    EXECUTE pg_catalog.format(
      'DROP TRIGGER IF EXISTS trg_block_active_account_deletion_mutation ON %I.%I',
      table_record.nspname,
      table_record.relname
    );
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER trg_block_active_account_deletion_mutation '
      || 'BEFORE INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW '
      || 'EXECUTE FUNCTION public.block_active_account_deletion_mutation()',
      table_record.nspname,
      table_record.relname
    );
  END LOOP;
END;
$install_active_deletion_mutation_fence$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion_auth_delete(
  p_job_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '60s'
AS $prepare_auth$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_profile_found boolean := false;
  v_current_couple_id uuid;
  v_current_role text;
  v_membership_count integer := 0;
  v_user_email text;
  v_scope_owner_id uuid;
  v_scope record;
  v_retention_block_code text;
BEGIN
  SELECT *
  INTO v_job
  FROM public.account_deletion_jobs AS job
  WHERE job.id = p_job_id
    AND job.status IN ('deleting', 'auth_deleting')
    AND job.claim_token = p_claim_token
  FOR UPDATE;

  IF NOT FOUND
     OR v_job.quarantine_count <> 0
     OR EXISTS (
       SELECT 1 FROM public.vendors AS vendor
       WHERE vendor.owner_id = v_job.user_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.account_deletion_media_manifest AS manifest
       WHERE manifest.job_id = v_job.id
         AND (manifest.source = 'quarantine' OR manifest.cleaned_at IS NULL)
     ) THEN
    RETURN false;
  END IF;

  -- The unprefixed lock is shared with begin_account_deletion_job and every
  -- user-attributable DML trigger. It drains transactions that began before
  -- deletion intake and prevents service-client writes from committing in the
  -- final prepare-to-Auth-delete window.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_job.user_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'hanbang:couple-membership:' || v_job.user_id::text,
      0
    )
  );

  -- Repeat the non-destructive retention gate at the final boundary as a
  -- defense in depth. The worker calls the same check before touching Storage.
  v_retention_block_code :=
    public.account_deletion_retention_block_code(v_job.user_id);
  IF v_retention_block_code IS NOT NULL THEN
    UPDATE public.account_deletion_jobs
    SET status = 'manual_review',
        claim_token = NULL,
        claimed_at = NULL,
        last_error_code = v_retention_block_code,
        updated_at = clock_timestamp()
    WHERE id = v_job.id;
    RETURN false;
  END IF;

  IF v_job.private_data_purged_at IS NULL THEN
    SELECT count(*)::integer,
      (array_agg(membership.couple_id ORDER BY membership.couple_id))[1],
      (array_agg(membership.actor_role ORDER BY membership.couple_id))[1]
    INTO v_membership_count, v_current_couple_id, v_current_role
    FROM (
      SELECT couple.id AS couple_id, 'bride'::text AS actor_role
      FROM public.couples AS couple
      WHERE couple.bride_id = v_job.user_id
      UNION ALL
      SELECT couple.id AS couple_id, 'groom'::text AS actor_role
      FROM public.couples AS couple
      WHERE couple.groom_id = v_job.user_id
    ) AS membership;

    IF v_membership_count > 1 THEN
      RETURN false;
    END IF;

    SELECT profile.couple_id, profile.role
    INTO v_profile_couple_id, v_profile_role
    FROM public.profiles AS profile
    WHERE profile.id = v_job.user_id;
    v_profile_found := FOUND;

    IF v_current_couple_id IS NOT NULL THEN
      PERFORM 1
      FROM public.couples
      WHERE id = v_current_couple_id
      FOR UPDATE;

      IF v_profile_found
         AND (v_profile_couple_id IS DISTINCT FROM v_current_couple_id
              OR v_profile_role IS DISTINCT FROM v_current_role) THEN
        RETURN false;
      END IF;
    ELSIF v_profile_found AND v_profile_couple_id IS NOT NULL THEN
      RETURN false;
    END IF;
  ELSE
    v_current_couple_id := v_job.deletion_couple_id;
    v_current_role := v_job.deletion_actor_role;
  END IF;

  PERFORM pg_catalog.set_config(
    'hanbang.account_deletion_cleanup', 'on', true
  );

  -- Repeat every destructive step on every retry until Auth deletion succeeds.
  -- The active-account mutation trigger below closes ordinary writes earlier,
  -- and this idempotent sweep is the final defense against a stale session or
  -- an integration path that races the external Auth API call.
  FOR v_scope IN
      SELECT DISTINCT scope.couple_id, scope.visibility
      FROM (
        SELECT v_current_couple_id AS couple_id,
          CASE v_current_role
            WHEN 'bride' THEN 'bride_private'
            WHEN 'groom' THEN 'groom_private'
          END AS visibility
        UNION ALL
        SELECT message.couple_id, message.visibility
        FROM public.chat_messages AS message
        WHERE message.sender_id = v_job.user_id
        UNION ALL
        SELECT summary.couple_id, summary.visibility
        FROM public.chat_summaries AS summary
        WHERE summary.user_id = v_job.user_id
        UNION ALL
        SELECT consent.couple_id, consent.visibility
        FROM public.amora_memory_consents AS consent
        WHERE consent.user_id = v_job.user_id
        UNION ALL
        SELECT memory_job.couple_id, memory_job.visibility
        FROM public.amora_memory_jobs AS memory_job
        WHERE memory_job.user_id = v_job.user_id
        UNION ALL
        SELECT claim.couple_id, claim.visibility
        FROM public.amora_chat_request_claims AS claim
        WHERE claim.user_id = v_job.user_id
      ) AS scope
      WHERE scope.couple_id IS NOT NULL
        AND scope.visibility IN ('bride_private', 'groom_private')
  LOOP
    SELECT CASE v_scope.visibility
      WHEN 'bride_private' THEN couple.bride_id
      WHEN 'groom_private' THEN couple.groom_id
    END
    INTO v_scope_owner_id
    FROM public.couples AS couple
    WHERE couple.id = v_scope.couple_id
    FOR UPDATE;

    IF v_scope_owner_id IS NOT NULL
       AND v_scope_owner_id IS DISTINCT FROM v_job.user_id THEN
      UPDATE public.account_deletion_jobs
      SET status = 'manual_review',
          claim_token = NULL,
          claimed_at = NULL,
          last_error_code = 'private_scope_owner_conflict',
          updated_at = clock_timestamp()
      WHERE id = v_job.id;
      RETURN false;
    END IF;

    PERFORM public.purge_couple_private_scope(
      v_job.user_id, v_scope.couple_id, v_scope.visibility
    );
  END LOOP;

    -- These service ledgers have no Auth FK and otherwise retain UUIDs in
    -- plain or embedded-text form after account deletion.
  DELETE FROM public.amora_chat_request_claims
  WHERE user_id = v_job.user_id;

  DELETE FROM public.amora_turn_requests
  WHERE request_key LIKE 'chat:' || v_job.user_id::text || ':%'
     OR request_key = 'greeting:' || v_job.user_id::text;

  DELETE FROM public.amora_conflict_check_claims
  WHERE requester_user_id = v_job.user_id;

  DELETE FROM public.amora_tool_executions
  WHERE request_key LIKE 'chat:' || v_job.user_id::text || ':%'
     OR request_key = 'greeting:' || v_job.user_id::text;

  UPDATE public.chat_messages AS message
  SET sender_id = NULL,
      metadata = message.metadata - ARRAY['imagePaths', 'imageUrls']
  WHERE message.visibility = 'shared'
    AND message.sender_id = v_job.user_id;

  -- Shared rows are retained for the other member, but transport/idempotency
  -- metadata must not preserve a departed user's raw UUID after sender_id is
  -- cleared by Auth. Pending clear requests can no longer be fulfilled, so
  -- terminalize them while keeping only a non-identifying state marker.
  UPDATE public.chat_messages AS message
  SET sender_id = CASE
        WHEN message.sender_id = v_job.user_id THEN NULL
        ELSE message.sender_id
      END,
      metadata = jsonb_set(
        message.metadata,
        '{clearRequest}',
        jsonb_build_object(
          'type', 'shared',
          'status', CASE
            WHEN message.metadata #>> '{clearRequest,status}' = 'pending'
              THEN 'declined'
            ELSE coalesce(
              message.metadata #>> '{clearRequest,status}', 'declined'
            )
          END,
          'privacyRedacted', true
        ),
        false
      )
  WHERE message.visibility = 'shared'
    AND (
      message.metadata #>> '{clearRequest,requestedBy}' = v_job.user_id::text
      OR message.metadata #>> '{clearRequest,respondedBy}' = v_job.user_id::text
    );

  UPDATE public.chat_messages AS message
  SET metadata = message.metadata
        - ARRAY['client_request_id', 'client_visible_request_id']
  WHERE message.metadata ->> 'client_request_id'
          LIKE 'chat:' || v_job.user_id::text || ':%'
     OR message.metadata ->> 'client_request_id'
          = 'greeting:' || v_job.user_id::text
     OR message.metadata ->> 'client_visible_request_id'
          LIKE 'chat:' || v_job.user_id::text || ':%'
     OR message.metadata ->> 'client_visible_request_id'
          = 'greeting:' || v_job.user_id::text;

    -- Quote checks contain vendor names, line items, memo text and generated
    -- analysis. Raw behavioral/search events also retain session identifiers,
    -- queries and metadata after their Auth FK becomes NULL. Aggregate tables
    -- remain available; the identifiable raw rows do not.
  DELETE FROM public.amora_quote_checks
  WHERE user_id = v_job.user_id;

  DELETE FROM public.customer_events
  WHERE user_id = v_job.user_id;

  DELETE FROM public.vendor_views
  WHERE viewer_id = v_job.user_id;

  DELETE FROM public.search_logs
  WHERE user_id = v_job.user_id;

  DELETE FROM public.chat_feedback
  WHERE user_id = v_job.user_id;

  SELECT lower(btrim(email))
  INTO v_user_email
  FROM auth.users
  WHERE id = v_job.user_id;

  IF v_user_email IS NOT NULL AND v_user_email <> '' THEN
    DELETE FROM public.preregistrations
    WHERE lower(btrim(email)) = v_user_email;
  END IF;

  PERFORM pg_catalog.set_config(
    'hanbang.allow_event_privacy_purge', 'on', true
  );
  DELETE FROM public.events
  WHERE user_id = v_job.user_id;
  PERFORM pg_catalog.set_config(
    'hanbang.allow_event_privacy_purge', 'off', true
  );

    -- Keep aggregate cost/reliability evidence so every AI call remains in the
    -- mandated audit ledger, while removing prompts, outputs, tool payloads and
    -- all user/couple/request identifiers.
  UPDATE public.ai_interactions_log
  SET metadata = (metadata - ARRAY[
        'target_author_id', 'target_id', 'target_title', 'reason'
      ]) || jsonb_build_object('target_privacy_redacted', true)
  WHERE metadata ->> 'target_author_id' = v_job.user_id::text;

  UPDATE public.ai_interactions_log
  SET user_id = NULL,
        couple_id = NULL,
        session_id = NULL,
        message_id = NULL,
        user_input = NULL,
        ai_output = NULL,
        tool_input = NULL,
        tool_output = NULL,
        error_message = NULL,
        metadata = jsonb_build_object('privacy_redacted', true),
        amora_request_key = NULL,
        amora_claim_token = NULL,
        amora_global_counter_key = NULL,
        amora_cost_couple_id = NULL
  WHERE user_id = v_job.user_id;

  UPDATE public.account_deletion_jobs
  SET deletion_couple_id = v_current_couple_id,
        deletion_actor_role = v_current_role,
        private_data_purged_at = clock_timestamp(),
        status = 'auth_deleting',
        storage_verified_at = coalesce(storage_verified_at, clock_timestamp()),
        updated_at = clock_timestamp()
  WHERE id = v_job.id;

  PERFORM pg_catalog.set_config(
    'hanbang.account_deletion_cleanup', 'off', true
  );

  RETURN true;
END;
$prepare_auth$;

ALTER FUNCTION public.prepare_account_deletion_auth_delete(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.prepare_account_deletion_auth_delete(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion_auth_delete(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion_job(
  p_job_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $finalize_job$
DECLARE
  v_job public.account_deletion_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.account_deletion_jobs
  WHERE id = p_job_id
    AND status = 'auth_deleting'
    AND claim_token = p_claim_token
    AND private_data_purged_at IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_job.user_id
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.account_deletions(reason, deleted_at)
  VALUES (v_job.reason, clock_timestamp());

  DELETE FROM public.account_deletion_media_manifest WHERE job_id = p_job_id;

  UPDATE public.account_deletion_jobs
  SET user_id = NULL,
      reason = NULL,
      deletion_couple_id = NULL,
      deletion_actor_role = NULL,
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

ALTER FUNCTION public.finalize_account_deletion_job(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.finalize_account_deletion_job(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_account_deletion_job(uuid, uuid)
  TO service_role;

DO $postcondition$
DECLARE
  function_record record;
BEGIN
  FOR function_record IN
    SELECT * FROM (VALUES
      ('public.purge_couple_private_scope(uuid,uuid,text)'::regprocedure, false),
      ('public.purge_departed_couple_private_scope()'::regprocedure, false),
      ('public.account_deletion_retention_block_code(uuid)'::regprocedure, false),
      ('public.preflight_account_deletion_retention(uuid,uuid)'::regprocedure, true),
      ('public.list_account_deletion_owned_chat_objects(uuid,text,integer)'::regprocedure, true),
      ('public.mark_account_deletion_legacy_chat_manual_review(uuid,uuid,text[],text)'::regprocedure, true),
      ('public.block_active_account_deletion_mutation()'::regprocedure, false),
      ('public.prepare_account_deletion_auth_delete(uuid,uuid)'::regprocedure, true),
      ('public.finalize_account_deletion_job(uuid,uuid)'::regprocedure, true)
    ) AS expected(oid, service_allowed)
  LOOP
    IF (SELECT proowner <> 'postgres'::regrole OR NOT prosecdef
        FROM pg_catalog.pg_proc WHERE oid = function_record.oid)
       OR pg_catalog.has_function_privilege(
            'anon', function_record.oid, 'EXECUTE'
          )
       OR pg_catalog.has_function_privilege(
            'authenticated', function_record.oid, 'EXECUTE'
          )
       OR pg_catalog.has_function_privilege(
            'service_role', function_record.oid, 'EXECUTE'
          ) IS DISTINCT FROM function_record.service_allowed THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_PRIVATE_PURGE_ACL_INVALID';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.couples'::regclass
      AND tgname = 'trg_purge_departed_couple_private_scope'
      AND tgenabled = 'O'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_PRIVATE_PURGE_TRIGGER_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation_record
    JOIN pg_catalog.pg_namespace AS namespace_record
      ON namespace_record.oid = relation_record.relnamespace
    WHERE namespace_record.nspname = 'public'
      AND relation_record.relkind IN ('r', 'p')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_record
        WHERE trigger_record.tgrelid = relation_record.oid
          AND trigger_record.tgname =
            'trg_block_active_account_deletion_mutation'
          AND trigger_record.tgenabled = 'O'
          AND NOT trigger_record.tgisinternal
      )
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_MUTATION_FENCE_INCOMPLETE';
  END IF;
END;
$postcondition$;

COMMENT ON COLUMN public.account_deletion_jobs.private_data_purged_at IS
  'Durable proof that actor-private scopes and raw AI payloads were purged before Auth deletion.';
COMMENT ON FUNCTION public.purge_couple_private_scope(uuid, uuid, text) IS
  'Internal no-EXECUTE helper that removes one role-private couple scope and scrubs copied outbound-care PII.';
COMMENT ON FUNCTION public.purge_departed_couple_private_scope() IS
  'Purges the old member private scope within the same transaction as a couple roster change.';
COMMENT ON FUNCTION public.account_deletion_retention_block_code(uuid) IS
  'Internal no-EXECUTE helper that routes administrator attribution and public/legal records to manual review.';
COMMENT ON FUNCTION public.preflight_account_deletion_retention(uuid, uuid) IS
  'Service-only preflight that stops irreversible Storage deletion when retained records require manual review.';
COMMENT ON FUNCTION public.list_account_deletion_owned_chat_objects(uuid, text, integer) IS
  'Service-only bounded owner inventory for chat-image objects whose legacy path does not encode the uploader.';
COMMENT ON FUNCTION public.mark_account_deletion_legacy_chat_manual_review(uuid, uuid, text[], text) IS
  'Service-only checkpoint that proves owner-attributed or exact message-referenced legacy chat objects and records their exact paths before manual review.';
COMMENT ON FUNCTION public.block_active_account_deletion_mutation() IS
  'Global authenticated DML fence for accounts with an unfinished deletion job.';
COMMENT ON FUNCTION public.prepare_account_deletion_auth_delete(uuid, uuid) IS
  'Service-only Auth boundary: verifies external cleanup, purges actor-private data, redacts AI raw payloads, then marks auth_deleting.';

COMMIT;
