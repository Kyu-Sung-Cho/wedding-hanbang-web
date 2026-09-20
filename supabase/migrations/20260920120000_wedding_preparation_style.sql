BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 새 인증 허브에서 본인이 확인한 응답만 보관한다. 공개/구판/연구 데이터는 가져오지 않는다.
CREATE SEQUENCE public.wedding_preparation_style_revision_seq AS bigint MINVALUE 1 MAXVALUE 9007199254740991 NO CYCLE;
CREATE TABLE public.wedding_preparation_style_responses (
  owner_user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  scene_version text CHECK (scene_version = 'v1.2-code'),
  answer_code text CHECK (
    answer_code ~ '^[ABCD-]{5}[ABC-][ABCD-][ABC-]{3}[AB-]{2}[ABC-][AB-]{7}$'
    AND answer_code <> '--------------------'
  ),
  revision bigint NOT NULL DEFAULT nextval('public.wedding_preparation_style_revision_seq') CHECK (revision BETWEEN 1 AND 9007199254740991),
  save_consent_version text CHECK (save_consent_version = '2026-09-20'),
  saved_at timestamptz DEFAULT clock_timestamp(),
  -- 삭제 후 원문 없는 확인 번호를 유지해 지연된 최초 저장(NULL baseline)의 재생을 막는다.
  CHECK ((answer_code IS NULL) = (scene_version IS NULL)
    AND (answer_code IS NULL) = (save_consent_version IS NULL)
    AND (answer_code IS NULL) = (saved_at IS NULL))
);
CREATE TABLE public.wedding_preparation_style_shares (
  owner_user_id uuid PRIMARY KEY REFERENCES public.wedding_preparation_style_responses(owner_user_id) ON DELETE CASCADE,
  partner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  couple_id uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  response_revision bigint NOT NULL CHECK (response_revision BETWEEN 1 AND 9007199254740991),
  share_consent_version text NOT NULL CHECK (share_consent_version = '2026-09-20'),
  shared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (owner_user_id <> partner_user_id)
);
CREATE INDEX wedding_preparation_style_shares_partner ON public.wedding_preparation_style_shares(partner_user_id);
CREATE INDEX wedding_preparation_style_shares_couple ON public.wedding_preparation_style_shares(couple_id);
ALTER TABLE public.wedding_preparation_style_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_preparation_style_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_preparation_style_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_preparation_style_shares FORCE ROW LEVEL SECURITY;
-- 기본 거부 RLS + RPC 전용 접근. service_role에도 테이블/sequence 권한을 주지 않는다.
REVOKE ALL ON public.wedding_preparation_style_responses, public.wedding_preparation_style_shares FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE public.wedding_preparation_style_revision_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.wedding_preparation_style_actor()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_owner uuid := auth.uid();
BEGIN
  IF v_owner IS NULL THEN RAISE EXCEPTION 'PREPARATION_STYLE_AUTH_REQUIRED' USING ERRCODE='28000'; END IF;
  -- 기존 계정 삭제 작업과 같은 잠금. 삭제 중 writer/reader는 대기 후 되살리지 않는다.
  IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('hanbang:account-data:' || v_owner::text,0)) THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_ACCOUNT_UNAVAILABLE' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_owner)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_owner)
     OR EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id=v_owner AND status<>'completed') THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_ACCOUNT_UNAVAILABLE' USING ERRCODE='55000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:wedding-preparation-style:' || v_owner::text,0));
  RETURN v_owner;
END;
$function$;
REVOKE ALL ON FUNCTION public.wedding_preparation_style_actor() FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_own_wedding_preparation_style()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE
  v_owner uuid := public.wedding_preparation_style_actor();
  v_couple uuid; v_partner uuid; v_own jsonb; v_other jsonb; v_share jsonb; v_revision bigint;
