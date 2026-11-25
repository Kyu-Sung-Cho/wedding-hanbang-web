#!/usr/bin/env node
// 아모라 먼저 챙기기 마이그레이션 넷(20261120100000·110000·120000·130000)만 운영 DB 에 반영하는 좁은 배포 길(2026-11-20).
// 웨딩홀 문의 배포 길(scripts/hall-inquiry-release.mjs)과 같은 꼴이다: 고정 원문·catalog 확인 → 읽기 전용 점검 →
// 같은 거래 안 연습 뒤 되돌림 확인 → 정확한 SQL 넷을 파일 이름 순서로 한 번 반영 → 읽기 전용 사후 확인. 영수증은 Git 밖에 남긴다.
// 다른 점: 이 SQL 은 기존 객체(profiles 칸·CHECK·트리거·주석, amora_today_one_signals kind CHECK·주석, 함수 27개)를 바꾼다.
// 그래서 대상 catalog 의 적용 전 모양도 고정해 두고 점검 때 운영과 바이트까지 대조한다.
// 이 파일이 하지 않는 것: Vercel 배포, 발송 스위치 켜기. 운영 반영은 소유자가 정확한 커밋으로만 부른다.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStaticScope, buildMutationSql, buildObservationSql, EXISTING_TABLE_CHANGES, FUNCTIONS, MIGRATIONS,
  PRE_EXISTING_FUNCTIONS, PROJECT_REF, RENAMED_FUNCTIONS, SYSTEM_IDENTIFIER, TABLES, unwrapMigration } from './amora-proactive-release-catalog.mjs';
import { loadPlan as loadHallInquiryPlan } from './hall-inquiry-release.mjs';
import { loadPlan as loadWeddingCode36Plan } from './wedding-code36-release.mjs';

export const RELEASE = 'amora-proactive-20261120';
// 이 길이 올라선 운영 main. 이 커밋의 supabase/migrations·release-contracts·scripts/lib 원문을 그대로 보존한다.
export const BASE_COMMIT = '98c3e1184ad6999e3aec179329bf9809ec53d5b6';
export const MANIFEST = 'supabase/release-contracts/amora-proactive-v1.json';
export const MIGRATION_FILES = Object.freeze(MIGRATIONS.map(m => m.file));
export const FIXTURE = 'supabase/release-contracts/amora-proactive-pg-catalog-v1.json';
export const PREDECESSOR_SNAPSHOT = 'supabase/release-contracts/amora-proactive-predecessor-build-inputs-v1.json';
const RUNTIME = 'scripts/amora-proactive-release.mjs';
const CATALOG = 'scripts/amora-proactive-release-catalog.mjs';
const PREPARE = 'scripts/amora-proactive-release-prepare.mjs';
const FIXTURE_SOURCE = 'scripts/amora-proactive-release-fixture.mjs';
const BUILD_CONTRACT = 'scripts/amora-proactive-release-build-contract.mjs';
export const PINNED_FILES = Object.freeze([...MIGRATION_FILES, FIXTURE, RUNTIME, CATALOG, PREPARE, FIXTURE_SOURCE, BUILD_CONTRACT,
  PREDECESSOR_SNAPSHOT]);
const SHA = /^[a-f0-9]{64}$/u;
const MD5 = /^[a-f0-9]{32}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
// 운영에서 이 역할들에게는 새 표·칸·함수 권한이 하나도 없어야 한다. 회원은 authenticated, 운영자는 service_role 이다.
const NO_ACCESS_ROLES = new Set(['PUBLIC', 'anon']);
export const digest = value => createHash('sha256').update(value).digest('hex');
const md5 = value => createHash('md5').update(value).digest('hex');
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const requireValue = (value, code) => { if (!value) fail(code); };
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const same = (a, b, code) => requireValue(JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)), code);
const sorted = values => [...values].sort();

