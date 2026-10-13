-- 로컬 companion 후보: e313 v2 및 25b786 최소 identity cutover 설치 후 사용한다.
-- 정상 owner SECURITY DEFINER 수동/승인 dispatcher 계약은 변경하지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE UPDATE ON TABLE public.amora_actions FROM service_role;

CREATE OR REPLACE FUNCTION public.apply_journey_progress_patch(
  p_couple_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_remove_keys text[] DEFAULT '{}'::text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE v_progress jsonb;
BEGIN
  IF p_patch ? '__amora_actions'
     OR '__amora_actions' = ANY(coalesce(p_remove_keys,'{}'::text[])) THEN
    RAISE EXCEPTION 'AMORA_ACTION_GENERIC_WRITER_RETIRED' USING ERRCODE = '55000';
  END IF;
  UPDATE wedding_journeys
     SET progress = (coalesce(progress, '{}'::jsonb) - p_remove_keys) || coalesce(p_patch, '{}'::jsonb),
         updated_at = now()
   WHERE couple_id = p_couple_id
   RETURNING progress INTO v_progress;
  IF v_progress IS NULL THEN
    RAISE EXCEPTION 'wedding_journeys row not found for couple_id=%', p_couple_id
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_progress;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_journey_progress_item_patch(
  p_couple_id uuid,
  p_item_key text,
  p_item_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_item jsonb;
BEGIN
  IF p_item_key IS NULL OR btrim(p_item_key) = '' THEN
    RAISE EXCEPTION 'progress item key is required' USING ERRCODE = '22023';
  END IF;
  IF p_item_patch IS NULL OR jsonb_typeof(p_item_patch) <> 'object' THEN
    RAISE EXCEPTION 'progress item patch must be a JSON object' USING ERRCODE = '22023';
  END IF;
  IF p_item_key = '__amora_actions' THEN
    RAISE EXCEPTION 'AMORA_ACTION_GENERIC_WRITER_RETIRED' USING ERRCODE = '55000';
  END IF;
  UPDATE public.wedding_journeys
     SET progress = jsonb_set(
       coalesce(progress, '{}'::jsonb),array[p_item_key],
       (CASE
          WHEN jsonb_typeof(coalesce(progress, '{}'::jsonb) -> p_item_key) = 'object'
            THEN coalesce(progress, '{}'::jsonb) -> p_item_key
          ELSE '{}'::jsonb
        END) || p_item_patch,true
     ),updated_at = now()
   WHERE couple_id = p_couple_id
   RETURNING progress -> p_item_key INTO v_item;
  IF v_item IS NULL THEN
    RAISE EXCEPTION 'wedding_journeys row not found for couple_id=%', p_couple_id USING ERRCODE = 'P0002';
  END IF;
  RETURN v_item;
END;
$function$;

COMMIT;
