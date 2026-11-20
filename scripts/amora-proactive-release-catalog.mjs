// 아모라 먼저 챙기기 마이그레이션 넷(2026-11-20)의 범위만 허용하는 catalog 관측식이다.
// 웨딩홀 문의 배포 길(hall-inquiry-release-catalog.mjs)의 관측식을 넓혔다. 다른 점은 넷이다.
//   1. 마이그레이션 넷(20261120100000·110000·120000·130000)을 파일 이름 순서로 한 거래 안에서 적용한다. 원장은 네 줄 는다.
//   2. 이 SQL 은 기존 객체를 바꾼다. 바꿔도 되는 기존 객체는 EXISTING_TABLE_CHANGES 와 이름이 FUNCTIONS 에 든 함수뿐이다.
//      대상 catalog 는 적용 전(before)과 적용 뒤(after) 모양을 둘 다 고정하고, 보존 catalog 에서는 정확히 그 부분만 뺀다.
//   3. 대상 모양에는 주석도 넣는다(함수 주석, 새 표 주석, 목록에 든 기존 표·칸 주석).
//   4. 맨 위 데이터 문장(메일 동의 이어받기 UPDATE 하나), 트리거 DROP, 사후 확인 DO 블록, 기존 표 ALTER 는
//      검토한 원문 그대로만 받는다(문장 sha256). 실제 허용 범위는 고정 원문 + 같은 거래 안 전후 catalog 비교로 닫는다.
import { createHash } from 'node:crypto';

export const PROJECT_REF = 'slrtobkksjmxgzatjyqb';
export const SYSTEM_IDENTIFIER = '7581440907192989109';
const frozen = value => Object.freeze(value);
const rename = (from, args, to) => frozen({ from, args, to });
// 파일 이름 순서가 적용 순서다. tables·functions 는 그 파일이 만드는 순서, renames 는 그 파일이 옮기는 함수다.
export const MIGRATIONS = frozen([
  frozen({ version: '20261120100000', name: 'amora_care_email_consent',
    file: 'supabase/migrations/20261120100000_amora_care_email_consent.sql', tables: frozen([]),
    functions: frozen(['normalize_amora_care_email_consent', 'prevent_direct_amora_care_consent_change', 'patch_profile_atomic',
      'claim_amora_care_email_delivery']),
    renames: frozen([rename('patch_profile_atomic', 'uuid, text, text, boolean, boolean, boolean, text, boolean, boolean',
      'patch_profile_atomic_pre_email_consent'),
    rename('claim_amora_care_email_delivery', 'uuid, uuid', 'claim_amora_care_email_delivery_pre_email_consent')]) }),
  frozen({ version: '20261120110000', name: 'amora_care_cadence',
    file: 'supabase/migrations/20261120110000_amora_care_cadence.sql', tables: frozen([]),
    functions: frozen(['prevent_direct_amora_care_consent_change', 'amora_care_couple_cadence', 'amora_care_is_imminent',
      'amora_care_posts_on_kst_day', 'amora_care_post_allowance', 'insert_amora_care_message', 'insert_amora_moment_care_message',
      'amora_care_cancel_job_internal', 'amora_care_release_job_internal', 'cancel_amora_care_job_source_changed',
      'prepare_amora_care_job', 'set_amora_care_cadence']),
    renames: frozen([rename('insert_amora_care_message', 'uuid, text, jsonb', 'insert_amora_care_message_pre_cadence'),
      rename('prepare_amora_care_job', 'uuid, uuid, boolean', 'prepare_amora_care_job_pre_cadence')]) }),
  frozen({ version: '20261120120000', name: 'amora_today_one_more_kinds',
    file: 'supabase/migrations/20261120120000_amora_today_one_more_kinds.sql', tables: frozen([]),
    functions: frozen(['amora_today_one_presentation_is_valid']), renames: frozen([]) }),
  frozen({ version: '20261120130000', name: 'amora_app_push',
    file: 'supabase/migrations/20261120130000_amora_app_push.sql', tables: frozen(['amora_push_preferences', 'amora_push_deliveries']),
    functions: frozen(['amora_push_clock', 'amora_push_window_open', 'get_amora_push_preference', 'set_amora_push_preference',
      'claim_amora_push_delivery', 'record_amora_push_result', 'list_amora_today_one_push_recipients']), renames: frozen([]) }),
]);
export const MIGRATION_VERSIONS = frozen(MIGRATIONS.map(m => m.version));
export const TABLES = frozen(MIGRATIONS.flatMap(m => m.tables));
export const RENAMED_FUNCTIONS = frozen(MIGRATIONS.flatMap(m => m.renames));
export const CREATED_FUNCTIONS = frozen([...new Set(MIGRATIONS.flatMap(m => m.functions))]);
// 대상 함수 이름: 새로 만들거나 CREATE OR REPLACE 로 바꾸는 함수와, 이름을 옮겨 받는 옛 함수.
export const FUNCTIONS = frozen([...CREATED_FUNCTIONS, ...RENAMED_FUNCTIONS.map(r => r.to)]);
// 적용 전에 이미 있는 대상 이름 함수(2026-09-11 운영 지문 기록과 같다). 나머지 대상 이름은 적용 전에 없어야 한다.
export const PRE_EXISTING_FUNCTIONS = frozen(['amora_today_one_presentation_is_valid', 'claim_amora_care_email_delivery',
  'insert_amora_care_message', 'insert_amora_moment_care_message', 'patch_profile_atomic', 'prepare_amora_care_job',
  'prevent_direct_amora_care_consent_change']);
