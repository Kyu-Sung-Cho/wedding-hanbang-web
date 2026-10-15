-- 수정 36문항은 기존 16문항 자료와 분리한다. 초대키는 참여만 허용하며,
-- 개인 결과 조회에는 브라우저가 보관한 별도 비밀키의 해시가 필요하다.
CREATE TABLE IF NOT EXISTS public.wedding_code36_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL UNIQUE,
  access_hash TEXT NOT NULL CHECK (access_hash ~ '^[0-9a-f]{64}$'),
  submission JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  deleted_at TIMESTAMPTZ,
  CHECK (expires_at = created_at + INTERVAL '7 days'),
  CHECK ((deleted_at IS NOT NULL AND submission IS NULL) OR
    (deleted_at IS NULL AND jsonb_typeof(submission) IS NOT DISTINCT FROM 'object'
      AND submission->>'questionnaire_version' IS NOT DISTINCT FROM 'wcr36-r6-2026-10-15'
      AND submission->>'questionnaire_fingerprint' IS NOT DISTINCT FROM '982e2623c147bd7bbeefd2f7e1a6fb7ec27cbbd28e60bb62a0c002c148735f16'))
);

CREATE TABLE IF NOT EXISTS public.wedding_code36_pairs (
  invite_token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_response_id UUID NOT NULL UNIQUE REFERENCES public.wedding_code36_responses(id) ON DELETE CASCADE,
  partner_response_id UUID UNIQUE REFERENCES public.wedding_code36_responses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (owner_response_id IS DISTINCT FROM partner_response_id)
);

