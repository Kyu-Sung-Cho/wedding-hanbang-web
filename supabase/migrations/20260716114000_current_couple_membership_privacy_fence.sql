BEGIN;

-- Fail closed on the current, bilateral couple membership.
--
-- Historical production rows can retain bride_id/groom_id values after a
-- profile moves to its canonical couple. Those stale slots must not remain an
-- authorization source. This migration:
--   1. preserves every couple and historical child row;
--   2. clears only a slot whose profile backlink is missing or different;
--   3. seals the exact last-slot clear so preserved invite codes cannot rejoin;
--   4. requires profile.couple_id + profile.role + the matching couple slot;
--   5. makes that invariant transactionally durable for future service writes.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preconditions$
BEGIN
  IF to_regclass('public.couples') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regprocedure('public.is_couple_member(uuid)') IS NULL
     OR to_regprocedure('public.can_access_couple_visibility(uuid,text)') IS NULL
     OR to_regprocedure('public.can_read_profile(uuid)') IS NULL THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_REQUIRED_OBJECT_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'trg_guard_new_couple_membership',
        'public.guard_new_couple_membership()'::text,
        'CREATE TRIGGER trg_guard_new_couple_membership BEFORE INSERT OR UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW EXECUTE FUNCTION guard_new_couple_membership()'::text
      ),
      (
        'trg_enforce_couple_roster_epoch',
        'public.enforce_couple_roster_epoch()',
        'CREATE TRIGGER trg_enforce_couple_roster_epoch BEFORE INSERT OR UPDATE ON public.couples FOR EACH ROW EXECUTE FUNCTION enforce_couple_roster_epoch()'
      ),
      (
        'trg_delete_empty_couple_after_membership_change',
        'public.delete_empty_couple_after_membership_change()',
        'CREATE TRIGGER trg_delete_empty_couple_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((new.bride_id IS NULL) AND (new.groom_id IS NULL))) EXECUTE FUNCTION delete_empty_couple_after_membership_change()'
      ),
      (
        'trg_reset_amora_memory_after_membership_change',
        'public.reset_amora_memory_after_membership_change()',
        'CREATE TRIGGER trg_reset_amora_memory_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((old.bride_id IS DISTINCT FROM new.bride_id) OR (old.groom_id IS DISTINCT FROM new.groom_id))) EXECUTE FUNCTION reset_amora_memory_after_membership_change()'
      ),
      (
        'trg_reset_amora_mediation_after_membership_change',
        'public.reset_amora_mediation_after_membership_change()',
        'CREATE TRIGGER trg_reset_amora_mediation_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((old.bride_id IS DISTINCT FROM new.bride_id) OR (old.groom_id IS DISTINCT FROM new.groom_id))) EXECUTE FUNCTION reset_amora_mediation_after_membership_change()'
      )
    ) AS required_trigger(trigger_name, function_signature, trigger_definition)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = 'public.couples'::regclass
        AND trigger_record.tgname = required_trigger.trigger_name
        AND NOT trigger_record.tgisinternal
        AND trigger_record.tgenabled IN ('O', 'A')
        AND trigger_record.tgfoid = to_regprocedure(required_trigger.function_signature)
        AND pg_get_triggerdef(trigger_record.oid, false)
          = required_trigger.trigger_definition
    )
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_REQUIRED_TRIGGER_MISSING';
  END IF;

  -- A shell that was already ownerless before this repair is not part of the
  -- bounded stale-slot transition below and must already be sealed.
  IF EXISTS (
    SELECT 1
    FROM public.couples
    WHERE bride_id IS NULL
      AND groom_id IS NULL
      AND membership_sealed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_PREEXISTING_UNSEALED_OWNERLESS_SHELL';
  END IF;
END
$preconditions$;

-- 0940 intentionally leaves a one-member roster unsealed when there is no
-- proof that two people shared it. Production has 33 such stale final slots,
-- all with reusable invite codes. Seal only the exact non-empty -> empty
-- transition. PostgreSQL runs same-kind triggers by name, so this trigger runs
-- after trg_enforce_couple_roster_epoch has accepted the slot clear and before
-- the AFTER triggers. The resulting epoch makes every preserved shell closed
-- to join_couple without weakening 0940's normal no-refill checks.
CREATE OR REPLACE FUNCTION public.seal_ownerless_couple_membership_epoch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.membership_sealed_at IS NULL
     AND (OLD.bride_id IS NOT NULL OR OLD.groom_id IS NOT NULL)
     AND NEW.bride_id IS NULL
     AND NEW.groom_id IS NULL THEN
    NEW.membership_sealed_at := transaction_timestamp();
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION public.seal_ownerless_couple_membership_epoch() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.seal_ownerless_couple_membership_epoch()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_seal_ownerless_couple_membership_epoch
  ON public.couples;
CREATE TRIGGER trg_seal_ownerless_couple_membership_epoch
  BEFORE UPDATE OF bride_id, groom_id ON public.couples
  FOR EACH ROW
  EXECUTE FUNCTION public.seal_ownerless_couple_membership_epoch();

-- Prove that the targeted slot cleanup cannot delete a historical row through
-- roster-change or empty-couple triggers. The temporary table stores counts
-- only; it contains no identifiers or customer content.
CREATE TEMP TABLE current_couple_privacy_row_counts
ON COMMIT DROP
AS
SELECT
  (SELECT count(*) FROM public.profiles) AS profiles,
  (SELECT count(*) FROM public.couples) AS couples,
  (SELECT count(*) FROM public.couples
    WHERE bride_id IS NULL AND groom_id IS NULL) AS ownerless_couples,
  (SELECT count(*) FROM public.couples
    WHERE membership_sealed_at IS NOT NULL) AS sealed_couples,
  (SELECT count(*)
    FROM public.couples AS couple
    WHERE (couple.bride_id IS NOT NULL OR couple.groom_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS bride
        WHERE bride.id = couple.bride_id AND bride.couple_id = couple.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS groom
        WHERE groom.id = couple.groom_id AND groom.couple_id = couple.id
      )) AS projected_new_ownerless_couples,
  (SELECT count(*)
    FROM public.couples AS couple
    WHERE couple.membership_sealed_at IS NULL
      AND (couple.bride_id IS NOT NULL OR couple.groom_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS bride
        WHERE bride.id = couple.bride_id AND bride.couple_id = couple.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles AS groom
        WHERE groom.id = couple.groom_id AND groom.couple_id = couple.id
      )) AS projected_new_membership_seals,
  (SELECT count(*) FROM public.chat_messages) AS chat_messages,
  (SELECT count(*) FROM public.chat_summaries) AS chat_summaries,
  (SELECT count(*) FROM public.decision_nodes) AS decision_nodes,
  (SELECT count(*) FROM public.wedding_journeys) AS wedding_journeys,
  (SELECT count(*) FROM public.ai_interactions_log) AS ai_interactions_log,
  (SELECT count(*) FROM public.amora_couple_profiles) AS amora_couple_profiles,
  (SELECT count(*) FROM public.amora_memory_settings) AS amora_memory_settings,
  (SELECT count(*) FROM public.amora_memory_consents) AS amora_memory_consents,
  (SELECT count(*) FROM public.amora_memory_jobs) AS amora_memory_jobs,
  (SELECT count(*) FROM public.amora_mediation_acceptances) AS amora_mediation_acceptances;

-- The normal product semantics intentionally reset derived memory and delete
-- an empty couple. This one-time repair must instead preserve the historical
-- shell and all children, so disable only those three known side-effect
-- triggers for the two bounded UPDATE statements. DDL is transactional: any
-- later failure rolls the trigger state and data changes back together.
ALTER TABLE public.couples
  DISABLE TRIGGER trg_delete_empty_couple_after_membership_change;
ALTER TABLE public.couples
  DISABLE TRIGGER trg_reset_amora_memory_after_membership_change;
ALTER TABLE public.couples
  DISABLE TRIGGER trg_reset_amora_mediation_after_membership_change;

UPDATE public.couples AS couple
SET bride_id = NULL
WHERE couple.bride_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = couple.bride_id
      AND profile.couple_id = couple.id
  );

