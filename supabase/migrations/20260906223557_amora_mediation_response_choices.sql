-- 괜찮음만 기존 양측 확정 경로에 포함한다. 조건/어려움은 확정과 별도로 남긴다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.amora_mediation_responses (
  message_id uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  proposal_version uuid NOT NULL,
  roster_fingerprint text NOT NULL CHECK (roster_fingerprint ~ '^[a-f0-9]{32}$'),
  choice text CHECK (choice IN ('ok','conditional','difficult')),
  condition text CHECK (condition IS NULL OR char_length(condition) BETWEEN 1 AND 500),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (message_id,user_id),
  CHECK ((choice = 'conditional' AND condition IS NOT NULL)
    OR (choice = 'difficult') OR (condition IS NULL AND choice IS DISTINCT FROM 'conditional'))
);
CREATE INDEX amora_mediation_responses_couple_idx ON public.amora_mediation_responses(couple_id);
ALTER TABLE public.amora_mediation_responses ENABLE ROW LEVEL SECURITY;
-- 원문 조건은 정확한 현재 제안·현재 구성원에게만 읽힌다.
CREATE POLICY amora_mediation_responses_current_read ON public.amora_mediation_responses
FOR SELECT TO authenticated USING (
  public.is_couple_member(couple_id) AND EXISTS (
    SELECT 1 FROM public.chat_messages m JOIN public.couples c ON c.id=m.couple_id
    WHERE m.id=message_id AND m.couple_id=amora_mediation_responses.couple_id
      AND m.sender_type='ai' AND m.role='assistant' AND m.sender_id IS NULL AND m.visibility='shared'
      AND m.metadata #>> '{mediation,proposalVersion}' = proposal_version::text
      AND m.metadata #>> '{mediation,rosterFingerprint}' = roster_fingerprint
      AND roster_fingerprint=md5(COALESCE(c.bride_id::text,'-')||':'||COALESCE(c.groom_id::text,'-'))
      AND user_id IN (c.bride_id,c.groom_id)
  )
);
REVOKE ALL ON TABLE public.amora_mediation_responses FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.amora_mediation_responses TO authenticated;
GRANT ALL ON TABLE public.amora_mediation_responses TO service_role;

-- 이미 존재하는 정식 확인을 새 읽기 계약에서도 그대로 보여준다.
INSERT INTO public.amora_mediation_responses(message_id,user_id,couple_id,proposal_version,roster_fingerprint,choice,updated_at)
SELECT a.message_id,a.user_id,a.couple_id,a.proposal_version,a.proposal_roster_fingerprint,'ok',a.accepted_at
FROM public.amora_mediation_acceptances a;

CREATE FUNCTION public.sync_amora_mediation_response_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    -- 취소 tombstone을 남겨 같은 화면의 오래된 revision=0 요청을 막는다.
    UPDATE public.amora_mediation_responses SET choice=NULL,condition=NULL,revision=revision+1,updated_at=clock_timestamp()
    WHERE message_id=OLD.message_id AND user_id=OLD.user_id
      AND proposal_version=OLD.proposal_version AND roster_fingerprint=OLD.proposal_roster_fingerprint AND choice='ok';
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.amora_mediation_responses r
    WHERE r.message_id=NEW.message_id AND r.user_id=NEW.user_id
      AND r.proposal_version=NEW.proposal_version AND r.roster_fingerprint=NEW.proposal_roster_fingerprint
      AND r.choice IN ('conditional','difficult')) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_RESPONSE_CHANGED' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.amora_mediation_responses AS r
    (message_id,user_id,couple_id,proposal_version,roster_fingerprint,choice)
  VALUES (NEW.message_id,NEW.user_id,NEW.couple_id,NEW.proposal_version,NEW.proposal_roster_fingerprint,'ok')
  ON CONFLICT (message_id,user_id) DO UPDATE SET
    couple_id=EXCLUDED.couple_id,proposal_version=EXCLUDED.proposal_version,roster_fingerprint=EXCLUDED.roster_fingerprint,
    choice='ok',condition=NULL,
    revision=CASE WHEN r.proposal_version=EXCLUDED.proposal_version AND r.roster_fingerprint=EXCLUDED.roster_fingerprint THEN r.revision+1 ELSE 1 END,
    updated_at=clock_timestamp()
  WHERE r.choice IS DISTINCT FROM 'ok' OR r.proposal_version IS DISTINCT FROM EXCLUDED.proposal_version
    OR r.roster_fingerprint IS DISTINCT FROM EXCLUDED.roster_fingerprint;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.sync_amora_mediation_response_acceptance() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_sync_amora_mediation_response_acceptance AFTER INSERT OR UPDATE OR DELETE
