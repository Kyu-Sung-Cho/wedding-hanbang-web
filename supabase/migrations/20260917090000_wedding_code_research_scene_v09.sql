-- WeddingCode 연구 기여 저장소가 새 장면 세트 v0.9-code의 답도 받게 한다.
-- 장면 세트를 v0.9로 바꿨지만 답 형식(A–D·- 20자리, 적어도 한 글자는 답)은 그대로다.
-- 그래서 장면 버전 CHECK의 허용 목록에 'v0.9-code' 하나만 더하고 다른 규칙은 건드리지 않는다.
-- 이미 저장된 행은 전부 'v0.8-code'이며 바꾸지 않는다. 장면이 다르면 같은 글자도 다른 질문의 답이므로,
-- 분석은 scene_version별로 따로 하고 두 버전을 한 표본으로 섞지 않는다.
-- 이 migration은 넓히기만 한다. 되돌려야 하면 앱의 연구 기여 플래그를 끈다.
-- CHECK를 다시 'v0.8-code'만으로 좁히지 않는다. 좁히면 이미 받은 v0.9-code 행 때문에 실패하거나,
-- 그 행을 보유 기간·삭제 receipt 계약 밖에서 지워야 한다.
-- 테이블·함수·권한·RLS는 바꾸지 않는다. 운영 반영은 wedding-code-research-scene-v09 릴리스 lane으로만 한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.wedding_code_research_contributions
  DROP CONSTRAINT wcr_contributions_scene_version,
  ADD CONSTRAINT wcr_contributions_scene_version CHECK (scene_version IN ('v0.8-code', 'v0.9-code'));

-- 적용 직후 다시 확인한다. 새 CHECK가 정확히 두 버전만 받는지, 제약 개수가 그대로인지,
-- RLS·정책 없음·앱 역할 권한 없음이 그대로인지, 소유자 권한 함수 세 개가 본문·설정·실행 권한까지
-- 234 그대로인지 본다. 하나라도 어긋나면 전체 트랜잭션을 되돌린다.
DO $verify_wedding_code_scene_v09$
DECLARE
  v_contributions regclass := pg_catalog.to_regclass('public.wedding_code_research_contributions');
  v_table regclass;
  v_role text;
  v_function regprocedure;
  v_body_md5 text;
BEGIN
  IF v_contributions IS NULL THEN
    RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_TABLE_MISSING';
  END IF;
  IF (SELECT pg_catalog.array_agg(pg_catalog.pg_get_constraintdef(c.oid, true))
      FROM pg_catalog.pg_constraint AS c
      WHERE c.conrelid = v_contributions AND c.conname = 'wcr_contributions_scene_version'
        AND c.contype = 'c' AND c.convalidated)
     IS DISTINCT FROM ARRAY['CHECK (scene_version = ANY (ARRAY[''v0.8-code''::text, ''v0.9-code''::text]))'] THEN
    RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_CHECK_UNEXPECTED';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint AS c
      WHERE c.conrelid = v_contributions AND c.contype <> 'n') <> 8 THEN
    RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_CONSTRAINT_SET_CHANGED';
  END IF;
  FOREACH v_table IN ARRAY ARRAY[
    v_contributions,
    pg_catalog.to_regclass('public.wedding_code_research_deletion_tombstones')
  ] LOOP
    IF v_table IS NULL OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c WHERE c.oid = v_table) THEN
      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_RLS_DISABLED';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy AS p WHERE p.polrelid = v_table) THEN
      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_POLICY_PRESENT';
    END IF;
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table,
           'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
         OR pg_catalog.has_any_column_privilege(v_role, v_table, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
        RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_TABLE_PRIVILEGE_OPEN';
      END IF;
    END LOOP;
  END LOOP;
  FOR v_function, v_body_md5 IN
    SELECT pg_catalog.to_regprocedure(f.signature), f.body_md5
    FROM (VALUES
      ('public.insert_wedding_code_research_contribution(text,text,text,bytea)', '6d85d70bfa4f428b4eeaeb97f2ee8817'),
      ('public.delete_wedding_code_research_contribution(bytea)', '8a8b384d47fcf3e3e0388c5f1e4268a6'),
      ('public.purge_expired_wedding_code_research_contributions()', '32526988ee690824453ecdb74be707da')
    ) AS f(signature, body_md5)
  LOOP
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_MISSING';
    END IF;
    IF NOT (SELECT p.prosecdef AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
                   AND pg_catalog.md5(p.prosrc) = v_body_md5
            FROM pg_catalog.pg_proc AS p WHERE p.oid = v_function) THEN
      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_CHANGED';
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_PRIVILEGE_OPEN';
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'WEDDING_CODE_SCENE_VERSION_FUNCTION_PRIVILEGE_MISSING';
    END IF;
  END LOOP;
END
$verify_wedding_code_scene_v09$;

COMMIT;
