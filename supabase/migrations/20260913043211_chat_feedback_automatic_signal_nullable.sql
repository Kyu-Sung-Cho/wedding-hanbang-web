-- 자동 신호는 대화 ID·원문 없이 저장한다. 기존 운영 테이블의 NOT NULL만 바로잡는다.
-- 수동 피드백의 UUID 검증과 RLS, 소유자 Auth 삭제 연쇄는 그대로 유지한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.chat_feedback IN ACCESS EXCLUSIVE MODE;

DO $automatic_feedback_nullable$
DECLARE
  phase integer;
  before_catalog jsonb;
  observed_catalog jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.chat_feedback'::regclass
      AND attname = 'message_id' AND atttypid = 'text'::regtype
      AND attnum > 0 AND NOT attisdropped AND attgenerated = ''
  ) THEN
    RAISE EXCEPTION 'CHAT_FEEDBACK_MESSAGE_COLUMN_UNEXPECTED';
  END IF;

  FOR phase IN 0..1 LOOP
    SELECT jsonb_build_object(
      'columns', (SELECT jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', a.atttypid, 'modifier', a.atttypmod,
        'not_null', CASE WHEN a.attname = 'message_id' THEN NULL ELSE a.attnotnull END,
        'identity', a.attidentity, 'generated', a.attgenerated,
        'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.chat_feedback'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
      'relation', (SELECT jsonb_build_object('owner', relowner, 'acl', relacl,
        'rls', relrowsecurity, 'force_rls', relforcerowsecurity)
        FROM pg_catalog.pg_class WHERE oid = 'public.chat_feedback'::regclass),
      'constraints', (SELECT jsonb_agg(jsonb_build_object('name', conname,
        'definition', pg_get_constraintdef(oid), 'validated', convalidated) ORDER BY conname)
        FROM pg_catalog.pg_constraint WHERE conrelid = 'public.chat_feedback'::regclass
          -- PostgreSQL 18은 같은 NOT NULL을 별도 catalog 제약으로도 기록한다.
          AND NOT (contype = 'n' AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
            WHERE attrelid = 'public.chat_feedback'::regclass AND attname = 'message_id')])),
      'indexes', (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid)
        FROM pg_catalog.pg_index WHERE indrelid = 'public.chat_feedback'::regclass),
      'policies', (SELECT jsonb_agg(jsonb_build_object('name', polname, 'command', polcmd,
        'permissive', polpermissive, 'roles', polroles,
        'using', pg_get_expr(polqual, polrelid), 'check', pg_get_expr(polwithcheck, polrelid)) ORDER BY polname)
        FROM pg_catalog.pg_policy WHERE polrelid = 'public.chat_feedback'::regclass),
      'triggers', (SELECT jsonb_agg(jsonb_build_object('name', tgname,
        'enabled', tgenabled, 'definition', pg_get_triggerdef(oid)) ORDER BY tgname)
        FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.chat_feedback'::regclass AND NOT tgisinternal)
    ) INTO observed_catalog;

    IF phase = 0 THEN
      before_catalog := observed_catalog;
      ALTER TABLE public.chat_feedback ALTER COLUMN message_id DROP NOT NULL;
    ELSIF observed_catalog IS DISTINCT FROM before_catalog THEN
      RAISE EXCEPTION 'CHAT_FEEDBACK_UNRELATED_CATALOG_CHANGED';
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.chat_feedback'::regclass AND attname = 'message_id' AND attnotnull) THEN
    RAISE EXCEPTION 'CHAT_FEEDBACK_MESSAGE_NULLABILITY_NOT_CHANGED';
  END IF;
END;
$automatic_feedback_nullable$;
COMMIT;
