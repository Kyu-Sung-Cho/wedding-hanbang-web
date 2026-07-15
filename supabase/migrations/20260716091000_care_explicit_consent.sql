-- Replace the historical default-on care flag with provable explicit consent
-- before re-enabling outbound delivery.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS care_notifications_consented_at timestamptz;

ALTER TABLE public.profiles
  ALTER COLUMN care_notifications_enabled SET DEFAULT false;

-- The previous boolean defaulted to true, so an existing true value is not
-- evidence that the person opted in. Reset once and ask again in Settings.
UPDATE public.profiles
SET care_notifications_enabled = false,
    care_notifications_consented_at = NULL
WHERE care_notifications_consented_at IS NULL;

CREATE OR REPLACE FUNCTION public.insert_amora_care_message(
  p_couple_id uuid,
  p_content text,
  p_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '5s'
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_bride_id uuid;
  v_groom_id uuid;
  v_required integer;
  v_consented integer;
  v_message_id uuid;
BEGIN
  IF char_length(p_content) NOT BETWEEN 1 AND 2000
     OR jsonb_typeof(COALESCE(p_metadata, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'AMORA_CARE_MESSAGE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT bride_id, groom_id INTO v_bride_id, v_groom_id
  FROM public.couples
  WHERE id = p_couple_id;

  SELECT count(DISTINCT member_id)::integer INTO v_required
  FROM (VALUES (v_bride_id), (v_groom_id)) AS members(member_id)
  WHERE member_id IS NOT NULL;
  IF v_required = 0 THEN
    RETURN NULL;
  END IF;

  -- Lock the current member rows so a simultaneous opt-out is serialized with
  -- message creation. Whichever transaction commits first defines the result.
  PERFORM 1
  FROM public.profiles
  WHERE id IN (v_bride_id, v_groom_id)
  ORDER BY id
  FOR SHARE;

  SELECT count(*)::integer INTO v_consented
  FROM public.profiles
  WHERE id IN (v_bride_id, v_groom_id)
    AND care_notifications_enabled = true
    AND care_notifications_consented_at IS NOT NULL;

  IF v_consented <> v_required THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.chat_messages(
    couple_id, sender_id, sender_type, role, content, visibility, metadata
  ) VALUES (
    p_couple_id, NULL, 'ai', 'assistant', p_content, 'shared', p_metadata
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END
$function$;

REVOKE ALL ON FUNCTION public.insert_amora_care_message(uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_amora_care_message(uuid, text, jsonb)
  TO service_role;

COMMENT ON COLUMN public.profiles.care_notifications_enabled IS
  'True only after explicit Settings opt-in for Amora outbound care.';
COMMENT ON COLUMN public.profiles.care_notifications_consented_at IS
  'Timestamp of the latest explicit Amora outbound-care opt-in; NULL when disabled.';