ON public.amora_mediation_acceptances FOR EACH ROW EXECUTE FUNCTION public.sync_amora_mediation_response_acceptance();

CREATE FUNCTION public.clean_amora_mediation_responses() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF TG_TABLE_NAME='couples' THEN
    DELETE FROM public.amora_mediation_responses WHERE couple_id=NEW.id;
  ELSE
    DELETE FROM public.amora_mediation_responses WHERE message_id=NEW.id AND (
      couple_id IS DISTINCT FROM NEW.couple_id OR NEW.visibility IS DISTINCT FROM 'shared'
      OR NEW.sender_type IS DISTINCT FROM 'ai' OR NEW.role IS DISTINCT FROM 'assistant' OR NEW.sender_id IS NOT NULL
      OR proposal_version::text IS DISTINCT FROM (NEW.metadata #>> '{mediation,proposalVersion}')
      OR roster_fingerprint IS DISTINCT FROM (NEW.metadata #>> '{mediation,rosterFingerprint}')
    );
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.clean_amora_mediation_responses() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_clean_amora_mediation_responses AFTER UPDATE OF bride_id,groom_id ON public.couples
FOR EACH ROW WHEN (OLD.bride_id IS DISTINCT FROM NEW.bride_id OR OLD.groom_id IS DISTINCT FROM NEW.groom_id)
EXECUTE FUNCTION public.clean_amora_mediation_responses();
CREATE TRIGGER trg_clean_amora_mediation_responses AFTER UPDATE OF couple_id,sender_type,sender_id,role,visibility,metadata ON public.chat_messages
FOR EACH ROW EXECUTE FUNCTION public.clean_amora_mediation_responses();

CREATE FUNCTION public.lock_own_amora_mediation_response(
  p_message_id uuid,p_expected_owner_id uuid,p_expected_proposal_version uuid,p_expected_roster_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout='5s' SET statement_timeout='30s' AS $function$
DECLARE v_actor uuid:=auth.uid(); v_message public.chat_messages%ROWTYPE; v_couple public.couples%ROWTYPE;
  v_profile_couple uuid; v_profile_role text;
BEGIN
  IF v_actor IS NULL OR v_actor IS DISTINCT FROM p_expected_owner_id THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  -- 기존 accept, revoke, 제안 바인딩과 같은 message -> advisory -> couple 순서.
  SELECT * INTO v_message FROM public.chat_messages WHERE id=p_message_id FOR SHARE;
  IF NOT FOUND OR v_message.sender_type IS DISTINCT FROM 'ai' OR v_message.role IS DISTINCT FROM 'assistant'
    OR v_message.sender_id IS NOT NULL OR v_message.visibility IS DISTINCT FROM 'shared'
    OR v_message.metadata #>> '{mediation,origin}' IS DISTINCT FROM 'user_requested'
    OR v_message.metadata #>> '{mediation,evidenceScope}' IS DISTINCT FROM 'requester_summary_only'
    OR v_message.metadata #> '{mediation,schemaVersion}' IS DISTINCT FROM '2'::jsonb THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:amora-mediation:'||p_message_id::text,0));
  SELECT * INTO v_couple FROM public.couples WHERE id=v_message.couple_id FOR SHARE;
  IF NOT FOUND OR NOT COALESCE(v_actor IN (v_couple.bride_id,v_couple.groom_id),false) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  -- profile 먼저 잠그는 unlink와 기다리는 순환을 만들지 않는다. 경합은 재시도로 닫는다.
  SELECT couple_id,role INTO v_profile_couple,v_profile_role FROM public.profiles WHERE id=v_actor FOR SHARE NOWAIT;
  IF NOT FOUND OR v_profile_couple IS DISTINCT FROM v_couple.id OR NOT COALESCE(
    (v_profile_role='bride' AND v_couple.bride_id=v_actor AND v_couple.groom_id IS DISTINCT FROM v_actor)
    OR (v_profile_role='groom' AND v_couple.groom_id=v_actor AND v_couple.bride_id IS DISTINCT FROM v_actor),false) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_SCOPE_INVALID' USING ERRCODE='42501';
  END IF;
  IF p_expected_proposal_version IS NULL OR p_expected_roster_fingerprint IS NULL
    OR v_message.metadata #>> '{mediation,proposalVersion}' IS DISTINCT FROM p_expected_proposal_version::text
    OR v_message.metadata #>> '{mediation,rosterFingerprint}' IS DISTINCT FROM p_expected_roster_fingerprint
    OR p_expected_roster_fingerprint IS DISTINCT FROM md5(COALESCE(v_couple.bride_id::text,'-')||':'||COALESCE(v_couple.groom_id::text,'-')) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_PROPOSAL_CHANGED' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('coupleId',v_couple.id,'resolution',btrim(v_message.metadata #>> '{mediation,resolution}'),
    'brideId',v_couple.bride_id,'groomId',v_couple.groom_id,
    'partnerLinked',v_couple.bride_id IS NOT NULL AND v_couple.groom_id IS NOT NULL AND v_couple.bride_id<>v_couple.groom_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.lock_own_amora_mediation_response(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.read_own_amora_mediation_response(
  p_message_id uuid,p_expected_owner_id uuid,p_expected_proposal_version uuid,p_expected_roster_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout='5s' SET statement_timeout='30s' AS $function$
DECLARE v_context jsonb; v_responses jsonb; v_mine jsonb; v_revision bigint:=0; v_count integer; v_completed boolean;
BEGIN
  v_context:=public.lock_own_amora_mediation_response(p_message_id,p_expected_owner_id,p_expected_proposal_version,p_expected_roster_fingerprint);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId',user_id,'choice',choice,'condition',condition,'revision',revision,'updatedAt',updated_at) ORDER BY user_id),'[]'::jsonb)
  INTO v_responses FROM public.amora_mediation_responses
  WHERE message_id=p_message_id AND proposal_version=p_expected_proposal_version AND roster_fingerprint=p_expected_roster_fingerprint
    AND user_id IN ((v_context->>'brideId')::uuid,(v_context->>'groomId')::uuid) AND choice IS NOT NULL;
  SELECT revision,CASE WHEN choice IS NOT NULL THEN jsonb_build_object('userId',user_id,'choice',choice,'condition',condition,'revision',revision,'updatedAt',updated_at) END
  INTO v_revision,v_mine FROM public.amora_mediation_responses
  WHERE message_id=p_message_id AND user_id=p_expected_owner_id AND proposal_version=p_expected_proposal_version AND roster_fingerprint=p_expected_roster_fingerprint;
  SELECT count(*)::integer INTO v_count FROM public.amora_mediation_acceptances a
  WHERE a.message_id=p_message_id AND a.proposal_version=p_expected_proposal_version AND a.proposal_roster_fingerprint=p_expected_roster_fingerprint
    AND a.proposal_resolution=v_context->>'resolution' AND a.user_id IN ((v_context->>'brideId')::uuid,(v_context->>'groomId')::uuid);
  SELECT EXISTS (SELECT 1 FROM public.decision_nodes WHERE couple_id=(v_context->>'coupleId')::uuid AND category='conflict_resolution'
    AND source='chat' AND source_ref_id=p_message_id AND chosen_value->>'value'=v_context->>'resolution'
    AND metadata->>'proposal_version'=p_expected_proposal_version::text AND metadata->>'roster_fingerprint'=p_expected_roster_fingerprint) INTO v_completed;
  RETURN jsonb_build_object('actorId',p_expected_owner_id,'proposalVersion',p_expected_proposal_version,'rosterFingerprint',p_expected_roster_fingerprint,
    'accepted',COALESCE(v_mine->>'choice'='ok',false),'acceptedCount',v_count,'requiredCount',2,'partnerLinked',v_context->'partnerLinked',
    'completed',v_completed,'myResponseRevision',COALESCE(v_revision,0),'myResponse',v_mine,'responses',v_responses);
END;
$function$;
REVOKE ALL ON FUNCTION public.read_own_amora_mediation_response(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_own_amora_mediation_response(uuid,uuid,uuid,text) TO authenticated;

CREATE FUNCTION public.respond_own_amora_mediation(
  p_message_id uuid,p_expected_owner_id uuid,p_expected_proposal_version uuid,p_expected_roster_fingerprint text,
  p_expected_response_revision bigint,p_choice text,p_condition text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout='5s' SET statement_timeout='30s' AS $function$
DECLARE v_context jsonb; v_revision bigint; v_condition text; v_units integer;
  v_trim_chars text := E' \t\n\r\f' || pg_catalog.chr(11) || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  v_condition:=NULLIF(btrim(p_condition,v_trim_chars),'');
  IF p_expected_response_revision IS NULL OR p_expected_response_revision<0 OR p_expected_response_revision>=9007199254740991
    OR (p_choice IS NOT NULL AND p_choice NOT IN ('ok','conditional','difficult'))
    OR (p_choice='conditional' AND v_condition IS NULL)
    OR ((p_choice IS NULL OR p_choice='ok') AND v_condition IS NOT NULL)
    OR char_length(v_condition)>500 THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_INVALID_RESPONSE' USING ERRCODE='22023';
  END IF;
  IF v_condition IS NOT NULL THEN
    SELECT sum(CASE WHEN ascii(substr(v_condition,n,1))>65535 THEN 2 ELSE 1 END)::integer INTO v_units FROM generate_series(1,char_length(v_condition)) n;
    IF v_units>500 THEN RAISE EXCEPTION 'AMORA_MEDIATION_INVALID_RESPONSE' USING ERRCODE='22023'; END IF;
  END IF;
  v_context:=public.lock_own_amora_mediation_response(p_message_id,p_expected_owner_id,p_expected_proposal_version,p_expected_roster_fingerprint);
  IF NOT (v_context->>'partnerLinked')::boolean THEN RAISE EXCEPTION 'AMORA_MEDIATION_PARTNER_REQUIRED' USING ERRCODE='55000'; END IF;
  SELECT revision INTO v_revision FROM public.amora_mediation_responses WHERE message_id=p_message_id AND user_id=p_expected_owner_id
    AND proposal_version=p_expected_proposal_version AND roster_fingerprint=p_expected_roster_fingerprint;
  IF COALESCE(v_revision,0)<>p_expected_response_revision THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_RESPONSE_CHANGED' USING ERRCODE='40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.decision_nodes WHERE category='conflict_resolution' AND source='chat' AND source_ref_id=p_message_id) THEN
    RAISE EXCEPTION 'AMORA_MEDIATION_ALREADY_COMPLETED' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.amora_mediation_responses(message_id,user_id,couple_id,proposal_version,roster_fingerprint,choice,condition,revision)
  VALUES(p_message_id,p_expected_owner_id,(v_context->>'coupleId')::uuid,p_expected_proposal_version,p_expected_roster_fingerprint,p_choice,v_condition,COALESCE(v_revision,0)+1)
  ON CONFLICT(message_id,user_id) DO UPDATE SET couple_id=EXCLUDED.couple_id,proposal_version=EXCLUDED.proposal_version,roster_fingerprint=EXCLUDED.roster_fingerprint,
    choice=EXCLUDED.choice,condition=EXCLUDED.condition,revision=EXCLUDED.revision,updated_at=clock_timestamp();
  IF p_choice='ok' THEN
    PERFORM public.accept_amora_mediation((v_context->>'coupleId')::uuid,p_message_id,p_expected_owner_id,
      '함께 확인한 합의 · '||left(v_context->>'resolution',56),v_context->>'resolution',p_expected_proposal_version,p_expected_roster_fingerprint);
  ELSE
    DELETE FROM public.amora_mediation_acceptances WHERE message_id=p_message_id AND user_id=p_expected_owner_id;
  END IF;
  RETURN public.read_own_amora_mediation_response(p_message_id,p_expected_owner_id,p_expected_proposal_version,p_expected_roster_fingerprint);
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_own_amora_mediation(uuid,uuid,uuid,text,bigint,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.respond_own_amora_mediation(uuid,uuid,uuid,text,bigint,text,text) TO authenticated;

COMMIT;
