import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CurrentBaselineBlocked } from './current-baseline-release-contract.mjs';

export const LEGACY_FITTING_ACL_PROJECT_REF = 'slrtobkksjmxgzatjyqb';
export const LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER = '7581440907192989109';
export const LEGACY_FITTING_ACL_RELEASE_ID = 'legacy-fitting-acl-20260928';
export const LEGACY_FITTING_ACL_CONTRACT_FILE = 'supabase/release-contracts/legacy-fitting-acl-v1.json';
const CONTRACT_SHA256 = 'f99120618fd1d7751cc53d81e56ea187c6d88a6727f2079605ef448add22e2ae';
const RUNTIME_FILE = 'scripts/lib/legacy-fitting-acl-release.mjs';
const MAX_AGE_MS = 120_000;
const SHA256 = /^[a-f0-9]{64}$/;
const TEMPLATE_DEADLINE = '2000-01-01T00:00:00.000Z';
const digest = value => createHash('sha256').update(value).digest('hex');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const fail = code => { throw new CurrentBaselineBlocked(code); };
const need = (value, code) => { if (!value) fail(code); };
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a, b, code) => need(canonical(a) === canonical(b), code);

export const LEGACY_FITTING_ACL_PINS = Object.freeze([
  Object.freeze({ identity: 'public.cleanup_expired_fittings()', definitionSha256: 'c4eb796a6da0f0c1e1f3cdf3abc1e6138b388a3f78726ead302583b7088356aa' }),
  Object.freeze({ identity: 'public.increment_fitting_usage(uuid,date)', definitionSha256: '9b17d7a47a88cfcbbc1100416e37abddf60b43c10562ca158a424428e6c8df03' }),
]);
const expectedAcl = phase => (phase === 'before' ? ['PUBLIC', 'anon', 'authenticated', 'postgres', 'service_role'] : ['postgres', 'service_role'])
  .map(grantee => ({ grantee, grantor: 'postgres', privilege: 'EXECUTE', grantable: false }));
const expectedInventory = phase => LEGACY_FITTING_ACL_PINS.map(pin => ({ ...pin, owner: 'postgres', securityDefiner: true,
  settings: null, aclExplicit: true, acl: expectedAcl(phase), execute: phase === 'before' ? [true, true, true, true] : [false, false, true, true] }));

// 함수 본문은 원시 UTF-8 hash, ACL은 정렬한 명시 권한과 실제 상속 권한으로 대조한다.
const INVENTORY_SELECT = `SELECT COALESCE(jsonb_agg(item ORDER BY identity COLLATE "C"),'[]'::jsonb) FROM (
 SELECT 'public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ', ',')||')' AS identity,
 jsonb_build_object('identity','public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ', ',')||')',
 'owner',r.rolname,'securityDefiner',p.prosecdef,'settings',p.proconfig,
 'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
 'aclExplicit',p.proacl IS NOT NULL,
 'acl',(SELECT COALESCE(jsonb_agg(jsonb_build_object('grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
   'grantor',pg_get_userbyid(a.grantor),'privilege',a.privilege_type,'grantable',a.is_grantable)
   ORDER BY (CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) COLLATE "C",a.privilege_type,a.is_grantable),'[]'::jsonb)
   FROM aclexplode(p.proacl) a),
 'execute',jsonb_build_array(has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),
   has_function_privilege('service_role',p.oid,'EXECUTE'),has_function_privilege('postgres',p.oid,'EXECUTE'))) AS item
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
 WHERE n.nspname='public' AND p.proname IN ('cleanup_expired_fittings','increment_fitting_usage')
) observed_functions`;
const PRESERVATION_SELECT = `SELECT jsonb_build_object(
 'defaultAclSha256',(SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(d) ORDER BY oid)::text,'[]'),'UTF8')),'hex') FROM pg_default_acl d),
 'ledgerSha256',(SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'[]'),'UTF8')),'hex') FROM supabase_migrations.schema_migrations m),
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations))`;

export function buildLegacyFittingAclObservationSql() {
  return `BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SELECT jsonb_build_object('format','legacy-fitting-acl-observation-v1',
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'database',current_database(),
 'serverVersion',current_setting('server_version'),'readOnly',current_setting('transaction_read_only')='on',
 'observedAt',clock_timestamp(),'inventory',(${INVENTORY_SELECT}),'preservation',(${PRESERVATION_SELECT})) AS observation;
COMMIT;`;
}