BEGIN
  SELECT profile.couple_id,
    CASE WHEN couple.bride_id=v_owner THEN couple.groom_id ELSE couple.bride_id END
    INTO v_couple,v_partner
    FROM public.profiles profile JOIN public.couples couple ON couple.id=profile.couple_id
    WHERE profile.id=v_owner AND public.is_current_couple_member(v_owner,profile.couple_id);
  IF v_partner IS NOT NULL AND (NOT public.is_current_couple_member(v_partner,v_couple)
    OR EXISTS (SELECT 1 FROM public.account_deletion_jobs WHERE user_id=v_partner AND status<>'completed')) THEN
    v_partner := NULL;
  END IF;
  SELECT revision INTO v_revision FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner;
  SELECT pg_catalog.jsonb_build_object('sceneVersion',scene_version,'answerCode',answer_code,'revision',revision,'savedAt',saved_at)
    INTO v_own FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner AND answer_code IS NOT NULL;
  SELECT pg_catalog.jsonb_build_object('responseRevision',grant_row.response_revision,'sharedAt',grant_row.shared_at)
    INTO v_share FROM public.wedding_preparation_style_shares grant_row
    JOIN public.wedding_preparation_style_responses answer ON answer.owner_user_id=grant_row.owner_user_id AND answer.revision=grant_row.response_revision AND answer.answer_code IS NOT NULL
    WHERE grant_row.owner_user_id=v_owner AND grant_row.partner_user_id=v_partner AND grant_row.couple_id=v_couple;
  -- 두 사람 모두 각자 최신 답의 공유를 승인한 경우에만 상대 답을 내려준다.
  IF v_share IS NOT NULL THEN
    SELECT pg_catalog.jsonb_build_object('sceneVersion',answer.scene_version,'answerCode',answer.answer_code,'revision',answer.revision,'savedAt',answer.saved_at)
      INTO v_other FROM public.wedding_preparation_style_responses answer
      JOIN public.wedding_preparation_style_shares grant_row ON grant_row.owner_user_id=answer.owner_user_id AND grant_row.response_revision=answer.revision
      WHERE answer.owner_user_id=v_partner AND answer.answer_code IS NOT NULL AND grant_row.partner_user_id=v_owner AND grant_row.couple_id=v_couple
        AND answer.scene_version=v_own->>'sceneVersion';
  END IF;
  RETURN pg_catalog.jsonb_build_object('ownerUserId',v_owner,'stateRevision',v_revision,'coupleId',v_couple,'partnerUserId',v_partner,'own',v_own,'sharing',v_share,'partner',v_other);
END;
$function$;