UPDATE public.couples AS couple
SET groom_id = NULL
WHERE couple.groom_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.id = couple.groom_id
      AND profile.couple_id = couple.id
  );

ALTER TABLE public.couples
  ENABLE TRIGGER trg_reset_amora_mediation_after_membership_change;
ALTER TABLE public.couples
  ENABLE TRIGGER trg_reset_amora_memory_after_membership_change;
ALTER TABLE public.couples
  ENABLE TRIGGER trg_delete_empty_couple_after_membership_change;

-- Never guess a role or move a profile. A residual mismatch is ambiguous and
-- aborts the whole transaction for operator review.
DO $cleaned_state$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.couples AS couple
    LEFT JOIN public.profiles AS bride ON bride.id = couple.bride_id
    LEFT JOIN public.profiles AS groom ON groom.id = couple.groom_id
    WHERE (couple.bride_id IS NOT NULL AND bride.couple_id IS DISTINCT FROM couple.id)
       OR (couple.groom_id IS NOT NULL AND groom.couple_id IS DISTINCT FROM couple.id)
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_SLOT_BACKLINK_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couples AS couple
    JOIN public.profiles AS profile
      ON profile.id IN (couple.bride_id, couple.groom_id)
    WHERE (profile.id = couple.bride_id AND profile.role IS DISTINCT FROM 'bride')
       OR (profile.id = couple.groom_id AND profile.role IS DISTINCT FROM 'groom')
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_ROLE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    LEFT JOIN public.couples AS couple ON couple.id = profile.couple_id
    WHERE profile.couple_id IS NOT NULL
      AND NOT (
        (
          profile.role IS NOT DISTINCT FROM 'bride'
          AND couple.bride_id IS NOT DISTINCT FROM profile.id
        )
        OR (
          profile.role IS NOT DISTINCT FROM 'groom'
          AND couple.groom_id IS NOT DISTINCT FROM profile.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_PROFILE_SLOT_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couples
    WHERE bride_id IS NOT NULL AND bride_id = groom_id
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_SAME_USER_BOTH_ROLES';
  END IF;
END
$cleaned_state$;

-- Existing lookup indexes remain useful during a rolling migration. These
-- unique partial indexes add the same-role proof after stale rows are cleared.
-- The existing advisory-lock membership trigger supplies the cross-role fence.
CREATE UNIQUE INDEX IF NOT EXISTS couples_bride_id_current_unique_idx
  ON public.couples (bride_id)
  WHERE bride_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS couples_groom_id_current_unique_idx
  ON public.couples (groom_id)
  WHERE groom_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.is_current_couple_member(
  p_user_id uuid,
  p_couple_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
  SELECT p_user_id IS NOT NULL
    AND p_couple_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = p_user_id
        AND profile.couple_id = p_couple_id
        AND (
          (profile.role = 'bride' AND couple.bride_id = p_user_id)
          OR (profile.role = 'groom' AND couple.groom_id = p_user_id)
        )
    );
$function$;

ALTER FUNCTION public.is_current_couple_member(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_current_couple_member(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_couple_member(uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.is_couple_member(p_couple_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
  SELECT public.is_current_couple_member(auth.uid(), p_couple_id);
$function$;

ALTER FUNCTION public.is_couple_member(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_couple_member(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_access_couple_visibility(
  p_couple_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
  SELECT p_visibility IN ('shared', 'bride_private', 'groom_private')
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND profile.couple_id = p_couple_id
        AND (
          (
            profile.role = 'bride'
            AND couple.bride_id = profile.id
            AND p_visibility IN ('shared', 'bride_private')
          )
          OR (
            profile.role = 'groom'
            AND couple.groom_id = profile.id
            AND p_visibility IN ('shared', 'groom_private')
          )
        )
    );
$function$;

ALTER FUNCTION public.can_access_couple_visibility(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_access_couple_visibility(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_couple_visibility(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_read_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
  SELECT p_profile_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles AS me
      JOIN public.couples AS couple ON couple.id = me.couple_id
      JOIN public.profiles AS related
        ON related.id = p_profile_id
       AND related.couple_id = couple.id
      WHERE me.id = auth.uid()
        AND (
          (me.role = 'bride' AND couple.bride_id = me.id)
          OR (me.role = 'groom' AND couple.groom_id = me.id)
        )
        AND (
          (related.role = 'bride' AND couple.bride_id = related.id)
          OR (related.role = 'groom' AND couple.groom_id = related.id)
        )
    );
$function$;

ALTER FUNCTION public.can_read_profile(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_read_profile(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_profile(uuid)
  TO authenticated, service_role;

-- Storage object paths are text. Compare the first folder component to the
-- canonical UUID text without casting attacker-controlled text.
CREATE OR REPLACE FUNCTION public.is_current_couple_path_member(
  p_couple_id_text text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '5s'
AS $function$
  SELECT p_couple_id_text IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS profile
      JOIN public.couples AS couple ON couple.id = profile.couple_id
      WHERE profile.id = auth.uid()
        AND couple.id::text = lower(btrim(p_couple_id_text))
        AND (
          (profile.role = 'bride' AND couple.bride_id = profile.id)
          OR (profile.role = 'groom' AND couple.groom_id = profile.id)
        )
    );
$function$;

ALTER FUNCTION public.is_current_couple_path_member(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_current_couple_path_member(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_couple_path_member(text)
  TO authenticated, service_role;

-- Enforce the bilateral invariant at transaction end so atomic create/join,
-- reset, and account-deletion flows may update the two tables in either order
-- while no committed half-membership can survive.
CREATE OR REPLACE FUNCTION public.enforce_current_couple_membership_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '15s'
AS $function$
DECLARE
  v_user_id uuid;
  v_couple_id uuid;
  v_profile_couple_id uuid;
  v_profile_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_slot_count integer;
BEGIN
  IF TG_TABLE_NAME = 'profiles' THEN
    v_user_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;

    -- A deferred trigger retains the row image from the statement that queued
    -- it. Re-read the committed-candidate row so an atomic NULL -> linked
    -- profile transition is judged by its final transaction state.
    SELECT profile.couple_id, profile.role
      INTO v_profile_couple_id, v_profile_role
    FROM public.profiles AS profile
    WHERE profile.id = v_user_id;

    IF NOT FOUND THEN
      IF EXISTS (
        SELECT 1 FROM public.couples AS couple
        WHERE couple.bride_id = v_user_id OR couple.groom_id = v_user_id
      ) THEN
        RAISE EXCEPTION 'CURRENT_COUPLE_PROFILE_DELETE_WITH_SLOT'
          USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
      END IF;
      RETURN NULL;
    END IF;

    IF v_profile_couple_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.couples AS couple
        WHERE couple.bride_id = v_user_id OR couple.groom_id = v_user_id
      ) THEN
        RAISE EXCEPTION 'CURRENT_COUPLE_UNLINKED_PROFILE_HAS_SLOT'
          USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
      END IF;
    ELSIF NOT public.is_current_couple_member(v_user_id, v_profile_couple_id) THEN
      RAISE EXCEPTION 'CURRENT_COUPLE_PROFILE_SLOT_MISMATCH'
        USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
    END IF;

    SELECT count(*)::integer
      INTO v_slot_count
    FROM (
      SELECT couple.id FROM public.couples AS couple WHERE couple.bride_id = v_user_id
      UNION ALL
      SELECT couple.id FROM public.couples AS couple WHERE couple.groom_id = v_user_id
    ) AS occurrence;

    IF (v_profile_couple_id IS NULL AND v_slot_count > 0)
       OR (v_profile_couple_id IS NOT NULL AND v_slot_count > 1) THEN
      RAISE EXCEPTION 'CURRENT_COUPLE_USER_MULTIPLE_SLOTS'
        USING ERRCODE = '23505', CONSTRAINT = 'current_couple_membership_integrity';
    END IF;

    RETURN NULL;
  END IF;

  v_couple_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  SELECT couple.bride_id, couple.groom_id
    INTO v_bride_id, v_groom_id
  FROM public.couples AS couple
  WHERE couple.id = v_couple_id;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles AS profile
      WHERE profile.couple_id = v_couple_id
    ) THEN
      RAISE EXCEPTION 'CURRENT_COUPLE_DELETE_WITH_PROFILE'
        USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
    END IF;
    RETURN NULL;
  END IF;

  IF v_bride_id IS NOT NULL AND v_bride_id = v_groom_id THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_SAME_USER_BOTH_ROLES'
      USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
  END IF;

  IF v_bride_id IS NOT NULL
     AND NOT public.is_current_couple_member(v_bride_id, v_couple_id) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_BRIDE_BACKLINK_MISMATCH'
      USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
  END IF;
  IF v_groom_id IS NOT NULL
     AND NOT public.is_current_couple_member(v_groom_id, v_couple_id) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_GROOM_BACKLINK_MISMATCH'
      USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    WHERE profile.couple_id = v_couple_id
      AND NOT (
        (
          profile.role IS NOT DISTINCT FROM 'bride'
          AND v_bride_id IS NOT DISTINCT FROM profile.id
        )
        OR (
          profile.role IS NOT DISTINCT FROM 'groom'
          AND v_groom_id IS NOT DISTINCT FROM profile.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PROFILE_BACKLINK_MISMATCH'
      USING ERRCODE = '23514', CONSTRAINT = 'current_couple_membership_integrity';
  END IF;

  RETURN NULL;
END
$function$;

ALTER FUNCTION public.enforce_current_couple_membership_integrity() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_current_couple_membership_integrity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_current_couple_profile_integrity ON public.profiles;
CREATE CONSTRAINT TRIGGER trg_current_couple_profile_integrity
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_current_couple_membership_integrity();

DROP TRIGGER IF EXISTS trg_current_couple_row_integrity ON public.couples;
CREATE CONSTRAINT TRIGGER trg_current_couple_row_integrity
  AFTER INSERT OR UPDATE OR DELETE ON public.couples
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_current_couple_membership_integrity();

-- Replace every current authenticated policy that used a couple slot directly.
DROP POLICY IF EXISTS couples_select_own ON public.couples;
DROP POLICY IF EXISTS couples_insert_own ON public.couples;
DROP POLICY IF EXISTS couples_update_own ON public.couples;
DROP POLICY IF EXISTS couples_select_by_code ON public.couples;
CREATE POLICY couples_select_own ON public.couples
  FOR SELECT TO authenticated
  USING (public.is_couple_member(id));

DROP POLICY IF EXISTS profiles_select_related ON public.profiles;
DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
DROP POLICY IF EXISTS profiles_select_safe_related ON public.profiles;
DROP POLICY IF EXISTS profiles_select_couple ON public.profiles;
CREATE POLICY profiles_select_safe_related ON public.profiles
  FOR SELECT TO authenticated
  USING (public.can_read_profile(id));

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS journeys_select_couple ON public.wedding_journeys;
DROP POLICY IF EXISTS journeys_insert_couple ON public.wedding_journeys;
DROP POLICY IF EXISTS journeys_update_couple ON public.wedding_journeys;
CREATE POLICY journeys_select_couple ON public.wedding_journeys
  FOR SELECT TO authenticated
  USING (public.is_couple_member(couple_id));
CREATE POLICY journeys_insert_couple ON public.wedding_journeys
  FOR INSERT TO authenticated
  WITH CHECK (public.is_couple_member(couple_id));
CREATE POLICY journeys_update_couple ON public.wedding_journeys
  FOR UPDATE TO authenticated
  USING (public.is_couple_member(couple_id))
  WITH CHECK (public.is_couple_member(couple_id));

DROP POLICY IF EXISTS "chat_select_couple" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_select_with_privacy" ON public.chat_messages;
DROP POLICY IF EXISTS "couple_members_can_view_messages" ON public.chat_messages;
CREATE POLICY chat_select_with_privacy ON public.chat_messages
  FOR SELECT TO authenticated
  USING (public.can_access_couple_visibility(couple_id, visibility));

DROP POLICY IF EXISTS "Allow AI message insert" ON public.chat_messages;
DROP POLICY IF EXISTS chat_insert_couple ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_insert_messages ON public.chat_messages;
DROP POLICY IF EXISTS couple_members_can_delete_messages ON public.chat_messages;
DROP POLICY IF EXISTS chat_messages_insert_own_user ON public.chat_messages;
CREATE POLICY chat_messages_insert_own_user ON public.chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND role = 'user'
    AND sender_type IN ('bride', 'groom')
    AND sender_role IS NULL
    AND specialist_type IS NULL
    AND (stage_tag IS NULL OR stage_tag IN (
      'planning_0', 'preparation_1', 'execution_2', 'ceremony_3', 'settlement_4'
    ))
    AND char_length(content) BETWEEN 1 AND 20000
    AND btrim(content) <> ''
    AND created_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
    AND (
      (sender_type = 'bride'
        AND public.can_access_couple_visibility(couple_id, 'bride_private'))
      OR (sender_type = 'groom'
        AND public.can_access_couple_visibility(couple_id, 'groom_private'))
    )
    AND public.can_access_couple_visibility(couple_id, visibility)
    AND (
      metadata IS NULL
      OR (
        jsonb_typeof(metadata) = 'object'
        AND metadata - ARRAY['target', 'imagePaths']::text[] = '{}'::jsonb
        AND (NOT metadata ? 'target' OR metadata->>'target' = 'partner')
        AND (
          NOT metadata ? 'imagePaths'
          OR (
            jsonb_typeof(metadata->'imagePaths') = 'array'
            AND jsonb_array_length(metadata->'imagePaths') <= 5
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(metadata->'imagePaths') AS image_path(value)
              WHERE jsonb_typeof(image_path.value) <> 'string'
                 OR char_length(image_path.value #>> '{}') NOT BETWEEN 1 AND 512
                 OR image_path.value #>> '{}' NOT LIKE chat_messages.couple_id::text || '/%'
                 OR image_path.value #>> '{}' LIKE '%..%'
            )
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS chat_summaries_select_couple ON public.chat_summaries;
DROP POLICY IF EXISTS chat_summaries_select_with_privacy ON public.chat_summaries;
CREATE POLICY chat_summaries_select_with_privacy ON public.chat_summaries
  FOR SELECT TO authenticated
  USING (public.can_access_couple_visibility(couple_id, visibility));

DROP POLICY IF EXISTS decision_nodes_owner_all ON public.decision_nodes;
DROP POLICY IF EXISTS decision_nodes_select ON public.decision_nodes;
DROP POLICY IF EXISTS decision_select_couple ON public.decision_nodes;
DROP POLICY IF EXISTS couple_members_can_view_decisions ON public.decision_nodes;
DROP POLICY IF EXISTS decisions_select_couple ON public.decision_nodes;
DROP POLICY IF EXISTS decision_nodes_select_with_privacy ON public.decision_nodes;
CREATE POLICY decision_nodes_select_with_privacy ON public.decision_nodes
  FOR SELECT TO authenticated
  USING (public.can_access_couple_visibility(couple_id, visibility));

-- Optional product surfaces are present in production but kept conditional so
-- a restored/minimal validation database can run the same migration safely.
DO $optional_policies$
BEGIN
  IF to_regclass('public.amora_memory_settings') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS amora_memory_settings_select_with_privacy ON public.amora_memory_settings';
    EXECUTE $policy$CREATE POLICY amora_memory_settings_select_with_privacy
      ON public.amora_memory_settings FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility))$policy$;
  END IF;

  IF to_regclass('public.amora_memory_consents') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS amora_memory_consents_select_with_privacy ON public.amora_memory_consents';
    EXECUTE $policy$CREATE POLICY amora_memory_consents_select_with_privacy
      ON public.amora_memory_consents FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility))$policy$;
  END IF;

  IF to_regclass('public.amora_couple_profiles') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "amora_couple_profiles_select_with_privacy" ON public.amora_couple_profiles';
    EXECUTE $policy$CREATE POLICY amora_couple_profiles_select_with_privacy
      ON public.amora_couple_profiles FOR SELECT TO authenticated
      USING (public.can_access_couple_visibility(couple_id, visibility))$policy$;
  END IF;

  IF to_regclass('public.decision_edges') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "decision_edges_owner_all" ON public.decision_edges';
    EXECUTE $policy$CREATE POLICY decision_edges_owner_all
      ON public.decision_edges FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
  END IF;

  IF to_regclass('public.customer_insights') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "Couple members can insert their insights" ON public.customer_insights';
    EXECUTE 'DROP POLICY IF EXISTS "Couple members can read their insights" ON public.customer_insights';
    EXECUTE 'DROP POLICY IF EXISTS "Couple members can update their insights" ON public.customer_insights';
    EXECUTE $policy$CREATE POLICY "Couple members can insert their insights"
      ON public.customer_insights FOR INSERT TO authenticated
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
    EXECUTE $policy$CREATE POLICY "Couple members can read their insights"
      ON public.customer_insights FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id))$policy$;
    EXECUTE $policy$CREATE POLICY "Couple members can update their insights"
      ON public.customer_insights FOR UPDATE TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
  END IF;

  IF to_regclass('public.fitting_usage') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "couple_can_insert_usage" ON public.fitting_usage';
    EXECUTE 'DROP POLICY IF EXISTS "couple_can_update_usage" ON public.fitting_usage';
    EXECUTE 'DROP POLICY IF EXISTS "couple_can_view_usage" ON public.fitting_usage';
    EXECUTE $policy$CREATE POLICY couple_can_insert_usage
      ON public.fitting_usage FOR INSERT TO authenticated
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
    EXECUTE $policy$CREATE POLICY couple_can_update_usage
      ON public.fitting_usage FOR UPDATE TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
    EXECUTE $policy$CREATE POLICY couple_can_view_usage
      ON public.fitting_usage FOR SELECT TO authenticated
      USING (public.is_couple_member(couple_id))$policy$;
  END IF;

  IF to_regclass('public.invitations') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "invitations_owner" ON public.invitations';
    EXECUTE $policy$CREATE POLICY invitations_owner
      ON public.invitations FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
  END IF;

  IF to_regclass('public.invitation_photos') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "photos_owner" ON public.invitation_photos';
    EXECUTE $policy$CREATE POLICY photos_owner
      ON public.invitation_photos FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_photos.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_photos.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))$policy$;
  END IF;

  IF to_regclass('public.invitation_accounts') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "accounts_owner" ON public.invitation_accounts';
    EXECUTE $policy$CREATE POLICY accounts_owner
      ON public.invitation_accounts FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_accounts.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_accounts.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))$policy$;
  END IF;

  IF to_regclass('public.invitation_rsvp') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "rsvp_owner_select" ON public.invitation_rsvp';
    EXECUTE $policy$CREATE POLICY rsvp_owner_select
      ON public.invitation_rsvp FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_rsvp.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))$policy$;
  END IF;

  IF to_regclass('public.invitation_guestbook') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "guestbook_owner_manage" ON public.invitation_guestbook';
    EXECUTE 'DROP POLICY IF EXISTS "guestbook_owner_delete" ON public.invitation_guestbook';
    EXECUTE $policy$CREATE POLICY guestbook_owner_manage
      ON public.invitation_guestbook FOR UPDATE TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_guestbook.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_guestbook.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))$policy$;
    EXECUTE $policy$CREATE POLICY guestbook_owner_delete
      ON public.invitation_guestbook FOR DELETE TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_guestbook.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))$policy$;
  END IF;

  IF to_regclass('public.invitation_visits') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "visits_owner_select" ON public.invitation_visits';
    EXECUTE $policy$CREATE POLICY visits_owner_select
      ON public.invitation_visits FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.invitations AS invitation
        WHERE invitation.id = invitation_visits.invitation_id
          AND public.is_couple_member(invitation.couple_id)
      ))$policy$;
  END IF;

  IF to_regclass('public.congratulatory_money') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "money_owner" ON public.congratulatory_money';
    EXECUTE $policy$CREATE POLICY money_owner
      ON public.congratulatory_money FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
  END IF;

  IF to_regclass('public.ai_scripts') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "scripts_owner" ON public.ai_scripts';
    EXECUTE $policy$CREATE POLICY scripts_owner
      ON public.ai_scripts FOR ALL TO authenticated
      USING (public.is_couple_member(couple_id))
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
  END IF;

  IF to_regclass('public.vendor_bookings') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "vendor_bookings_select" ON public.vendor_bookings';
    EXECUTE 'DROP POLICY IF EXISTS "vendor_bookings_insert" ON public.vendor_bookings';
    EXECUTE 'DROP POLICY IF EXISTS "vendor_bookings_update" ON public.vendor_bookings';
    EXECUTE $policy$CREATE POLICY vendor_bookings_select
      ON public.vendor_bookings FOR SELECT TO authenticated
      USING (
        public.is_couple_member(couple_id)
        OR EXISTS (
          SELECT 1 FROM public.vendors AS vendor
          WHERE vendor.id = vendor_bookings.vendor_id
            AND vendor.owner_id = auth.uid()
        )
      )$policy$;
    EXECUTE $policy$CREATE POLICY vendor_bookings_insert
      ON public.vendor_bookings FOR INSERT TO authenticated
      WITH CHECK (public.is_couple_member(couple_id))$policy$;
    EXECUTE $policy$CREATE POLICY vendor_bookings_update
      ON public.vendor_bookings FOR UPDATE TO authenticated
      USING (
        public.is_couple_member(couple_id)
        OR EXISTS (
          SELECT 1 FROM public.vendors AS vendor
          WHERE vendor.id = vendor_bookings.vendor_id
            AND vendor.owner_id = auth.uid()
        )
      )
      WITH CHECK (
        public.is_couple_member(couple_id)
        OR EXISTS (
          SELECT 1 FROM public.vendors AS vendor
          WHERE vendor.id = vendor_bookings.vendor_id
            AND vendor.owner_id = auth.uid()
        )
      )$policy$;
  END IF;

  IF to_regclass('public.contracts') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "고객: 본인 계약 조회" ON public.contracts';
    EXECUTE $policy$CREATE POLICY "고객: 본인 계약 조회"
      ON public.contracts FOR SELECT TO authenticated
      -- contracts.customer_id is an auth user id, not a couple id. Passing it
      -- to is_couple_member(uuid) can disclose a row if a user UUID happens to
      -- equal a current couple UUID. Keep this legacy surface fail-closed and
      -- self-only until it has an explicit couple_id column and migration.
      USING (customer_id = auth.uid())$policy$;
  END IF;

  -- Hosted Supabase owns storage.objects as supabase_storage_admin. Its policy
  -- contract is a separately inventoried Dashboard platform operation and must
  -- never be changed by this automatic public-schema migration. During the
  -- mixed-client window the existing, exact legacy INSERT policy remains for
  -- cached clients; UPDATE and DELETE are removed by the Storage operation.
