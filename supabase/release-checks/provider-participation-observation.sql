BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','provider-participation-observation-v1','readOnly',current_setting('transaction_read_only')='on',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'observedAt',clock_timestamp(),
 'permission',(SELECT jsonb_build_object('currentUser',current_user,'owner',pg_get_userbyid(relowner),
 'ownerUsage',pg_has_role(current_user,relowner,'USAGE'),'rls',relrowsecurity,'policyGrants',current_setting('supautils.policy_grants',true))
 FROM pg_class WHERE oid='storage.objects'::regclass),
 'target',jsonb_build_object('relations',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a) rows(value)),
 'columns',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid),(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(a.attacl,acldefault('c',c.relowner))) a) rows(value))) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) rows(value)),
 'constraints',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint
 WHERE conrelid=c.oid AND NOT(c.relnamespace='public'::regnamespace AND c.relname='account_deletion_media_manifest' AND conname IN ('account_deletion_media_bucket','account_deletion_media_source','account_deletion_media_path_shape'))) rows(value)),
 'indexes',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid) rows(value)),
 'policies',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(pg_get_userbyid(role) ORDER BY pg_get_userbyid(role)) FROM unnest(polroles) role),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))
 FROM pg_policy WHERE polrelid=c.oid AND NOT (c.relnamespace='storage'::regnamespace AND c.relname='objects' AND polname='provider_portfolio_service_only')) rows(value)),'triggers',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true)) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) rows(value))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname='public' AND c.relname IN ('business_inquiries','provider_applications','provider_audit_events','provider_media','provider_offerings','provider_profiles')) rows(value)),
 'functions',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('schema',n.nspname,'name',p.proname,'args',oidvectortypes(p.proargtypes),'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
 'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,
 'parallel',p.proparallel,'leakproof',p.proleakproof,'config',p.proconfig,'body',p.prosrc,'acl',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) rows(value))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE (n.nspname='provider_private' OR (n.nspname='public' AND p.proname LIKE 'provider\_%' ESCAPE '\'))) rows(value)),
 'manifestFunction',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('schema',n.nspname,'name',p.proname,'args',oidvectortypes(p.proargtypes),'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
 'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,
 'parallel',p.proparallel,'leakproof',p.proleakproof,'config',p.proconfig,'body',p.prosrc,'acl',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) rows(value))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname='replace_account_deletion_media_manifest') rows(value)),
 'manifestConstraints',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint
 WHERE conrelid='public.account_deletion_media_manifest'::regclass AND conname IN ('account_deletion_media_bucket','account_deletion_media_source','account_deletion_media_path_shape')) rows(value)),
 'schema',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a) rows(value))) FROM pg_namespace n WHERE n.nspname='provider_private') rows(value)),
 'policy',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(pg_get_userbyid(role) ORDER BY pg_get_userbyid(role)) FROM unnest(polroles) role),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) FROM pg_policy
 WHERE polrelid='storage.objects'::regclass AND polname='provider_portfolio_service_only') rows(value)),
 'bucket',(SELECT jsonb_build_object('id',id,'name',name,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types)
 FROM storage.buckets WHERE id='provider-portfolio')),'preservation',jsonb_build_object('catalog',md5(jsonb_build_object('relations',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',n.nspname||'.'||c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a) rows(value)),
 'columns',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid),(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(a.attacl,acldefault('c',c.relowner))) a) rows(value))) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) rows(value)),
 'constraints',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true)) FROM pg_constraint
 WHERE conrelid=c.oid AND NOT(c.relnamespace='public'::regnamespace AND c.relname='account_deletion_media_manifest' AND conname IN ('account_deletion_media_bucket','account_deletion_media_source','account_deletion_media_path_shape'))) rows(value)),
 'indexes',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid) rows(value)),
 'policies',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(pg_get_userbyid(role) ORDER BY pg_get_userbyid(role)) FROM unnest(polroles) role),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid))
 FROM pg_policy WHERE polrelid=c.oid AND NOT (c.relnamespace='storage'::regnamespace AND c.relname='objects' AND polname='provider_portfolio_service_only')) rows(value)),'triggers',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true)) FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) rows(value))) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f')
 AND n.nspname IN ('public','auth','storage') AND NOT(n.nspname='public' AND c.relname IN ('business_inquiries','provider_applications','provider_audit_events','provider_media','provider_offerings','provider_profiles'))) rows(value)),
 'functions',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_object('schema',n.nspname,'name',p.proname,'args',oidvectortypes(p.proargtypes),'arguments',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),
 'owner',pg_get_userbyid(p.proowner),'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'strict',p.proisstrict,
 'parallel',p.proparallel,'leakproof',p.proleakproof,'config',p.proconfig,'body',p.prosrc,'acl',(SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT jsonb_build_array(CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) rows(value))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','auth','storage') AND p.prokind IN ('f','p')
 AND NOT (n.nspname='provider_private' OR (n.nspname='public' AND p.proname LIKE 'provider\_%' ESCAPE '\')) AND NOT (n.nspname='public' AND p.proname='replace_account_deletion_media_manifest')) rows(value)) )::text),
 'buckets',md5((SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT to_jsonb(b) FROM storage.buckets b WHERE id<>'provider-portfolio') rows(value))::text),
 'objects',md5((SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT to_jsonb(o) FROM storage.objects o) rows(value))::text),
 'defaults',md5((SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT to_jsonb(a) FROM pg_default_acl a) rows(value))::text),
 'roleSettings',md5((SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT to_jsonb(s) FROM pg_db_role_setting s) rows(value))::text),
 'ledger',md5((SELECT coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb) FROM (SELECT to_jsonb(m) FROM supabase_migrations.schema_migrations m WHERE version NOT IN ('20260928135517','20260928140701','20260928142123')) rows(value))::text)),
 'targetLedger',(SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),'sqlMd5',md5(statements[1])) ORDER BY version),'[]'::jsonb)
 FROM supabase_migrations.schema_migrations WHERE version IN ('20260928135517','20260928140701','20260928142123')),
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations)) AS observation;
 COMMIT;