export function validateLegacyFittingAclObservation(value, { now, phase } = {}) {
  need(value?.format === 'legacy-fitting-acl-observation-v1' && value.systemIdentifier === LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER
    && value.database === 'postgres' && /^17\./.test(value.serverVersion ?? '') && value.readOnly === true,
  'FITTING_ACL_OBSERVATION_INVALID');
  const at = Date.parse(value.observedAt), time = now?.getTime();
  need(Number.isFinite(at) && Number.isFinite(time) && at <= time + 10_000 && at > time - MAX_AGE_MS, 'FITTING_ACL_OBSERVATION_EXPIRED');
  need(value.preservation && SHA256.test(value.preservation.defaultAclSha256 ?? '') && SHA256.test(value.preservation.ledgerSha256 ?? '')
    && Number.isSafeInteger(value.preservation.ledgerCount) && value.preservation.ledgerCount >= 0, 'FITTING_ACL_PRESERVATION_INVALID');
  const actualPhase = canonical(value.inventory) === canonical(expectedInventory('before')) ? 'before'
    : canonical(value.inventory) === canonical(expectedInventory('after')) ? 'after' : null;
  need(actualPhase && (phase === undefined || actualPhase === phase), 'FITTING_ACL_INVENTORY_DRIFT');
  return actualPhase;
}

export function buildLegacyFittingAclMutationSql({ before, deadline, rehearsal }) {
  need(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) && Number.isFinite(Date.parse(deadline))
    && typeof rehearsal === 'boolean', 'FITTING_ACL_BUNDLE_INVALID');
  same(before?.inventory, expectedInventory('before'), 'FITTING_ACL_INVENTORY_DRIFT');
  need(SHA256.test(before?.preservation?.defaultAclSha256 ?? '') && SHA256.test(before?.preservation?.ledgerSha256 ?? '')
    && Number.isSafeInteger(before?.preservation?.ledgerCount) && before.preservation.ledgerCount >= 0, 'FITTING_ACL_PRESERVATION_INVALID');
  return `BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,public;
SET LOCAL standard_conforming_strings=on;
SELECT pg_advisory_xact_lock(60928,2);
DO $fitting_acl_before$ BEGIN
 IF (SELECT system_identifier::text FROM pg_control_system()) <> ${literal(LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER)}
   OR current_database() <> 'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
   THEN RAISE EXCEPTION 'FITTING_ACL_TARGET_DRIFT'; END IF;
 IF clock_timestamp() > ${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'FITTING_ACL_DEADLINE_EXPIRED'; END IF;
 IF (${INVENTORY_SELECT}) IS DISTINCT FROM ${literal(JSON.stringify(expectedInventory('before')))}::jsonb
   OR (${PRESERVATION_SELECT}) IS DISTINCT FROM ${literal(JSON.stringify(before.preservation))}::jsonb
   THEN RAISE EXCEPTION 'FITTING_ACL_BASELINE_DRIFT'; END IF;
END $fitting_acl_before$;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_fittings() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_fitting_usage(uuid,date) FROM PUBLIC, anon, authenticated;
DO $fitting_acl_after$ BEGIN
 IF (${INVENTORY_SELECT}) IS DISTINCT FROM ${literal(JSON.stringify(expectedInventory('after')))}::jsonb
   OR (${PRESERVATION_SELECT}) IS DISTINCT FROM ${literal(JSON.stringify(before.preservation))}::jsonb
   THEN RAISE EXCEPTION 'FITTING_ACL_AFTER_DRIFT'; END IF;
 IF clock_timestamp() > ${literal(deadline)}::timestamptz THEN RAISE EXCEPTION 'FITTING_ACL_DEADLINE_EXPIRED'; END IF;
END $fitting_acl_after$;
${rehearsal ? 'ROLLBACK' : 'COMMIT'};`;
}

