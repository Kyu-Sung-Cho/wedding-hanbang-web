-- WeddingCode 연구 기여 저장소(opt-in, 익명). 동의 버전·장면 버전·20자리 답 코드와
-- 참여자가 보관하는 삭제 receipt의 HMAC hash만 받는다. 사용자 ID·IP·user agent·자유서술,
-- 계정·아모라·커플과 잇는 결합 키는 두지 않는다. 응답은 최대 60일, tombstone은 30일 보관한다.
-- 시각은 UTC 날짜(자정)로만 남긴다. 분석·요청 로그와 시각으로 이어 붙일 수 없게 한다.
-- 런타임 접근은 소유자 권한으로 도는 아래 함수 세 개뿐이며 service_role만 실행할 수 있다.
-- 운영 반영은 wedding-code-research-contributions 릴리스 lane으로만 한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE public.wedding_code_research_contributions (
  id uuid CONSTRAINT wcr_contributions_pkey PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT date_trunc('day', now(), 'UTC')
    CONSTRAINT wcr_contributions_created_at_day CHECK (created_at = date_trunc('day', created_at, 'UTC')),
  expires_at timestamptz NOT NULL DEFAULT (date_trunc('day', now(), 'UTC') + interval '60 days'),
  scene_version text NOT NULL
    CONSTRAINT wcr_contributions_scene_version CHECK (scene_version = 'v0.8-code'),
  answer_code text NOT NULL
    CONSTRAINT wcr_contributions_answer_code CHECK (answer_code ~ '^[A-D-]{20}$' AND answer_code ~ '[A-D]'),
  consent_version text NOT NULL
    CONSTRAINT wcr_contributions_consent_version CHECK (consent_version ~ '^wc-research-consent-v[1-9][0-9]*$'),
  deletion_receipt_hash bytea NOT NULL
    CONSTRAINT wcr_contributions_receipt_hash_key UNIQUE
    CONSTRAINT wcr_contributions_receipt_hash_length CHECK (octet_length(deletion_receipt_hash) = 32),
  CONSTRAINT wcr_contributions_retention
    CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 days')
);
CREATE INDEX wcr_contributions_expires_at_idx
  ON public.wedding_code_research_contributions (expires_at);

-- 삭제한 receipt hash와 삭제 날짜만 남긴다. 답·동의·장면 버전은 넣지 않는다.
CREATE TABLE public.wedding_code_research_deletion_tombstones (
  deletion_receipt_hash bytea
    CONSTRAINT wcr_tombstones_pkey PRIMARY KEY
    CONSTRAINT wcr_tombstones_receipt_hash_length CHECK (octet_length(deletion_receipt_hash) = 32),
  deleted_at timestamptz NOT NULL DEFAULT date_trunc('day', now(), 'UTC')
    CONSTRAINT wcr_tombstones_deleted_at_day CHECK (deleted_at = date_trunc('day', deleted_at, 'UTC')),
  expires_at timestamptz NOT NULL DEFAULT (date_trunc('day', now(), 'UTC') + interval '30 days')
);
CREATE INDEX wcr_tombstones_expires_at_idx
  ON public.wedding_code_research_deletion_tombstones (expires_at);

-- 정책은 만들지 않는다. RLS를 켜고 모든 앱 역할의 테이블 권한을 거둔다.
ALTER TABLE public.wedding_code_research_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_code_research_deletion_tombstones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.wedding_code_research_contributions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.wedding_code_research_deletion_tombstones FROM PUBLIC, anon, authenticated, service_role;

