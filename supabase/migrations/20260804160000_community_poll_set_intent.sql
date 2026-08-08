-- Replace toggle-based poll voting with an actor-explicit, idempotent
-- set-intent contract. A client says what the final option state must be;
-- retries can never invert that intent.

BEGIN;

-- Freeze all three relation layers before inventorying legacy corruption. A
-- concurrent option/vote write must not slip between evidence capture, source
-- cleanup, and the composite membership constraint.
LOCK TABLE public.community_polls,
  public.community_poll_options,
  public.community_poll_votes
IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE public.community_poll_vote_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_vote_id uuid NOT NULL UNIQUE,
  source_poll_id uuid NOT NULL,
  option_id uuid NOT NULL,
  option_poll_id uuid NOT NULL,
  user_id uuid NOT NULL,
  source_created_at timestamptz NOT NULL,
  reason_code text NOT NULL CHECK (reason_code = 'poll_option_mismatch'),
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.community_poll_vote_quarantine ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_poll_vote_quarantine
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_poll_vote_quarantine TO service_role;
CREATE POLICY community_poll_vote_quarantine_service_select
  ON public.community_poll_vote_quarantine
  FOR SELECT TO service_role
  USING (true);

-- Capture the exact source row plus the option's authoritative poll before
-- deleting anything. Any inventory mismatch aborts the migration atomically.
INSERT INTO public.community_poll_vote_quarantine (
  source_vote_id,
  source_poll_id,
  option_id,
  option_poll_id,
  user_id,
  source_created_at,
  reason_code
)
SELECT
  vote.id,
  vote.poll_id,
  vote.option_id,
  option.poll_id,
  vote.user_id,
  vote.created_at,
  'poll_option_mismatch'
FROM public.community_poll_votes AS vote
JOIN public.community_poll_options AS option
  ON option.id = vote.option_id
WHERE vote.poll_id <> option.poll_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.community_poll_votes AS vote
    JOIN public.community_poll_options AS option
      ON option.id = vote.option_id
    LEFT JOIN public.community_poll_vote_quarantine AS quarantined
      ON quarantined.source_vote_id = vote.id
     AND quarantined.source_poll_id = vote.poll_id
     AND quarantined.option_id = vote.option_id
     AND quarantined.option_poll_id = option.poll_id
     AND quarantined.user_id = vote.user_id
     AND quarantined.source_created_at = vote.created_at
     AND quarantined.reason_code = 'poll_option_mismatch'
    WHERE vote.poll_id <> option.poll_id
      AND quarantined.source_vote_id IS NULL
  ) THEN
    RAISE EXCEPTION 'cross-poll vote inventory failed closed'
      USING ERRCODE = '55000';
  END IF;
END
$$;

DELETE FROM public.community_poll_votes AS vote
USING public.community_poll_options AS option,
      public.community_poll_vote_quarantine AS quarantined
WHERE option.id = vote.option_id
  AND vote.poll_id <> option.poll_id
  AND quarantined.source_vote_id = vote.id
  AND quarantined.source_poll_id = vote.poll_id
  AND quarantined.option_id = vote.option_id
  AND quarantined.option_poll_id = option.poll_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.community_poll_votes AS vote
    JOIN public.community_poll_options AS option
      ON option.id = vote.option_id
    WHERE vote.poll_id <> option.poll_id
  ) THEN
    RAISE EXCEPTION 'cross-poll vote quarantine postcondition failed'
      USING ERRCODE = '55000';
  END IF;
END
$$;

ALTER TABLE public.community_poll_options
  ADD CONSTRAINT community_poll_options_poll_id_id_key
  UNIQUE (poll_id, id);
ALTER TABLE public.community_poll_votes
  ADD CONSTRAINT community_poll_votes_poll_option_fkey
  FOREIGN KEY (poll_id, option_id)
  REFERENCES public.community_poll_options(poll_id, id)
  ON DELETE CASCADE;

ALTER TABLE public.community_polls
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.community_polls'::regclass
      AND conname = 'community_polls_version_safe_integer'
  ) THEN
    ALTER TABLE public.community_polls
      ADD CONSTRAINT community_polls_version_safe_integer
      CHECK (version BETWEEN 1 AND 9007199254740991);
  END IF;
