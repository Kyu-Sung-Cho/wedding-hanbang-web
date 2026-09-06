BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 개인 할 일은 커플 공유 실행·알림·결정 원장과 분리한다.
CREATE TABLE public.amora_personal_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  source_requester_message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (owner_user_id,request_id),
  CONSTRAINT amora_personal_actions_title_bounded CHECK (char_length(btrim(title)) > 0 AND char_length(title) + char_length(regexp_replace(title,U&'[^\+010000-\+10FFFF]','','g')) <= 120),
  CONSTRAINT amora_personal_actions_description_bounded CHECK (description IS NULL OR char_length(description) + char_length(regexp_replace(description,U&'[^\+010000-\+10FFFF]','','g')) <= 500)
);
CREATE INDEX amora_personal_actions_owner_recent ON public.amora_personal_actions(owner_user_id,created_at DESC,id DESC);
CREATE INDEX amora_personal_actions_source ON public.amora_personal_actions(source_message_id);
CREATE INDEX amora_personal_actions_requester ON public.amora_personal_actions(source_requester_message_id);
ALTER TABLE public.amora_personal_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY amora_personal_actions_read ON public.amora_personal_actions FOR SELECT TO authenticated USING (owner_user_id = (SELECT auth.uid()));
CREATE POLICY amora_personal_actions_update ON public.amora_personal_actions FOR UPDATE TO authenticated USING (owner_user_id = (SELECT auth.uid())) WITH CHECK (owner_user_id = (SELECT auth.uid()));
CREATE POLICY amora_personal_actions_delete ON public.amora_personal_actions FOR DELETE TO authenticated USING (owner_user_id = (SELECT auth.uid()));
REVOKE ALL ON public.amora_personal_actions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,DELETE ON public.amora_personal_actions TO authenticated;
GRANT UPDATE(status) ON public.amora_personal_actions TO authenticated;

CREATE FUNCTION public.touch_amora_personal_action() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $function$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.touch_amora_personal_action() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER amora_personal_action_revision BEFORE UPDATE ON public.amora_personal_actions FOR EACH ROW EXECUTE FUNCTION public.touch_amora_personal_action();

