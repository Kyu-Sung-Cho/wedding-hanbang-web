-- Commit profile, consent, and optional default community nickname changes as
-- one service-only transaction. The API must never compose these writes.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.patch_profile_atomic(
  p_user_id uuid,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_phone_provided boolean DEFAULT false,
  p_phone_care_consent boolean DEFAULT NULL,
  p_care_notifications_enabled boolean DEFAULT NULL,
  p_community_nickname text DEFAULT NULL,
  p_force_community_nickname_sync boolean DEFAULT false,
  p_community_nickname_provided boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '20s'
AS $function$
DECLARE
  v_couple_id uuid;
  v_profile public.profiles%ROWTYPE;
  v_previous_name text;
  v_community_nickname text;
  v_default_nickname_key text;
  v_current_nickname_key text;
  v_community_profile_synced boolean := false;
  v_cancelled_jobs integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_phone_provided IS NULL
     OR p_force_community_nickname_sync IS NULL
     OR p_community_nickname_provided IS NULL
     OR (NOT p_phone_provided AND p_phone IS NOT NULL)
     OR (
       NOT p_community_nickname_provided
       AND p_name IS NULL
       AND p_community_nickname IS NOT NULL
     )
     OR (p_community_nickname_provided AND p_community_nickname IS NULL)
     OR (p_community_nickname_provided AND p_force_community_nickname_sync)
     OR (
       p_name IS NULL
       AND NOT p_phone_provided
       AND p_phone_care_consent IS NULL
       AND p_care_notifications_enabled IS NULL
       AND NOT p_community_nickname_provided
     ) THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NOT NULL
     AND (
       btrim(p_name) = ''
       OR p_name IS DISTINCT FROM btrim(p_name)
       OR char_length(p_name) > 80
     ) THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID_NAME' USING ERRCODE = '22023';
  END IF;
  IF p_phone_provided
     AND p_phone IS NOT NULL
     AND p_phone !~ '^01[016789][0-9]{7,8}$' THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID_PHONE' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NOT NULL AND p_community_nickname IS NULL THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID_NICKNAME' USING ERRCODE = '22023';
  END IF;
  IF p_community_nickname IS NOT NULL
     AND (
       btrim(p_community_nickname) = ''
       OR p_community_nickname IS DISTINCT FROM btrim(p_community_nickname)
       OR char_length(p_community_nickname) > 20
     ) THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID_NICKNAME' USING ERRCODE = '22023';
  END IF;
  IF p_force_community_nickname_sync AND p_name IS NULL THEN
    RAISE EXCEPTION 'PROFILE_PATCH_INVALID_NICKNAME_SYNC' USING ERRCODE = '22023';
  END IF;

  IF p_care_notifications_enabled = false THEN
    SELECT id INTO v_couple_id
    FROM public.couples
    WHERE bride_id = p_user_id OR groom_id = p_user_id
    ORDER BY id
    LIMIT 1;

    IF v_couple_id IS NOT NULL THEN
      -- Keep the worker-compatible global lock order: jobs before profiles.
      PERFORM 1
      FROM public.amora_care_jobs
      WHERE couple_id = v_couple_id
        AND status IN ('pending', 'processing')
      ORDER BY id
      FOR UPDATE;
    END IF;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_PATCH_PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  v_previous_name := v_profile.name;

  IF p_phone_care_consent = true
     AND (CASE WHEN p_phone_provided THEN p_phone ELSE v_profile.phone END) IS NULL THEN
    RAISE EXCEPTION 'PROFILE_PATCH_PHONE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_name IS NOT NULL
     OR p_phone_provided
     OR p_phone_care_consent IS NOT NULL
     OR p_care_notifications_enabled IS NOT NULL THEN
    UPDATE public.profiles
    SET name = CASE WHEN p_name IS NOT NULL THEN p_name ELSE v_profile.name END,
        phone = CASE WHEN p_phone_provided THEN p_phone ELSE v_profile.phone END,
        phone_care_consented_at = CASE
          WHEN p_phone_provided AND p_phone IS NULL THEN NULL
          WHEN p_phone_care_consent = true THEN now()
          WHEN p_phone_care_consent = false THEN NULL
          ELSE v_profile.phone_care_consented_at
        END,
        care_notifications_enabled = COALESCE(
          p_care_notifications_enabled,
          v_profile.care_notifications_enabled
        ),
        care_notifications_consented_at = CASE
          WHEN p_care_notifications_enabled = true THEN now()
          WHEN p_care_notifications_enabled = false THEN NULL
          ELSE v_profile.care_notifications_consented_at
        END,
        updated_at = now()
    WHERE id = p_user_id
    RETURNING * INTO v_profile;
  END IF;

  IF p_community_nickname IS NOT NULL THEN
    SELECT nickname INTO v_community_nickname
    FROM public.community_profiles
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF FOUND THEN
      v_default_nickname_key := lower(
        regexp_replace(btrim(v_previous_name), '\s+', '', 'g')
      );
      v_current_nickname_key := lower(
        regexp_replace(btrim(v_community_nickname), '\s+', '', 'g')
      );

      IF (
        p_community_nickname_provided
        OR p_force_community_nickname_sync
        OR v_community_nickname = '익명'
        OR v_community_nickname = (
          'user-' || substr(replace(p_user_id::text, '-', ''), 1, 8)
        )
        OR v_current_nickname_key = v_default_nickname_key
      ) AND v_community_nickname IS DISTINCT FROM p_community_nickname THEN
        UPDATE public.community_profiles
        SET nickname = p_community_nickname,
            updated_at = now()
        WHERE user_id = p_user_id;
        v_community_nickname := p_community_nickname;
        v_community_profile_synced := true;
      END IF;
    ELSIF p_community_nickname_provided OR p_force_community_nickname_sync THEN
      INSERT INTO public.community_profiles (
        user_id,
        nickname,
        badge,
        post_count,
        comment_count,
        total_upvotes_received
      )
      VALUES (
        p_user_id,
        p_community_nickname,
        'member',
        (
          SELECT count(*)::integer
          FROM public.community_posts
          WHERE author_id = p_user_id
            AND visibility IN ('public', 'members')
            AND under_review = false
        ),
        (
          SELECT count(*)::integer
          FROM public.community_comments
          WHERE author_id = p_user_id
            AND is_deleted = false
        ),
        0
      );
      v_community_nickname := p_community_nickname;
      v_community_profile_synced := true;
    END IF;
  END IF;

  IF p_care_notifications_enabled = false AND v_couple_id IS NOT NULL THEN
    UPDATE public.amora_care_deliveries AS delivery
    SET status = CASE
          WHEN delivery.status IN ('pending', 'processing') THEN 'cancelled'
          ELSE delivery.status
        END,
        completed_at = CASE
          WHEN delivery.status IN ('pending', 'processing') THEN now()
          ELSE delivery.completed_at
        END,
        recipient_email = NULL,
        recipient_name = NULL,
        last_error = CASE
          WHEN delivery.status IN ('pending', 'processing') THEN 'consent_withdrawn'
          ELSE delivery.last_error
        END,
        updated_at = now()
    FROM public.amora_care_jobs AS job
    WHERE delivery.job_id = job.id
      AND job.couple_id = v_couple_id
      AND job.status IN ('pending', 'processing');

    UPDATE public.amora_care_jobs
    SET status = 'cancelled',
        completed_at = now(),
        updated_at = now(),
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = 'consent_withdrawn',
        content = '[redacted]',
        email_subject = NULL,
        email_html = NULL,
        metadata = '{}'::jsonb
    WHERE couple_id = v_couple_id
      AND status IN ('pending', 'processing');
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'profile', to_jsonb(v_profile),
    'community_profile_synced', v_community_profile_synced,
    'community_nickname', v_community_nickname,
    'cancelled_jobs', v_cancelled_jobs
  );
END
$function$;

ALTER FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean
) TO service_role;

COMMENT ON FUNCTION public.patch_profile_atomic(
  uuid, text, text, boolean, boolean, boolean, text, boolean, boolean
) IS
  'Service-only atomic profile, consent, and optional community nickname patch.';
