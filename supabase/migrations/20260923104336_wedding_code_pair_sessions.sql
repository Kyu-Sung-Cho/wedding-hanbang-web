BEGIN;

-- v3.1의 선택형 비공개 비교만 보관한다. 계정·연구·AI 기억과 연결하지 않는다.
CREATE TABLE public.wedding_code_pair_sessions (
  room_id uuid PRIMARY KEY CHECK (room_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  owner_hash text NOT NULL CHECK (owner_hash ~ '^[0-9a-f]{64}$'),
  invite_hash text NOT NULL CHECK (invite_hash ~ '^[0-9a-f]{64}$' AND invite_hash <> owner_hash),
  participant_hash text CHECK (participant_hash ~ '^[0-9a-f]{64}$' AND participant_hash <> owner_hash AND participant_hash <> invite_hash),
  owner_answer_code text CHECK (octet_length(owner_answer_code) BETWEEN 1 AND 256 AND owner_answer_code ~ '^31_[1-5uns-]{25}_[0-9a-z.-]+_[0-9a-z-]+_[0-9a-z-]+_[0-9a-z-]+$'),
  participant_answer_code text CHECK (octet_length(participant_answer_code) BETWEEN 1 AND 256 AND participant_answer_code ~ '^31_[1-5uns-]{25}_[0-9a-z.-]+_[0-9a-z-]+_[0-9a-z-]+_[0-9a-z-]+$'),
  owner_consent_version text CHECK (owner_consent_version = '2026-09-23'),
  participant_consent_version text CHECK (participant_consent_version = '2026-09-23'),
  owner_age_confirmed boolean CHECK (owner_age_confirmed IS NULL OR owner_age_confirmed),
  participant_age_confirmed boolean CHECK (participant_age_confirmed IS NULL OR participant_age_confirmed),
  issued_at bigint NOT NULL CHECK (issued_at > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  joined_at timestamptz,
  closed_at timestamptz,
  CHECK (expires_at = created_at + interval '7 days'),
  CHECK ((closed_at IS NULL AND owner_answer_code IS NOT NULL AND owner_consent_version IS NOT NULL AND owner_age_confirmed IS TRUE
    AND ((participant_hash IS NULL AND participant_answer_code IS NULL AND participant_consent_version IS NULL AND participant_age_confirmed IS NULL AND joined_at IS NULL)
      OR (participant_hash IS NOT NULL AND participant_answer_code IS NOT NULL AND participant_consent_version IS NOT NULL AND participant_age_confirmed IS TRUE AND joined_at IS NOT NULL)))
    OR (closed_at IS NOT NULL AND owner_answer_code IS NULL AND participant_answer_code IS NULL AND owner_consent_version IS NULL
      AND participant_consent_version IS NULL AND owner_age_confirmed IS NULL AND participant_age_confirmed IS NULL AND joined_at IS NULL))
);
CREATE INDEX wedding_code_pair_sessions_expiry ON public.wedding_code_pair_sessions(expires_at);
ALTER TABLE public.wedding_code_pair_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_code_pair_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.wedding_code_pair_sessions FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.read_wedding_code_pair_session(p_room_id uuid, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_row public.wedding_code_pair_sessions%ROWTYPE; v_role text; v_state text; v_result jsonb;
BEGIN
  IF p_room_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'PAIR_SESSION_INVALID' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_row FROM public.wedding_code_pair_sessions WHERE room_id=p_room_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAIR_SESSION_NOT_FOUND' USING ERRCODE='28000'; END IF;
  v_role := CASE p_token_hash WHEN v_row.owner_hash THEN 'owner' WHEN v_row.participant_hash THEN 'participant' WHEN v_row.invite_hash THEN 'invite' ELSE NULL END;
  IF v_role IS NULL THEN RAISE EXCEPTION 'PAIR_SESSION_NOT_FOUND' USING ERRCODE='28000'; END IF;
  v_state := CASE WHEN v_row.closed_at IS NOT NULL OR v_row.expires_at <= clock_timestamp() THEN 'closed'
    WHEN v_row.participant_hash IS NULL THEN 'waiting' ELSE 'ready' END;
  v_result := pg_catalog.jsonb_build_object('roomId',v_row.room_id,'state',v_state,'role',v_role,'expiresAt',v_row.expires_at);
  -- 초대 권한은 참여 상태만 알려주며, 어느 단계에서도 원응답을 읽지 못한다.
  IF v_role='invite' OR v_state='closed' THEN RETURN v_result; END IF;
  v_result := v_result || pg_catalog.jsonb_build_object('ownAnswerCode',CASE WHEN v_role='owner' THEN v_row.owner_answer_code ELSE v_row.participant_answer_code END);
  IF v_state='ready' THEN
    v_result := v_result || pg_catalog.jsonb_build_object('partnerAnswerCode',CASE WHEN v_role='owner' THEN v_row.participant_answer_code ELSE v_row.owner_answer_code END);
  END IF;
  RETURN v_result;
END;
$function$;

CREATE FUNCTION public.create_wedding_code_pair_session(
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
    RAISE EXCEPTION 'PAIR_SESSION_CONFLICT' USING ERRCODE='40001';
  END IF;
  IF v_row.closed_at IS NOT NULL OR v_row.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'PAIR_SESSION_CLOSED' USING ERRCODE='55000'; END IF;
  IF v_row.owner_answer_code IS DISTINCT FROM p_answer_code OR v_row.issued_at IS DISTINCT FROM p_issued_at THEN
    RAISE EXCEPTION 'PAIR_SESSION_CONFLICT' USING ERRCODE='40001';
  END IF;
  RETURN public.read_wedding_code_pair_session(p_room_id,p_owner_hash);
END;
$function$;

CREATE FUNCTION public.join_wedding_code_pair_session(
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
      RAISE EXCEPTION 'PAIR_SESSION_CONFLICT' USING ERRCODE='40001';
    END IF;
  ELSE
    UPDATE public.wedding_code_pair_sessions SET participant_hash=p_participant_hash,participant_answer_code=p_answer_code,
      participant_consent_version=p_consent_version,participant_age_confirmed=TRUE,joined_at=clock_timestamp() WHERE room_id=p_room_id;
  END IF;
  RETURN public.read_wedding_code_pair_session(p_room_id,p_participant_hash);
END;
$function$;

CREATE FUNCTION public.revoke_wedding_code_pair_session(p_room_id uuid, p_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_row public.wedding_code_pair_sessions%ROWTYPE;
BEGIN
  IF p_room_id IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'PAIR_SESSION_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM public.wedding_code_pair_sessions WHERE room_id=p_room_id FOR UPDATE;
  IF NOT FOUND OR (p_token_hash IS DISTINCT FROM v_row.owner_hash AND p_token_hash IS DISTINCT FROM v_row.participant_hash) THEN
    RAISE EXCEPTION 'PAIR_SESSION_NOT_FOUND' USING ERRCODE='28000';
  END IF;
  UPDATE public.wedding_code_pair_sessions SET closed_at=coalesce(closed_at,clock_timestamp()),owner_answer_code=NULL,participant_answer_code=NULL,
    owner_consent_version=NULL,participant_consent_version=NULL,owner_age_confirmed=NULL,participant_age_confirmed=NULL,joined_at=NULL WHERE room_id=p_room_id;
  RETURN public.read_wedding_code_pair_session(p_room_id,p_token_hash);
END;
$function$;

CREATE FUNCTION public.purge_expired_wedding_code_pair_sessions()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '30s'
AS $function$
DECLARE v_deleted bigint;
BEGIN
  DELETE FROM public.wedding_code_pair_sessions WHERE expires_at <= clock_timestamp();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_wedding_code_pair_session(uuid,text,text,text,text,bigint,boolean,boolean),
  public.read_wedding_code_pair_session(uuid,text), public.join_wedding_code_pair_session(uuid,text,text,text,text,boolean,boolean),
  public.revoke_wedding_code_pair_session(uuid,text), public.purge_expired_wedding_code_pair_sessions() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_wedding_code_pair_session(uuid,text,text,text,text,bigint,boolean,boolean),
  public.read_wedding_code_pair_session(uuid,text), public.join_wedding_code_pair_session(uuid,text,text,text,text,boolean,boolean),
  public.revoke_wedding_code_pair_session(uuid,text) TO service_role;

DO $cron_guard$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_cron') THEN
    RAISE EXCEPTION 'PAIR_SESSION_CRON_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='wedding-code-pair-session-purge') THEN
    RAISE EXCEPTION 'PAIR_SESSION_CRON_ALREADY_EXISTS';
  END IF;
END;
$cron_guard$;
SELECT cron.schedule('wedding-code-pair-session-purge','17 3 * * *','SELECT public.purge_expired_wedding_code_pair_sessions();');

COMMENT ON TABLE public.wedding_code_pair_sessions IS 'Explicitly consented immutable v3.1 pair snapshots; fixed 7-day access; daily expiry purge; revocation removes answers immediately; no account, research or AI linkage.';
COMMIT;