ALTER TABLE public.wedding_code36_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_code36_pairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wedding_code36_responses, public.wedding_code36_pairs FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wc36_pair(
  p_response_id UUID, p_access_hash TEXT, p_invite_token UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pair public.wedding_code36_pairs%ROWTYPE;
  v_existing public.wedding_code36_pairs%ROWTYPE;
  v_response public.wedding_code36_responses%ROWTYPE;
BEGIN
  -- 빈 초대 이동과 반대 방향의 동시 참여도 하나의 그래프 변경으로 직렬화한다.
  -- 요청별 잠금만으로는 소유자/참여자 두 열을 가로지르는 중복 소속을 막지 못한다.
  PERFORM pg_advisory_xact_lock(hashtextextended('wc36-pair-graph', 0));
  -- 응답 단위 잠금은 두 초대에 동시에 참여하는 요청도 직렬화한다.
  PERFORM pg_advisory_xact_lock(hashtextextended('wc36-response:' || p_response_id::TEXT, 0));
  SELECT * INTO v_response FROM public.wedding_code36_responses r WHERE r.id=p_response_id AND r.access_hash=p_access_hash;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','unauthorized');
  END IF;
  IF v_response.expires_at<=now() THEN RETURN jsonb_build_object('error','expired'); END IF;
  IF v_response.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('error','deleted'); END IF;
  SELECT * INTO v_existing FROM public.wedding_code36_pairs c
    WHERE c.owner_response_id=p_response_id OR c.partner_response_id=p_response_id FOR UPDATE;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.wedding_code36_responses r
      WHERE r.id IN (v_existing.owner_response_id,v_existing.partner_response_id)
        AND (r.expires_at<=now() OR r.deleted_at IS NOT NULL)) THEN
      RETURN jsonb_build_object('error','expired');
    END IF;
    -- 이미 두 결과가 연결됐거나 같은 초대를 재확인하는 경우는 그대로 돌려준다.
    IF v_existing.partner_response_id IS NOT NULL OR p_invite_token IS NULL OR p_invite_token=v_existing.invite_token THEN
      RETURN jsonb_build_object('pairing_status',CASE WHEN v_existing.partner_response_id IS NULL THEN 'waiting' ELSE 'paired' END,'invite_token',v_existing.invite_token);
    END IF;
  END IF;
  IF p_invite_token IS NULL THEN
    INSERT INTO public.wedding_code36_pairs(owner_response_id) VALUES(p_response_id) RETURNING * INTO v_pair;
    RETURN jsonb_build_object('pairing_status','waiting','invite_token',v_pair.invite_token);
  END IF;
  SELECT * INTO v_pair FROM public.wedding_code36_pairs c WHERE c.invite_token=p_invite_token FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','invite_not_found'); END IF;
  IF EXISTS (SELECT 1 FROM public.wedding_code36_responses r
    WHERE r.id IN (v_pair.owner_response_id,v_pair.partner_response_id)
      AND (r.expires_at<=now() OR r.deleted_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('error','expired');
  END IF;
  IF v_pair.owner_response_id=p_response_id OR EXISTS (SELECT 1 FROM public.wedding_code36_responses r WHERE r.id=v_pair.owner_response_id AND r.access_hash=p_access_hash) THEN RETURN jsonb_build_object('error','self_pair'); END IF;
  IF v_pair.partner_response_id IS NOT NULL THEN RETURN jsonb_build_object('pairing_status','full','invite_token',NULL); END IF;
  -- 대상 확인이 끝난 뒤에만 내 빈 초대를 닫는다. 실패한 참여는 기존 링크를 보존한다.
  DELETE FROM public.wedding_code36_pairs
    WHERE owner_response_id=p_response_id AND partner_response_id IS NULL;
  UPDATE public.wedding_code36_pairs SET partner_response_id=p_response_id WHERE invite_token=p_invite_token;
  RETURN jsonb_build_object('pairing_status','paired','invite_token',p_invite_token);
END; $$;

CREATE OR REPLACE FUNCTION public.wc36_update_sharing(p_response_id UUID,p_access_hash TEXT,p_settings JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_response public.wedding_code36_responses%ROWTYPE;
BEGIN
  IF jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_settings->'allow_couple_comparison') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_settings->'share_alias') IS DISTINCT FROM 'boolean'
    OR jsonb_typeof(p_settings->'share_item_ids') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('error','invalid_sharing');
  END IF;
  SELECT * INTO v_response FROM public.wedding_code36_responses r
    WHERE r.id=p_response_id AND r.access_hash=p_access_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF v_response.expires_at<=now() THEN RETURN jsonb_build_object('error','expired'); END IF;
  IF v_response.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('error','deleted'); END IF;
  UPDATE public.wedding_code36_responses r SET submission = r.submission || jsonb_build_object(
    'allow_couple_comparison',p_settings->'allow_couple_comparison',
    'share_item_ids',p_settings->'share_item_ids','share_alias',p_settings->'share_alias'
  ) WHERE r.id=p_response_id RETURNING * INTO v_response;
  RETURN jsonb_build_object('submission',v_response.submission,'expires_at',v_response.expires_at);
END; $$;

CREATE OR REPLACE FUNCTION public.wc36_submit(
  p_submission_id UUID, p_access_hash TEXT, p_submission JSONB, p_invite_token UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_response public.wedding_code36_responses%ROWTYPE;
  v_pair JSONB;
  v_recovered BOOLEAN := FALSE;
BEGIN
  IF p_submission_id IS NULL OR p_access_hash IS NULL OR p_access_hash !~ '^[0-9a-f]{64}$'
    OR p_submission IS NULL OR jsonb_typeof(p_submission) IS DISTINCT FROM 'object'
    OR p_submission->>'questionnaire_version' IS DISTINCT FROM 'wcr36-r6-2026-10-15'
    OR p_submission->>'questionnaire_fingerprint' IS DISTINCT FROM '982e2623c147bd7bbeefd2f7e1a6fb7ec27cbbd28e60bb62a0c002c148735f16' THEN
    RETURN jsonb_build_object('error','invalid_submission');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wc36-submission:' || p_submission_id::TEXT, 0));
  SELECT * INTO v_response FROM public.wedding_code36_responses r WHERE r.submission_id=p_submission_id;
  IF FOUND THEN
    IF v_response.access_hash <> p_access_hash THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
    IF v_response.expires_at<=now() THEN RETURN jsonb_build_object('error','expired'); END IF;
    IF v_response.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('error','deleted'); END IF;
    v_recovered := TRUE;
  ELSE
    INSERT INTO public.wedding_code36_responses(submission_id,access_hash,submission)
      VALUES(p_submission_id,p_access_hash,p_submission) RETURNING * INTO v_response;
  END IF;
  IF p_invite_token IS NOT NULL OR EXISTS (SELECT 1 FROM public.wedding_code36_pairs c WHERE c.owner_response_id=v_response.id OR c.partner_response_id=v_response.id) THEN
    v_pair := public.wc36_pair(v_response.id,p_access_hash,p_invite_token);
    -- 개인 저장 성공과 초대 참여 실패는 분리한다. 잘못된 초대로도 저장된
    -- 본인 결과의 ID를 잃거나 같은 제출키 재시도가 영구 실패하지 않는다.
    IF v_pair->>'error' IN ('invite_not_found','self_pair','expired') THEN
      v_pair := jsonb_build_object('pairing_status','unpaired','invite_token',NULL,
        'pairing_error',CASE WHEN v_pair->>'error'='expired' THEN 'invite_expired' ELSE v_pair->>'error' END);
    END IF;
  ELSE
    v_pair := jsonb_build_object('pairing_status','unpaired','invite_token',NULL);
  END IF;
  RETURN jsonb_build_object('response_id',v_response.id,'submission',v_response.submission,'expires_at',v_response.expires_at,'recovered',v_recovered) || v_pair;
END; $$;

CREATE OR REPLACE FUNCTION public.wc36_read_report(p_response_id UUID,p_access_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_response public.wedding_code36_responses%ROWTYPE;
  v_pair public.wedding_code36_pairs%ROWTYPE;
  v_partner JSONB;
BEGIN
  SELECT * INTO v_response FROM public.wedding_code36_responses r WHERE r.id=p_response_id AND r.access_hash=p_access_hash;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF v_response.expires_at<=now() THEN RETURN jsonb_build_object('error','expired'); END IF;
  IF v_response.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('error','deleted'); END IF;
  SELECT * INTO v_pair FROM public.wedding_code36_pairs c WHERE c.owner_response_id=p_response_id OR c.partner_response_id=p_response_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','unpaired'); END IF;
  IF v_pair.partner_response_id IS NULL THEN RETURN jsonb_build_object('status','waiting','invite_token',v_pair.invite_token); END IF;
  IF EXISTS (SELECT 1 FROM public.wedding_code36_responses r
    WHERE r.id IN (v_pair.owner_response_id,v_pair.partner_response_id)
      AND (r.expires_at<=now() OR r.deleted_at IS NOT NULL)) THEN
    RETURN jsonb_build_object('error','expired');
  END IF;
  SELECT r.submission INTO v_partner FROM public.wedding_code36_responses r
    WHERE r.id=CASE WHEN v_pair.owner_response_id=p_response_id THEN v_pair.partner_response_id ELSE v_pair.owner_response_id END;
  RETURN jsonb_build_object('status','ready','own_submission',v_response.submission,'partner_submission',v_partner);
END; $$;

CREATE OR REPLACE FUNCTION public.wc36_invite_status(p_invite_token UUID)
RETURNS JSONB LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT jsonb_build_object('status',COALESCE((SELECT CASE WHEN c.partner_response_id IS NULL THEN 'waiting' ELSE 'full' END
    FROM public.wedding_code36_pairs c JOIN public.wedding_code36_responses owner ON owner.id=c.owner_response_id
    LEFT JOIN public.wedding_code36_responses partner ON partner.id=c.partner_response_id
    WHERE c.invite_token=p_invite_token AND owner.expires_at>now() AND owner.deleted_at IS NULL
      AND (c.partner_response_id IS NULL OR (partner.expires_at>now() AND partner.deleted_at IS NULL))),'not_found'));
$$;

CREATE OR REPLACE FUNCTION public.wc36_delete(p_response_id UUID,p_access_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_response public.wedding_code36_responses%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('wc36-pair-graph',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('wc36-response:' || p_response_id::TEXT,0));
  SELECT * INTO v_response FROM public.wedding_code36_responses r
    WHERE r.id=p_response_id AND r.access_hash=p_access_hash FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','unauthorized'); END IF;
  IF v_response.expires_at<=now() THEN RETURN jsonb_build_object('error','expired'); END IF;
  DELETE FROM public.wedding_code36_pairs WHERE owner_response_id=p_response_id OR partner_response_id=p_response_id;
  -- 원래 만료일까지 최소 재시도 표지만 남긴다. 응답 본문은 즉시 삭제한다.
  UPDATE public.wedding_code36_responses SET submission=NULL,deleted_at=COALESCE(deleted_at,now()) WHERE id=p_response_id;
  RETURN jsonb_build_object('deleted',true);
END; $$;

CREATE OR REPLACE FUNCTION public.wc36_purge_expired()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_deleted BIGINT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('wc36-pair-graph',0));
  -- 참여자 쪽 만료도 연결을 끊는다. 상대의 개인 응답은 지우지 않는다.
  DELETE FROM public.wedding_code36_pairs c USING public.wedding_code36_responses r
    WHERE r.expires_at<=now() AND (c.owner_response_id=r.id OR c.partner_response_id=r.id);
  DELETE FROM public.wedding_code36_responses WHERE expires_at<=now();
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  RETURN jsonb_build_object('deleted_count',v_deleted);
END; $$;

-- 익명/로그인 사용자의 직접 DB 호출은 금지하고 서버 API만 실행한다.
REVOKE ALL ON FUNCTION public.wc36_submit(UUID,TEXT,JSONB,UUID), public.wc36_pair(UUID,TEXT,UUID), public.wc36_read_report(UUID,TEXT), public.wc36_invite_status(UUID), public.wc36_update_sharing(UUID,TEXT,JSONB),public.wc36_delete(UUID,TEXT),public.wc36_purge_expired() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wc36_submit(UUID,TEXT,JSONB,UUID), public.wc36_pair(UUID,TEXT,UUID), public.wc36_read_report(UUID,TEXT), public.wc36_invite_status(UUID), public.wc36_update_sharing(UUID,TEXT,JSONB),public.wc36_delete(UUID,TEXT),public.wc36_purge_expired() TO service_role;
NOTIFY pgrst, 'reload schema';