export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (['--inspect', '--rehearse', '--apply', '--verify'].includes(arg)) {
      requireValue(!Object.hasOwn(options, 'mode'), 'APRO_MODE_DUPLICATE'); options.mode = arg.slice(2); continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|baseline-receipt|confirm-production)=(.+)$/u.exec(arg);
    requireValue(match && !Object.hasOwn(options, match[1]), 'APRO_ARGUMENT_INVALID'); options[match[1]] = match[2];
  }
  requireValue(options.mode && GIT_SHA.test(options['expected-commit'] ?? '') && options['project-ref'] === PROJECT_REF
    && isAbsolute(options['receipt-out'] ?? ''), 'APRO_ARGUMENT_REQUIRED');
  requireValue(options['confirm-production'] === `${RELEASE}:${PROJECT_REF}:${options.mode}:${options['expected-commit']}`,
    'APRO_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED');
  requireValue(options.mode !== 'verify' || isAbsolute(options['baseline-receipt'] ?? ''), 'APRO_BASELINE_RECEIPT_REQUIRED');
  requireValue(options.mode === 'verify' || options['baseline-receipt'] === undefined, 'APRO_BASELINE_ARGUMENT_INVALID');
  return options;
}

function safeArtifact(root, file) {
  const path = resolve(root, file), rel = relative(resolve(root), path);
  requireValue(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'APRO_ARTIFACT_PATH_INVALID');
  let cursor = resolve(root);
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(!stat.isSymbolicLink(), 'APRO_ARTIFACT_SYMLINK_FORBIDDEN');
  }
  requireValue(lstatSync(path).isFile(), 'APRO_ARTIFACT_NOT_FILE');
  return readFileSync(path);
}

const grantees = entries => (Array.isArray(entries) ? entries : []).map(entry => entry?.[0]);
const opensTo = (entries, roles) => grantees(entries).some(role => roles.has(role));
const isCatalog = catalog => catalog && Array.isArray(catalog.relations) && Array.isArray(catalog.functions)
  && Array.isArray(catalog.existingRelations);
const partNames = (part, key) => (Array.isArray(part?.[key]) ? part[key].map(entry => entry?.[0]) : null);

// 고정 catalog 가 이 길의 범위와 최소 권한을 지키는지 본다. 운영 관측은 이 값과 바이트까지 비교한다.
function validateFixtureCatalog(before, after) {
  requireValue(isCatalog(before) && isCatalog(after), 'APRO_FIXTURE_INVALID');
  same(before.relations, [], 'APRO_FIXTURE_TABLES_INVALID');
  same(after.relations.map(r => r.name).sort(), TABLES.map(n => `public.${n}`).sort(), 'APRO_FIXTURE_TABLES_INVALID');
  same(before.functions.map(f => f.name).sort(), sorted(PRE_EXISTING_FUNCTIONS), 'APRO_FIXTURE_FUNCTIONS_INVALID');
  same(after.functions.map(f => f.name).sort(), sorted(FUNCTIONS), 'APRO_FIXTURE_FUNCTIONS_INVALID');
  // 이름을 옮겨 받은 옛 함수는 적용 전 그 이름 함수의 본문을 그대로 갖는다(감싸기만 한다).
  for (const { from, args, to } of RENAMED_FUNCTIONS) {
    const old = before.functions.find(f => f.name === from && f.args === args), moved = after.functions.find(f => f.name === to);
    requireValue(old && moved && moved.args === args && moved.body === old.body, 'APRO_FIXTURE_FUNCTIONS_INVALID');
  }
  const tables = EXISTING_TABLE_CHANGES.map(t => `${t.schema}.${t.table}`).sort();
  same(before.existingRelations.map(r => r.name).sort(), tables, 'APRO_FIXTURE_EXISTING_TABLES_INVALID');
  same(after.existingRelations.map(r => r.name).sort(), tables, 'APRO_FIXTURE_EXISTING_TABLES_INVALID');
  for (const change of EXISTING_TABLE_CHANGES) {
    const part = after.existingRelations.find(r => r.name === `${change.schema}.${change.table}`);
    requireValue(JSON.stringify(sorted(partNames(part, 'columns') ?? [0])) === JSON.stringify(sorted(change.columns))
      && JSON.stringify(sorted(partNames(part, 'constraints') ?? [0])) === JSON.stringify(sorted(change.constraints))
      && JSON.stringify(sorted(partNames(part, 'triggers') ?? [0])) === JSON.stringify(sorted(change.triggers))
      && JSON.stringify(sorted(partNames(part, 'columnComments') ?? [0])) === JSON.stringify(sorted(change.columnComments))
      && part.constraints.every(entry => entry[2] === true) && part.triggers.every(entry => entry[1] === 'O')
      && (change.tableComment ? typeof part.comment === 'string' && part.comment.length > 0 : part.comment === null)
      && part.columns.every(column => !opensTo(column[6], NO_ACCESS_ROLES)), 'APRO_FIXTURE_EXISTING_TABLES_INVALID');
  }
  requireValue(after.relations.every(r => r.owner === 'postgres' && r.rls === true && r.forceRls === true && !opensTo(r.acl, NO_ACCESS_ROLES)
    && Array.isArray(r.columns) && r.columns.every(column => !opensTo(column[6], NO_ACCESS_ROLES))
    && Array.isArray(r.policies) && r.policies.every(policy => !(policy.roles ?? ['PUBLIC']).some(role => NO_ACCESS_ROLES.has(role)))),
  'APRO_FIXTURE_PRIVILEGES_INVALID');
  requireValue(after.functions.every(f => f.owner === 'postgres' && !opensTo(f.acl, NO_ACCESS_ROLES)
    && Array.isArray(f.config) && f.config.some(entry => typeof entry === 'string' && entry.startsWith('search_path='))),
  'APRO_FIXTURE_PRIVILEGES_INVALID');
}