END
$optional_policies$;

DO $postconditions$
DECLARE
  before_counts current_couple_privacy_row_counts%ROWTYPE;
  v_ownerless_couple_id uuid;
BEGIN
  SELECT * INTO before_counts FROM current_couple_privacy_row_counts;

  IF before_counts.profiles <> (SELECT count(*) FROM public.profiles)
     OR before_counts.couples <> (SELECT count(*) FROM public.couples)
     OR before_counts.chat_messages <> (SELECT count(*) FROM public.chat_messages)
     OR before_counts.chat_summaries <> (SELECT count(*) FROM public.chat_summaries)
     OR before_counts.decision_nodes <> (SELECT count(*) FROM public.decision_nodes)
     OR before_counts.wedding_journeys <> (SELECT count(*) FROM public.wedding_journeys)
     OR before_counts.ai_interactions_log <> (SELECT count(*) FROM public.ai_interactions_log)
     OR before_counts.amora_couple_profiles <> (SELECT count(*) FROM public.amora_couple_profiles)
     OR before_counts.amora_memory_settings <> (SELECT count(*) FROM public.amora_memory_settings)
     OR before_counts.amora_memory_consents <> (SELECT count(*) FROM public.amora_memory_consents)
     OR before_counts.amora_memory_jobs <> (SELECT count(*) FROM public.amora_memory_jobs)
     OR before_counts.amora_mediation_acceptances <> (SELECT count(*) FROM public.amora_mediation_acceptances) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_HISTORY_ROW_COUNT_CHANGED';
  END IF;

  IF before_counts.ownerless_couples
       + before_counts.projected_new_ownerless_couples
       <> (SELECT count(*) FROM public.couples
            WHERE bride_id IS NULL AND groom_id IS NULL)
     OR before_counts.sealed_couples
       + before_counts.projected_new_membership_seals
       <> (SELECT count(*) FROM public.couples
            WHERE membership_sealed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_OWNERLESS_SEAL_COUNT_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couples AS couple
    LEFT JOIN public.profiles AS bride ON bride.id = couple.bride_id
    LEFT JOIN public.profiles AS groom ON groom.id = couple.groom_id
    WHERE (couple.bride_id IS NOT NULL
      AND (bride.couple_id IS DISTINCT FROM couple.id OR bride.role IS DISTINCT FROM 'bride'))
       OR (couple.groom_id IS NOT NULL
      AND (groom.couple_id IS DISTINCT FROM couple.id OR groom.role IS DISTINCT FROM 'groom'))
  ) OR EXISTS (
    SELECT 1
    FROM public.profiles AS profile
    LEFT JOIN public.couples AS couple ON couple.id = profile.couple_id
    WHERE profile.couple_id IS NOT NULL
      AND NOT (
        (
          profile.role IS NOT DISTINCT FROM 'bride'
          AND couple.bride_id IS NOT DISTINCT FROM profile.id
        )
        OR (
          profile.role IS NOT DISTINCT FROM 'groom'
          AND couple.groom_id IS NOT DISTINCT FROM profile.id
        )
      )
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_BILATERAL_POSTCONDITION_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.couples
    WHERE bride_id IS NULL
      AND groom_id IS NULL
      AND membership_sealed_at IS NULL
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_OWNERLESS_SHELL_NOT_SEALED';
  END IF;

  -- Exercise the exact join write shape inside a PL/pgSQL subtransaction.
  -- The attempted mutation is rolled back by the expected 0940 exception and
  -- therefore leaves no row change, while proving a preserved invite shell
  -- cannot refill either member slot.
  SELECT id INTO v_ownerless_couple_id
  FROM public.couples
  WHERE bride_id IS NULL AND groom_id IS NULL
  ORDER BY id
  LIMIT 1;

  IF FOUND THEN
    BEGIN
      UPDATE public.couples
      SET bride_id = gen_random_uuid()
      WHERE id = v_ownerless_couple_id;

      RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_OWNERLESS_JOIN_WAS_ACCEPTED';
    EXCEPTION
      WHEN check_violation THEN
        IF SQLERRM IS DISTINCT FROM 'COUPLE_ROSTER_EPOCH_CLOSED' THEN
          RAISE;
        END IF;
    END;
  END IF;

  IF EXISTS (
    SELECT member_id
    FROM (
      SELECT bride_id AS member_id FROM public.couples WHERE bride_id IS NOT NULL
      UNION ALL
      SELECT groom_id AS member_id FROM public.couples WHERE groom_id IS NOT NULL
    ) AS membership
    GROUP BY member_id
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM public.couples
    WHERE bride_id IS NOT NULL AND bride_id = groom_id
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_MEMBERSHIP_UNIQUENESS_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_record
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_record.indrelid
     AND attribute.attnum = index_record.indkey[0]
    WHERE index_record.indexrelid = 'public.couples_bride_id_current_unique_idx'::regclass
      AND index_record.indrelid = 'public.couples'::regclass
      AND index_record.indisunique
      AND index_record.indisvalid
      AND index_record.indnkeyatts = 1
      AND attribute.attname = 'bride_id'
      AND pg_get_expr(index_record.indpred, index_record.indrelid)
        = '(bride_id IS NOT NULL)'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_index AS index_record
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = index_record.indrelid
     AND attribute.attnum = index_record.indkey[0]
    WHERE index_record.indexrelid = 'public.couples_groom_id_current_unique_idx'::regclass
      AND index_record.indrelid = 'public.couples'::regclass
      AND index_record.indisunique
      AND index_record.indisvalid
      AND index_record.indnkeyatts = 1
      AND attribute.attname = 'groom_id'
      AND pg_get_expr(index_record.indpred, index_record.indrelid)
        = '(groom_id IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_UNIQUE_INDEX_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'public.is_current_couple_member(uuid,uuid)',
        ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
        false, true
      ),
      (
        'public.is_couple_member(uuid)',
        ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
        true, true
      ),
      (
        'public.can_access_couple_visibility(uuid,text)',
        ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
        true, true
      ),
      (
        'public.can_read_profile(uuid)',
        ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
        true, true
      ),
      (
        'public.is_current_couple_path_member(text)',
        ARRAY['search_path=pg_catalog, public', 'statement_timeout=5s']::text[],
        true, true
      ),
      (
        'public.enforce_current_couple_membership_integrity()',
        ARRAY[
          'search_path=pg_catalog, public', 'lock_timeout=5s',
          'statement_timeout=15s'
        ]::text[],
        false, false
      ),
      (
        'public.seal_ownerless_couple_membership_epoch()',
        ARRAY['search_path=pg_catalog, public']::text[],
        false, false
      )
    ) AS helper(signature, expected_config, authenticated_execute, service_execute)
    LEFT JOIN pg_proc AS procedure_record
      ON procedure_record.oid = to_regprocedure(helper.signature)
    WHERE procedure_record.oid IS NULL
       OR procedure_record.prokind <> 'f'
       OR NOT procedure_record.prosecdef
       OR pg_get_userbyid(procedure_record.proowner) <> 'postgres'
       OR procedure_record.proconfig IS DISTINCT FROM helper.expected_config
       OR has_function_privilege(
            'anon', procedure_record.oid, 'EXECUTE'
          )
       OR has_function_privilege(
            'authenticated', procedure_record.oid, 'EXECUTE'
          ) IS DISTINCT FROM helper.authenticated_execute
       OR has_function_privilege(
            'service_role', procedure_record.oid, 'EXECUTE'
          ) IS DISTINCT FROM helper.service_execute
       OR EXISTS (
         SELECT 1
         FROM aclexplode(COALESCE(
           procedure_record.proacl,
           acldefault('f', procedure_record.proowner)
         )) AS acl_entry
         WHERE acl_entry.grantee = 0
           AND acl_entry.privilege_type = 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_HELPER_ACL_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE (
      'authenticated' = ANY(policy.roles)
      OR 'public' = ANY(policy.roles)
    )
      AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
        ~ '(bride_id|groom_id)'
      AND lower(COALESCE(policy.qual, '') || ' ' || COALESCE(policy.with_check, ''))
        ~ 'auth[.]uid'
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_DIRECT_SLOT_POLICY_REMAINS';
  END IF;

  IF EXISTS (
    WITH required_policy(table_name, policy_name, contract_md5) AS (VALUES
      ('chat_messages', 'chat_messages_insert_own_user', '48c182459e66881b136652eabe7ee08c'),
      ('chat_messages', 'chat_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('chat_summaries', 'chat_summaries_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('couples', 'couples_select_own', '36ee69e97368f83068ca43593527a472'),
      ('decision_nodes', 'decision_nodes_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('profiles', 'profiles_insert_own', 'bdea55417fe3838960614724cd523fe5'),
      ('profiles', 'profiles_select_safe_related', '395dd22058959cf8881abd6feb64746e'),
      ('profiles', 'profiles_update_own', '1375863c707138d0f78ec5ebff3322a2'),
      ('wedding_journeys', 'journeys_insert_couple', '0b4d8d411f50a3bb55f532785991f5fc'),
      ('wedding_journeys', 'journeys_select_couple', '91d3a3d0f1c29cbc1658641efc0c9129'),
      ('wedding_journeys', 'journeys_update_couple', 'b0faf9a8390f6406cadc6e36ed00d706')
    )
    SELECT 1
    FROM required_policy
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = required_policy.table_name
        AND policy.policyname = required_policy.policy_name
        AND policy.roles = ARRAY['authenticated']::name[]
        AND md5(concat_ws(
          chr(31), policy.cmd, array_to_string(policy.roles, ','),
          COALESCE(policy.qual, ''), COALESCE(policy.with_check, '')
        )) = required_policy.contract_md5
    )
  ) OR EXISTS (
    WITH required_policy(table_name, policy_name, contract_md5) AS (VALUES
      ('chat_messages', 'chat_messages_insert_own_user', '48c182459e66881b136652eabe7ee08c'),
      ('chat_messages', 'chat_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('chat_summaries', 'chat_summaries_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('couples', 'couples_select_own', '36ee69e97368f83068ca43593527a472'),
      ('decision_nodes', 'decision_nodes_select_with_privacy', 'fb023cd759a7743a3ce8b39622205f0d'),
      ('profiles', 'profiles_insert_own', 'bdea55417fe3838960614724cd523fe5'),
      ('profiles', 'profiles_select_safe_related', '395dd22058959cf8881abd6feb64746e'),
      ('profiles', 'profiles_update_own', '1375863c707138d0f78ec5ebff3322a2'),
      ('wedding_journeys', 'journeys_insert_couple', '0b4d8d411f50a3bb55f532785991f5fc'),
      ('wedding_journeys', 'journeys_select_couple', '91d3a3d0f1c29cbc1658641efc0c9129'),
      ('wedding_journeys', 'journeys_update_couple', 'b0faf9a8390f6406cadc6e36ed00d706')
    )
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename IN (
        'couples', 'profiles', 'wedding_journeys',
        'chat_messages', 'chat_summaries', 'decision_nodes'
      )
      AND ('authenticated' = ANY(policy.roles) OR 'public' = ANY(policy.roles))
      AND NOT EXISTS (
        SELECT 1
        FROM required_policy
        WHERE required_policy.table_name = policy.tablename
          AND required_policy.policy_name = policy.policyname
          AND required_policy.contract_md5 = md5(concat_ws(
            chr(31), policy.cmd, array_to_string(policy.roles, ','),
            COALESCE(policy.qual, ''), COALESCE(policy.with_check, '')
          ))
      )
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_UNEXPECTED_CORE_POLICY_REMAINS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      (
        'couples', 'trg_guard_new_couple_membership',
        'public.guard_new_couple_membership()',
        'CREATE TRIGGER trg_guard_new_couple_membership BEFORE INSERT OR UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW EXECUTE FUNCTION guard_new_couple_membership()',
        false
      ),
      (
        'couples', 'trg_enforce_couple_roster_epoch',
        'public.enforce_couple_roster_epoch()',
        'CREATE TRIGGER trg_enforce_couple_roster_epoch BEFORE INSERT OR UPDATE ON public.couples FOR EACH ROW EXECUTE FUNCTION enforce_couple_roster_epoch()',
        false
      ),
      (
        'couples', 'trg_delete_empty_couple_after_membership_change',
        'public.delete_empty_couple_after_membership_change()',
        'CREATE TRIGGER trg_delete_empty_couple_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((new.bride_id IS NULL) AND (new.groom_id IS NULL))) EXECUTE FUNCTION delete_empty_couple_after_membership_change()',
        false
      ),
      (
        'couples', 'trg_reset_amora_memory_after_membership_change',
        'public.reset_amora_memory_after_membership_change()',
        'CREATE TRIGGER trg_reset_amora_memory_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((old.bride_id IS DISTINCT FROM new.bride_id) OR (old.groom_id IS DISTINCT FROM new.groom_id))) EXECUTE FUNCTION reset_amora_memory_after_membership_change()',
        false
      ),
      (
        'couples', 'trg_reset_amora_mediation_after_membership_change',
        'public.reset_amora_mediation_after_membership_change()',
        'CREATE TRIGGER trg_reset_amora_mediation_after_membership_change AFTER UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW WHEN (((old.bride_id IS DISTINCT FROM new.bride_id) OR (old.groom_id IS DISTINCT FROM new.groom_id))) EXECUTE FUNCTION reset_amora_mediation_after_membership_change()',
        false
      ),
      (
        'couples', 'trg_seal_ownerless_couple_membership_epoch',
        'public.seal_ownerless_couple_membership_epoch()',
        'CREATE TRIGGER trg_seal_ownerless_couple_membership_epoch BEFORE UPDATE OF bride_id, groom_id ON public.couples FOR EACH ROW EXECUTE FUNCTION seal_ownerless_couple_membership_epoch()',
        false
      ),
      (
        'couples', 'trg_current_couple_row_integrity',
        'public.enforce_current_couple_membership_integrity()',
        'CREATE CONSTRAINT TRIGGER trg_current_couple_row_integrity AFTER INSERT OR DELETE OR UPDATE ON public.couples DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_current_couple_membership_integrity()',
        true
      ),
      (
        'profiles', 'trg_current_couple_profile_integrity',
        'public.enforce_current_couple_membership_integrity()',
        'CREATE CONSTRAINT TRIGGER trg_current_couple_profile_integrity AFTER INSERT OR DELETE OR UPDATE ON public.profiles DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_current_couple_membership_integrity()',
        true
      )
    ) AS required_trigger(
      table_name, trigger_name, function_signature, trigger_definition,
      must_be_deferred
    )
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger AS trigger_record
      WHERE trigger_record.tgrelid = format(
          'public.%I', required_trigger.table_name
        )::regclass
        AND trigger_record.tgname = required_trigger.trigger_name
        AND NOT trigger_record.tgisinternal
        AND trigger_record.tgenabled IN ('O', 'A')
        AND trigger_record.tgfoid = to_regprocedure(
          required_trigger.function_signature
        )
        AND pg_get_triggerdef(trigger_record.oid, false)
          = required_trigger.trigger_definition
        AND (
          NOT required_trigger.must_be_deferred
          OR (trigger_record.tgdeferrable AND trigger_record.tginitdeferred)
        )
    )
  ) THEN
    RAISE EXCEPTION 'CURRENT_COUPLE_PRIVACY_TRIGGER_POSTCONDITION_FAILED';
  END IF;
END
$postconditions$;

COMMENT ON FUNCTION public.is_current_couple_member(uuid, uuid) IS
  'Service-only bilateral membership proof: profile couple+role and matching couple slot must all agree.';
COMMENT ON FUNCTION public.is_couple_member(uuid) IS
  'Authenticated RLS predicate backed by current bilateral profile/slot membership.';
COMMENT ON FUNCTION public.can_access_couple_visibility(uuid, text) IS
  'Authenticated shared/private visibility predicate backed by current bilateral membership and role.';
COMMENT ON FUNCTION public.enforce_current_couple_membership_integrity() IS
  'Deferred integrity fence preventing committed profile/couple membership half-links.';
COMMENT ON FUNCTION public.seal_ownerless_couple_membership_epoch() IS
  'Seals only a non-empty to empty roster transition so preserved historical shells cannot accept an invite-code join.';

COMMIT;