// 이 SQL 이 바꾸는 기존 표의 부분. 이것 말고 기존 catalog 는 한 바이트도 바뀌면 안 된다.
export const EXISTING_TABLE_CHANGES = frozen([
  frozen({ schema: 'public', table: 'profiles',
    columns: frozen(['care_email_enabled', 'care_email_consented_at', 'care_prompt_answered_at', 'care_intensity',
      'care_window_start_hour', 'care_window_end_hour']),
    constraints: frozen(['profiles_care_email_consent_state_valid', 'profiles_care_email_requires_shared_consent',
      'profiles_care_cadence_valid']),
    triggers: frozen(['trg_normalize_amora_care_email_consent', 'trg_prevent_direct_amora_care_consent_change']),
    columnComments: frozen(['care_notifications_enabled', 'care_notifications_consented_at', 'care_email_enabled',
      'care_email_consented_at', 'care_prompt_answered_at', 'care_intensity', 'care_window_start_hour', 'care_window_end_hour']),
    tableComment: false }),
  frozen({ schema: 'public', table: 'amora_today_one_signals', columns: frozen([]),
    constraints: frozen(['amora_today_one_signals_kind_check']), triggers: frozen([]), columnComments: frozen([]), tableComment: true }),
]);
// 이 SQL 이 기대는 기존 객체. 운영에 하나라도 없으면 적용 전에 막는다(원장 숫자만으로 판단하지 않는다).
// plpgsql 본문의 칸은 실행할 때 묶이므로 반영은 통과해도 나중에 42703 으로 깨진다. 그래서 본문이 읽고 쓰는 칸도 본다.
const columnsOf = (schema, table, list) => list.map(column => [schema, table, column]);
export const PREREQUISITES = frozen({
  relations: [['auth', 'users'], ['public', 'couples'], ['public', 'profiles'], ['public', 'chat_messages'],
    ['public', 'wedding_journeys'], ['public', 'amora_care_jobs'], ['public', 'amora_care_deliveries'],
    ['public', 'amora_today_one_signals'], ['public', 'amora_today_one_preferences'],
    ['public', 'amora_today_one_recipient_states'], ['public', 'mobile_push_device_tokens']],
  columns: [...columnsOf('auth', 'users', ['id']), ...columnsOf('public', 'couples', ['id', 'bride_id', 'groom_id']),
    ...columnsOf('public', 'profiles', ['id', 'couple_id', 'updated_at', 'care_notifications_enabled',
      'care_notifications_consented_at']),
    ...columnsOf('public', 'chat_messages', ['couple_id', 'sender_id', 'sender_type', 'role', 'visibility', 'metadata', 'created_at']),
    ...columnsOf('public', 'wedding_journeys', ['couple_id', 'state_revision']),
    ...columnsOf('public', 'amora_care_jobs', ['id', 'couple_id', 'status', 'scan_day', 'content', 'email_subject', 'email_html',
      'metadata', 'attempt_count', 'available_at', 'claimed_at', 'lease_token', 'lease_expires_at', 'chat_message_id',
      'last_error', 'updated_at', 'completed_at']),
    ...columnsOf('public', 'amora_care_deliveries', ['job_id', 'user_id', 'status', 'recipient_email', 'recipient_name',
      'last_error', 'updated_at', 'completed_at']),
    ...columnsOf('public', 'amora_today_one_signals', ['kind', 'presentation']),
    ...columnsOf('public', 'amora_today_one_preferences', ['user_id', 'enabled', 'paused_until']),
    ...columnsOf('public', 'amora_today_one_recipient_states', ['recipient_user_id', 'claimed_for_date']),
    ...columnsOf('public', 'mobile_push_device_tokens', ['installation_id', 'user_id', 'push_token', 'binding_epoch',
      'revoked_at', 'revoke_reason', 'last_seen_at'])],
  functions: [['auth', 'uid', ''], ['public', 'amora_care_delivery_clock', ''],
    ['public', 'amora_today_one_text_is_safe', 'text, integer, integer'], ['public', 'get_mobile_push_delivery_targets', 'uuid']],
  // 이름으로 짚는 검증된 CHECK. 메일 동의 이어받기는 동의 칸 불변식에, 사후 확인은 kind·presentation 짝 검사에 기댄다.
  constraints: [['public', 'profiles', 'profiles_care_consent_state_valid'],
    ['public', 'amora_today_one_signals', 'amora_today_one_signals_kind_presentation_check']],
  // 새 함수가 쓰는 상태 값을 그 이름의 CHECK 가 받는지 본다.
  checkValues: [...['pending', 'processing', 'cancelled'].map(value => ['public', 'amora_care_jobs', 'amora_care_jobs_status_check', value]),
    ...['pending', 'processing', 'cancelled', 'skipped']
      .map(value => ['public', 'amora_care_deliveries', 'amora_care_deliveries_status_check', value])],
});
// 맨 위에 와도 되는 특별 문장(데이터 UPDATE, 트리거 DROP, 사후 확인 DO 블록)과 기존 표를 바꾸는 문장(ALTER TABLE,
// CREATE TRIGGER)의 검토한 원문 sha256. 원문은 앞 주석·앞뒤 공백을 뺀 문장 그대로(끝의 ; 제외)다. 두 번 오면 두 번 적는다.
//   100000 특별: UPDATE public.profiles SET care_email_enabled = true … AND care_email_enabled = false (기존 동의 이어받기),
//               DROP TRIGGER IF EXISTS trg_normalize_amora_care_email_consent ON public.profiles,
//               DROP TRIGGER IF EXISTS trg_prevent_direct_amora_care_consent_change ON public.profiles, DO $postconditions$
//   110000 특별: DROP TRIGGER IF EXISTS trg_prevent_direct_amora_care_consent_change ON public.profiles, DO $postconditions$
//   120000·130000 특별: DO $postconditions$
//   기존 표: profiles 칸 더하기·CHECK 지우기·더하기·검증과 트리거 다시 만들기(100000 아홉, 110000 다섯),
//           amora_today_one_signals kind CHECK 지우기·더하기·검증(120000 셋)
export const REVIEWED_STATEMENTS = frozen({
  '20261120100000': frozen({
    special: frozen(['4da882dd0f12741509a63bead8e6aa5a3922adda5eac2964ffa10ca9afcc4a43', '357b5586f6747a3305ed40135b2281afd78d843824980463388bf7074d953d3f',
      'b3aae7b2b7daad8551012fc9fc37e11c95f44ca29cc3af034bae47729d9696c6', 'c99b43ce57bfc385d2dc7d73c4c82101f66bd2fb33ad6527a2853143b05758f5']),
    existingTable: frozen(['218b4f0659309761a13cbdf18e8af03ee1adab17f4f87ea24d0df0724a6984bd', 'badfef5229d736cb742d7b6d26798b3491e9610907f1c467357329c1541edd91',
      '542ffb900639b7c38bac81dfb94af27e1b1d52a1bc05aa2ea72370cc8f410f13', '85308008c0dd99629c352cd159f72b44562ee34a0e97317bccee53e3429f3035',
      '86766de536392a7858e437840edb8d56af8ade2315a3b068448d81c892ab1826', '3fd6ae1922cf2a688f5c68a2d406e25f8e9c88ee48affc4dd8d3d4a57f799a67',
      'f470e9865661d9b316c67cda45550d8adff73cd9625b531c4369cc5072a44b46', '8c9e715e689d7d5f94a2963ec541c6336b22e194f68c7ae9bca47a5cccfe8be4',
      '82c42455993ee2d8e2c8eea63e01ba85cffef2f9130fc22a8847abf28a7b5b1f']) }),
  '20261120110000': frozen({
    special: frozen(['b3aae7b2b7daad8551012fc9fc37e11c95f44ca29cc3af034bae47729d9696c6', 'a17104506d6a98bd7f9fda2ae9a48bac347d346384202dcdd6886cb1cfb4b672']),
    existingTable: frozen(['31d7ce6e3cfdf30398ca5b2bd2923d6a66dc784c504d78c4a81e3eb4437bbcda', '80ab22f9bc4adc08f74d0ec774b66a98eb8c2d3cbca9538076167bf9a4433997',
      '6efd546609ab2b02f51fd185ff982dc515d2caa8de07c0a08e34bdf44dfed3b6', 'ba18505be3e7dbf1368f218de7659acda16aea6d9e787af57f5334f9bde1ea32',
      '6de1acec80b7c6b653be49c7fd5549b7f2ea8a171628e5109fa4d444e4b2bfec']) }),
  '20261120120000': frozen({
    special: frozen(['5faca452d31c9d670eb0a6f313d355a4463b9281745838671b2da2e87a8e8642']),
    existingTable: frozen(['6e05eeb3966b90d0b89f2200a820d291b8f9ac87497b5596ed68a1d81db78fcc', '318db5abc55de23c4339db00f77b134c6c34e3bf63a2240f62c554417a3daa17',
      '4865b5b6b81aa5aa899bef97bb5b6721a0955c31c93b7933a2c3386c3050f57f']) }),
  '20261120130000': frozen({
    special: frozen(['6d60d1ef855cc824e5a6e069fb5b65b5b7629675ad4cdfddf33efcc5efbddba5']), existingTable: frozen([]) }),
});
export const statementDigest = raw => createHash('sha256').update(raw, 'utf8').digest('hex');

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const names = values => values.map(literal).join(',');
// (식,…) IN ((값,…),…). 목록이 비면 false 다.
const rowIn = (expressions, rows) => (rows.length === 0 ? 'false'
  : `(${expressions.join(',')}) IN (${rows.map(row => `(${row.map(literal).join(',')})`).join(',')})`);
