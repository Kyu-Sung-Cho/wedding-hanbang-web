-- Auth 삭제 후에는 사용자 식별자 없이 사유만 기록한다.
-- 기존 감사 행과 finalizer, 권한은 보존하고 legacy NOT NULL만 바로잡는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.account_deletions IN ACCESS EXCLUSIVE MODE;

DO $anonymous_deletion_audit_nullable$
DECLARE
  phase integer;
  before_catalog jsonb;
  observed_catalog jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE a.attrelid = 'public.account_deletions'::regclass
      AND c.relkind = 'r' AND a.attname = 'user_id' AND a.atttypid = 'uuid'::regtype
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '' AND a.attidentity = ''
      AND d.oid IS NULL
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUDIT_USER_COLUMN_UNEXPECTED';
  END IF;

  FOR phase IN 0..1 LOOP
    SELECT jsonb_build_object(
      'columns', (SELECT jsonb_agg(jsonb_build_object(
        'name', a.attname, 'type', a.atttypid, 'modifier', a.atttypmod,
        'not_null', CASE WHEN a.attname = 'user_id' THEN NULL ELSE a.attnotnull END,
        'identity', a.attidentity, 'generated', a.attgenerated,
        'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = 'public.account_deletions'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
      'relation', (SELECT jsonb_build_object('owner', relowner, 'acl', relacl,
        'rls', relrowsecurity, 'force_rls', relforcerowsecurity)
        FROM pg_catalog.pg_class WHERE oid = 'public.account_deletions'::regclass),
      'constraints', (SELECT jsonb_agg(jsonb_build_object('name', conname,
        'definition', pg_get_constraintdef(oid), 'validated', convalidated) ORDER BY conname)
        FROM pg_catalog.pg_constraint WHERE conrelid = 'public.account_deletions'::regclass
          -- PostgreSQL 18은 같은 NOT NULL을 별도 catalog 제약으로도 기록한다.
          AND NOT (contype = 'n' AND conkey = ARRAY[(SELECT attnum FROM pg_catalog.pg_attribute
            WHERE attrelid = 'public.account_deletions'::regclass AND attname = 'user_id')])),
      'indexes', (SELECT jsonb_agg(pg_get_indexdef(indexrelid) ORDER BY indexrelid)
        FROM pg_catalog.pg_index WHERE indrelid = 'public.account_deletions'::regclass),
      'policies', (SELECT jsonb_agg(jsonb_build_object('name', polname, 'command', polcmd,
        'permissive', polpermissive, 'roles', polroles,
        'using', pg_get_expr(polqual, polrelid), 'check', pg_get_expr(polwithcheck, polrelid)) ORDER BY polname)
        FROM pg_catalog.pg_policy WHERE polrelid = 'public.account_deletions'::regclass),
      'triggers', (SELECT jsonb_agg(jsonb_build_object('name', tgname,
        'enabled', tgenabled, 'definition', pg_get_triggerdef(oid)) ORDER BY tgname)
        FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.account_deletions'::regclass AND NOT tgisinternal)
    ) INTO observed_catalog;

    IF phase = 0 THEN
      before_catalog := observed_catalog;
      ALTER TABLE public.account_deletions ALTER COLUMN user_id DROP NOT NULL;
    ELSIF observed_catalog IS DISTINCT FROM before_catalog THEN
      RAISE EXCEPTION 'ACCOUNT_DELETION_AUDIT_UNRELATED_CATALOG_CHANGED';
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.account_deletions'::regclass AND attname = 'user_id' AND attnotnull) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_AUDIT_USER_NULLABILITY_NOT_CHANGED';
  END IF;
END;
$anonymous_deletion_audit_nullable$;
COMMIT;