function loadMigration(migration, bytes) {
  const sql = bytes.toString('utf8');
  requireValue(!sql.includes('\r') && !sql.includes('\0'), 'APRO_MIGRATION_ENCODING_INVALID');
  let body;
  try { body = unwrapMigration(sql); } catch { fail('APRO_SQL_TRANSACTION_BOUNDARY_INVALID'); }
  // 보조 정적 검사다. 실제 허용 범위는 고정 원문 + 같은 거래 안 전후 catalog 비교로 닫는다.
  try { assertStaticScope(migration, body); } catch (error) {
    fail(/^APRO_[A-Z0-9_]+$/u.test(error?.code ?? '') ? error.code : 'APRO_SQL_TRANSACTION_BOUNDARY_INVALID');
  }
  return { ...migration, sql, sqlSha256: digest(bytes) };
}

export function loadPlan(repoRoot) {
  let manifest;
  try { manifest = JSON.parse(safeArtifact(repoRoot, MANIFEST)); } catch { fail('APRO_MANIFEST_UNAVAILABLE'); }
  requireValue(manifest.version === 1 && manifest.kind === 'amora-proactive-scoped-release'
    && manifest.release === RELEASE && manifest.status === 'requires-scoped-runtime-evidence'
    && manifest.projectRef === PROJECT_REF && manifest.systemIdentifier === SYSTEM_IDENTIFIER
    && manifest.baseCommit === BASE_COMMIT && manifest.existingData === 'profiles-default-columns-and-care-email-consent-backfill-only'
    && manifest.newRows === 'none' && manifest.runtimeEvidenceVerified === false && manifest.productionApplyImplemented === true,
  'APRO_MANIFEST_CONTRACT_INVALID');
  same(manifest.migrations, MIGRATIONS.map(m => ({ version: m.version, name: m.name, file: m.file })), 'APRO_MANIFEST_CONTRACT_INVALID');
  same(manifest.scope, expectedScope(), 'APRO_MANIFEST_SCOPE_INVALID');
  same((manifest.artifacts ?? []).map(pin => pin.file).sort(), sorted(PINNED_FILES), 'APRO_ARTIFACT_SET_INVALID');
  const contents = new Map();
  for (const pin of manifest.artifacts) {
    requireValue(SHA.test(pin.sha256 ?? ''), 'APRO_ARTIFACT_HASH_INVALID');
    const bytes = safeArtifact(repoRoot, pin.file);
    requireValue(digest(bytes) === pin.sha256, 'APRO_ARTIFACT_HASH_MISMATCH'); contents.set(pin.file, bytes);
  }
  const migrations = MIGRATIONS.map(m => loadMigration(m, contents.get(m.file)));
  let fixture;
  try { fixture = JSON.parse(contents.get(FIXTURE)); } catch { fail('APRO_FIXTURE_INVALID'); }
  requireValue(fixture.format === 'amora-proactive-catalog-fixture-v1', 'APRO_FIXTURE_INVALID');
  same(fixture.migrations, migrations.map(m => ({ file: m.file, sha256: m.sqlSha256 })), 'APRO_FIXTURE_INVALID');
  validateFixtureCatalog(fixture.before, fixture.after);
  return { manifest, manifestSha256: digest(safeArtifact(repoRoot, MANIFEST)), migrations, sqls: migrations.map(m => m.sql),
    beforeCatalog: fixture.before, catalog: fixture.after, sqlSha256s: migrations.map(m => m.sqlSha256),
    fixtureSha256: digest(contents.get(FIXTURE)) };
}

