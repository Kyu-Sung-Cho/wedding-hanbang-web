BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
-- 행 내용·함수 본문·인증 키를 반환하지 않는 전체 카탈로그 관측이다.
WITH namespaces AS MATERIALIZED (
  SELECT oid, nspname, nspowner, nspacl FROM pg_catalog.pg_namespace
  WHERE nspname <> 'information_schema' AND nspname !~ '^pg_'
), relations AS MATERIALIZED (
  SELECT c.*, n.nspname FROM pg_catalog.pg_class c JOIN namespaces n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND NOT (n.nspname = 'public' AND c.relname = 'production_release_lease_20260717')
), objects AS (
  SELECT 'relation' AS kind, format('%I.%I', c.nspname, c.relname) AS identity,
    jsonb_build_object('kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
      'acl', c.relacl, 'rls', c.relrowsecurity, 'forceRls', c.relforcerowsecurity,
      'persistence', c.relpersistence, 'replicaIdentity', c.relreplident,
      'options', c.reloptions, 'partition', pg_get_expr(c.relpartbound, c.oid),
      'view', CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END,
      'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname, a.attnum,
        format_type(a.atttypid,a.atttypmod), a.attnotnull, a.attidentity, a.attgenerated,
        a.attacl, pg_get_expr(d.adbin,d.adrelid), a.attcollation::regcollation::text)
        ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d
        ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
      'constraints', (SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid,true),
        k.convalidated,k.condeferrable,k.condeferred) ORDER BY k.conname)
        FROM pg_constraint k WHERE k.conrelid=c.oid),
      'indexes', (SELECT jsonb_agg(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,
        i.indisready,i.indisreplident) ORDER BY pg_get_indexdef(i.indexrelid))
        FROM pg_index i WHERE i.indrelid=c.oid),
      'policies', (SELECT jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
        (SELECT array_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r)
         FROM unnest(p.polroles) r), pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))
        ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid=c.oid),
      'triggers', (SELECT jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid,true),t.tgenabled)
        ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal
        AND NOT (c.nspname = 'public' AND t.tgname = 'trg_production_write_fence_20260717')),
      'rules', (SELECT jsonb_agg(pg_get_ruledef(r.oid,true) ORDER BY r.rulename)
        FROM pg_rewrite r WHERE r.ev_class=c.oid AND r.rulename<>'_RETURN'),
      'sequence', (SELECT jsonb_build_array(format_type(s.seqtypid,NULL),s.seqstart,s.seqincrement,
        s.seqmax,s.seqmin,s.seqcache,s.seqcycle) FROM pg_sequence s WHERE s.seqrelid=c.oid)) AS definition
  FROM relations c
  UNION ALL
  SELECT 'function', format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl,'owner',pg_get_userbyid(p.proowner))
  FROM pg_proc p JOIN namespaces n ON n.oid=p.pronamespace WHERE p.prokind IN ('f','p')
    AND NOT (n.nspname='public' AND p.proname IN ('production_write_fence_guard_20260717',
      'production_write_fence_attach_20260717','production_live_schema_contract_20260717'))
  UNION ALL
  SELECT 'schema',nspname,jsonb_build_array(pg_get_userbyid(nspowner),nspacl) FROM namespaces
  UNION ALL
  SELECT 'type',format('%I.%I',n.nspname,t.typname),jsonb_build_object('kind',t.typtype,
    'base',format_type(t.typbasetype,t.typtypmod),'notNull',t.typnotnull,'default',t.typdefault,
    'acl',t.typacl,'owner',pg_get_userbyid(t.typowner),'labels',(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
      FROM pg_enum e WHERE e.enumtypid=t.oid),'constraints',(SELECT jsonb_agg(pg_get_constraintdef(k.oid,true)
      ORDER BY k.conname) FROM pg_constraint k WHERE k.contypid=t.oid))
  FROM pg_type t JOIN namespaces n ON n.oid=t.typnamespace WHERE t.typtype IN ('d','e')
  UNION ALL
  SELECT 'role',r.rolname,to_jsonb(r)-'oid' FROM pg_roles r
  UNION ALL
  SELECT 'membership',format('%s:%s',pg_get_userbyid(roleid),pg_get_userbyid(member)),
    jsonb_build_array(pg_get_userbyid(grantor),admin_option,inherit_option,set_option) FROM pg_auth_members
  UNION ALL
  SELECT 'extension',extname,jsonb_build_array(extversion,n.nspname,pg_get_userbyid(extowner))
  FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  UNION ALL
  SELECT 'defaultAcl',format('%s:%s:%s',pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype),
    to_jsonb(d.defaclacl) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
  UNION ALL
  SELECT 'publication',p.pubname,jsonb_build_object('owner',pg_get_userbyid(p.pubowner),
    'allTables',p.puballtables,'insert',p.pubinsert,'update',p.pubupdate,'delete',p.pubdelete,
    'truncate',p.pubtruncate,'viaRoot',p.pubviaroot,'tables',(SELECT jsonb_agg(to_jsonb(t)-'pubname'
      ORDER BY t.schemaname,t.tablename) FROM pg_publication_tables t WHERE t.pubname=p.pubname))
  FROM pg_publication p
  UNION ALL
  SELECT 'eventTrigger',e.evtname,jsonb_build_array(e.evtevent,e.evtenabled,e.evttags,
    e.evtfoid::regprocedure::text,pg_get_userbyid(e.evtowner)) FROM pg_event_trigger e
  WHERE e.evtname NOT IN ('evt_production_write_fence_ddl_lock_20260717','evt_production_write_fence_20260717')
), fingerprints AS (
  SELECT kind,identity,encode(sha256(convert_to(definition::text,'UTF8')),'hex') AS sha256 FROM objects
)
SELECT jsonb_build_object(
  'format','current-baseline-observation-v1',
  'observedAt',clock_timestamp(),
  'readOnly',current_setting('transaction_read_only')='on',
  'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
  'serverVersion',current_setting('server_version'),
  'storageStructureSha256',(SELECT encode(sha256(convert_to((definition-'policies')::text,'UTF8')),'hex')
    FROM objects WHERE kind='relation' AND identity='storage.objects'),
  'storagePolicies',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
    'sha256',encode(sha256(convert_to(jsonb_build_array(p.polpermissive,
      (SELECT array_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(p.polroles) r),
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))::text,'UTF8')),'hex')) ORDER BY p.polname),'[]'::jsonb)
    FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass),
  'objects',(SELECT jsonb_agg(to_jsonb(f) ORDER BY kind,identity) FROM fingerprints f),
  'relations',(SELECT jsonb_agg(jsonb_build_object('schema',nspname,'name',relname,'kind',relkind)
    ORDER BY nspname,relname) FROM relations),
  'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,
    'statementsSha256',CASE WHEN statements IS NULL THEN NULL ELSE
      encode(sha256(convert_to(to_jsonb(statements)::text,'UTF8')),'hex') END)
    ORDER BY version) FROM supabase_migrations.schema_migrations),
  'vaultRows',(SELECT count(*) FROM vault.secrets),
  'cronJobs',(SELECT count(*) FROM cron.job)
) AS observation;
COMMIT;