const listed = key => EXISTING_TABLE_CHANGES.flatMap(t => t[key].map(name => [t.schema, t.table, name]));
const CHANGED_TABLES = EXISTING_TABLE_CHANGES.map(t => [t.schema, t.table]);
const COMMENTED_TABLES = EXISTING_TABLE_CHANGES.filter(t => t.tableComment).map(t => [t.schema, t.table]);
const COLUMN = ['n.nspname', 'c.relname', 'a.attname'];
const keep = (expressions, key, include) => ` AND ${include ? '' : 'NOT '}${rowIn(expressions, listed(key))}`;
// JSON 행의 순서는 DB 기본 locale 대신 bytewise C collation으로 고정한다.
export const aggregate = query => `(SELECT COALESCE(jsonb_agg(v ORDER BY v::text COLLATE "C"),'[]'::jsonb) FROM (${query}) q(v))`;
const acl = (expression, kind) => aggregate(`SELECT jsonb_build_array(
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
 pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
 FROM aclexplode(COALESCE(${expression},acldefault('${kind}',c.${kind === 'f' ? 'proowner' : 'relowner'}))) a`);
const columnShape = filter => aggregate(`SELECT jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,
 a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid),${aggregate(`SELECT jsonb_build_array(
 CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable)
 FROM aclexplode(a.attacl) x`)}) FROM pg_attribute a
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped${filter}`);
// PostgreSQL 18의 not-null constraint는 17에 없으므로 attnotnull로만 고정한다.
const constraintShape = filter => aggregate(`SELECT jsonb_build_array(conname,contype,convalidated,pg_get_constraintdef(oid,true))
 FROM pg_constraint WHERE conrelid=c.oid AND contype<>'n'${filter}`);