export function expectedScope() {
  return { newTables: TABLES.map(n => `public.${n}`), functions: FUNCTIONS.map(n => `public.${n}`),
    preExistingFunctions: PRE_EXISTING_FUNCTIONS.map(n => `public.${n}`),
    renamedFunctions: RENAMED_FUNCTIONS.map(r => `public.${r.from}(${r.args}) -> public.${r.to}`),
    existingTableChanges: EXISTING_TABLE_CHANGES.map(t => ({ table: `${t.schema}.${t.table}`, columns: [...t.columns],
      constraints: [...t.constraints], triggers: [...t.triggers], columnComments: [...t.columnComments], tableComment: t.tableComment })),
    existingFunctions: 'unchanged-except-listed', existingTables: 'unchanged-except-listed-parts',
    auth: 'unchanged', storage: 'unchanged', cron: 'unchanged' };
}

// 운영 반영은 이 길이 검토한 변경만 담은 커밋에서만 한다. CI 의 정적 검사는 다른 변경이 섞여도 돈다.
const SCOPE_PREFIXES = ['apps/web/src/', 'apps/mobile/app/', 'apps/mobile/src/', 'packages/shared/src/'];
const SCOPE_FILES = new Set(['turbo.json', 'apps/web/.env.example', 'apps/web/vercel.json', 'packages/shared/package.json',
  'apps/web/vendorDisclosureProductionBuildFence.ts', '.github/workflows/ci.yml', 'scripts/verify-local.mjs',
  'scripts/repository-test-manifest.json', 'scripts/tests/amora-runtime-env-contract.test.mjs',
  'scripts/tests/amora-action-view-v2-current-source-rejection.test.mjs', 'scripts/tests/ci-signal-integrity.test.mjs',
  'scripts/tests/qa-merged-preflight.test.mjs', 'scripts/tests/repo-tests-are-all-wired.test.mjs',
  'scripts/tests/supabase-explicit-budget-static-fence.test.mjs', ...MIGRATION_FILES]);
const SCOPE_PATTERNS = [/^scripts\/(?:tests\/)?amora-proactive-release[^/]*\.mjs$/u, /^supabase\/release-contracts\/amora-proactive-[^/]*\.json$/u];
export const inReleaseScope = file => typeof file === 'string' && (SCOPE_FILES.has(file)
  || SCOPE_PREFIXES.some(prefix => file.startsWith(prefix)) || SCOPE_PATTERNS.some(pattern => pattern.test(file)));

export function validateSourceChanges(changed, { staticOnly = false } = {}) {
  requireValue(Array.isArray(changed) && changed.every(file => typeof file === 'string') && typeof staticOnly === 'boolean',
    'APRO_SOURCE_SCOPE_ARGUMENT_INVALID');
  if (staticOnly) return;
  requireValue(changed.length > 0 && MIGRATION_FILES.every(file => changed.includes(file)) && changed.every(inReleaseScope),
    'APRO_SOURCE_SCOPE_DRIFT');
}

const gitRunner = (repoRoot, timeout) => (args, input) => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
  encoding: 'utf8', input, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024,
  stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
}).trim();

export function assertSource(repoRoot, expectedCommit, { staticOnly = false } = {}) {
  const git = gitRunner(repoRoot, 15_000);
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'APRO_SOURCE_NOT_CLEAN_EXACT_COMMIT');
  const origin = git(['remote', 'get-url', 'origin']);
  requireValue(/^https:\/\/github\.com\/Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(origin)
    || /^git@github\.com:Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(origin), 'APRO_ORIGIN_MISMATCH');
  try { git(['merge-base', '--is-ancestor', BASE_COMMIT, expectedCommit]); } catch { fail('APRO_BASE_COMMIT_NOT_ANCESTOR'); }
  // 이름 바꾸기 감지를 끈다. 켜 두면 기존 파일을 범위 안 경로로 옮긴 변경이 새 경로 하나로만 보인다.
  const changed = git(['diff', '--name-only', '--no-renames', BASE_COMMIT, expectedCommit]).split(/\r?\n/u).filter(Boolean);
  validateSourceChanges(changed, { staticOnly });
  // 운영 반영 때도 CI 의 정적 검사(기준 원문 보존·정확한 마이그레이션 묶음·앞선 두 길 원문)를 다시 본다.
  if (!staticOnly) assertPredecessorPins(repoRoot);
}

