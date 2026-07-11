BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Forward repair for environments that already recorded the earlier July
-- migrations before the invite lifecycle contract was corrected.
ALTER TABLE public.couples
  ALTER COLUMN invite_code DROP NOT NULL;

DO $$
DECLARE
  v_definition text;
  v_validated boolean;
BEGIN
  SELECT pg_get_constraintdef(oid, true), convalidated
  INTO v_definition, v_validated
  FROM pg_constraint
  WHERE conrelid = 'public.couples'::regclass
    AND conname = 'couples_blocked_invite_revoked';

  IF v_definition IS NULL THEN
    ALTER TABLE public.couples
      ADD CONSTRAINT couples_blocked_invite_revoked
      CHECK (amora_replacement_blocked_at IS NULL OR invite_code IS NULL);
  ELSIF v_definition <>
    'CHECK (amora_replacement_blocked_at IS NULL OR invite_code IS NULL)'
  THEN
    RAISE EXCEPTION 'COUPLES_BLOCKED_INVITE_CONSTRAINT_MISMATCH'
      USING ERRCODE = '55000';
  ELSIF NOT v_validated THEN
    ALTER TABLE public.couples
      VALIDATE CONSTRAINT couples_blocked_invite_revoked;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_or_rotate_invite_code_safely(
  p_user_id uuid,
  p_rotate boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_role text;
  v_bride_id uuid;
  v_groom_id uuid;
  v_invite_code text;
  v_fully_linked boolean;
  v_replacement_blocked_at timestamptz;
BEGIN
  SELECT couple_id, role::text
  INTO v_couple_id, v_role
  FROM public.profiles
  WHERE id = p_user_id
    AND account_deleting_at IS NULL
    AND amora_membership_resetting_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_couple_id IS NULL OR v_role NOT IN ('bride', 'groom') THEN
    RAISE EXCEPTION 'invite state is unavailable' USING ERRCODE = '42501';
  END IF;

  SELECT bride_id, groom_id, invite_code, amora_replacement_blocked_at
  INTO v_bride_id, v_groom_id, v_invite_code, v_replacement_blocked_at
  FROM public.couples
  WHERE id = v_couple_id
    AND amora_shared_resetting_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
    OR (v_role = 'bride' AND v_bride_id IS DISTINCT FROM p_user_id)
    OR (v_role = 'groom' AND v_groom_id IS DISTINCT FROM p_user_id)
  THEN
    RAISE EXCEPTION 'invite state is unavailable' USING ERRCODE = '42501';
  END IF;

  v_fully_linked := v_bride_id IS NOT NULL AND v_groom_id IS NOT NULL;
  IF v_replacement_blocked_at IS NOT NULL THEN
    IF v_fully_linked THEN
      RAISE EXCEPTION 'blocked invite state is inconsistent' USING ERRCODE = '55000';
    END IF;
    RETURN jsonb_build_object(
      'invite_code', NULL,
      'is_fully_linked', false,
      'requires_relink_confirmation', true
    );
  END IF;

  IF COALESCE(p_rotate, false) AND v_fully_linked THEN
    RAISE EXCEPTION 'invite cannot be rotated after linking' USING ERRCODE = '55000';
  END IF;

  IF v_invite_code IS NULL
    OR v_invite_code !~ '^WH-[A-F0-9]{12}$'
    OR COALESCE(p_rotate, false)
  THEN
    v_invite_code := public.generate_invite_code();
    UPDATE public.couples
    SET invite_code = v_invite_code, updated_at = now()
    WHERE id = v_couple_id;
  END IF;

  RETURN jsonb_build_object(
    'invite_code', v_invite_code,
    'is_fully_linked', v_fully_linked,
    'requires_relink_confirmation', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_or_rotate_invite_code_safely(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_rotate_invite_code_safely(uuid, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.join_couple_server(
  p_user_id uuid,
  p_invite_code text,
  p_role text,
  p_wedding_date date,
  p_venue text,
  p_total_budget numeric,
  p_progress jsonb,
  p_sanggyeonrye_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_couple_id uuid;
  v_couple_id uuid;
  v_code text := upper(btrim(COALESCE(p_invite_code, '')));
  v_role text := lower(btrim(COALESCE(p_role, '')));
  v_progress jsonb;
  v_events jsonb;
  v_now timestamptz;
BEGIN
  IF v_role NOT IN ('bride', 'groom')
    OR v_code !~ '^WH-[A-Z0-9]{12}$'
    OR p_total_budget IS NULL OR p_total_budget < 0 OR p_total_budget > 10000000000
    OR jsonb_typeof(COALESCE(p_progress, '{}'::jsonb)) <> 'object'
  THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  SELECT couple_id INTO v_profile_couple_id
  FROM public.profiles
  WHERE id = p_user_id
    AND account_deleting_at IS NULL
    AND amora_membership_resetting_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR v_profile_couple_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  SELECT id INTO v_couple_id
  FROM public.couples
  WHERE invite_code = v_code
    AND amora_shared_resetting_at IS NULL
    AND amora_replacement_blocked_at IS NULL
    AND (bride_id IS NOT NULL OR groom_id IS NOT NULL)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  IF v_role = 'bride' THEN
    UPDATE public.couples
    SET bride_id = p_user_id,
        amora_context_generation = amora_context_generation + 1,
        amora_context_changed_at = now(),
        updated_at = now()
    WHERE id = v_couple_id AND bride_id IS NULL
      AND (groom_id IS NULL OR groom_id <> p_user_id);
  ELSE
    UPDATE public.couples
    SET groom_id = p_user_id,
        amora_context_generation = amora_context_generation + 1,
        amora_context_changed_at = now(),
        updated_at = now()
    WHERE id = v_couple_id AND groom_id IS NULL
      AND (bride_id IS NULL OR bride_id <> p_user_id);
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invite unavailable.');
  END IF;

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      onboarding_completed = true,
      onboarding_step = 5,
      updated_at = now()
  WHERE id = p_user_id;

  SELECT progress INTO v_progress
  FROM public.wedding_journeys
  WHERE couple_id = v_couple_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wedding_journeys (
      couple_id, wedding_date, venue, total_budget, progress
    ) VALUES (
      v_couple_id, p_wedding_date, NULLIF(btrim(p_venue), ''),
      p_total_budget, COALESCE(p_progress, '{}'::jsonb)
    );
  ELSIF p_sanggyeonrye_date IS NOT NULL THEN
    v_events := CASE
      WHEN jsonb_typeof(COALESCE(v_progress->'__events', '[]'::jsonb)) = 'array'
        THEN COALESCE(v_progress->'__events', '[]'::jsonb)
      ELSE '[]'::jsonb
    END;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_events) AS event
      WHERE event->>'momentType' = 'sanggyeonrye'
    ) THEN
      v_now := clock_timestamp();
      v_events := v_events || jsonb_build_array(jsonb_build_object(
        'id', 'evt_' || replace(gen_random_uuid()::text, '-', ''),
        'date', p_sanggyeonrye_date,
        'title', '상견례',
        'momentType', 'sanggyeonrye',
        'createdAt', v_now,
        'updatedAt', v_now
      ));
      UPDATE public.wedding_journeys
      SET progress = jsonb_set(
        COALESCE(v_progress, '{}'::jsonb), '{__events}', v_events, true
      )
      WHERE couple_id = v_couple_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'couple_id', v_couple_id,
    'invite_code', v_code
  );
END;
$$;
REVOKE ALL ON FUNCTION public.join_couple_server(
  uuid, text, text, date, text, numeric, jsonb, date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_couple_server(
  uuid, text, text, date, text, numeric, jsonb, date
) TO service_role;

-- Retire the bucket even when the old table-drop migration was already
-- recorded. Locking the FK target serializes concurrent Storage inserts.
DO $$
BEGIN
  PERFORM 1
  FROM storage.buckets
  WHERE id = 'invitation-photos'
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM storage.objects WHERE bucket_id = 'invitation-photos'
  ) THEN
    RAISE EXCEPTION 'INVITATION_STORAGE_EXPORT_REQUIRED'
      USING ERRCODE = '55000';
  END IF;

  -- Old workers may have snapshotted this now-retired scope before the app
  -- allow-list was tightened. Objects are proven absent above, so removing
  -- only that exact scope prevents otherwise-valid jobs from dead-lettering.
  UPDATE public.account_deletion_jobs AS job
  SET storage_inventory = COALESCE((
        SELECT jsonb_agg(item.value ORDER BY item.ordinality)
        FROM jsonb_array_elements(job.storage_inventory)
          WITH ORDINALITY AS item(value, ordinality)
        WHERE item.value->>'bucket' <> 'invitation-photos'
      ), '[]'::jsonb),
      updated_at = now()
  WHERE job.storage_inventory IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(job.storage_inventory) AS item(value)
      WHERE item.value->>'bucket' = 'invitation-photos'
    );

  UPDATE storage.buckets
  SET public = false
  WHERE id = 'invitation-photos';
END;
$$;

COMMIT;