END
$$;

-- Repair denormalized counters from the vote rows before making non-negative
-- counters a durable schema invariant.
UPDATE public.community_poll_options AS option
SET vote_count = (
  SELECT count(*)::integer
  FROM public.community_poll_votes AS vote
  WHERE vote.option_id = option.id
);

UPDATE public.community_polls AS poll
SET total_votes = (
      SELECT count(*)::integer
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = poll.id
    ),
    total_voters = (
      SELECT count(DISTINCT vote.user_id)::integer
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = poll.id
    );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.community_poll_options'::regclass
      AND conname = 'community_poll_options_vote_count_nonnegative'
  ) THEN
    ALTER TABLE public.community_poll_options
      ADD CONSTRAINT community_poll_options_vote_count_nonnegative
      CHECK (vote_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.community_polls'::regclass
      AND conname = 'community_polls_total_votes_nonnegative'
  ) THEN
    ALTER TABLE public.community_polls
      ADD CONSTRAINT community_polls_total_votes_nonnegative
      CHECK (total_votes >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.community_polls'::regclass
      AND conname = 'community_polls_total_voters_nonnegative'
  ) THEN
    ALTER TABLE public.community_polls
      ADD CONSTRAINT community_polls_total_voters_nonnegative
      CHECK (total_voters >= 0);
  END IF;
END
$$;

-- There is no defensible automatic winner for conflicting legacy intent.
-- Abort with all source rows untouched so an operator can resolve the pair
-- from product evidence rather than silently retaining an arbitrary timestamp.
DO $$
DECLARE
  v_duplicate_group_count integer;
