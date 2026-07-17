-- Two-sided confirmation for Amora mediation proposals. A proposal becomes a
-- durable shared decision only after every currently linked partner accepts.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.amora_mediation_acceptances (
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  proposal_resolution text NOT NULL CHECK (char_length(proposal_resolution) BETWEEN 1 AND 500),
  proposal_version uuid NOT NULL,
  proposal_roster_fingerprint text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT amora_mediation_acceptances_roster_fingerprint_check
    CHECK (proposal_roster_fingerprint ~ '^[a-f0-9]{32}$')
);

-- Earlier pre-production drafts did not bind acceptance rows to the exact
-- proposal revision and creation-time roster. Such rows are untrustworthy and
-- must not survive a clone rehearsal or retry of this unreleased migration.
ALTER TABLE public.amora_mediation_acceptances
  ADD COLUMN IF NOT EXISTS proposal_resolution text,
  ADD COLUMN IF NOT EXISTS proposal_version uuid,
  ADD COLUMN IF NOT EXISTS proposal_roster_fingerprint text;
DELETE FROM public.amora_mediation_acceptances
WHERE proposal_resolution IS NULL
   OR proposal_version IS NULL
   OR proposal_roster_fingerprint IS NULL;

DO $not_null_contracts$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.amora_mediation_acceptances'::regclass
      AND conname = 'amora_mediation_acceptances_proposal_resolution_not_null'
  ) THEN
    ALTER TABLE public.amora_mediation_acceptances
      ADD CONSTRAINT amora_mediation_acceptances_proposal_resolution_not_null
      CHECK (proposal_resolution IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.amora_mediation_acceptances'::regclass
      AND conname = 'amora_mediation_acceptances_proposal_version_not_null'
  ) THEN
    ALTER TABLE public.amora_mediation_acceptances
      ADD CONSTRAINT amora_mediation_acceptances_proposal_version_not_null
      CHECK (proposal_version IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.amora_mediation_acceptances'::regclass
      AND conname = 'amora_mediation_acceptances_roster_fingerprint_not_null'
  ) THEN
    ALTER TABLE public.amora_mediation_acceptances
      ADD CONSTRAINT amora_mediation_acceptances_roster_fingerprint_not_null
      CHECK (proposal_roster_fingerprint IS NOT NULL) NOT VALID;
  END IF;
END
$not_null_contracts$;

ALTER TABLE public.amora_mediation_acceptances
  VALIDATE CONSTRAINT amora_mediation_acceptances_proposal_resolution_not_null;
ALTER TABLE public.amora_mediation_acceptances
  VALIDATE CONSTRAINT amora_mediation_acceptances_proposal_version_not_null;
ALTER TABLE public.amora_mediation_acceptances
  VALIDATE CONSTRAINT amora_mediation_acceptances_roster_fingerprint_not_null;

ALTER TABLE public.amora_mediation_acceptances
  ALTER COLUMN proposal_resolution SET NOT NULL,
  ALTER COLUMN proposal_version SET NOT NULL,
  ALTER COLUMN proposal_roster_fingerprint SET NOT NULL;

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'amora_mediation_acceptances_proposal_resolution_check'
      AND conrelid = 'public.amora_mediation_acceptances'::regclass
  ) THEN
    ALTER TABLE public.amora_mediation_acceptances
      ADD CONSTRAINT amora_mediation_acceptances_proposal_resolution_check
      CHECK (char_length(proposal_resolution) BETWEEN 1 AND 500)
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'amora_mediation_acceptances_roster_fingerprint_check'
      AND conrelid = 'public.amora_mediation_acceptances'::regclass
  ) THEN
    ALTER TABLE public.amora_mediation_acceptances
      ADD CONSTRAINT amora_mediation_acceptances_roster_fingerprint_check
      CHECK (proposal_roster_fingerprint ~ '^[a-f0-9]{32}$')
      NOT VALID;
  END IF;