const indexes = aggregate(`SELECT jsonb_build_array(pg_get_indexdef(indexrelid),indisvalid,indisready) FROM pg_index WHERE indrelid=c.oid`);
const policies = aggregate(`SELECT jsonb_build_object('name',polname,'command',polcmd,'permissive',polpermissive,
 'roles',(SELECT array_agg(CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END ORDER BY r) FROM unnest(polroles) r),
 'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) FROM pg_policy WHERE polrelid=c.oid`);
const triggerShape = filter => aggregate(`SELECT jsonb_build_array(tgname,tgenabled,pg_get_triggerdef(oid,true))
 FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal${filter}`);
const columnCommentShape = filter => aggregate(`SELECT jsonb_build_array(a.attname,col_description(c.oid,a.attnum)) FROM pg_attribute a
 WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped AND col_description(c.oid,a.attnum) IS NOT NULL${filter}`);
const relationCore = ({ columns = '', constraints = '', triggers = '' } = {}) => `jsonb_build_object('name',n.nspname||'.'||c.relname,
 'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
 'acl',${acl('c.relacl', 'r')},'columns',${columnShape(columns)},'constraints',${constraintShape(constraints)},
 'indexes',${indexes},'policies',${policies},'triggers',${triggerShape(triggers)})`;
const newRelationShape = `(${relationCore()} || jsonb_build_object('comment',obj_description(c.oid,'pg_class'),
 'columnComments',${columnCommentShape('')}))`;
// 기존 표에서는 목록에 든 칸·CHECK·트리거·주석만 대상이다. 그 밖의 부분은 보존 catalog 가 본다.
const changedPartsShape = `jsonb_build_object('name',n.nspname||'.'||c.relname,
 'columns',${columnShape(keep(COLUMN, 'columns', true))},
 'constraints',${constraintShape(keep(['n.nspname', 'c.relname', 'conname'], 'constraints', true))},
 'triggers',${triggerShape(keep(['n.nspname', 'c.relname', 'tgname'], 'triggers', true))},
 'comment',CASE WHEN ${rowIn(['n.nspname', 'c.relname'], COMMENTED_TABLES)} THEN obj_description(c.oid,'pg_class') END,
 'columnComments',${columnCommentShape(keep(COLUMN, 'columnComments', true))})`;
const functionShape = `jsonb_build_object('name',c.proname,'args',oidvectortypes(c.proargtypes),
 'result',pg_get_function_result(c.oid),'definition',pg_get_functiondef(c.oid),'language',l.lanname,'owner',pg_get_userbyid(c.proowner),
 'securityDefiner',c.prosecdef,'volatility',c.provolatile,'strict',c.proisstrict,'parallel',c.proparallel,'kind',c.prokind,
 'config',c.proconfig,'body',c.prosrc,'comment',obj_description(c.oid,'pg_proc'),'acl',${acl('c.proacl', 'f')})`;
const sequenceShape = `jsonb_build_object('name',n.nspname||'.'||c.relname,'owner',pg_get_userbyid(c.relowner),
 'acl',${acl('c.relacl', 's')},'type',format_type(s.seqtypid,NULL),'start',s.seqstart,'increment',s.seqincrement,
 'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle)`;