-- 같은 receipt hash의 저장과 삭제를 한 줄로 세운다. 동시에 들어와도 삭제 뒤 저장이 살아남지 않는다.
CREATE FUNCTION public.insert_wedding_code_research_contribution(
  p_scene_version text,
  p_answer_code text,
  p_consent_version text,
  p_deletion_receipt_hash bytea
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  DELETE FROM public.wedding_code_research_contributions
    WHERE expires_at <= pg_catalog.now();
  DELETE FROM public.wedding_code_research_deletion_tombstones
    WHERE expires_at <= pg_catalog.now();
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'wedding_code_research:' || pg_catalog.encode(p_deletion_receipt_hash, 'hex'), 0));
  IF EXISTS (
    SELECT 1 FROM public.wedding_code_research_deletion_tombstones AS tombstone
    WHERE tombstone.deletion_receipt_hash = p_deletion_receipt_hash
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WEDDING_CODE_RESEARCH_CONTRIBUTION_REJECTED';
  END IF;
  -- 형식 검증은 테이블 CHECK가 맡는다. 어긋나면 INSERT가 예외를 낸다.
  -- 같은 hash가 이미 있으면 UNIQUE 위반(23505)을 그대로 올린다. 호출자는 이를 같은 요청의 재시도로 본다.
  INSERT INTO public.wedding_code_research_contributions
    (scene_version, answer_code, consent_version, deletion_receipt_hash)
  VALUES (p_scene_version, p_answer_code, p_consent_version, p_deletion_receipt_hash);
END;
$function$;
REVOKE ALL ON FUNCTION public.insert_wedding_code_research_contribution(text, text, text, bytea)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_wedding_code_research_contribution(text, text, text, bytea) TO service_role;

-- 행이 있었는지와 무관하게 같은 결과를 낸다. 응답으로 존재 여부를 알 수 없다.
CREATE FUNCTION public.delete_wedding_code_research_contribution(p_deletion_receipt_hash bytea)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_deletion_receipt_hash IS NULL OR pg_catalog.octet_length(p_deletion_receipt_hash) <> 32 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'WEDDING_CODE_RESEARCH_CONTRIBUTION_REJECTED';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'wedding_code_research:' || pg_catalog.encode(p_deletion_receipt_hash, 'hex'), 0));
  DELETE FROM public.wedding_code_research_contributions
    WHERE deletion_receipt_hash = p_deletion_receipt_hash;
  INSERT INTO public.wedding_code_research_deletion_tombstones (deletion_receipt_hash)
  VALUES (p_deletion_receipt_hash)
  ON CONFLICT (deletion_receipt_hash) DO NOTHING;
END;
$function$;
REVOKE ALL ON FUNCTION public.delete_wedding_code_research_contribution(bytea)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_wedding_code_research_contribution(bytea) TO service_role;

-- 만료됐거나 receipt가 이미 삭제된(tombstone이 있는) 응답 행을 지우고, 그 뒤 만료 tombstone을 지운다.
-- 함수 밖 경로로 tombstone과 같은 hash의 응답 행이 남아 있으면 여기서 지운다. 전체 DB 복원은 tombstone도
-- 함께 되돌리므로 그 경우 재삭제를 보장하지 않는다. 지운 응답 행 수를 돌려준다.
CREATE FUNCTION public.purge_expired_wedding_code_research_contributions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.wedding_code_research_contributions AS contribution
    WHERE contribution.expires_at <= pg_catalog.now()
       OR EXISTS (
         SELECT 1 FROM public.wedding_code_research_deletion_tombstones AS tombstone
         WHERE tombstone.deletion_receipt_hash = contribution.deletion_receipt_hash
       );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.wedding_code_research_deletion_tombstones
    WHERE expires_at <= pg_catalog.now();
  RETURN v_deleted;
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_expired_wedding_code_research_contributions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_wedding_code_research_contributions() TO service_role;

-- 적용 직후 권한 경계를 다시 확인한다. 하나라도 어긋나면 전체 트랜잭션을 되돌린다.
DO $verify_wedding_code_research$
DECLARE
  v_table regclass;
  v_function regprocedure;
  v_role text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    pg_catalog.to_regclass('public.wedding_code_research_contributions'),
    pg_catalog.to_regclass('public.wedding_code_research_deletion_tombstones')
  ] LOOP
    IF v_table IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_table) THEN
      RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_RLS_DISABLED';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p WHERE p.polrelid = v_table) THEN
      RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_POLICY_PRESENT';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table,
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
         OR pg_catalog.has_any_column_privilege(v_role, v_table, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_TABLE_PRIVILEGE_OPEN';
      END IF;
    END LOOP;
  END LOOP;
  FOREACH v_function IN ARRAY ARRAY[
    pg_catalog.to_regprocedure('public.insert_wedding_code_research_contribution(text,text,text,bytea)'),
    pg_catalog.to_regprocedure('public.delete_wedding_code_research_contribution(bytea)'),
    pg_catalog.to_regprocedure('public.purge_expired_wedding_code_research_contributions()')
  ] LOOP
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_FUNCTION_MISSING';
    END IF;
    IF NOT (SELECT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
            FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function) THEN
      RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_FUNCTION_NOT_DEFINER';
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_FUNCTION_PRIVILEGE_OPEN';
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'WEDDING_CODE_RESEARCH_FUNCTION_PRIVILEGE_MISSING';
    END IF;
  END LOOP;
END
$verify_wedding_code_research$;

COMMIT;