END
$block$;

ALTER TABLE public.amora_mediation_acceptances
  VALIDATE CONSTRAINT amora_mediation_acceptances_proposal_resolution_check;
ALTER TABLE public.amora_mediation_acceptances
  VALIDATE CONSTRAINT amora_mediation_acceptances_roster_fingerprint_check;

CREATE INDEX IF NOT EXISTS amora_mediation_acceptances_couple_idx
  ON public.amora_mediation_acceptances(couple_id, accepted_at DESC);

ALTER TABLE public.amora_mediation_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amora_mediation_acceptances_select_couple
  ON public.amora_mediation_acceptances;
CREATE POLICY amora_mediation_acceptances_select_couple
  ON public.amora_mediation_acceptances
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));

DROP POLICY IF EXISTS amora_mediation_acceptances_service_all
  ON public.amora_mediation_acceptances;
CREATE POLICY amora_mediation_acceptances_service_all
  ON public.amora_mediation_acceptances
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.amora_mediation_acceptances FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.amora_mediation_acceptances TO authenticated;
GRANT ALL ON TABLE public.amora_mediation_acceptances TO service_role;

-- Bind every newly persisted proposal to both the exact proposal revision and
-- the couple roster that existed in the message-creation transaction. The
-- application can keep sending the existing mediation metadata shape; these
-- two server-owned fields are added transparently and cannot be overwritten by
-- an unrelated metadata update.
CREATE OR REPLACE FUNCTION public.bind_amora_mediation_proposal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_resolution text;
  v_old_resolution text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_roster_fingerprint text;
  v_proposal_version text;
  v_old_roster_fingerprint text;
  v_old_proposal_version text;
  v_old_is_proposal boolean := false;
  v_mediation jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- PostgreSQL has already locked the chat_messages row before this row
    -- trigger runs. Acceptance RPCs deliberately take that same row lock
    -- before this advisory lock, giving every proposal mutation one global
    -- order: message row -> message advisory -> couple roster.
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('hanbang:amora-mediation:' || NEW.id::text, 0)
    );

    -- Membership UPDATEs already own a couples row before their reset trigger
    -- deletes mediation state. Lock every roster touched by this message now,
    -- before inspecting or deleting that same state, to keep the cross-table
    -- order couple -> decision/acceptance. UUID ordering also prevents two
    -- message moves between different couples from taking the rows oppositely.
    PERFORM couple.id
    FROM public.couples AS couple
    WHERE couple.id IN (OLD.couple_id, NEW.couple_id)
    ORDER BY couple.id
    FOR SHARE;

    v_old_resolution := pg_catalog.btrim(OLD.metadata #>> '{mediation,resolution}');
    v_old_roster_fingerprint := OLD.metadata #>> '{mediation,rosterFingerprint}';
    v_old_proposal_version := OLD.metadata #>> '{mediation,proposalVersion}';
    v_old_is_proposal :=
      OLD.sender_type IS NOT DISTINCT FROM 'ai'
      AND OLD.role IS NOT DISTINCT FROM 'assistant'
      AND OLD.visibility IS NOT DISTINCT FROM 'shared'
      AND jsonb_typeof(COALESCE(OLD.metadata, '{}'::jsonb)) IS NOT DISTINCT FROM 'object'
      AND v_old_resolution IS NOT NULL
      AND char_length(v_old_resolution) BETWEEN 1 AND 500;
  END IF;

  v_resolution := pg_catalog.btrim(NEW.metadata #>> '{mediation,resolution}');
  IF NEW.sender_type IS DISTINCT FROM 'ai'
     OR NEW.role IS DISTINCT FROM 'assistant'
     OR NEW.visibility IS DISTINCT FROM 'shared'
     OR jsonb_typeof(COALESCE(NEW.metadata, '{}'::jsonb)) IS DISTINCT FROM 'object'
     OR v_resolution IS NULL
     OR char_length(v_resolution) NOT BETWEEN 1 AND 500 THEN
    -- Removing or privatizing a real proposal is also a proposal revision. It
    -- must not bypass completed-decision immutability or leave pending consent
    -- rows that could later be mistaken for active consent.
    IF TG_OP = 'UPDATE' AND v_old_is_proposal THEN
      IF EXISTS (
        SELECT 1
        FROM public.decision_nodes AS node
        WHERE node.category = 'conflict_resolution'
          AND node.source = 'chat'
          AND node.source_ref_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'AMORA_MEDIATION_ALREADY_COMPLETED' USING ERRCODE = '55000';
      END IF;

      DELETE FROM public.amora_mediation_acceptances
      WHERE message_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id
     AND NEW.sender_type IS NOT DISTINCT FROM OLD.sender_type
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.visibility IS NOT DISTINCT FROM OLD.visibility
     AND (
       COALESCE(NEW.metadata -> 'mediation', '{}'::jsonb)
         - 'proposalVersion' - 'rosterFingerprint'
     ) IS NOT DISTINCT FROM (
       COALESCE(OLD.metadata -> 'mediation', '{}'::jsonb)
         - 'proposalVersion' - 'rosterFingerprint'
     )
     AND v_old_roster_fingerprint ~ '^[a-f0-9]{32}$'
     AND v_old_proposal_version ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    v_roster_fingerprint := v_old_roster_fingerprint;
    v_proposal_version := v_old_proposal_version;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      -- Once both partners have completed this message's decision, its consent
      -- object is immutable. Otherwise invalidate every pending click in the
      -- same transaction as the revision, so read paths cannot briefly treat a
      -- previous version as current when the text later changes back.
      IF EXISTS (
        SELECT 1
        FROM public.decision_nodes AS node
        WHERE node.category = 'conflict_resolution'
          AND node.source = 'chat'
          AND node.source_ref_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'AMORA_MEDIATION_ALREADY_COMPLETED' USING ERRCODE = '55000';
      END IF;

      DELETE FROM public.amora_mediation_acceptances
      WHERE message_id = NEW.id;
    END IF;

    -- Couples membership updates lock this row before their reset triggers.
    -- Taking the same row lock here makes the fingerprint match the roster at
    -- the proposal insert/revision boundary, never a stale pre-change read.
    SELECT couple.bride_id, couple.groom_id
      INTO v_bride_id, v_groom_id
    FROM public.couples AS couple
    WHERE couple.id = NEW.couple_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE = '42501';
    END IF;

    v_roster_fingerprint := pg_catalog.md5(
      COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
    );
    v_proposal_version := gen_random_uuid()::text;
  END IF;

  v_mediation := COALESCE(NEW.metadata -> 'mediation', '{}'::jsonb)
    || jsonb_build_object(
      'proposalVersion', v_proposal_version,
      'rosterFingerprint', v_roster_fingerprint
    );
  NEW.metadata := jsonb_set(
    COALESCE(NEW.metadata, '{}'::jsonb),
    '{mediation}',
    v_mediation,
    true
  );
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.bind_amora_mediation_proposal()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_bind_amora_mediation_proposal
  ON public.chat_messages;
CREATE TRIGGER trg_bind_amora_mediation_proposal
  BEFORE INSERT OR UPDATE OF couple_id, sender_type, role, visibility, metadata
  ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.bind_amora_mediation_proposal();

-- Remove the unreleased five-argument draft so a retry cannot leave an
-- unversioned acceptance path callable alongside the strict contract below.
DROP FUNCTION IF EXISTS public.accept_amora_mediation(uuid, uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.accept_amora_mediation(
  p_couple_id uuid,
  p_message_id uuid,
  p_user_id uuid,
  p_title text,
  p_resolution text,
  p_expected_proposal_version uuid,
  p_expected_roster_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_required integer;
  v_accepted integer;
  v_decision_id uuid;
  v_decision_resolution text;
  v_decision_version text;
  v_decision_roster_fingerprint text;
  v_canonical_resolution text;
  v_proposal_version_text text;
  v_proposal_version uuid;
  v_proposal_roster_fingerprint text;
  v_current_roster_fingerprint text;
  v_bride_id uuid;
  v_groom_id uuid;
BEGIN
  IF char_length(p_title) NOT BETWEEN 1 AND 80
     OR char_length(p_resolution) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_CONTENT_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Lock the canonical proposal row before the shared advisory key. A proposal
  -- UPDATE already owns this row before its binding trigger runs, so this
  -- ordering prevents a row/advisory inversion while serializing both paths.
  SELECT pg_catalog.btrim(message.metadata #>> '{mediation,resolution}'),
         message.metadata #>> '{mediation,proposalVersion}',
         message.metadata #>> '{mediation,rosterFingerprint}'
    INTO v_canonical_resolution, v_proposal_version_text,
         v_proposal_roster_fingerprint
  FROM public.chat_messages AS message
  WHERE message.id = p_message_id
    AND message.couple_id = p_couple_id
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND message.visibility = 'shared'
  FOR SHARE;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-mediation:' || p_message_id::text, 0)
  );

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND (couple.bride_id = p_user_id OR couple.groom_id = p_user_id)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  v_current_roster_fingerprint := pg_catalog.md5(
    COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
  );

  IF v_canonical_resolution IS NULL
     OR char_length(v_canonical_resolution) NOT BETWEEN 1 AND 500
     OR pg_catalog.btrim(p_resolution) IS DISTINCT FROM v_canonical_resolution THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_INVALID' USING ERRCODE = '22023';
  END IF;

  IF v_proposal_version_text IS NULL
     OR v_proposal_version_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR v_proposal_roster_fingerprint IS NULL
     OR v_proposal_roster_fingerprint !~ '^[a-f0-9]{32}$'
     OR v_proposal_roster_fingerprint IS DISTINCT FROM v_current_roster_fingerprint THEN
    -- Keep the existing application-visible conflict response while refusing
    -- proposals created for a previous couple roster or an unversioned draft.
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;
  v_proposal_version := v_proposal_version_text::uuid;

  -- Consent belongs to the exact card revision rendered to this caller. Text
  -- can change away and back, so matching resolution alone is insufficient.
  IF p_expected_proposal_version IS DISTINCT FROM v_proposal_version
     OR p_expected_roster_fingerprint IS DISTINCT FROM v_proposal_roster_fingerprint THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;

  SELECT count(DISTINCT member_id)::integer INTO v_required
  FROM public.couples AS couple
  CROSS JOIN LATERAL (VALUES (couple.bride_id), (couple.groom_id)) AS members(member_id)
  WHERE couple.id = p_couple_id
    AND member_id IS NOT NULL;

  IF v_required <> 2 THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PARTNER_REQUIRED' USING ERRCODE = '55000';
  END IF;

  -- A proposal revision is a new consent object even when its text later
  -- changes back to an earlier value. Remove every non-current revision before
  -- recording this click so an old acceptance can never become active again.
  DELETE FROM public.amora_mediation_acceptances
  WHERE couple_id = p_couple_id
    AND message_id = p_message_id
    AND (
      proposal_version IS DISTINCT FROM v_proposal_version
      OR proposal_resolution IS DISTINCT FROM v_canonical_resolution
      OR proposal_roster_fingerprint IS DISTINCT FROM v_current_roster_fingerprint
    );

  INSERT INTO public.amora_mediation_acceptances(
    couple_id, message_id, user_id, proposal_resolution, proposal_version,
    proposal_roster_fingerprint
  )
  VALUES (
    p_couple_id, p_message_id, p_user_id, v_canonical_resolution,
    v_proposal_version, v_current_roster_fingerprint
  )
  ON CONFLICT (message_id, user_id) DO UPDATE SET
    couple_id = excluded.couple_id,
    proposal_resolution = excluded.proposal_resolution,
    proposal_version = excluded.proposal_version,
    proposal_roster_fingerprint = excluded.proposal_roster_fingerprint,
    accepted_at = now();

  SELECT count(*)::integer INTO v_accepted
  FROM public.amora_mediation_acceptances AS acceptance
  JOIN public.couples AS couple ON couple.id = acceptance.couple_id
  WHERE acceptance.message_id = p_message_id
    AND acceptance.couple_id = p_couple_id
    AND acceptance.proposal_resolution = v_canonical_resolution
    AND acceptance.proposal_version = v_proposal_version
    AND acceptance.proposal_roster_fingerprint = v_current_roster_fingerprint
    AND acceptance.user_id IN (couple.bride_id, couple.groom_id);

  SELECT id, chosen_value ->> 'value', metadata ->> 'proposal_version',
         metadata ->> 'roster_fingerprint'
    INTO v_decision_id, v_decision_resolution, v_decision_version,
         v_decision_roster_fingerprint
  FROM public.decision_nodes
  WHERE couple_id = p_couple_id
    AND category = 'conflict_resolution'
    AND source = 'chat'
    AND source_ref_id = p_message_id
  LIMIT 1;

  IF v_decision_id IS NOT NULL
     AND (
       v_decision_resolution IS DISTINCT FROM v_canonical_resolution
       OR v_decision_version IS DISTINCT FROM v_proposal_version_text
       OR v_decision_roster_fingerprint IS DISTINCT FROM v_current_roster_fingerprint
     ) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_CHANGED' USING ERRCODE = '55000';
  END IF;

  IF v_accepted >= v_required AND v_required > 0 AND v_decision_id IS NULL THEN
    INSERT INTO public.decision_nodes(
      couple_id, category, decision_type, title, chosen_value, reasoning,
      confidence, source, source_ref_id, visibility, decided_at, metadata
    ) VALUES (
      p_couple_id, 'conflict_resolution', 'decided', p_title,
      jsonb_build_object('value', v_canonical_resolution),
      CASE
        WHEN v_required > 1 THEN '두 파트너가 아모라 중재안에 직접 동의함'
        ELSE '현재 연결된 사용자가 아모라 중재안에 직접 동의함'
      END,
      1.00, 'chat', p_message_id, 'shared', now(),
      jsonb_build_object(
        'confirmed_by_both', true,
        'acceptance_count', v_accepted,
        'proposal_version', v_proposal_version_text,
        'roster_fingerprint', v_current_roster_fingerprint
      )
    )
    RETURNING id INTO v_decision_id;
  END IF;

  RETURN jsonb_build_object(
    'accepted_count', v_accepted,
    'required_count', v_required,
    'completed', v_decision_id IS NOT NULL,
    'decision_node_id', v_decision_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.accept_amora_mediation(uuid, uuid, uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_amora_mediation(uuid, uuid, uuid, text, text, uuid, text)
  TO service_role;

COMMENT ON TABLE public.amora_mediation_acceptances IS
  'Per-partner acceptance of an Amora mediation proposal; never implies mutual agreement from one click.';

CREATE OR REPLACE FUNCTION public.revoke_amora_mediation_acceptance(
  p_couple_id uuid,
  p_message_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_accepted integer;
  v_deleted integer;
  v_canonical_resolution text;
  v_proposal_version_text text;
  v_proposal_version uuid;
  v_proposal_roster_fingerprint text;
  v_current_roster_fingerprint text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_decision_id uuid;
  v_proposal_found boolean;
BEGIN
  -- Keep the same row -> advisory -> roster order as proposal UPDATEs and
  -- accept_amora_mediation, avoiding a cross-path deadlock.
  SELECT pg_catalog.btrim(message.metadata #>> '{mediation,resolution}'),
         message.metadata #>> '{mediation,proposalVersion}',
         message.metadata #>> '{mediation,rosterFingerprint}'
    INTO v_canonical_resolution, v_proposal_version_text,
         v_proposal_roster_fingerprint
  FROM public.chat_messages AS message
  WHERE message.id = p_message_id
    AND message.couple_id = p_couple_id
    AND message.sender_type = 'ai'
    AND message.role = 'assistant'
    AND message.visibility = 'shared'
  FOR SHARE;
  v_proposal_found := FOUND;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-mediation:' || p_message_id::text, 0)
  );

  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = p_couple_id
    AND (couple.bride_id = p_user_id OR couple.groom_id = p_user_id)
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE = '42501';
  END IF;

  v_current_roster_fingerprint := pg_catalog.md5(
    COALESCE(v_bride_id::text, '-') || ':' || COALESCE(v_groom_id::text, '-')
  );

  IF NOT v_proposal_found THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Completion is irreversible for this message regardless of a later metadata
  -- revision. A caller may, however, remove every one of their still-pending
  -- acceptance versions even when the current proposal metadata is stale.
  SELECT node.id INTO v_decision_id
  FROM public.decision_nodes AS node
  WHERE node.couple_id = p_couple_id
    AND node.category = 'conflict_resolution'
    AND node.source = 'chat'
    AND node.source_ref_id = p_message_id
  LIMIT 1;

  IF v_decision_id IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_ALREADY_COMPLETED' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.amora_mediation_acceptances
  WHERE couple_id = p_couple_id
    AND message_id = p_message_id
    AND user_id = p_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_canonical_resolution IS NOT NULL
     AND char_length(v_canonical_resolution) BETWEEN 1 AND 500
     AND v_proposal_version_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     AND v_proposal_roster_fingerprint ~ '^[a-f0-9]{32}$'
     AND v_proposal_roster_fingerprint = v_current_roster_fingerprint THEN
    v_proposal_version := v_proposal_version_text::uuid;
    SELECT count(*)::integer INTO v_accepted
    FROM public.amora_mediation_acceptances AS acceptance
    JOIN public.couples AS couple ON couple.id = acceptance.couple_id
    WHERE acceptance.message_id = p_message_id
      AND acceptance.couple_id = p_couple_id
      AND acceptance.proposal_resolution = v_canonical_resolution
      AND acceptance.proposal_version = v_proposal_version
      AND acceptance.proposal_roster_fingerprint = v_current_roster_fingerprint
      AND acceptance.user_id IN (couple.bride_id, couple.groom_id);
  ELSE
    v_accepted := 0;
  END IF;

  RETURN jsonb_build_object(
    'revoked', v_deleted > 0,
    'accepted_count', v_accepted,
    'required_count', 2,
    'completed', false
  );
END
$function$;

REVOKE ALL ON FUNCTION public.revoke_amora_mediation_acceptance(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_amora_mediation_acceptance(uuid, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reset_amora_mediation_after_membership_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
BEGIN
  DELETE FROM public.amora_mediation_acceptances
  WHERE couple_id = NEW.id;

  DELETE FROM public.decision_nodes
  WHERE couple_id = NEW.id
    AND category = 'conflict_resolution'
    AND source = 'chat';

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.reset_amora_mediation_after_membership_change()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_reset_amora_mediation_after_membership_change
  ON public.couples;
CREATE TRIGGER trg_reset_amora_mediation_after_membership_change
  AFTER UPDATE OF bride_id, groom_id ON public.couples
  FOR EACH ROW
  WHEN (
    OLD.bride_id IS DISTINCT FROM NEW.bride_id
    OR OLD.groom_id IS DISTINCT FROM NEW.groom_id
  )
  EXECUTE FUNCTION public.reset_amora_mediation_after_membership_change();