// 기준 커밋의 모든 기존 마이그레이션·릴리스 계약·scripts/lib 원문을 보존하고, 새 SQL 은 이 넷뿐인지 본다.
// 웨딩홀 문의 길과 36문항 길의 고정 원문(실행기·catalog·빌드 계약 포함)도 그대로인지 그 길의 loadPlan 으로 함께 본다.
export function assertPredecessorPins(repoRoot) {
  try { loadHallInquiryPlan(repoRoot); loadWeddingCode36Plan(repoRoot); } catch { fail('APRO_PREDECESSOR_LANE_INVALID'); }
  const git = gitRunner(repoRoot, 30_000);
  const old = git(['ls-tree', '-r', BASE_COMMIT, '--', 'supabase/migrations', 'supabase/release-contracts', 'scripts/lib'])
    .split(/\r?\n/u).filter(Boolean).map(line => {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
      requireValue(match, 'APRO_PREDECESSOR_TREE_INVALID'); return { oid: match[1], file: match[2] };
    });
  requireValue(old.length > 100, 'APRO_PREDECESSOR_TREE_INCOMPLETE');
  for (const pin of old) safeArtifact(repoRoot, pin.file);
  const hashes = git(['hash-object', '--no-filters', '--stdin-paths'], `${old.map(pin => pin.file).join('\n')}\n`).split(/\r?\n/u);
  requireValue(hashes.length === old.length && hashes.every((hash, i) => hash === old[i].oid), 'APRO_PREDECESSOR_PIN_DRIFT');
  const expectedSql = [...old.filter(pin => pin.file.startsWith('supabase/migrations/')).map(pin => pin.file.split('/').at(-1)),
    ...MIGRATION_FILES.map(file => file.split('/').at(-1))].sort();
  same(readdirSync(resolve(repoRoot, 'supabase/migrations')).filter(name => /\.sql$/iu.test(name)).sort(), expectedSql,
    'APRO_UNREVIEWED_MIGRATION');
  return { preservedPredecessorFiles: old.length, migrationCount: expectedSql.length };
}

export function checkLocalOnly(repoRoot, expectedCommit) {
  const plan = loadPlan(repoRoot);
  const pins = assertPredecessorPins(repoRoot);
  if (expectedCommit !== undefined) {
    requireValue(GIT_SHA.test(expectedCommit), 'APRO_LOCAL_SOURCE_ARGUMENT_INVALID');
    assertSource(repoRoot, expectedCommit, { staticOnly: true });
  }
  return { status: 'local-manifest-and-predecessor-pins-verified', sqlSha256s: plan.sqlSha256s, migrationCount: pins.migrationCount,
    preservedPredecessorFiles: pins.preservedPredecessorFiles, remoteWritesPerformed: false, deploymentAuthorized: false };
}

// 원장 네 줄은 모두 없거나(적용 전) 모두 검토한 원문 그대로 있어야(적용 뒤) 한다. 일부만 있으면 충돌이다.
const appliedRows = plan => plan.migrations.map(m => ({ version: m.version, name: m.name, statementCount: 1, sqlMd5: md5(m.sql) }));
export function validateObservation(observed, plan, now = new Date()) {
  requireValue(observed?.format === 'amora-proactive-catalog-v1' && observed.identityReady === true && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM_IDENTIFIER && /^17\./u.test(observed.serverVersion ?? '')
    && observed.database === 'postgres' && observed.currentUser === 'supabase_read_only_user'
    && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(v => MD5.test(v ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0 && /^\d{14}$/u.test(observed.ledgerHead ?? '')
    && Array.isArray(observed.missingPrerequisites) && Array.isArray(observed.migrations), 'APRO_OBSERVATION_INVALID');
  const time = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(time) && time > now.getTime() - 120_000 && time <= now.getTime() + 10_000,
    'APRO_OBSERVATION_EXPIRED');
  requireValue(observed.missingPrerequisites.length === 0, 'APRO_PREREQUISITE_MISSING');
  if (observed.migrations.length === 0) {
    same(observed.catalog, plan.beforeCatalog, 'APRO_TARGET_BEFORE_DRIFT');
    requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'APRO_LEDGER_CONFLICT');
  } else {
    same(observed.migrations, appliedRows(plan), 'APRO_APPLIED_LEDGER_CONFLICT');
    same(observed.catalog, plan.catalog, 'APRO_APPLIED_CATALOG_DRIFT');
  }
  return observed;
}

