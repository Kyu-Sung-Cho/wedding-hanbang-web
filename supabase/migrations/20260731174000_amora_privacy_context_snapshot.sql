BEGIN;

-- One request-scoped privacy fence for every piece of auxiliary context that
-- can enter an Amora provider call. The caller supplies only the couple and the
-- one or two visibility scopes needed by the current turn; auth.uid() and the
-- current bilateral roster remain the authorization source.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.get_own_amora_privacy_context_snapshot(
  p_couple_id uuid,
  p_visibilities text[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '5s'
AS $function$
DECLARE
  v_user_id uuid;
  v_actor_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_requested_count integer;
  v_distinct_count integer;
  v_memory jsonb;
  v_personalization_exists boolean;
  v_personalization_revision bigint;
  v_roster_fingerprint text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_AUTH_REQUIRED'
      USING ERRCODE = '42501';
  END IF;

  IF p_couple_id IS NULL
     OR p_visibilities IS NULL
     OR pg_catalog.cardinality(p_visibilities) NOT BETWEEN 1 AND 2
     OR pg_catalog.array_position(p_visibilities, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_VISIBILITIES_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.count(DISTINCT requested.visibility)::integer
  INTO v_requested_count, v_distinct_count
  FROM pg_catalog.unnest(p_visibilities) AS requested(visibility)
  WHERE requested.visibility IN (
    'shared',
    'bride_private',
    'groom_private'
  );

  IF v_requested_count IS DISTINCT FROM pg_catalog.cardinality(p_visibilities)
     OR v_distinct_count IS DISTINCT FROM v_requested_count THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_VISIBILITIES_INVALID'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.role, couple.bride_id, couple.groom_id
  INTO v_actor_role, v_bride_id, v_groom_id
  FROM public.profiles AS profile
  JOIN public.couples AS couple
    ON couple.id = profile.couple_id
  WHERE profile.id = v_user_id
    AND profile.couple_id = p_couple_id
    AND (
      (profile.role = 'bride' AND couple.bride_id = v_user_id)
      OR (profile.role = 'groom' AND couple.groom_id = v_user_id)
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(p_visibilities) AS requested(visibility)
    WHERE (requested.visibility = 'bride_private' AND v_actor_role <> 'bride')
       OR (requested.visibility = 'groom_private' AND v_actor_role <> 'groom')
  ) THEN
    RAISE EXCEPTION 'AMORA_PRIVACY_CONTEXT_SCOPE_INVALID'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_object_agg(
      requested.visibility,
      pg_catalog.jsonb_build_object(
        'enabled',
        public.has_current_amora_memory_consent(
          p_couple_id,
          requested.visibility
        ),
        'resetAt',
        setting.memory_reset_at
      )
    ),
    '{}'::jsonb
  )
  INTO v_memory
  FROM pg_catalog.unnest(p_visibilities) AS requested(visibility)
  LEFT JOIN public.amora_memory_settings AS setting
    ON setting.couple_id = p_couple_id
   AND setting.visibility = requested.visibility;

  SELECT preference.revision
  INTO v_personalization_revision
  FROM public.amora_personalization_preferences AS preference
  WHERE preference.owner_user_id = v_user_id;
  v_personalization_exists := FOUND;

  -- The fingerprint detects a role or roster transition even when the current
  -- user remains linked to the same couple. No raw partner identifier leaves
  -- the database boundary.
  v_roster_fingerprint := pg_catalog.md5(
    'amora-privacy-roster-v1:'
    || COALESCE(v_bride_id::text, '-')
    || ':'
    || COALESCE(v_groom_id::text, '-')
  );

  RETURN pg_catalog.jsonb_build_object(
    'version', 1,
    'actorRole', v_actor_role,
    'rosterFingerprint', v_roster_fingerprint,
    'memory', v_memory,
    'personalization', pg_catalog.jsonb_build_object(
      'exists', v_personalization_exists,
      'revision',
      CASE
        WHEN v_personalization_exists THEN v_personalization_revision
        ELSE NULL
      END
    )
  );
END;
$function$;

ALTER FUNCTION public.get_own_amora_privacy_context_snapshot(uuid, text[])
  OWNER TO postgres;

REVOKE ALL ON FUNCTION
  public.get_own_amora_privacy_context_snapshot(uuid, text[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.get_own_amora_privacy_context_snapshot(uuid, text[])
  TO authenticated;

COMMENT ON FUNCTION
  public.get_own_amora_privacy_context_snapshot(uuid, text[])
  IS 'Authenticated, current-roster snapshot used to fence Amora provider context immediately before generation.';

COMMIT;