BEGIN
  SELECT count(*)::integer
  INTO v_duplicate_group_count
  FROM (
    SELECT vote.poll_id, vote.user_id
    FROM public.community_poll_votes AS vote
    JOIN public.community_polls AS poll
      ON poll.id = vote.poll_id
    WHERE poll.allow_multiple = false
    GROUP BY vote.poll_id, vote.user_id
    HAVING count(*) > 1
  ) AS duplicate_group;

  IF v_duplicate_group_count > 0 THEN
    RAISE EXCEPTION
      'manual resolution required: % single-choice duplicate group(s)',
      v_duplicate_group_count
      USING ERRCODE = '23514';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.community_recount_poll_counters(
  p_poll_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.community_poll_options AS option
  SET vote_count = (
    SELECT count(*)::integer
    FROM public.community_poll_votes AS vote
    WHERE vote.option_id = option.id
  )
  WHERE option.poll_id = p_poll_id;

  UPDATE public.community_polls AS poll
  SET total_votes = (
        SELECT count(*)::integer
        FROM public.community_poll_votes AS vote
        WHERE vote.poll_id = p_poll_id
      ),
      total_voters = (
        SELECT count(DISTINCT vote.user_id)::integer
        FROM public.community_poll_votes AS vote
        WHERE vote.poll_id = p_poll_id
      )
  WHERE poll.id = p_poll_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.community_poll_recount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_poll_id uuid;
BEGIN
  v_poll_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.poll_id ELSE OLD.poll_id END;
  PERFORM public.community_recount_poll_counters(v_poll_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.community_recount_poll_counters(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_poll_recount()
  FROM PUBLIC, anon, authenticated, service_role;

-- Definition edits invalidate old client intents. Vote/counter changes do not
-- bump this version, so concurrent voters do not make each other stale.
CREATE OR REPLACE FUNCTION public.community_bump_poll_definition_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.allow_multiple = true
    AND NEW.allow_multiple = false
    AND EXISTS (
      SELECT 1
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = OLD.id
      GROUP BY vote.user_id
      HAVING count(*) > 1
    ) THEN
    RAISE EXCEPTION 'single-choice poll cannot retain multiple selections'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.version >= 9007199254740991 THEN
    RAISE EXCEPTION 'poll version exhausted' USING ERRCODE = '22003';
  END IF;

  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_poll_definition_version
  ON public.community_polls;
CREATE TRIGGER community_poll_definition_version
BEFORE UPDATE OF
  post_id,
  question,
  allow_multiple,
  is_anonymous,
  hide_results_until_voted,
  closes_at
ON public.community_polls
FOR EACH ROW
EXECUTE FUNCTION public.community_bump_poll_definition_version();

CREATE OR REPLACE FUNCTION public.community_touch_poll_version_from_option()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_poll_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.poll_id IS DISTINCT FROM OLD.poll_id THEN
    RAISE EXCEPTION 'poll options cannot move between polls'
      USING ERRCODE = '23514';
  END IF;

  v_poll_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.poll_id ELSE NEW.poll_id END;

  UPDATE public.community_polls
  SET version = version + 1
  WHERE id = v_poll_id
    AND version < 9007199254740991;

  IF FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.community_polls
    WHERE id = v_poll_id
  ) THEN
    RAISE EXCEPTION 'poll version exhausted' USING ERRCODE = '22003';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS community_poll_option_insert_version
  ON public.community_poll_options;
CREATE TRIGGER community_poll_option_insert_version
AFTER INSERT ON public.community_poll_options
FOR EACH ROW
EXECUTE FUNCTION public.community_touch_poll_version_from_option();

DROP TRIGGER IF EXISTS community_poll_option_delete_version
  ON public.community_poll_options;
CREATE TRIGGER community_poll_option_delete_version
AFTER DELETE ON public.community_poll_options
FOR EACH ROW
EXECUTE FUNCTION public.community_touch_poll_version_from_option();

DROP TRIGGER IF EXISTS community_poll_option_update_version
  ON public.community_poll_options;
CREATE TRIGGER community_poll_option_update_version
AFTER UPDATE OF poll_id, position, label, image_url
ON public.community_poll_options
FOR EACH ROW
EXECUTE FUNCTION public.community_touch_poll_version_from_option();

REVOKE ALL ON FUNCTION public.community_bump_poll_definition_version()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_touch_poll_version_from_option()
  FROM PUBLIC, anon, authenticated, service_role;

-- Enforce option membership and the single-choice rule below every RPC or
-- maintenance path. Locking the poll row makes competing intents serialize.
CREATE OR REPLACE FUNCTION public.community_guard_poll_vote_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allow_multiple boolean;
  v_current_vote_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_current_vote_id := OLD.id;
  END IF;

  IF NOT EXISTS (
      SELECT 1
      FROM public.community_profiles AS profile
      WHERE profile.user_id = NEW.user_id
        AND COALESCE(profile.is_suspended, false) = false
    )
    OR EXISTS (
      SELECT 1
      FROM public.community_agent_personas AS persona
      WHERE persona.backing_user_id = NEW.user_id
    ) THEN
    RAISE EXCEPTION 'actor_ineligible' USING ERRCODE = '42501';
  END IF;

  SELECT poll.allow_multiple
  INTO v_allow_multiple
  FROM public.community_polls AS poll
  WHERE poll.id = NEW.poll_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll_not_found' USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.community_poll_options AS option
    WHERE option.id = NEW.option_id
      AND option.poll_id = NEW.poll_id
  ) THEN
    RAISE EXCEPTION 'option_invalid' USING ERRCODE = '23503';
  END IF;

  IF v_allow_multiple = false
    AND EXISTS (
      SELECT 1
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = NEW.poll_id
        AND vote.user_id = NEW.user_id
        AND vote.option_id <> NEW.option_id
        AND (v_current_vote_id IS NULL OR vote.id <> v_current_vote_id)
    ) THEN
    RAISE EXCEPTION 'single_choice_violation' USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_poll_vote_invariant
  ON public.community_poll_votes;
CREATE TRIGGER community_poll_vote_invariant
BEFORE INSERT OR UPDATE OF poll_id, option_id, user_id
ON public.community_poll_votes
FOR EACH ROW
EXECUTE FUNCTION public.community_guard_poll_vote_invariant();

REVOKE ALL ON FUNCTION public.community_guard_poll_vote_invariant()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.community_poll_vote_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  poll_id uuid NOT NULL,
  option_id uuid NOT NULL,
  desired_selected boolean NOT NULL,
  expected_poll_version bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  result_digest text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT community_poll_vote_commands_actor_key_unique
    UNIQUE (actor_id, idempotency_key),
  CONSTRAINT community_poll_vote_commands_version_valid
    CHECK (expected_poll_version BETWEEN 1 AND 9007199254740991),
  CONSTRAINT community_poll_vote_commands_status_valid
    CHECK (status IN ('pending', 'completed')),
  CONSTRAINT community_poll_vote_commands_completion_valid
    CHECK (
      (status = 'pending' AND result IS NULL AND completed_at IS NULL)
      OR
      (
        status = 'completed'
        AND result IS NOT NULL
        AND result_digest IS NOT NULL
        AND completed_at IS NOT NULL
      )
    ),
  CONSTRAINT community_poll_vote_commands_result_digest_valid
    CHECK (result_digest IS NULL OR result_digest ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_community_poll_vote_commands_poll_created
  ON public.community_poll_vote_commands (poll_id, created_at DESC);

ALTER TABLE public.community_poll_vote_commands ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.community_poll_vote_commands
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_poll_vote_commands TO service_role;

CREATE OR REPLACE FUNCTION public.community_poll_vote_result_digest(
  p_result jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT encode(
    extensions.digest(convert_to(p_result::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

REVOKE ALL ON FUNCTION public.community_poll_vote_result_digest(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_complete_poll_vote_command(
  p_command_id uuid,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb := COALESCE(p_result, '{}'::jsonb);
BEGIN
  IF jsonb_typeof(v_result) IS DISTINCT FROM 'object'
     OR v_result ? 'replayed' THEN
    RAISE EXCEPTION 'poll vote command receipt is invalid'
      USING ERRCODE = '55000';
  END IF;
  UPDATE public.community_poll_vote_commands
  SET status = 'completed',
      result = v_result,
      result_digest = public.community_poll_vote_result_digest(v_result),
      completed_at = clock_timestamp()
  WHERE id = p_command_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'poll vote command cannot be completed'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.community_complete_poll_vote_command(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.community_replay_poll_vote_command_service(
  p_actor_id uuid,
  p_poll_id uuid,
  p_option_id uuid,
  p_selected boolean,
  p_expected_poll_version bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_command public.community_poll_vote_commands%ROWTYPE;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL
    OR p_poll_id IS NULL
    OR p_option_id IS NULL
    OR p_selected IS NULL
    OR p_expected_poll_version IS NULL
    OR p_idempotency_key IS NULL
    OR p_expected_poll_version NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid poll vote replay input' USING ERRCODE = '22023';
  END IF;

  SELECT command.*
  INTO v_command
  FROM public.community_poll_vote_commands AS command
  WHERE command.actor_id = p_actor_id
    AND command.idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_command.poll_id IS DISTINCT FROM p_poll_id
    OR v_command.option_id IS DISTINCT FROM p_option_id
    OR v_command.desired_selected IS DISTINCT FROM p_selected
    OR v_command.expected_poll_version IS DISTINCT FROM p_expected_poll_version THEN
    RAISE EXCEPTION 'poll vote idempotency key reused with different payload'
      USING ERRCODE = '22023';
  END IF;
  IF v_command.status <> 'completed'
    OR v_command.result IS NULL
    OR v_command.result_digest IS NULL
    OR jsonb_typeof(v_command.result) IS DISTINCT FROM 'object'
    OR v_command.result ? 'replayed' THEN
    RAISE EXCEPTION 'poll vote command receipt is unavailable'
      USING ERRCODE = '55000';
  END IF;
  IF v_command.result_digest
    <> public.community_poll_vote_result_digest(v_command.result) THEN
    RAISE EXCEPTION 'poll vote command receipt digest mismatch'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_command.result;
END;
$$;

REVOKE ALL ON FUNCTION public.community_replay_poll_vote_command_service(
  uuid, uuid, uuid, boolean, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_replay_poll_vote_command_service(
  uuid, uuid, uuid, boolean, bigint, uuid
) TO service_role;

CREATE OR REPLACE FUNCTION public.community_set_poll_vote(
  p_user_id uuid,
  p_poll_id uuid,
  p_option_id uuid,
  p_selected boolean,
  p_expected_poll_version bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_command public.community_poll_vote_commands%ROWTYPE;
  v_command_id uuid;
  v_poll public.community_polls%ROWTYPE;
  v_post record;
  v_was_selected boolean;
  v_had_other_selection boolean;
  v_action text;
  v_selected_option_ids jsonb;
  v_actual_selected boolean;
  v_option_vote_count integer;
  v_result jsonb;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL
    OR p_poll_id IS NULL
    OR p_option_id IS NULL
    OR p_selected IS NULL
    OR p_expected_poll_version IS NULL
    OR p_idempotency_key IS NULL
    OR p_expected_poll_version NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'invalid poll vote intent' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS actor WHERE actor.id = p_user_id
  ) THEN
    RAISE EXCEPTION 'invalid poll vote actor' USING ERRCODE = '22023';
  END IF;

  -- Fast replay path. FOR UPDATE also makes a concurrent replay wait for the
  -- first command transaction to publish its completed receipt.
  SELECT command.*
  INTO v_command
  FROM public.community_poll_vote_commands AS command
  WHERE command.actor_id = p_user_id
    AND command.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_command.poll_id IS DISTINCT FROM p_poll_id
      OR v_command.option_id IS DISTINCT FROM p_option_id
      OR v_command.desired_selected IS DISTINCT FROM p_selected
      OR v_command.expected_poll_version IS DISTINCT FROM p_expected_poll_version THEN
      RAISE EXCEPTION 'poll vote idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    IF v_command.status <> 'completed'
      OR v_command.result IS NULL
      OR v_command.result_digest IS NULL
      OR jsonb_typeof(v_command.result) IS DISTINCT FROM 'object'
      OR v_command.result ? 'replayed' THEN
      RAISE EXCEPTION 'poll vote command is unavailable'
        USING ERRCODE = '55000';
    END IF;
    IF v_command.result_digest
      <> public.community_poll_vote_result_digest(v_command.result) THEN
      RAISE EXCEPTION 'poll vote command receipt digest mismatch'
        USING ERRCODE = '55000';
    END IF;

    RETURN v_command.result;
  END IF;

  IF public.community_runtime_mode() <> 'normal' THEN
    RAISE EXCEPTION 'community is %', public.community_runtime_mode()
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.community_poll_vote_commands (
    actor_id,
    idempotency_key,
    poll_id,
    option_id,
    desired_selected,
    expected_poll_version
  ) VALUES (
    p_user_id,
    p_idempotency_key,
    p_poll_id,
    p_option_id,
    p_selected,
    p_expected_poll_version
  )
  ON CONFLICT (actor_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_command_id;

  IF v_command_id IS NULL THEN
    SELECT command.*
    INTO v_command
    FROM public.community_poll_vote_commands AS command
    WHERE command.actor_id = p_user_id
      AND command.idempotency_key = p_idempotency_key
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'poll vote command claim failed'
        USING ERRCODE = '55000';
    END IF;

    IF v_command.poll_id IS DISTINCT FROM p_poll_id
      OR v_command.option_id IS DISTINCT FROM p_option_id
      OR v_command.desired_selected IS DISTINCT FROM p_selected
      OR v_command.expected_poll_version IS DISTINCT FROM p_expected_poll_version THEN
      RAISE EXCEPTION 'poll vote idempotency key reused with different payload'
        USING ERRCODE = '22023';
    END IF;

    IF v_command.status <> 'completed'
      OR v_command.result IS NULL
      OR v_command.result_digest IS NULL
      OR jsonb_typeof(v_command.result) IS DISTINCT FROM 'object'
      OR v_command.result ? 'replayed' THEN
      RAISE EXCEPTION 'poll vote command is unavailable'
        USING ERRCODE = '55000';
    END IF;
    IF v_command.result_digest
      <> public.community_poll_vote_result_digest(v_command.result) THEN
      RAISE EXCEPTION 'poll vote command receipt digest mismatch'
        USING ERRCODE = '55000';
    END IF;

    RETURN v_command.result;
  END IF;

  -- New positive participation requires a current, unsuspended human member.
  -- Exact receipts returned above and negative intent (withdrawal) remain
  -- available after suspension or persona classification.
  IF p_selected
    AND (
      NOT EXISTS (
        SELECT 1
        FROM public.community_profiles AS profile
        WHERE profile.user_id = p_user_id
          AND COALESCE(profile.is_suspended, false) = false
      )
      OR EXISTS (
        SELECT 1
        FROM public.community_agent_personas AS persona
        WHERE persona.backing_user_id = p_user_id
      )
    ) THEN
    RETURN public.community_complete_poll_vote_command(
      v_command_id,
      jsonb_build_object('ok', false, 'error', 'actor_ineligible')
    );
  END IF;

  -- The poll row is the serialization point for option validation, the
  -- single-choice rule, vote mutation, and all three derived counters.
  SELECT poll.*
  INTO v_poll
  FROM public.community_polls AS poll
  WHERE poll.id = p_poll_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public.community_complete_poll_vote_command(
      v_command_id,
      jsonb_build_object('ok', false, 'error', 'poll_not_found')
    );
  END IF;

  SELECT
    post.author_id,
    post.visibility,
    COALESCE(post.under_review, false) AS under_review
  INTO v_post
  FROM public.community_posts AS post
  WHERE post.id = v_poll.post_id;

  IF NOT FOUND
    OR (v_post.under_review = true AND v_post.author_id IS DISTINCT FROM p_user_id)
    OR NOT (
      (v_post.under_review = true AND v_post.author_id = p_user_id)
      OR (v_post.under_review = false AND v_post.visibility IN ('public', 'members'))
      OR (v_post.under_review = false AND v_post.visibility = 'draft'
          AND v_post.author_id = p_user_id)
    ) THEN
    RETURN public.community_complete_poll_vote_command(
      v_command_id,
      jsonb_build_object('ok', false, 'error', 'forbidden')
    );
  END IF;

  IF v_poll.version IS DISTINCT FROM p_expected_poll_version THEN
    RETURN public.community_complete_poll_vote_command(
      v_command_id,
      jsonb_build_object(
        'ok', false,
        'error', 'poll_stale',
        'current_version', v_poll.version
      )
    );
  END IF;

  IF v_poll.closes_at IS NOT NULL
    AND v_poll.closes_at <= clock_timestamp() THEN
    RETURN public.community_complete_poll_vote_command(
      v_command_id,
      jsonb_build_object('ok', false, 'error', 'poll_closed')
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.community_poll_options AS option
    WHERE option.id = p_option_id
      AND option.poll_id = p_poll_id
  ) THEN
    RETURN public.community_complete_poll_vote_command(
      v_command_id,
      jsonb_build_object('ok', false, 'error', 'option_invalid')
    );
  END IF;

  SELECT EXISTS (
      SELECT 1
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = p_poll_id
        AND vote.option_id = p_option_id
        AND vote.user_id = p_user_id
    ),
    EXISTS (
      SELECT 1
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = p_poll_id
        AND vote.option_id <> p_option_id
        AND vote.user_id = p_user_id
    )
  INTO v_was_selected, v_had_other_selection;

  IF p_selected THEN
    IF v_poll.allow_multiple = false THEN
      DELETE FROM public.community_poll_votes
      WHERE poll_id = p_poll_id
        AND user_id = p_user_id
        AND option_id <> p_option_id;
    END IF;

    INSERT INTO public.community_poll_votes (poll_id, option_id, user_id)
    VALUES (p_poll_id, p_option_id, p_user_id)
    ON CONFLICT (option_id, user_id) DO NOTHING;

    IF v_was_selected AND NOT v_had_other_selection THEN
      v_action := 'unchanged';
    ELSIF v_had_other_selection AND v_poll.allow_multiple = false THEN
      v_action := 'switched';
    ELSE
      v_action := 'selected';
    END IF;
  ELSE
    DELETE FROM public.community_poll_votes
    WHERE poll_id = p_poll_id
      AND option_id = p_option_id
      AND user_id = p_user_id;

    v_action := CASE WHEN v_was_selected THEN 'unselected' ELSE 'unchanged' END;
  END IF;

  PERFORM public.community_recount_poll_counters(p_poll_id);

  SELECT
    COALESCE(
      jsonb_agg(vote.option_id ORDER BY option.position),
      '[]'::jsonb
    )
  INTO v_selected_option_ids
  FROM public.community_poll_votes AS vote
  JOIN public.community_poll_options AS option
    ON option.id = vote.option_id
   AND option.poll_id = vote.poll_id
  WHERE vote.poll_id = p_poll_id
    AND vote.user_id = p_user_id;

  SELECT
    EXISTS (
      SELECT 1
      FROM public.community_poll_votes AS vote
      WHERE vote.poll_id = p_poll_id
        AND vote.option_id = p_option_id
        AND vote.user_id = p_user_id
    ),
    option.vote_count
  INTO v_actual_selected, v_option_vote_count
  FROM public.community_poll_options AS option
  WHERE option.id = p_option_id
    AND option.poll_id = p_poll_id;

  SELECT poll.*
  INTO v_poll
  FROM public.community_polls AS poll
  WHERE poll.id = p_poll_id;

  v_result := jsonb_build_object(
    'ok', true,
    'action', v_action,
    'selected', v_actual_selected,
    'selected_option_ids', v_selected_option_ids,
    'poll_version', v_poll.version,
    'option_vote_count', v_option_vote_count,
    'total_votes', v_poll.total_votes,
    'total_voters', v_poll.total_voters,
    'poll', public.community_get_poll_actor_projection(p_user_id, p_poll_id)
  );

  RETURN public.community_complete_poll_vote_command(v_command_id, v_result);
END;
$$;

-- The server must obtain counters through an actor-bound projection. Returning
-- NULL (not zero) prevents hidden results from being mistaken for an empty
-- poll, while closed polls follow the existing reveal-on-close product rule.
CREATE OR REPLACE FUNCTION public.community_get_poll_actor_projection(
  p_actor_id uuid,
  p_poll_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_poll public.community_polls%ROWTYPE;
  v_post record;
  v_has_voted boolean;
  v_results_hidden boolean;
  v_selected_option_ids jsonb;
  v_options jsonb;
BEGIN
  IF NOT public.community_request_is_service() THEN
    RAISE EXCEPTION 'service role required' USING ERRCODE = '42501';
  END IF;

  IF p_poll_id IS NULL THEN
    RAISE EXCEPTION 'invalid poll projection request' USING ERRCODE = '22023';
  END IF;

  IF p_actor_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM auth.users AS actor WHERE actor.id = p_actor_id
    ) THEN
    RAISE EXCEPTION 'invalid poll projection actor' USING ERRCODE = '22023';
  END IF;

  SELECT poll.*
  INTO v_poll
  FROM public.community_polls AS poll
  WHERE poll.id = p_poll_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT
    post.author_id,
    post.visibility,
    COALESCE(post.under_review, false) AS under_review
  INTO v_post
  FROM public.community_posts AS post
  WHERE post.id = v_poll.post_id;

  IF NOT FOUND
    OR (v_post.under_review = true AND v_post.author_id IS DISTINCT FROM p_actor_id)
    OR NOT (
      (v_post.under_review = true AND v_post.author_id = p_actor_id)
      OR (v_post.under_review = false AND v_post.visibility = 'public')
      OR (
        v_post.under_review = false
        AND v_post.visibility = 'members'
        AND p_actor_id IS NOT NULL
      )
      OR (
        v_post.under_review = false
        AND v_post.visibility = 'draft'
        AND v_post.author_id = p_actor_id
      )
    ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.community_poll_votes AS vote
    WHERE vote.poll_id = p_poll_id
      AND vote.user_id = p_actor_id
  )
  INTO v_has_voted;

  v_results_hidden := v_poll.hide_results_until_voted
    AND NOT v_has_voted
    AND (
      v_poll.closes_at IS NULL
      OR v_poll.closes_at > now()
    );

  SELECT COALESCE(
    jsonb_agg(vote.option_id ORDER BY option.position),
    '[]'::jsonb
  )
  INTO v_selected_option_ids
  FROM public.community_poll_votes AS vote
  JOIN public.community_poll_options AS option
    ON option.poll_id = vote.poll_id
   AND option.id = vote.option_id
  WHERE vote.poll_id = p_poll_id
    AND vote.user_id = p_actor_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', option.id,
        'poll_id', option.poll_id,
        'position', option.position,
        'label', option.label,
        'image_url', option.image_url,
        'vote_count', CASE
          WHEN v_results_hidden THEN NULL::integer
          ELSE option.vote_count
        END
      )
      ORDER BY option.position, option.id
    ),
    '[]'::jsonb
  )
  INTO v_options
  FROM public.community_poll_options AS option
  WHERE option.poll_id = p_poll_id;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_poll.id,
    'post_id', v_poll.post_id,
    'version', v_poll.version,
    'question', v_poll.question,
    'allow_multiple', v_poll.allow_multiple,
    'is_anonymous', v_poll.is_anonymous,
    'hide_results_until_voted', v_poll.hide_results_until_voted,
    'closes_at', v_poll.closes_at,
    'total_voters', CASE
      WHEN v_results_hidden THEN NULL::integer
      ELSE v_poll.total_voters
    END,
    'total_votes', CASE
      WHEN v_results_hidden THEN NULL::integer
      ELSE v_poll.total_votes
    END,
    'created_at', v_poll.created_at,
    'results_hidden', v_results_hidden,
    'user_voted_option_ids', v_selected_option_ids,
    'options', v_options
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_get_poll_actor_projection(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_get_poll_actor_projection(uuid, uuid)
  TO service_role;

-- Authenticated clients may still read their own rows, but every mutation now
-- crosses the service-only set-intent RPC.
DROP POLICY IF EXISTS "poll_votes_insert_own" ON public.community_poll_votes;
DROP POLICY IF EXISTS "poll_votes_delete_own" ON public.community_poll_votes;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.community_poll_votes
  FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.community_poll_votes TO service_role;

-- Counter columns cannot be read around the actor projection from an
-- authenticated/anonymous PostgREST query. Non-sensitive definition columns
-- remain available under the existing row-level visibility policies.
REVOKE SELECT ON TABLE public.community_polls
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT (total_voters, total_votes)
  ON TABLE public.community_polls
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  post_id,
  version,
  question,
  allow_multiple,
  is_anonymous,
  hide_results_until_voted,
  closes_at,
  created_at
) ON public.community_polls TO anon, authenticated;

REVOKE SELECT ON TABLE public.community_poll_options
  FROM PUBLIC, anon, authenticated;
REVOKE SELECT (vote_count)
  ON TABLE public.community_poll_options
  FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  poll_id,
  position,
  label,
  image_url,
  created_at
) ON public.community_poll_options TO anon, authenticated;

REVOKE ALL ON FUNCTION public.community_cast_poll_vote(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.community_set_poll_vote(
  uuid, uuid, uuid, boolean, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_set_poll_vote(
  uuid, uuid, uuid, boolean, bigint, uuid
) TO service_role;

COMMENT ON COLUMN public.community_polls.version IS
  'Monotonic poll-definition version. Vote and counter changes do not increment it.';
COMMENT ON TABLE public.community_poll_vote_commands IS
  'Private service audit/receipt ledger for exact poll vote intents and idempotent replay.';
COMMENT ON FUNCTION public.community_set_poll_vote(
  uuid, uuid, uuid, boolean, bigint, uuid
) IS
  'Service-only actor-explicit poll vote set-intent. Serializes a poll, rejects stale definitions, and replays exact idempotent receipts.';
COMMENT ON FUNCTION public.community_get_poll_actor_projection(uuid, uuid) IS
  'Service-only actor projection that nulls protected poll counters until the actor votes or the poll closes.';

COMMIT;