function assertOutside(repoRoot, path) {
  const rel = relative(resolve(repoRoot), resolve(path));
  requireValue(isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`), 'APRO_RECEIPT_MUST_BE_OUTSIDE_GIT');
}
function openReceipt(repoRoot, path) {
  assertOutside(repoRoot, path);
  const target = resolve(path), parent = dirname(target); let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/u).filter(Boolean)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'APRO_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'APRO_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append(record) { const bytes = Buffer.from(`${JSON.stringify(record)}\n`); let offset = 0;
    while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset, null);
      requireValue(Number.isSafeInteger(n) && n > 0 && n <= bytes.length - offset, 'APRO_RECEIPT_WRITE_FAILED'); offset += n; }
    fsyncSync(fd); }, close() { closeSync(fd); } };
}

// 관측에는 적용 전이든 뒤든 대상 catalog 전체가 실린다(함수 27개의 정의와 본문). 응답 상한은 웨딩홀 길과 같은 1MiB 다.
export const MANAGEMENT_RESPONSE_LIMIT_BYTES = 1024 * 1024;
export async function managementQuery(sql, { readOnly, token }) {
  requireValue(typeof readOnly === 'boolean' && /^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'APRO_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // 마이그레이션이 statement_timeout 을 60초로 올리고 반영 묶음의 마감은 120초다. 그보다 먼저 끊지 않는다.
      body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(130_000),
    });
    requireValue(response.ok, 'APRO_REMOTE_OUTCOME_UNVERIFIED');
    const bytes = await response.text();
    requireValue(Buffer.byteLength(bytes) <= MANAGEMENT_RESPONSE_LIMIT_BYTES, 'APRO_REMOTE_RESPONSE_LIMIT');
    const rows = JSON.parse(bytes); requireValue(Array.isArray(rows), 'APRO_REMOTE_RESPONSE_INVALID'); return rows;
  } catch { fail('APRO_REMOTE_OUTCOME_UNVERIFIED'); }
}

export async function runRelease({ repoRoot, argv, now = () => new Date(), query, source = assertSource,
  receiptFactory = openReceipt, baselineReader = file => readFileSync(file, 'utf8') } = {}) {
  const options = parseArgs(argv ?? []), plan = loadPlan(repoRoot);
  source(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'APRO_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
    query = (sql, queryOptions) => managementQuery(sql, { ...queryOptions, token });
  }
  const receipt = receiptFactory(repoRoot, options['receipt-out']);
  const binding = { format: 'amora-proactive-release-receipt-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT_REF, releaseCommit: options['expected-commit'], baseCommit: BASE_COMMIT,
    manifestSha256: plan.manifestSha256, sqlSha256s: plan.sqlSha256s, fixtureSha256: plan.fixtureSha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildObservationSql(), { readOnly: true });
    requireValue(rows.length === 1 && rows[0].observation, 'APRO_OBSERVATION_RESPONSE_INVALID');
    return validateObservation(rows[0].observation, plan, now());
  };
  const unchanged = (a, b) => {
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'ledgerHead', 'migrations'])
      same(a[key], b[key], 'APRO_REHEARSAL_NOT_ROLLED_BACK');
  };
  const verifyApplied = (before, after) => {
    requireValue(before.migrations.length === 0 && after.migrations.length === MIGRATIONS.length
      && after.ledgerCount === before.ledgerCount + MIGRATIONS.length
      && after.ledgerWithoutTargetSha === before.ledgerSha && after.preservedCatalogSha === before.preservedCatalogSha,
    'APRO_POST_APPLY_UNVERIFIED');
  };
  let mutationStarted = false;
  try {
    record('started');
    const before = await observe(); record('before-observed', { observation: before,
      backupScope: 'metadata-only-pinned-before-catalog-and-existing-catalog-ledger-digests-no-customer-rows' });
    if (options.mode === 'verify') {
      assertOutside(repoRoot, options['baseline-receipt']);
      let records;
      try { records = baselineReader(options['baseline-receipt']).trim().split(/\r?\n/u).map(line => JSON.parse(line)); }
      catch { fail('APRO_BASELINE_RECEIPT_INVALID'); }
      const baseline = records.find(r => r.status === 'before-observed' && r.format === binding.format
        && r.release === RELEASE && r.projectRef === PROJECT_REF && r.mode === 'apply'
        && r.releaseCommit === binding.releaseCommit && r.baseCommit === BASE_COMMIT
        && r.manifestSha256 === binding.manifestSha256 && JSON.stringify(r.sqlSha256s) === JSON.stringify(binding.sqlSha256s)
        && r.fixtureSha256 === binding.fixtureSha256 && Array.isArray(r.observation?.migrations) && r.observation.migrations.length === 0);
      requireValue(baseline, 'APRO_BASELINE_RECEIPT_BINDING_INVALID'); verifyApplied(baseline.observation, before);
      record('applied-and-readonly-postverified', { observation: before });
      return { status: 'applied-and-readonly-postverified', remoteWritesPerformed: false };
    }
    if (options.mode === 'inspect' || before.migrations.length !== 0) {
      const status = before.migrations.length ? 'already-applied-catalog-verified' : 'inspected-before-catalog-verified';
      record(status); return { status, remoteWritesPerformed: false };
    }
    const deadline = new Date(now().getTime() + 120_000).toISOString();
    const mutation = rehearsal => buildMutationSql({ sqls: plan.sqls, before, beforeCatalog: plan.beforeCatalog, catalog: plan.catalog,
      deadline, rehearsal });
    const rehearsal = mutation(true);
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearsal), retryProhibitedOnAmbiguity: true });
    mutationStarted = true;
    await query(rehearsal, { readOnly: false });
    const rolledBack = await observe(); unchanged(before, rolledBack);
    record('rehearsed-and-rolled-back', { observation: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', remoteWritesPerformed: false,
      temporaryTransactionalWritesPerformed: true };
    requireValue(now().getTime() < Date.parse(deadline), 'APRO_DEADLINE_EXPIRED');
    source(repoRoot, options['expected-commit']); const fresh = loadPlan(repoRoot);
    requireValue(fresh.manifestSha256 === plan.manifestSha256 && JSON.stringify(fresh.sqlSha256s) === JSON.stringify(plan.sqlSha256s),
      'APRO_SOURCE_CHANGED');
    const apply = mutation(false);
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(apply), retryProhibitedOnAmbiguity: true });
    await query(apply, { readOnly: false });
    const after = await observe(); verifyApplied(before, after);
    record('applied-and-postverified', { observation: after });
    return { status: 'applied-and-postverified', remoteWritesPerformed: true };
  } catch (error) {
    const code = /^APRO_[A-Z0-9_]+$/u.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'APRO_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* fsync한 앞선 기록을 보존한다. */ }
    fail(mutationStarted ? 'APRO_OUTCOME_REQUIRES_READONLY_INSPECTION' : code);
  } finally { receipt.close(); }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--check-only')) {
      requireValue(args.length >= 1 && args.length <= 2 && args[0] === '--check-only'
        && (args.length === 1 || /^--expected-commit=[a-f0-9]{40}$/u.test(args[1])), 'APRO_LOCAL_CHECK_ARGUMENT_INVALID');
      const result = checkLocalOnly(process.cwd(), args[1]?.slice('--expected-commit='.length));
      process.stdout.write(`AMORA_PROACTIVE_LOCAL_VERIFIED: migrations=${result.migrationCount}; predecessor_files=${result.preservedPredecessorFiles}; remote_writes=false; deployment_authorized=false\n`);
    } else {
      const result = await runRelease({ repoRoot: process.cwd(), argv: args });
      process.stdout.write(`AMORA_PROACTIVE_RELEASE: ${result.status}; durable_remote_writes=${result.remoteWritesPerformed}\n`);
    }
  } catch (error) {
    process.stderr.write(`AMORA_PROACTIVE_RELEASE_BLOCKED: ${/^APRO_[A-Z0-9_]+$/u.test(error?.code ?? '') ? error.code : 'APRO_UNEXPECTED'}\n`);
    process.exitCode = 1;
  }
}

// Next's synchronous config loader must be able to require the static contract.
// CLI async work still owns its network/receipt handles and catches all failures.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
