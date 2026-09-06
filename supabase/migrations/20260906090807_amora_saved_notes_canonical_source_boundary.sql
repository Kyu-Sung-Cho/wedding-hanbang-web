-- 저장 본문은 현재 공유 메시지에서만 복사한다. 직접 REST INSERT와 원문 변경은 닫고
-- 커플이 공유 메모를 수정·삭제하는 기존 RLS 계약은 유지한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.amora_note_utf16_excerpt(p_text text, p_max_units integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = ''
AS $function$
DECLARE v_index integer; v_units integer := 0; v_next integer; v_end integer := 0;
BEGIN
  IF p_max_units < 0 OR p_max_units > 4000 THEN
    RAISE EXCEPTION 'AMORA_NOTE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  FOR v_index IN 1..LEAST(pg_catalog.char_length(p_text), p_max_units) LOOP
    v_next := CASE WHEN pg_catalog.octet_length(pg_catalog.substr(p_text,v_index,1)) = 4 THEN 2 ELSE 1 END;
    EXIT WHEN v_units + v_next > p_max_units;
    v_units := v_units + v_next; v_end := v_index;
  END LOOP;
  RETURN pg_catalog.left(p_text, v_end);
END;
$function$;

CREATE FUNCTION public.save_own_amora_note(p_couple_id uuid, p_message_id uuid, p_memo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_profile_couple uuid; v_role text; v_bride uuid; v_groom uuid;
  v_source_couple uuid; v_visibility text; v_content text; v_memo text; v_note public.amora_saved_notes%ROWTYPE;
  v_trim_chars text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF v_actor IS NULL OR p_couple_id IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'AMORA_NOTE_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  -- 저장끼리의300개 상한만 직렬화한다. 대기 중에는 프로필 행을 잡지 않는다.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hanbang:amora-note-save:' || p_couple_id::text,0)
  );
  SELECT couple_id,role INTO v_profile_couple,v_role FROM public.profiles WHERE id = v_actor FOR NO KEY UPDATE;
  IF NOT FOUND OR v_profile_couple IS DISTINCT FROM p_couple_id THEN
    RAISE EXCEPTION 'AMORA_NOTE_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  -- 공동 초기화 수락도 couple SHARE를 먼저 잡으므로 서로 기다리지 않게 한다.
  SELECT bride_id,groom_id INTO v_bride,v_groom FROM public.couples WHERE id = p_couple_id FOR SHARE;
  IF NOT FOUND OR NOT COALESCE((
    (v_role = 'bride' AND v_bride = v_actor AND v_groom IS DISTINCT FROM v_actor)
    OR (v_role = 'groom' AND v_groom = v_actor AND v_bride IS DISTINCT FROM v_actor)
  ),false) THEN
    RAISE EXCEPTION 'AMORA_NOTE_SCOPE_DENIED' USING ERRCODE = '42501';
  END IF;
  v_memo := NULLIF(pg_catalog.btrim(p_memo,v_trim_chars),'');
  IF v_memo IS NOT NULL AND public.amora_note_utf16_excerpt(v_memo,500) IS DISTINCT FROM v_memo THEN
    RAISE EXCEPTION 'AMORA_NOTE_INVALID_INPUT' USING ERRCODE = '22023';
  END IF;
  -- 동일 수락 카드의 message UPDATE가 진행 중이면 profile -> message 역전 대기를
  -- 만들지 않는다. 55P03은 API에서 재시도 가능한 저장 실패로 응답한다.
  SELECT couple_id,visibility,content INTO v_source_couple,v_visibility,v_content
    FROM public.chat_messages WHERE id = p_message_id FOR SHARE NOWAIT;
  IF NOT FOUND OR v_source_couple IS DISTINCT FROM p_couple_id THEN
    RAISE EXCEPTION 'AMORA_NOTE_SOURCE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_visibility IS DISTINCT FROM 'shared' THEN
    RAISE EXCEPTION 'AMORA_NOTE_PRIVATE_SOURCE' USING ERRCODE = '42501';
  END IF;
  v_content := public.amora_note_utf16_excerpt(pg_catalog.btrim(v_content,v_trim_chars),4000);
  IF v_content IS NULL OR v_content = '' THEN
    RAISE EXCEPTION 'AMORA_NOTE_SOURCE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_note FROM public.amora_saved_notes
    WHERE couple_id = p_couple_id AND message_id = p_message_id FOR SHARE;
  IF FOUND THEN RETURN pg_catalog.jsonb_build_object('note',pg_catalog.to_jsonb(v_note),'already_saved',true); END IF;
  IF (SELECT pg_catalog.count(*) FROM public.amora_saved_notes WHERE couple_id = p_couple_id) >= 300 THEN
    RAISE EXCEPTION 'AMORA_NOTE_LIMIT' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.amora_saved_notes(couple_id,saved_by,message_id,content,memo)
    VALUES(p_couple_id,v_actor,p_message_id,v_content,v_memo)
    ON CONFLICT (couple_id,message_id) WHERE message_id IS NOT NULL DO NOTHING
    RETURNING * INTO v_note;
  IF NOT FOUND THEN
    SELECT * INTO v_note FROM public.amora_saved_notes
      WHERE couple_id = p_couple_id AND message_id = p_message_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'AMORA_NOTE_RECEIPT_UNAVAILABLE' USING ERRCODE = '55000'; END IF;
    RETURN pg_catalog.jsonb_build_object('note',pg_catalog.to_jsonb(v_note),'already_saved',true);
  END IF;
  RETURN pg_catalog.jsonb_build_object('note',pg_catalog.to_jsonb(v_note),'already_saved',false);
END;
$function$;

ALTER FUNCTION public.amora_note_utf16_excerpt(text,integer) OWNER TO postgres;
ALTER FUNCTION public.save_own_amora_note(uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.amora_note_utf16_excerpt(text,integer) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_own_amora_note(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_own_amora_note(uuid,uuid,text) TO authenticated;
REVOKE INSERT,UPDATE ON public.amora_saved_notes FROM PUBLIC,anon,authenticated;
GRANT UPDATE(memo) ON public.amora_saved_notes TO authenticated;
-- 기존 행은 운영 검증에서 확인하고, 새 메모 변경은 JS와 같은 UTF-16 상한을 쓴다.
ALTER TABLE public.amora_saved_notes ADD CONSTRAINT amora_saved_notes_memo_utf16_bounded
  CHECK (memo IS NULL OR pg_catalog.char_length(memo)
    + pg_catalog.char_length(pg_catalog.regexp_replace(memo,U&'[^\+010000-\+10FFFF]','','g')) <= 500) NOT VALID;
COMMIT;
