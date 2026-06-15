-- Make invite-code joining atomic and keep every client path on the same RPC.

CREATE OR REPLACE FUNCTION public.join_couple(p_invite_code text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_couple_id uuid;
  v_invite_code text;
  v_updated_id uuid;
  v_code text := upper(trim(coalesce(p_invite_code, '')));
  v_role text := lower(trim(coalesce(p_role, '')));
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', 'Unauthenticated.');
  END IF;

  IF v_role NOT IN ('bride', 'groom') THEN
    RETURN jsonb_build_object('error', 'Invalid role.');
  END IF;

  IF v_code !~ '^WH-[A-Z0-9]{6,12}$' THEN
    RETURN jsonb_build_object('error', 'Invalid invite code.');
  END IF;

  SELECT id, invite_code
  INTO v_couple_id, v_invite_code
  FROM public.couples
  WHERE invite_code = v_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Invalid invite code.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND couple_id IS NOT NULL
      AND couple_id <> v_couple_id
  ) THEN
    RETURN jsonb_build_object('error', 'This account is already linked to another couple.');
  END IF;

  PERFORM set_config('hanbang.allow_membership_write', 'on', true);

  IF v_role = 'bride' THEN
    UPDATE public.couples
    SET bride_id = auth.uid(), updated_at = now()
    WHERE id = v_couple_id
      AND bride_id IS NULL
      AND (groom_id IS NULL OR groom_id <> auth.uid())
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Bride slot is already linked.');
    END IF;
  ELSE
    UPDATE public.couples
    SET groom_id = auth.uid(), updated_at = now()
    WHERE id = v_couple_id
      AND groom_id IS NULL
      AND (bride_id IS NULL OR bride_id <> auth.uid())
    RETURNING id INTO v_updated_id;

    IF v_updated_id IS NULL THEN
      RETURN jsonb_build_object('error', 'Groom slot is already linked.');
    END IF;
  END IF;

  UPDATE public.profiles
  SET couple_id = v_couple_id,
      role = v_role,
      updated_at = now()
  WHERE id = auth.uid();

  RETURN jsonb_build_object(
    'success', true,
    'couple_id', v_couple_id,
    'invite_code', v_invite_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_couple(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_couple(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_couple(text, text) TO authenticated, service_role;