export function targetCatalogSql() {
  return `jsonb_build_object('relations',${aggregate(`SELECT ${newRelationShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname IN (${names(TABLES)})`)},
 'functions',${aggregate(`SELECT ${functionShape} FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace
 JOIN pg_language l ON l.oid=c.prolang WHERE n.nspname='public' AND c.proname IN (${names(FUNCTIONS)})`)},
 'existingRelations',${aggregate(`SELECT ${changedPartsShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p') AND ${rowIn(['n.nspname', 'c.relname'], CHANGED_TABLES)}`)})`;
}
// 보존 catalog 는 대상 모양에 더해 소유자 변경·옵션·뷰 정의·규칙·주석·publication 소속까지 본다(웨딩홀 길과 같다).
// 목록에 든 기존 표의 부분(칸·CHECK·트리거·표 주석·칸 주석)만 뺀다.
const preservedRelationShape = `(${relationCore({ columns: keep(COLUMN, 'columns', false),
  constraints: keep(['n.nspname', 'c.relname', 'conname'], 'constraints', false),
  triggers: keep(['n.nspname', 'c.relname', 'tgname'], 'triggers', false) })} || jsonb_build_object('options',c.reloptions,
 'view',CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid,true) END,
 'rules',${aggregate(`SELECT jsonb_build_array(r.rulename,pg_get_ruledef(r.oid,true)) FROM pg_rewrite r
 WHERE r.ev_class=c.oid AND r.rulename<>'_RETURN'`)},
 'comment',CASE WHEN ${rowIn(['n.nspname', 'c.relname'], COMMENTED_TABLES)} THEN NULL ELSE obj_description(c.oid,'pg_class') END,
 'columnComments',${columnCommentShape(keep(COLUMN, 'columnComments', false))},
 'publications',${aggregate(`SELECT to_jsonb(p.pubname) FROM pg_publication_rel pr JOIN pg_publication p ON p.oid=pr.prpubid
 WHERE pr.prrelid=c.oid`)}))`;
export function preservedCatalogSql() {
  return `(SELECT md5(jsonb_build_object('relations',${aggregate(`SELECT ${preservedRelationShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','auth','storage','cron') AND c.relkind IN ('r','p','v','m','f')
 AND NOT(n.nspname='public' AND c.relname IN (${names(TABLES)}))`)},
 'functions',${aggregate(`SELECT jsonb_build_array(n.nspname,c.proname,oidvectortypes(c.proargtypes),md5(pg_get_functiondef(c.oid)),c.proacl,
 pg_get_userbyid(c.proowner),obj_description(c.oid,'pg_proc'))
 FROM pg_proc c JOIN pg_namespace n ON n.oid=c.pronamespace WHERE n.nspname IN ('public','auth','storage','cron') AND c.prokind IN ('f','p')
 AND NOT(n.nspname='public' AND c.proname IN (${names(FUNCTIONS)}))`)},
 'sequences',${aggregate(`SELECT ${sequenceShape} FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_sequence s ON s.seqrelid=c.oid WHERE n.nspname IN ('public','auth','storage','cron')`)},
 'defaultAcl',${aggregate(`SELECT jsonb_build_array(pg_get_userbyid(d.defaclrole),COALESCE(n.nspname,''),d.defaclobjtype,d.defaclacl)
 FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace`)},
 'schemas',${aggregate(`SELECT jsonb_build_array(nspname,pg_get_userbyid(nspowner),nspacl) FROM pg_namespace
 WHERE nspname IN ('public','auth','storage','cron')`)}
 )::text))`;
}
// catalog 만 읽는다. 읽기 전용 관측 역할은 auth 스키마 USAGE 가 없을 수 있어 to_regclass 대신 pg_class 를 본다.
const relationOf = (schema, table) => `JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(table)}`;
export function missingPrerequisitesSql() {
  const rows = [
    ...PREREQUISITES.relations.map(([schema, name]) => `SELECT ${literal(`relation:${schema}.${name}`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(name)} AND c.relkind IN ('r','p'))`),
    ...PREREQUISITES.columns.map(([schema, table, column]) => `SELECT ${literal(`column:${schema}.${table}.${column}`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname=${literal(schema)} AND c.relname=${literal(table)} AND a.attname=${literal(column)} AND a.attnum>0 AND NOT a.attisdropped)`),
    ...PREREQUISITES.functions.map(([schema, name, args]) => `SELECT ${literal(`function:${schema}.${name}(${args})`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname=${literal(schema)} AND p.proname=${literal(name)} AND oidvectortypes(p.proargtypes)=${literal(args)})`),
    ...PREREQUISITES.constraints.map(([schema, table, constraint]) => `SELECT ${literal(`constraint:${schema}.${table}.${constraint}`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_constraint k ${relationOf(schema, table)} AND k.contype='c' AND k.conname=${literal(constraint)} AND k.convalidated)`),
    ...PREREQUISITES.checkValues.map(([schema, table, constraint, value]) => `SELECT ${literal(`check:${schema}.${table}.${constraint}:${value}`)}::text WHERE NOT EXISTS(
 SELECT 1 FROM pg_constraint k ${relationOf(schema, table)} AND k.contype='c' AND k.conname=${literal(constraint)}
 AND pg_get_constraintdef(k.oid) LIKE ${literal(`%'${value}'%`)})`),
  ];
  return `(SELECT COALESCE(jsonb_agg(to_jsonb(v) ORDER BY v COLLATE "C"),'[]'::jsonb) FROM (${rows.join('\n UNION ALL ')}) q(v))`;
}
export function ledgerDigestSql(excludeTarget = false) {
  return `(SELECT md5(COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version)::text,'[]'))
 FROM supabase_migrations.schema_migrations${excludeTarget ? ` WHERE version NOT IN (${names(MIGRATION_VERSIONS)})` : ''})`;
}
const ledgerRowsSql = `(SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'name',name,'statementCount',cardinality(statements),
 'sqlMd5',md5(statements[1])) ORDER BY version),'[]'::jsonb)
 FROM supabase_migrations.schema_migrations WHERE version IN (${names(MIGRATION_VERSIONS)}))`;
const databaseIdentitySql = `(SELECT system_identifier::text FROM pg_control_system())=${literal(SYSTEM_IDENTIFIER)}
 AND current_database()='postgres'
 AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
 AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role'))=3`;
export const targetIdentitySql = `${databaseIdentitySql} AND current_user='postgres'
 AND has_schema_privilege(current_user,'public','CREATE')
 AND has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT')
 AND has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT')`;
// Management API의 read_only:true는 전용 최소권한 역할로 실행된다.
const observationIdentitySql = `${databaseIdentitySql} AND current_user='supabase_read_only_user'
 AND has_schema_privilege(current_user,'public','USAGE')
 AND has_table_privilege(current_user,'supabase_migrations.schema_migrations','SELECT')
 AND NOT has_table_privilege(current_user,'supabase_migrations.schema_migrations','INSERT')
 AND NOT has_schema_privilege(current_user,'public','CREATE')`;

export function buildObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
 SELECT jsonb_build_object('format','amora-proactive-catalog-v1','identityReady',(${observationIdentitySql}),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'serverVersion',current_setting('server_version'),
 'database',current_database(),'currentUser',current_user,'readOnly',current_setting('transaction_read_only')='on',
 'observedAt',clock_timestamp(),'catalog',${targetCatalogSql()},'preservedCatalogSha',${preservedCatalogSql()},
 'missingPrerequisites',${missingPrerequisitesSql()},
 'ledgerSha',${ledgerDigestSql()},'ledgerWithoutTargetSha',${ledgerDigestSql(true)},
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'ledgerHead',(SELECT max(version) FROM supabase_migrations.schema_migrations),'migrations',${ledgerRowsSql}) AS observation; COMMIT;`;
}

// 맨 위 SQL 을 문장 단위로 나눈다. 줄 주석·블록 주석·문자열('…', E'…' 의 백슬래시)·큰따옴표 이름·달러 따옴표 본문은
// 그대로 건너뛰어 그 안의 ; 와 낱말을 문장으로 보지 않는다(웨딩홀 길의 topLevelStatements 와 같은 규칙).
// normalized 는 문자열을 '' 로, 본문을 $body$ 로, 주석을 공백으로 바꾼 글이고 raw 는 원문 그대로(앞뒤 공백 제외)다.
// PostgreSQL 이름에 이어 쓸 수 있는 글자(ident_cont: 영문·숫자·_·$·0x80 이상) 바로 뒤의 e' 와 $tag$ 는 이름의 일부다.
const IDENTIFIER_CHAR = /[A-Za-z0-9_$\u0080-\uFFFF]/u;
const tokenInvalid = () => { throw new Error('APRO_SQL_TOKEN_INVALID'); };
function skipQuoted(sql, i, escaped) {
  let j = i + 1;
  for (;;) {
    if (j >= sql.length) tokenInvalid();
    if (escaped && sql[j] === '\\') { j += 2; continue; }
    if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } return j + 1; }
    j += 1;
  }
}
function skipIdentifier(sql, i) {
  let j = i + 1;
  for (;;) { if (j >= sql.length) tokenInvalid(); if (sql[j] === '"') { if (sql[j + 1] === '"') { j += 2; continue; } return j + 1; } j += 1; }
}
export function splitStatements(sql) {
  const statements = [];
  let normalized = '', start = -1, i = 0;
  const finish = end => {
    if (normalized.trim()) statements.push({ normalized: normalized.trim(), raw: sql.slice(start, end).trim() });
    normalized = ''; start = -1;
  };
  while (i < sql.length) {
    const ch = sql[i], next = sql[i + 1];
    if (ch === '-' && next === '-') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; normalized += ' '; continue; }
    if (ch === '/' && next === '*') { const end = sql.indexOf('*/', i + 2); if (end < 0) tokenInvalid(); i = end + 2; normalized += ' '; continue; }
    if (ch === ';') { finish(i); i += 1; continue; }
    if (/\s/u.test(ch)) { normalized += ch; i += 1; continue; }
    if (start < 0) start = i;
    if (ch === "'") {
      i = skipQuoted(sql, i, /[Ee]/u.test(sql[i - 1] ?? '') && !IDENTIFIER_CHAR.test(sql[i - 2] ?? '')); normalized += "''"; continue;
    }
    if (ch === '"') { const end = skipIdentifier(sql, i); normalized += sql.slice(i, end); i = end; continue; }
    if (ch === '$' && !IDENTIFIER_CHAR.test(sql[i - 1] ?? '')) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/u.exec(sql.slice(i, i + 64))?.[0];
      if (tag) { const end = sql.indexOf(tag, i + tag.length); if (end < 0) tokenInvalid(); i = end + tag.length; normalized += ' $body$ '; continue; }
    }
    normalized += ch; i += 1;
  }
  if (normalized.trim()) finish(sql.length);
  return statements;
}
export const topLevelStatements = sql => splitStatements(sql).map(statement => statement.normalized);
const TRANSACTION_CONTROL = /^(?:BEGIN|COMMIT|ROLLBACK|END|ABORT|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION|SET\s+(?:SESSION\s+)?TRANSACTION|SET\s+SESSION\s+CHARACTERISTICS)\b/iu;

// 파일은 머리 주석(없어도 된다) 뒤에 BEGIN; 으로 열고 마지막 줄 COMMIT; 으로 닫는다. 그 사이 본문만 돌려준다.
export function unwrapMigration(sql) {
  const lines = sql.split('\n');
  let first = 0;
  while (first < lines.length && /^\s*(?:--.*)?$/u.test(lines[first])) first += 1;
  if (first >= lines.length || lines[first] !== 'BEGIN;') throw new Error('APRO_SQL_TRANSACTION_BOUNDARY_INVALID');
  const rest = lines.slice(first + 1).join('\n');
  const end = /(?:^|\n)COMMIT;\s*$/u.exec(rest);
  if (!end) throw new Error('APRO_SQL_TRANSACTION_BOUNDARY_INVALID');
  const body = rest.slice(0, end.index + (rest[end.index] === '\n' ? 1 : 0));
  let statements;
  try { statements = topLevelStatements(body); } catch { throw new Error('APRO_SQL_TRANSACTION_BOUNDARY_INVALID'); }
  // 본문의 어느 문장도 거래를 끝내거나 나누지 못한다. 그래야 연습 묶음의 마지막 ROLLBACK 이 전부를 되돌린다.
  if (statements.some(statement => TRANSACTION_CONTROL.test(statement))) throw new Error('APRO_SQL_TRANSACTION_BOUNDARY_INVALID');
  return body;
}

// 맨 위 SELECT·VALUES 도 함수를 불러 행을 바꿀 수 있어 특별 문장으로 본다. 검토한 원문에는 하나도 없다.
const SPECIAL_HEAD = /^(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|DO|CALL|COPY|MERGE|WITH|EXECUTE|PREPARE|REASSIGN|SELECT|VALUES)\b/iu;
const ARGS = '\\(([^()]*)\\)';
const canonicalArgs = text => text.split(',').map(part => part.trim()).filter(Boolean).join(', ');
// 문장 하나의 종류와 짚는 이름. 공백은 한 칸으로 줄여 본다(문자열·본문·주석은 이미 걷혔다).
export function classifyStatement(normalized) {
  const text = normalized.replace(/\s+/gu, ' ').trim();
  const match = pattern => new RegExp(pattern, 'iu').exec(text);
  let m;
  if (SPECIAL_HEAD.test(text)) return { kind: 'special' };
  if (match("^SET LOCAL (?:lock_timeout|statement_timeout) = ''$")) return { kind: 'set-local-timeout' };
  if ((m = match('^CREATE TABLE (?:IF NOT EXISTS )?public\\.([a-z_0-9]+) ?\\('))) return { kind: 'create-table', table: m[1] };
  if ((m = match('^CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?[a-z_0-9]+ ON (?:ONLY )?public\\.([a-z_0-9]+) ?\\(')))
    return { kind: 'create-index', table: m[1] };
  if ((m = match('^CREATE (?:OR REPLACE )?FUNCTION public\\.([a-z_0-9]+) ?\\('))) return { kind: 'create-function', name: m[1] };
  if ((m = match('^CREATE TRIGGER ([a-z_0-9]+) (?:BEFORE|AFTER) .*? ON public\\.([a-z_0-9]+) FOR EACH ROW EXECUTE FUNCTION public\\.([a-z_0-9]+)\\(\\)$')))
    return { kind: 'create-trigger', name: m[1], table: m[2], function: m[3] };
  if ((m = match('^ALTER TABLE public\\.([a-z_0-9]+) [A-Z]'))) return { kind: 'alter-table', table: m[1] };
  if ((m = match(`^ALTER FUNCTION public\\.([a-z_0-9]+)${ARGS} OWNER TO postgres$`)))
    return { kind: 'alter-function-owner', name: m[1], args: canonicalArgs(m[2]) };
  if ((m = match(`^ALTER FUNCTION public\\.([a-z_0-9]+)${ARGS} RENAME TO ([a-z_0-9]+)$`)))
    return { kind: 'alter-function-rename', name: m[1], args: canonicalArgs(m[2]), to: m[3] };
  if ((m = match(`^(?:GRANT EXECUTE|REVOKE ALL) ON FUNCTION public\\.([a-z_0-9]+)${ARGS} (?:TO|FROM) [a-z_, A-Z]+$`)))
    return { kind: 'function-privilege', name: m[1], args: canonicalArgs(m[2]) };
  if ((m = match('^REVOKE ALL ON TABLE public\\.([a-z_0-9]+) FROM [a-z_, A-Z]+$'))) return { kind: 'table-privilege', table: m[1] };
  if ((m = match("^COMMENT ON TABLE public\\.([a-z_0-9]+) IS ''$"))) return { kind: 'comment-table', table: m[1] };
  if ((m = match("^COMMENT ON COLUMN public\\.([a-z_0-9]+)\\.([a-z_0-9]+) IS ''$")))
    return { kind: 'comment-column', table: m[1], column: m[2] };
  if ((m = match(`^COMMENT ON FUNCTION public\\.([a-z_0-9]+)${ARGS} IS ''$`))) return { kind: 'comment-function', name: m[1] };
  return { kind: 'unknown' };
}

const scopeFail = code => { const error = new Error(code); error.code = code; throw error; };
const multisetEqual = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const tableChange = table => EXISTING_TABLE_CHANGES.find(t => t.schema === 'public' && t.table === table);
// 보조 정적 검사다. 파일 하나의 맨 위 문장이 이 길이 검토한 범위 안인지 본다. 실패하면 그 이유의 코드를 던진다.
export function assertStaticScope(migration, body) {
  const created = { tables: [], functions: [], renames: [] }, special = [], alters = [];
  for (const { normalized, raw } of splitStatements(body)) {
    const statement = classifyStatement(normalized);
    const existing = 'table' in statement && !TABLES.includes(statement.table);
    switch (statement.kind) {
      case 'special': special.push(statementDigest(raw)); break;
      case 'set-local-timeout': break;
      case 'create-table': created.tables.push(statement.table); break;
      case 'create-function': created.functions.push(statement.name); break;
      case 'alter-function-rename': created.renames.push(`${statement.name}(${statement.args})>${statement.to}`); break;
      case 'alter-function-owner': case 'function-privilege': case 'comment-function':
        if (!FUNCTIONS.includes(statement.name)) scopeFail('APRO_DDL_FUNCTION_SCOPE_INVALID'); break;
      case 'create-index': case 'table-privilege': if (existing) scopeFail('APRO_DDL_EXISTING_TABLE_SCOPE_INVALID'); break;
      case 'alter-table': if (existing) alters.push(statementDigest(raw)); break;
      case 'create-trigger':
        if (existing && !tableChange(statement.table)?.triggers.includes(statement.name)) scopeFail('APRO_DDL_EXISTING_TABLE_SCOPE_INVALID');
        if (!FUNCTIONS.includes(statement.function)) scopeFail('APRO_DDL_FUNCTION_SCOPE_INVALID');
        if (existing) alters.push(statementDigest(raw)); break;
      case 'comment-table': if (existing && !tableChange(statement.table)?.tableComment) scopeFail('APRO_DDL_EXISTING_TABLE_SCOPE_INVALID'); break;
      case 'comment-column':
        if (existing && !tableChange(statement.table)?.columnComments.includes(statement.column)) scopeFail('APRO_DDL_EXISTING_TABLE_SCOPE_INVALID');
        break;
      default: scopeFail('APRO_DDL_STATEMENT_FORBIDDEN');
    }
  }
  const reviewed = REVIEWED_STATEMENTS[migration.version];
  if (!reviewed || !multisetEqual(special, reviewed.special)) scopeFail('APRO_TOP_LEVEL_DML_FORBIDDEN');
  if (JSON.stringify(created.tables) !== JSON.stringify(migration.tables)) scopeFail('APRO_DDL_TABLE_SCOPE_INVALID');
  if (JSON.stringify(created.functions) !== JSON.stringify(migration.functions)
    || JSON.stringify(created.renames) !== JSON.stringify(migration.renames.map(r => `${r.from}(${r.args})>${r.to}`)))
    scopeFail('APRO_DDL_FUNCTION_SCOPE_INVALID');
  if (!multisetEqual(alters, reviewed.existingTable)) scopeFail('APRO_DDL_EXISTING_TABLE_SCOPE_INVALID');
  return { special: special.length, existingTable: alters.length };
}

const md5Text = /^[a-f0-9]{32}$/u;
// 새 표는 빈 채로 끝나고, profiles 의 새 칸은 기본값이며 메일 동의는 이어받기 규칙 그대로여야 한다(거래 안에서 profiles 는 잠겨 있다).
const profileDataDrift = `EXISTS(SELECT 1 FROM public.profiles WHERE
 care_email_enabled IS DISTINCT FROM (care_notifications_enabled IS TRUE AND care_notifications_consented_at IS NOT NULL)
 OR care_email_consented_at IS DISTINCT FROM (CASE WHEN care_notifications_enabled IS TRUE THEN care_notifications_consented_at END)
 OR care_prompt_answered_at IS NOT NULL OR care_intensity IS DISTINCT FROM 'normal'
 OR care_window_start_hour IS DISTINCT FROM 9 OR care_window_end_hour IS DISTINCT FROM 20)`;
// 관측 JSON 과 고정 JSON 은 키 순서와 무관하게 비교한다(묶음 안의 jsonb 비교도 순서를 보지 않는다).
const canonical = value => (Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value);
const sameJson = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function buildMutationSql({ sqls, before, beforeCatalog, catalog, deadline, rehearsal }) {
  if (!Array.isArray(sqls) || sqls.length !== MIGRATIONS.length || !sqls.every(sql => typeof sql === 'string' && sql.length > 0)
      || ![before?.ledgerSha, before?.preservedCatalogSha].every(v => md5Text.test(v ?? ''))
      || !Number.isSafeInteger(before?.ledgerCount) || before.ledgerCount < 1
      || !Array.isArray(before.migrations) || before.migrations.length !== 0
      || !beforeCatalog || typeof beforeCatalog !== 'object' || !sameJson(before.catalog, beforeCatalog)
      || !Array.isArray(before.missingPrerequisites) || before.missingPrerequisites.length !== 0
      || !catalog || typeof catalog !== 'object'
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(deadline ?? '')
      || typeof rehearsal !== 'boolean') throw new Error('APRO_MUTATION_BASELINE_INVALID');
  const bodies = sqls.map(sql => `${unwrapMigration(sql)} SET LOCAL search_path=pg_catalog,public;\n`).join('');
  return `BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';
 SET LOCAL search_path=pg_catalog,public; SET LOCAL standard_conforming_strings=on;
 SELECT pg_advisory_xact_lock(61120,10); LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 DO $apro_before$ BEGIN
 IF NOT (${targetIdentitySql}) THEN RAISE EXCEPTION 'APRO_TARGET_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'APRO_DEADLINE_EXPIRED'; END IF;
 IF ${missingPrerequisitesSql()} IS DISTINCT FROM '[]'::jsonb THEN RAISE EXCEPTION 'APRO_PREREQUISITE_MISSING'; END IF;
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(before.catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql()} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount}
 THEN RAISE EXCEPTION 'APRO_BASELINE_DRIFT'; END IF;
 END $apro_before$;
${bodies} INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
 VALUES${MIGRATIONS.map((m, i) => `(${literal(m.version)},${literal(m.name)},ARRAY[${literal(sqls[i])}]::text[])`).join(',\n ')};
 DO $apro_after$ BEGIN
 IF ${targetCatalogSql()} IS DISTINCT FROM ${literal(JSON.stringify(catalog))}::jsonb
 OR ${preservedCatalogSql()} IS DISTINCT FROM ${literal(before.preservedCatalogSha)}
 OR ${ledgerDigestSql(true)} IS DISTINCT FROM ${literal(before.ledgerSha)}
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${before.ledgerCount + MIGRATIONS.length}
 ${TABLES.map(table => `OR EXISTS(SELECT 1 FROM public.${table})`).join('\n ')}
 OR ${profileDataDrift}
 THEN RAISE EXCEPTION 'APRO_AFTER_DRIFT'; END IF;
 IF clock_timestamp()>${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'APRO_DEADLINE_EXPIRED'; END IF;
 END $apro_after$;
 ${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}