export function loadLegacyFittingAclReleasePlan(repoRoot) {
  const file = join(repoRoot, LEGACY_FITTING_ACL_CONTRACT_FILE);
  need(!lstatSync(file).isSymbolicLink() && realpathSync(file) === resolve(file), 'FITTING_ACL_CONTRACT_PATH_INVALID');
  const bytes = readFileSync(file);
  need(digest(bytes) === CONTRACT_SHA256, 'FITTING_ACL_CONTRACT_CHANGED');
  const contract = JSON.parse(bytes);
  same(contract.functions, LEGACY_FITTING_ACL_PINS, 'FITTING_ACL_CONTRACT_CHANGED');
  need(contract.release === LEGACY_FITTING_ACL_RELEASE_ID && contract.projectRef === LEGACY_FITTING_ACL_PROJECT_REF
    && contract.systemIdentifier === LEGACY_FITTING_ACL_SYSTEM_IDENTIFIER && contract.runtimeFile === RUNTIME_FILE,
  'FITTING_ACL_CONTRACT_CHANGED');
  const templateBefore = { inventory: expectedInventory('before'), preservation: { defaultAclSha256: '0'.repeat(64), ledgerSha256: '0'.repeat(64), ledgerCount: 0 } };
  same(contract.sql, { observationSha256: digest(buildLegacyFittingAclObservationSql()),
    mutationTemplateSha256: digest(buildLegacyFittingAclMutationSql({ before: templateBefore, deadline: TEMPLATE_DEADLINE, rehearsal: true })),
    templateDeadline: TEMPLATE_DEADLINE, templatePreservation: templateBefore.preservation }, 'FITTING_ACL_SQL_CHANGED');
  const runtime = join(repoRoot, RUNTIME_FILE);
  need(realpathSync(runtime) === fileURLToPath(import.meta.url), 'FITTING_ACL_RUNTIME_PATH_INVALID');
  return { contract, contractSha256: digest(bytes), runtimeSha256: digest(readFileSync(runtime)) };
}

export function parseLegacyFittingAclArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (['--legacy-fitting-acl', '--inspect', '--rehearse', '--apply'].includes(arg)) {
      const key = arg === '--legacy-fitting-acl' ? 'selected' : 'mode';
      need(!Object.hasOwn(result, key), 'FITTING_ACL_ARGUMENT_DUPLICATE');
      result[key] = key === 'selected' ? true : arg.slice(2);
    } else {
      const match = /^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
      need(match && !Object.hasOwn(result, match[1]), 'FITTING_ACL_ARGUMENT_INVALID');
      result[match[1]] = match[2];
    }
  }
  need(result.selected && result.mode && /^[a-f0-9]{40}$/.test(result['expected-commit'] ?? '')
    && result['project-ref'] === LEGACY_FITTING_ACL_PROJECT_REF && isAbsolute(result['receipt-out'] ?? ''), 'FITTING_ACL_ARGUMENT_INVALID');
  need(result['confirm-production'] === `${LEGACY_FITTING_ACL_RELEASE_ID}:${LEGACY_FITTING_ACL_PROJECT_REF}:${result.mode}:${result['expected-commit']}`,
    'FITTING_ACL_CONFIRMATION_REQUIRED');
  return result;
}

export function assertLegacyFittingAclGitSource(repoRoot, expectedCommit) {
  // Git 저장소·작업 폴더·설정 주입이 -C 대상 검사를 바꾸지 못하게 모두 제거한다.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], { encoding: 'utf8', windowsHide: true,
    timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' } }).trim();
  need(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'FITTING_ACL_SOURCE_NOT_CLEAN_EXACT_COMMIT');
}

export function appendLegacyFittingAclReceipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    need(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset, 'FITTING_ACL_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

export function openLegacyFittingAclReceipt(file) {
  need(isAbsolute(file), 'FITTING_ACL_RECEIPT_PATH_INVALID');
  const target = resolve(file), parent = dirname(target);
  let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    const stat = lstatSync(cursor);
    need(stat.isDirectory() && !stat.isSymbolicLink(), 'FITTING_ACL_RECEIPT_PATH_INVALID');
  }
  need(realpathSync(parent) === parent, 'FITTING_ACL_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append: value => appendLegacyFittingAclReceipt(fd, value), close: () => closeSync(fd) };
}

async function managementQuery(sql, accessToken, { readOnly }) {
  try {
    need(typeof readOnly === 'boolean' && (!readOnly || sql === buildLegacyFittingAclObservationSql()), 'FITTING_ACL_QUERY_INVALID');
    const response = await fetch(`https://api.supabase.com/v1/projects/${LEGACY_FITTING_ACL_PROJECT_REF}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      // 기존 전용 controller와 같은 admin 경로다. 관측은 SQL 자체의 READ ONLY로 강제한다.
      body: JSON.stringify({ query: sql, read_only: false }), signal: AbortSignal.timeout(45_000),
    });
    need(response.ok, 'FITTING_ACL_REMOTE_OUTCOME_UNVERIFIED');
    const text = await response.text();
    need(Buffer.byteLength(text) <= 256 * 1024, 'FITTING_ACL_REMOTE_OUTCOME_UNVERIFIED');
    const rows = JSON.parse(text);
    need(Array.isArray(rows), 'FITTING_ACL_REMOTE_OUTCOME_UNVERIFIED');
    return rows;
  } catch { fail('FITTING_ACL_REMOTE_OUTCOME_UNVERIFIED'); }
}

// 주입 함수는 로컬 테스트 전용이다. 실제 controller는 고정 HTTPS·Git·계약을 사용한다.
export async function runLegacyFittingAclRelease({ repoRoot, argv, now = () => new Date(), query,
  assertSource = assertLegacyFittingAclGitSource, receiptFactory = openLegacyFittingAclReceipt } = {}) {
  const options = parseLegacyFittingAclArgs(argv ?? []);
  const receiptRelative = relative(realpathSync(repoRoot), resolve(options['receipt-out']));
  need(receiptRelative.startsWith(`..${sep}`) || isAbsolute(receiptRelative), 'FITTING_ACL_RECEIPT_PATH_INVALID');
  const plan = loadLegacyFittingAclReleasePlan(repoRoot);
  assertSource(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    need(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token ?? ''), 'FITTING_ACL_CREDENTIAL_UNAVAILABLE');
    query = (sql, options) => managementQuery(sql, token, options);
  }
  const receipt = receiptFactory(options['receipt-out']);
  const binding = { format: 'legacy-fitting-acl-runtime-v1', release: LEGACY_FITTING_ACL_RELEASE_ID,
    mode: options.mode, projectRef: LEGACY_FITTING_ACL_PROJECT_REF, releaseCommit: options['expected-commit'],
    contractSha256: plan.contractSha256, runtimeSha256: plan.runtimeSha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildLegacyFittingAclObservationSql(), { readOnly: true });
    need(Array.isArray(rows) && rows.length === 1, 'FITTING_ACL_OBSERVATION_INVALID');
    validateLegacyFittingAclObservation(rows[0].observation, { now: now() });
    return rows[0].observation;
  };
  let mutationStarted = false;
  try {
    record('started');
    const before = await observe();
    const phase = validateLegacyFittingAclObservation(before, { now: now() });
    record('before-observed', { before });
    if (options.mode === 'inspect' || phase === 'after') {
      const status = phase === 'after' ? 'already-restricted-verified' : 'inspected-unrestricted';
      record(status);
      return { status, before, remoteWritesPerformed: false };
    }
    const deadline = new Date(now().getTime() + MAX_AGE_MS).toISOString();
    const rehearsal = buildLegacyFittingAclMutationSql({ before, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearsal) });
    need(now().getTime() < Date.parse(deadline), 'FITTING_ACL_DEADLINE_EXPIRED');
    mutationStarted = true;
    const rehearsalResult = await query(rehearsal, { readOnly: false });
    need(Array.isArray(rehearsalResult), 'FITTING_ACL_REMOTE_OUTCOME_UNVERIFIED');
    const rolledBack = await observe();
    for (const key of ['inventory', 'preservation']) same(rolledBack[key], before[key], 'FITTING_ACL_REHEARSAL_NOT_ROLLED_BACK');
    record('rehearsed-and-rolled-back', { after: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', before, after: rolledBack, remoteWritesPerformed: false };
    need(now().getTime() < Date.parse(deadline), 'FITTING_ACL_DEADLINE_EXPIRED');
    assertSource(repoRoot, options['expected-commit']);
    const fresh = loadLegacyFittingAclReleasePlan(repoRoot);
    same([fresh.contractSha256, fresh.runtimeSha256], [plan.contractSha256, plan.runtimeSha256], 'FITTING_ACL_SOURCE_CHANGED');
    const apply = buildLegacyFittingAclMutationSql({ before, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(apply) });
    need(now().getTime() < Date.parse(deadline), 'FITTING_ACL_DEADLINE_EXPIRED');
    const appliedResult = await query(apply, { readOnly: false });
    need(Array.isArray(appliedResult), 'FITTING_ACL_REMOTE_OUTCOME_UNVERIFIED');
    const after = await observe();
    validateLegacyFittingAclObservation(after, { now: now(), phase: 'after' });
    same(after.preservation, before.preservation, 'FITTING_ACL_POST_APPLY_PRESERVATION_DRIFT');
    record('applied-and-postverified', { after });
    return { status: 'applied-and-postverified', before, after, remoteWritesPerformed: true };
  } catch (error) {
    const code = /^FITTING_ACL_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'FITTING_ACL_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); }
    catch { /* 사전 fsync 실패 후 어떤 원격 변경도 재전송하지 않는다. */ }
    fail(mutationStarted ? 'FITTING_ACL_OUTCOME_REQUIRES_INSPECTION' : code);
  } finally { receipt.close(); }
}
