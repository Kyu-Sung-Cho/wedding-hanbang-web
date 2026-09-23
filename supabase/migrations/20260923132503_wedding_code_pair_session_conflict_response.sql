BEGIN;

-- 업무상 충돌은 PostgREST의 serialization 재시도를 유발하지 않는 HTTP 409로 반환한다.
CREATE OR REPLACE FUNCTION public.create_wedding_code_pair_session(
  p_room_id uuid, p_owner_hash text, p_invite_hash text, p_answer_code text, p_consent_version text, p_issued_at bigint,
  p_consented boolean, p_age_confirmed boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_now timestamptz := clock_timestamp(); v_row public.wedding_code_pair_sessions%ROWTYPE;
BEGIN
  IF p_room_id IS NULL OR p_room_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_owner_hash IS NULL OR p_owner_hash !~ '^[0-9a-f]{64}$' OR p_invite_hash IS NULL OR p_invite_hash !~ '^[0-9a-f]{64}$' OR p_owner_hash=p_invite_hash
    OR p_answer_code IS NULL OR octet_length(p_answer_code)>256 OR p_answer_code !~ '^31_[1-5uns-]{25}_[0-9a-z.-]+_[0-9a-z-]+_[0-9a-z-]+_[0-9a-z-]+$'
    OR p_consent_version IS DISTINCT FROM '2026-09-23' OR p_consented IS DISTINCT FROM TRUE OR p_age_confirmed IS DISTINCT FROM TRUE
    OR p_issued_at IS NULL OR p_issued_at <= 0
    OR ('x'||substr(replace(p_room_id::text,'-',''),1,12))::bit(48)::bigint IS DISTINCT FROM p_issued_at
    OR abs(extract(epoch FROM v_now)*1000-p_issued_at)>300000 THEN
    RAISE EXCEPTION 'PAIR_SESSION_INVALID' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.wedding_code_pair_sessions(room_id,owner_hash,invite_hash,owner_answer_code,owner_consent_version,owner_age_confirmed,issued_at,created_at,expires_at)
    VALUES(p_room_id,p_owner_hash,p_invite_hash,p_answer_code,p_consent_version,TRUE,p_issued_at,v_now,v_now+interval '7 days')
    ON CONFLICT(room_id) DO NOTHING;
  SELECT * INTO v_row FROM public.wedding_code_pair_sessions WHERE room_id=p_room_id FOR UPDATE;
  IF v_row.owner_hash IS DISTINCT FROM p_owner_hash OR v_row.invite_hash IS DISTINCT FROM p_invite_hash THEN
    RAISE EXCEPTION 'PAIR_SESSION_CONFLICT' USING ERRCODE='PT409';
  END IF;
  IF v_row.closed_at IS NOT NULL OR v_row.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'PAIR_SESSION_CLOSED' USING ERRCODE='55000'; END IF;
  IF v_row.owner_answer_code IS DISTINCT FROM p_answer_code OR v_row.issued_at IS DISTINCT FROM p_issued_at THEN
    RAISE EXCEPTION 'PAIR_SESSION_CONFLICT' USING ERRCODE='PT409';
  END IF;
  RETURN public.read_wedding_code_pair_session(p_room_id,p_owner_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.join_wedding_code_pair_session(
  p_room_id uuid, p_invite_hash text, p_participant_hash text, p_answer_code text, p_consent_version text,
  p_consented boolean, p_age_confirmed boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_row public.wedding_code_pair_sessions%ROWTYPE;
BEGIN
  IF p_room_id IS NULL OR p_invite_hash IS NULL OR p_invite_hash !~ '^[0-9a-f]{64}$'
    OR p_participant_hash IS NULL OR p_participant_hash !~ '^[0-9a-f]{64}$' OR p_participant_hash=p_invite_hash
    OR p_answer_code IS NULL OR octet_length(p_answer_code)>256 OR p_answer_code !~ '^31_[1-5uns-]{25}_[0-9a-z.-]+_[0-9a-z-]+_[0-9a-z-]+_[0-9a-z-]+$'
    OR p_consent_version IS DISTINCT FROM '2026-09-23' OR p_consented IS DISTINCT FROM TRUE OR p_age_confirmed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'PAIR_SESSION_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_row FROM public.wedding_code_pair_sessions WHERE room_id=p_room_id FOR UPDATE;
  IF NOT FOUND OR v_row.invite_hash IS DISTINCT FROM p_invite_hash THEN RAISE EXCEPTION 'PAIR_SESSION_NOT_FOUND' USING ERRCODE='28000'; END IF;
  IF v_row.closed_at IS NOT NULL OR v_row.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'PAIR_SESSION_CLOSED' USING ERRCODE='55000'; END IF;
  IF p_participant_hash=v_row.owner_hash THEN RAISE EXCEPTION 'PAIR_SESSION_INVALID' USING ERRCODE='22023'; END IF;
  IF v_row.participant_hash IS NOT NULL THEN
    IF v_row.participant_hash IS DISTINCT FROM p_participant_hash OR v_row.participant_answer_code IS DISTINCT FROM p_answer_code THEN
      RAISE EXCEPTION 'PAIR_SESSION_CONFLICT' USING ERRCODE='PT409';
    END IF;
  ELSE
    UPDATE public.wedding_code_pair_sessions SET participant_hash=p_participant_hash,participant_answer_code=p_answer_code,
      participant_consent_version=p_consent_version,participant_age_confirmed=TRUE,joined_at=clock_timestamp() WHERE room_id=p_room_id;
  END IF;
  RETURN public.read_wedding_code_pair_session(p_room_id,p_participant_hash);
END;
$function$;

COMMIT;