CREATE FUNCTION public.set_own_wedding_preparation_style(
  p_expected_revision bigint, p_scene_version text, p_answer_code text, p_save_consent_version text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_owner uuid := public.wedding_preparation_style_actor(); v_current public.wedding_preparation_style_responses%ROWTYPE;
BEGIN
  IF p_scene_version IS DISTINCT FROM 'v1.2-code' OR p_save_consent_version IS DISTINCT FROM '2026-09-20'
    OR p_answer_code IS NULL OR p_answer_code !~ '^[ABCD-]{5}[ABC-][ABCD-][ABC-]{3}[AB-]{2}[ABC-][AB-]{7}$'
    OR p_answer_code='--------------------' OR (p_expected_revision IS NOT NULL AND p_expected_revision NOT BETWEEN 1 AND 9007199254740991) THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_current FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner FOR UPDATE;
  -- 응답을 못 받은 같은 저장의 재시도는 공유 상태를 바꾸지 않는다.
  IF v_current.owner_user_id IS NOT NULL AND v_current.scene_version=p_scene_version AND v_current.answer_code=p_answer_code
    AND v_current.save_consent_version=p_save_consent_version THEN RETURN public.get_own_wedding_preparation_style(); END IF;
  IF v_current.revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  DELETE FROM public.wedding_preparation_style_shares WHERE owner_user_id=v_owner;
  INSERT INTO public.wedding_preparation_style_responses(owner_user_id,scene_version,answer_code,save_consent_version)
    VALUES(v_owner,p_scene_version,p_answer_code,p_save_consent_version)
    ON CONFLICT(owner_user_id) DO UPDATE SET scene_version=excluded.scene_version,answer_code=excluded.answer_code,
      save_consent_version=excluded.save_consent_version,revision=excluded.revision,saved_at=excluded.saved_at;
  RETURN public.get_own_wedding_preparation_style();
END;
$function$;

CREATE FUNCTION public.clear_own_wedding_preparation_style(p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_owner uuid := public.wedding_preparation_style_actor(); v_revision bigint;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  SELECT revision INTO v_revision FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner FOR UPDATE;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    IF v_revision>p_expected_revision AND EXISTS (SELECT 1 FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner AND answer_code IS NULL) THEN
      RETURN public.get_own_wedding_preparation_style();
    END IF;
    RAISE EXCEPTION 'PREPARATION_STYLE_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  DELETE FROM public.wedding_preparation_style_shares WHERE owner_user_id=v_owner;
  UPDATE public.wedding_preparation_style_responses SET scene_version=NULL,answer_code=NULL,
    save_consent_version=NULL,saved_at=NULL,revision=nextval('public.wedding_preparation_style_revision_seq')
    WHERE owner_user_id=v_owner;
  RETURN public.get_own_wedding_preparation_style();
END;
$function$;

CREATE FUNCTION public.share_own_wedding_preparation_style(
  p_expected_revision bigint, p_expected_couple_id uuid, p_expected_partner_user_id uuid, p_share_consent_version text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_owner uuid := public.wedding_preparation_style_actor(); v_revision bigint; v_snapshot jsonb;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9007199254740991
    OR p_expected_couple_id IS NULL OR p_expected_partner_user_id IS NULL OR p_expected_partner_user_id=v_owner
    OR p_share_consent_version IS DISTINCT FROM '2026-09-20' THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock_shared(pg_catalog.hashtextextended('hanbang:account-data:' || p_expected_partner_user_id::text,0)) THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_ACCOUNT_UNAVAILABLE' USING ERRCODE='55000';
  END IF;
  -- 공유 승인과 연결 해제가 겹치면 새 파트너로 승인을 옮기지 않는다.
  PERFORM id FROM public.profiles WHERE id IN(v_owner,p_expected_partner_user_id) ORDER BY id FOR SHARE;
  PERFORM id FROM public.couples WHERE id=p_expected_couple_id FOR SHARE;
  v_snapshot := public.get_own_wedding_preparation_style();
  IF (v_snapshot->>'coupleId')::uuid IS DISTINCT FROM p_expected_couple_id
    OR (v_snapshot->>'partnerUserId')::uuid IS DISTINCT FROM p_expected_partner_user_id THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_MEMBERSHIP_CONFLICT' USING ERRCODE='40001';
  END IF;
  SELECT revision INTO v_revision FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner AND answer_code IS NOT NULL FOR UPDATE;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  -- 공유/철회도 확인 번호를 전진시켜 지연 도착한 옛 승인이 철회를 되돌리지 못하게 한다.
  UPDATE public.wedding_preparation_style_responses
    SET revision=nextval('public.wedding_preparation_style_revision_seq') WHERE owner_user_id=v_owner
    RETURNING revision INTO v_revision;
  INSERT INTO public.wedding_preparation_style_shares(owner_user_id,partner_user_id,couple_id,response_revision,share_consent_version)
    VALUES(v_owner,p_expected_partner_user_id,p_expected_couple_id,v_revision,p_share_consent_version)
    ON CONFLICT(owner_user_id) DO UPDATE SET partner_user_id=excluded.partner_user_id,couple_id=excluded.couple_id,
      response_revision=excluded.response_revision,share_consent_version=excluded.share_consent_version,shared_at=excluded.shared_at
    WHERE (wedding_preparation_style_shares.partner_user_id,wedding_preparation_style_shares.couple_id,wedding_preparation_style_shares.response_revision)
      IS DISTINCT FROM (excluded.partner_user_id,excluded.couple_id,excluded.response_revision);
  RETURN public.get_own_wedding_preparation_style();
END;
$function$;

CREATE FUNCTION public.unshare_own_wedding_preparation_style(p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET lock_timeout = '5s' SET statement_timeout = '5s'
AS $function$
DECLARE v_owner uuid := public.wedding_preparation_style_actor(); v_revision bigint;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision NOT BETWEEN 1 AND 9007199254740991 THEN
    RAISE EXCEPTION 'PREPARATION_STYLE_INVALID_INPUT' USING ERRCODE='22023';
  END IF;
  SELECT revision INTO v_revision FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner FOR UPDATE;
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    IF v_revision>p_expected_revision AND EXISTS (SELECT 1 FROM public.wedding_preparation_style_responses WHERE owner_user_id=v_owner AND answer_code IS NULL) THEN
      RETURN public.get_own_wedding_preparation_style();
    END IF;
    RAISE EXCEPTION 'PREPARATION_STYLE_REVISION_CONFLICT' USING ERRCODE='40001';
  END IF;
  DELETE FROM public.wedding_preparation_style_shares WHERE owner_user_id=v_owner;
  UPDATE public.wedding_preparation_style_responses
    SET revision=nextval('public.wedding_preparation_style_revision_seq') WHERE owner_user_id=v_owner;
  RETURN public.get_own_wedding_preparation_style();
END;
$function$;

-- 기존 삭제 준비 함수/영수증을 바꾸지 않고 신규 데이터만 즉시 정리한다.
CREATE FUNCTION public.purge_wedding_preparation_style_for_account_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.status<>'completed' THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hanbang:account-data:' || NEW.user_id::text,0));
    DELETE FROM public.wedding_preparation_style_shares WHERE partner_user_id=NEW.user_id;
    DELETE FROM public.wedding_preparation_style_responses WHERE owner_user_id=NEW.user_id;
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_wedding_preparation_style_account_deletion
  AFTER INSERT OR UPDATE OF user_id,status ON public.account_deletion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.purge_wedding_preparation_style_for_account_deletion();

CREATE FUNCTION public.revoke_wedding_preparation_style_for_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF TG_TABLE_NAME='profiles' THEN
    IF (NEW.couple_id,NEW.role) IS DISTINCT FROM (OLD.couple_id,OLD.role) THEN
      DELETE FROM public.wedding_preparation_style_shares
        WHERE owner_user_id=OLD.id OR partner_user_id=OLD.id OR couple_id IN(OLD.couple_id,NEW.couple_id);
      -- 아직 공유하지 않은 사람의 지연 승인도 옛 연결로 재생되면 안 된다.
      UPDATE public.wedding_preparation_style_responses SET revision=nextval('public.wedding_preparation_style_revision_seq')
        WHERE owner_user_id=OLD.id OR owner_user_id IN (
          SELECT bride_id FROM public.couples WHERE id IN(OLD.couple_id,NEW.couple_id)
          UNION SELECT groom_id FROM public.couples WHERE id IN(OLD.couple_id,NEW.couple_id)
        );
    END IF;
  ELSIF (NEW.bride_id,NEW.groom_id) IS DISTINCT FROM (OLD.bride_id,OLD.groom_id) THEN
    DELETE FROM public.wedding_preparation_style_shares WHERE couple_id=OLD.id;
    UPDATE public.wedding_preparation_style_responses SET revision=nextval('public.wedding_preparation_style_revision_seq')
      WHERE owner_user_id IN(OLD.bride_id,OLD.groom_id,NEW.bride_id,NEW.groom_id);
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_wedding_preparation_style_profile_membership
  AFTER UPDATE OF couple_id,role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.revoke_wedding_preparation_style_for_membership();
CREATE TRIGGER trg_wedding_preparation_style_couple_membership
  AFTER UPDATE OF bride_id,groom_id ON public.couples
  FOR EACH ROW EXECUTE FUNCTION public.revoke_wedding_preparation_style_for_membership();

REVOKE ALL ON FUNCTION public.get_own_wedding_preparation_style(),
  public.set_own_wedding_preparation_style(bigint,text,text,text),public.clear_own_wedding_preparation_style(bigint),
  public.share_own_wedding_preparation_style(bigint,uuid,uuid,text),public.unshare_own_wedding_preparation_style(bigint),
  public.purge_wedding_preparation_style_for_account_deletion(),public.revoke_wedding_preparation_style_for_membership()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_own_wedding_preparation_style(),
  public.set_own_wedding_preparation_style(bigint,text,text,text),public.clear_own_wedding_preparation_style(bigint),
  public.share_own_wedding_preparation_style(bigint,uuid,uuid,text),public.unshare_own_wedding_preparation_style(bigint)
  TO authenticated;

COMMENT ON TABLE public.wedding_preparation_style_responses IS '본인이 명시적으로 계정에 저장한 최신 장면 응답. revision은 저장/공유/철회/삭제 확인 번호. 결과 삭제 뒤 owner+revision만 유지하고 원문·문항판·동의·시각은 NULL, 회원탈퇴 시 행도 삭제. 성격 추론/AI 기억/공개 링크 자동 수집 금지.';
COMMENT ON TABLE public.wedding_preparation_style_shares IS '현재 연결된 특정 파트너에게 특정 응답 revision을 공유한 승인. 응답 수정/연결 변경/계정 삭제 시 철회.';
COMMIT;