CREATE FUNCTION public.save_own_amora_personal_action(
  p_owner_id uuid, p_couple_id uuid, p_message_id uuid, p_request_id uuid,
  p_title text, p_description text DEFAULT NULL, p_due_date date DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '15s'
AS $function$
DECLARE
  v_actor uuid := auth.uid(); v_couple uuid; v_role text; v_bride uuid; v_groom uuid;
  v_source public.chat_messages%ROWTYPE; v_requester public.chat_messages%ROWTYPE;
  v_segment public.conversation_segments%ROWTYPE; v_reply_id uuid;
  v_row public.amora_personal_actions%ROWTYPE; v_title text; v_description text;
  v_trim text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF v_actor IS NULL OR p_owner_id IS DISTINCT FROM v_actor OR p_couple_id IS NULL OR p_message_id IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  -- 저장 상한·requestId 재시도는 소유자 단위로만 직렬화하고 공유 행 대기는 피한다.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:personal-action:' || v_actor::text,0));
  SELECT couple_id,role INTO v_couple,v_role FROM public.profiles WHERE id=v_actor FOR SHARE NOWAIT;
  IF NOT FOUND OR v_couple IS DISTINCT FROM p_couple_id OR v_role NOT IN ('bride','groom') THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT bride_id,groom_id INTO v_bride,v_groom FROM public.couples WHERE id=p_couple_id FOR SHARE NOWAIT;
  IF NOT FOUND OR NOT COALESCE((v_role='bride' AND v_bride=v_actor AND v_groom IS DISTINCT FROM v_actor)
    OR (v_role='groom' AND v_groom=v_actor AND v_bride IS DISTINCT FROM v_actor),false) THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_SCOPE_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_source FROM public.chat_messages WHERE id=p_message_id FOR SHARE NOWAIT;
  IF NOT FOUND OR v_source.couple_id IS DISTINCT FROM p_couple_id
    OR v_source.visibility IS DISTINCT FROM v_role || '_private'
    OR v_source.sender_id IS NOT NULL OR v_source.sender_type IS DISTINCT FROM 'ai' OR v_source.role IS DISTINCT FROM 'assistant'
    OR COALESCE(v_source.metadata->>'target','')='partner' THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_PRIVATE_SOURCE_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF v_source.segment_id IS NULL THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE' USING ERRCODE='P0002';
  END IF;
  SELECT * INTO v_segment FROM public.conversation_segments WHERE id=v_source.segment_id FOR SHARE NOWAIT;
  IF NOT FOUND OR v_segment.owner_user_id IS DISTINCT FROM v_actor
    OR v_segment.couple_id IS DISTINCT FROM p_couple_id OR v_segment.visibility IS DISTINCT FROM v_source.visibility THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_SOURCE_OWNER_MISMATCH' USING ERRCODE='42501';
  END IF;
  IF NOT COALESCE((v_source.metadata->>'in_reply_to_user_message_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',false) THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_SOURCE_PROVENANCE_UNAVAILABLE' USING ERRCODE='P0002';
  END IF;
  v_reply_id := (v_source.metadata->>'in_reply_to_user_message_id')::uuid;
  SELECT * INTO v_requester FROM public.chat_messages WHERE id=v_reply_id FOR SHARE NOWAIT;
  IF NOT FOUND OR v_requester.sender_id IS DISTINCT FROM v_actor OR v_requester.role IS DISTINCT FROM 'user'
    OR v_requester.sender_type IS DISTINCT FROM v_role OR v_requester.couple_id IS DISTINCT FROM p_couple_id
    OR v_requester.visibility IS DISTINCT FROM v_source.visibility OR v_requester.segment_id IS DISTINCT FROM v_source.segment_id
    OR COALESCE(v_requester.metadata->>'target','')='partner' THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_SOURCE_REQUESTER_MISMATCH' USING ERRCODE='42501';
  END IF;
  v_title := pg_catalog.btrim(p_title,v_trim);
  v_description := NULLIF(pg_catalog.btrim(p_description,v_trim),'');
  IF v_title IS NULL OR v_title='' OR pg_catalog.char_length(v_title) + pg_catalog.char_length(pg_catalog.regexp_replace(v_title,U&'[^\+010000-\+10FFFF]','','g')) > 120
    OR (v_description IS NOT NULL AND pg_catalog.char_length(v_description) + pg_catalog.char_length(pg_catalog.regexp_replace(v_description,U&'[^\+010000-\+10FFFF]','','g')) > 500)
    OR (p_due_date IS NOT NULL AND (p_due_date < DATE '0001-01-01' OR p_due_date > DATE '9999-12-31')) THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_row FROM public.amora_personal_actions WHERE owner_user_id=v_actor AND request_id=p_request_id;
  IF FOUND THEN
    IF v_row.source_message_id IS DISTINCT FROM p_message_id OR v_row.title IS DISTINCT FROM v_title
      OR v_row.description IS DISTINCT FROM v_description OR v_row.due_date IS DISTINCT FROM p_due_date THEN
      RAISE EXCEPTION 'PERSONAL_ACTION_REQUEST_CONFLICT' USING ERRCODE='23505';
    END IF;
    RETURN pg_catalog.to_jsonb(v_row);
  END IF;
  IF (SELECT pg_catalog.count(*) FROM public.amora_personal_actions WHERE owner_user_id=v_actor) >= 300 THEN
    RAISE EXCEPTION 'PERSONAL_ACTION_LIMIT' USING ERRCODE='54000';
  END IF;
  INSERT INTO public.amora_personal_actions(owner_user_id,source_message_id,source_requester_message_id,request_id,title,description,due_date)
    VALUES(v_actor,p_message_id,v_reply_id,p_request_id,v_title,v_description,p_due_date) RETURNING * INTO v_row;
  RETURN pg_catalog.to_jsonb(v_row);
END;
$function$;
ALTER FUNCTION public.save_own_amora_personal_action(uuid,uuid,uuid,uuid,text,text,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_own_amora_personal_action(uuid,uuid,uuid,uuid,text,text,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_own_amora_personal_action(uuid,uuid,uuid,uuid,text,text,date) TO authenticated;
COMMIT;
