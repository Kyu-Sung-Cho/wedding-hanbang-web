#!/usr/bin/env node
// 아모라 맡은 일 마이그레이션(20261120160000) 하나만 운영 DB 에 반영하는 좁은 배포 길(2026-11-20).
// 웨딩홀 문의 배포 길(scripts/hall-inquiry-release.mjs)과 같은 꼴이다: 고정 원문·catalog 확인 → 읽기 전용 점검 →
// 같은 거래 안 연습 뒤 되돌림 확인 → 정확한 SQL 한 번 반영 → 읽기 전용 사후 확인. 영수증은 Git 밖에 남긴다.
// 웨딩홀 문의 길과 다른 점: 기존 표에 트리거를 달지 않으므로 기존 catalog 는 한 바이트도 바뀌면 안 되고, 앞 길 확인은
// 웨딩홀 문의 길과 36문항 길을 함께 본다(두 길의 실행기 원문은 기준 스냅숏 밖에 있어 각 길의 loadPlan 만 지킨다).
// 이 파일이 하지 않는 것: Vercel 배포, AMORA_TASKS_ENABLED 켜기, 기존 고객 행 변경. 운영 반영은 소유자가 정확한 커밋으로만 부른다.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMutationSql, buildObservationSql, FUNCTIONS, MIGRATION_FILE, MIGRATION_NAME, MIGRATION_VERSION, PROJECT_REF,
  SYSTEM_IDENTIFIER, TABLES, topLevelSql, topLevelStatements, unwrapMigration } from './amora-tasks-release-catalog.mjs';
import { loadPlan as loadHallInquiryPlan } from './hall-inquiry-release.mjs';
import { loadPlan as loadWeddingCode36Plan } from './wedding-code36-release.mjs';

export const RELEASE = 'amora-tasks-20261120';
// 이 길이 올라선 운영 main. 이 커밋의 supabase/migrations·release-contracts·scripts/lib 원문을 그대로 보존한다.
export const BASE_COMMIT = '98c3e1184ad6999e3aec179329bf9809ec53d5b6';
export const MANIFEST = 'supabase/release-contracts/amora-tasks-v1.json';
export const MIGRATION = MIGRATION_FILE;
export const FIXTURE = 'supabase/release-contracts/amora-tasks-pg-catalog-v1.json';
export const PREDECESSOR_SNAPSHOT = 'supabase/release-contracts/amora-tasks-predecessor-build-inputs-v1.json';
const RUNTIME = 'scripts/amora-tasks-release.mjs';
const CATALOG = 'scripts/amora-tasks-release-catalog.mjs';
const PREPARE = 'scripts/amora-tasks-release-prepare.mjs';
const FIXTURE_SOURCE = 'scripts/amora-tasks-release-fixture.mjs';
const BUILD_CONTRACT = 'scripts/amora-tasks-release-build-contract.mjs';
export const PINNED_FILES = [MIGRATION, FIXTURE, RUNTIME, CATALOG, PREPARE, FIXTURE_SOURCE, BUILD_CONTRACT, PREDECESSOR_SNAPSHOT];
const SHA = /^[a-f0-9]{64}$/u;
const MD5 = /^[a-f0-9]{32}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
// 운영에서 이 역할들에게는 새 표·칸·함수 권한이 하나도 없어야 한다. 회원 읽기는 authenticated, 일꾼은 service_role 이다.
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

export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (['--inspect', '--rehearse', '--apply', '--verify'].includes(arg)) {
      requireValue(!Object.hasOwn(options, 'mode'), 'ATK_MODE_DUPLICATE'); options.mode = arg.slice(2); continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|baseline-receipt|confirm-production)=(.+)$/u.exec(arg);
    requireValue(match && !Object.hasOwn(options, match[1]), 'ATK_ARGUMENT_INVALID'); options[match[1]] = match[2];
  }
  requireValue(options.mode && GIT_SHA.test(options['expected-commit'] ?? '') && options['project-ref'] === PROJECT_REF
    && isAbsolute(options['receipt-out'] ?? ''), 'ATK_ARGUMENT_REQUIRED');
  requireValue(options['confirm-production'] === `${RELEASE}:${PROJECT_REF}:${options.mode}:${options['expected-commit']}`,
    'ATK_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED');
  requireValue(options.mode !== 'verify' || isAbsolute(options['baseline-receipt'] ?? ''), 'ATK_BASELINE_RECEIPT_REQUIRED');
  requireValue(options.mode === 'verify' || options['baseline-receipt'] === undefined, 'ATK_BASELINE_ARGUMENT_INVALID');
  return options;
}

function safeArtifact(root, file) {
  const path = resolve(root, file), rel = relative(resolve(root), path);
  requireValue(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'ATK_ARTIFACT_PATH_INVALID');
  let cursor = resolve(root);
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(!stat.isSymbolicLink(), 'ATK_ARTIFACT_SYMLINK_FORBIDDEN');
  }
  requireValue(lstatSync(path).isFile(), 'ATK_ARTIFACT_NOT_FILE');
  return readFileSync(path);
}

const grantees = entries => (Array.isArray(entries) ? entries : []).map(entry => entry?.[0]);
const opensTo = (entries, roles) => grantees(entries).some(role => roles.has(role));

// 고정 catalog 가 최소 권한을 지키는지 본다. 운영 적용 뒤에는 실제 catalog 를 이 값과 바이트까지 비교한다.
// 칸은 relations·functions 둘뿐이어야 한다(기존 표 트리거 칸이 없다).
function validateFixtureCatalog(catalog) {
  requireValue(catalog && typeof catalog === 'object' && !Array.isArray(catalog)
    && Object.keys(catalog).sort().join(',') === 'functions,relations'
    && Array.isArray(catalog.relations) && Array.isArray(catalog.functions), 'ATK_FIXTURE_INVALID');
  same(catalog.relations.map(r => r.name).sort(), TABLES.map(n => `public.${n}`).sort(), 'ATK_FIXTURE_TABLES_INVALID');
  same(catalog.functions.map(f => f.name).sort(), [...FUNCTIONS].sort(), 'ATK_FIXTURE_FUNCTIONS_INVALID');
  requireValue(catalog.relations.every(r => r.owner === 'postgres' && r.rls === true && !opensTo(r.acl, NO_ACCESS_ROLES)
    && Array.isArray(r.columns) && r.columns.every(column => !opensTo(column[6], NO_ACCESS_ROLES))
    && Array.isArray(r.policies) && r.policies.every(policy => !(policy.roles ?? ['PUBLIC']).some(role => NO_ACCESS_ROLES.has(role)))),
  'ATK_FIXTURE_PRIVILEGES_INVALID');
  requireValue(catalog.functions.every(f => f.owner === 'postgres' && !opensTo(f.acl, NO_ACCESS_ROLES)
    && Array.isArray(f.config) && f.config.some(entry => typeof entry === 'string' && entry.startsWith('search_path='))),
  'ATK_FIXTURE_PRIVILEGES_INVALID');
}

// 표를 짚는 문장. 문장 하나씩 보고(한 문장의 낱말이 다음 문장과 이어 읽히지 않게), 스키마까지 읽는다.
const TABLE_STATEMENTS = [
  [/^ALTER\s+TABLE\b/iu, /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z_0-9]+)\.([a-z_0-9]+)/iu],
  [/^CREATE\s+POLICY\b/iu, /^CREATE\s+POLICY\s+[a-z_0-9]+\s+ON\s+([a-z_0-9]+)\.([a-z_0-9]+)/iu],
  [/^CREATE\s+(?:UNIQUE\s+)?INDEX\b/iu,
    /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:[a-z_0-9]+\s+)?ON\s+(?:ONLY\s+)?([a-z_0-9]+)\.([a-z_0-9]+)/iu],
  [/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\b/iu,
    /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+[a-z_0-9]+\s[\s\S]*?\bON\s+(?:ONLY\s+)?([a-z_0-9]+)\.([a-z_0-9]+)/iu],
];
const touchesOnlyNewTables = statement => TABLE_STATEMENTS.every(([head, target]) => {
  if (!head.test(statement)) return true;
  const match = target.exec(statement);
  return Boolean(match) && match[1].toLowerCase() === 'public' && TABLES.includes(match[2].toLowerCase());
});

export function loadPlan(repoRoot) {
  let manifest;
  try { manifest = JSON.parse(safeArtifact(repoRoot, MANIFEST)); } catch { fail('ATK_MANIFEST_UNAVAILABLE'); }
  requireValue(manifest.version === 1 && manifest.kind === 'amora-tasks-isolated-additive-release'
    && manifest.release === RELEASE && manifest.status === 'requires-scoped-runtime-evidence'
    && manifest.projectRef === PROJECT_REF && manifest.systemIdentifier === SYSTEM_IDENTIFIER
    && manifest.baseCommit === BASE_COMMIT && manifest.migrationVersion === MIGRATION_VERSION
    && manifest.migrationName === MIGRATION_NAME
    && manifest.existingData === 'unchanged' && manifest.newRows === 'none'
    && manifest.runtimeEvidenceVerified === false && manifest.productionApplyImplemented === true,
  'ATK_MANIFEST_CONTRACT_INVALID');
  same(manifest.scope, { newTables: TABLES.map(n => `public.${n}`), newFunctions: FUNCTIONS.map(n => `public.${n}`),
    existingFunctions: 'unchanged', existingTables: 'unchanged', auth: 'unchanged', storage: 'unchanged', cron: 'unchanged' },
  'ATK_MANIFEST_SCOPE_INVALID');
  same((manifest.artifacts ?? []).map(pin => pin.file).sort(), [...PINNED_FILES].sort(), 'ATK_ARTIFACT_SET_INVALID');
  const contents = new Map();
  for (const pin of manifest.artifacts) {
    requireValue(SHA.test(pin.sha256 ?? ''), 'ATK_ARTIFACT_HASH_INVALID');
    const bytes = safeArtifact(repoRoot, pin.file);
    requireValue(digest(bytes) === pin.sha256, 'ATK_ARTIFACT_HASH_MISMATCH'); contents.set(pin.file, bytes);
  }
  const sql = contents.get(MIGRATION).toString('utf8');
  requireValue(!sql.includes('\r') && !sql.includes('\0'), 'ATK_MIGRATION_ENCODING_INVALID');
  let body;
  try { body = unwrapMigration(sql); } catch { fail('ATK_SQL_TRANSACTION_BOUNDARY_INVALID'); }
  // 보조 정적 검사다. 실제 허용 범위는 고정 원문 + 같은 거래 안 전후 catalog 비교로 닫는다.
  const statements = topLevelStatements(body);
  const ddl = topLevelSql(body);
  // 줄 머리가 아니라 문장 첫 낱말로 본다(정책의 'WITH CHECK', 함수 본문의 'WITH candidate' 는 문장 머리가 아니다).
  // 데이터를 바꾸는 CTE(WITH … DELETE)와 준비문 실행, 소유권 넘기기도 막는다.
  requireValue(!statements.some(statement =>
    /^(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|DO|CALL|COPY|MERGE|WITH|EXECUTE|PREPARE|REASSIGN)\b/iu.test(statement)),
  'ATK_TOP_LEVEL_DML_FORBIDDEN');
  const declaredTables = [...ddl.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z_0-9]+)/giu)].map(m => m[1]).sort();
  const declaredFunctions = [...ddl.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_0-9]+)/giu)].map(m => m[1]).sort();
  same(declaredTables, [...TABLES].sort(), 'ATK_DDL_TABLE_SCOPE_INVALID');
  same(declaredFunctions, [...FUNCTIONS].sort(), 'ATK_DDL_FUNCTION_SCOPE_INVALID');
  // 기존 표를 짚는 문장(트리거·칸·정책·색인)은 하나도 없어야 한다. 짚는 표를 읽지 못해도 막는다.
  requireValue(statements.every(touchesOnlyNewTables), 'ATK_DDL_EXISTING_TABLE_SCOPE_INVALID');
  let fixture;
  try { fixture = JSON.parse(contents.get(FIXTURE)); } catch { fail('ATK_FIXTURE_INVALID'); }
  requireValue(fixture.format === 'amora-tasks-catalog-fixture-v1' && fixture.migrationSha256 === digest(contents.get(MIGRATION)),
    'ATK_FIXTURE_INVALID');
  validateFixtureCatalog(fixture.catalog);
  return { manifest, manifestSha256: digest(safeArtifact(repoRoot, MANIFEST)), sql, catalog: fixture.catalog,
    sqlSha256: digest(contents.get(MIGRATION)), fixtureSha256: digest(contents.get(FIXTURE)) };
}

// 운영 반영은 이 길이 검토한 변경만 담은 커밋에서만 한다. CI 의 정적 검사는 다른 변경이 섞여도 돈다.
const SCOPE_PREFIXES = ['apps/web/src/', 'apps/mobile/app/', 'apps/mobile/src/', 'packages/shared/src/'];
const SCOPE_FILES = new Set(['turbo.json', 'apps/web/.env.example', 'apps/web/vercel.json', 'apps/web/weddingAppRoutes.ts',
  'packages/shared/package.json', 'apps/web/vendorDisclosureProductionBuildFence.ts', '.github/workflows/ci.yml',
  'scripts/verify-local.mjs', 'scripts/repository-test-manifest.json', 'scripts/tests/amora-runtime-env-contract.test.mjs',
  'scripts/tests/amora-action-view-v2-current-source-rejection.test.mjs', 'scripts/tests/ci-signal-integrity.test.mjs',
  'scripts/tests/qa-merged-preflight.test.mjs', 'scripts/tests/repo-tests-are-all-wired.test.mjs',
  'scripts/tests/supabase-explicit-budget-static-fence.test.mjs', MIGRATION]);
const SCOPE_PATTERNS = [/^scripts\/(?:tests\/)?amora-tasks-release[^/]*\.mjs$/u, /^supabase\/release-contracts\/amora-tasks-[^/]*\.json$/u];
export const inReleaseScope = file => typeof file === 'string' && (SCOPE_FILES.has(file)
  || SCOPE_PREFIXES.some(prefix => file.startsWith(prefix)) || SCOPE_PATTERNS.some(pattern => pattern.test(file)));

export function validateSourceChanges(changed, { staticOnly = false } = {}) {
  requireValue(Array.isArray(changed) && changed.every(file => typeof file === 'string') && typeof staticOnly === 'boolean',
    'ATK_SOURCE_SCOPE_ARGUMENT_INVALID');
  if (staticOnly) return;
  requireValue(changed.length > 0 && changed.includes(MIGRATION) && changed.every(inReleaseScope), 'ATK_SOURCE_SCOPE_DRIFT');
}

const gitRunner = (repoRoot, timeout) => (args, input) => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
  encoding: 'utf8', input, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024,
  stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
}).trim();

export function assertSource(repoRoot, expectedCommit, { staticOnly = false } = {}) {
  const git = gitRunner(repoRoot, 15_000);
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'ATK_SOURCE_NOT_CLEAN_EXACT_COMMIT');
  const origin = git(['remote', 'get-url', 'origin']);
  requireValue(/^https:\/\/github\.com\/Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(origin)
    || /^git@github\.com:Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(origin), 'ATK_ORIGIN_MISMATCH');
  try { git(['merge-base', '--is-ancestor', BASE_COMMIT, expectedCommit]); } catch { fail('ATK_BASE_COMMIT_NOT_ANCESTOR'); }
  // 이름 바꾸기 감지를 끈다. 켜 두면 기존 파일을 범위 안 경로로 옮긴 변경이 새 경로 하나로만 보인다.
  const changed = git(['diff', '--name-only', '--no-renames', BASE_COMMIT, expectedCommit]).split(/\r?\n/u).filter(Boolean);
  validateSourceChanges(changed, { staticOnly });
  // 운영 반영 때도 CI 의 정적 검사(기준 원문 보존·정확한 마이그레이션 묶음·앞 길 원문)를 다시 본다.
  if (!staticOnly) assertPredecessorPins(repoRoot);
}

// 앞 길 둘의 고정 원문(실행기·catalog·준비·빌드 계약 포함)이 그대로인지 각 길의 loadPlan 으로 본다.
// 두 길의 실행기는 scripts/ 바로 아래에 있어 기준 스냅숏(supabase/migrations·release-contracts·scripts/lib) 밖이다.
export function loadPreviousLanePlans(repoRoot) {
  return { hallInquiry: loadHallInquiryPlan(repoRoot), weddingCode36: loadWeddingCode36Plan(repoRoot) };
}

// 기준 커밋의 모든 기존 마이그레이션·릴리스 계약·scripts/lib 원문을 보존하고, 새 SQL 은 이 하나뿐인지 본다.
export function assertPredecessorPins(repoRoot) {
  try { loadPreviousLanePlans(repoRoot); } catch { fail('ATK_PREDECESSOR_LANE_INVALID'); }
  const git = gitRunner(repoRoot, 30_000);
  const old = git(['ls-tree', '-r', BASE_COMMIT, '--', 'supabase/migrations', 'supabase/release-contracts', 'scripts/lib'])
    .split(/\r?\n/u).filter(Boolean).map(line => {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
      requireValue(match, 'ATK_PREDECESSOR_TREE_INVALID'); return { oid: match[1], file: match[2] };
    });
  requireValue(old.length > 100, 'ATK_PREDECESSOR_TREE_INCOMPLETE');
  for (const pin of old) safeArtifact(repoRoot, pin.file);
  const hashes = git(['hash-object', '--no-filters', '--stdin-paths'], `${old.map(pin => pin.file).join('\n')}\n`).split(/\r?\n/u);
  requireValue(hashes.length === old.length && hashes.every((hash, i) => hash === old[i].oid), 'ATK_PREDECESSOR_PIN_DRIFT');
  const expectedSql = [...old.filter(pin => pin.file.startsWith('supabase/migrations/')).map(pin => pin.file.split('/').at(-1)),
    MIGRATION.split('/').at(-1)].sort();
  same(readdirSync(resolve(repoRoot, 'supabase/migrations')).filter(name => /\.sql$/iu.test(name)).sort(), expectedSql,
    'ATK_UNREVIEWED_MIGRATION');
  return { preservedPredecessorFiles: old.length, migrationCount: expectedSql.length };
}

export function checkLocalOnly(repoRoot, expectedCommit) {
  const plan = loadPlan(repoRoot);
  const pins = assertPredecessorPins(repoRoot);
  if (expectedCommit !== undefined) {
    requireValue(GIT_SHA.test(expectedCommit), 'ATK_LOCAL_SOURCE_ARGUMENT_INVALID');
    assertSource(repoRoot, expectedCommit, { staticOnly: true });
  }
  return { status: 'local-manifest-and-predecessor-pins-verified', sqlSha256: plan.sqlSha256, migrationCount: pins.migrationCount,
    preservedPredecessorFiles: pins.preservedPredecessorFiles, remoteWritesPerformed: false, deploymentAuthorized: false };
}

const emptyTarget = { relations: [], functions: [] };

export function validateObservation(observed, plan, now = new Date()) {
  requireValue(observed?.format === 'amora-tasks-catalog-v1' && observed.identityReady === true && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM_IDENTIFIER && /^17\./u.test(observed.serverVersion ?? '')
    && observed.database === 'postgres' && observed.currentUser === 'supabase_read_only_user'
    && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(v => MD5.test(v ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0 && /^\d{14}$/u.test(observed.ledgerHead ?? '')
    && Array.isArray(observed.missingPrerequisites), 'ATK_OBSERVATION_INVALID');
  const time = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(time) && time > now.getTime() - 120_000 && time <= now.getTime() + 10_000,
    'ATK_OBSERVATION_EXPIRED');
  requireValue(observed.missingPrerequisites.length === 0, 'ATK_PREREQUISITE_MISSING');
  if (observed.migration === null) {
    same(observed.catalog, emptyTarget, 'ATK_TARGET_OBJECTS_ALREADY_EXIST');
    requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'ATK_LEDGER_CONFLICT');
  } else {
    same(observed.migration, { version: MIGRATION_VERSION, name: MIGRATION_NAME,
      statementCount: 1, sqlMd5: md5(plan.sql) }, 'ATK_APPLIED_LEDGER_CONFLICT');
    same(observed.catalog, plan.catalog, 'ATK_APPLIED_CATALOG_DRIFT');
  }
  return observed;
}

function assertOutside(repoRoot, path) {
  const rel = relative(resolve(repoRoot), resolve(path));
  requireValue(isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`), 'ATK_RECEIPT_MUST_BE_OUTSIDE_GIT');
}
function openReceipt(repoRoot, path) {
  assertOutside(repoRoot, path);
  const target = resolve(path), parent = dirname(target); let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/u).filter(Boolean)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'ATK_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'ATK_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append(record) { const bytes = Buffer.from(`${JSON.stringify(record)}\n`); let offset = 0;
    while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset, null);
      requireValue(Number.isSafeInteger(n) && n > 0 && n <= bytes.length - offset, 'ATK_RECEIPT_WRITE_FAILED'); offset += n; }
    fsyncSync(fd); }, close() { closeSync(fd); } };
}

// 적용 뒤 관측에는 새 객체 catalog 전체가 실린다. 웨딩홀 문의 길과 같은 응답 상한 1MiB 를 둔다.
export const MANAGEMENT_RESPONSE_LIMIT_BYTES = 1024 * 1024;
export async function managementQuery(sql, { readOnly, token }) {
  requireValue(typeof readOnly === 'boolean' && /^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'ATK_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // 마이그레이션이 statement_timeout 을 60초로 올리고 반영 묶음의 마감은 120초다. 그보다 먼저 끊지 않는다.
      body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(130_000),
    });
    requireValue(response.ok, 'ATK_REMOTE_OUTCOME_UNVERIFIED');
    const bytes = await response.text();
    requireValue(Buffer.byteLength(bytes) <= MANAGEMENT_RESPONSE_LIMIT_BYTES, 'ATK_REMOTE_RESPONSE_LIMIT');
    const rows = JSON.parse(bytes); requireValue(Array.isArray(rows), 'ATK_REMOTE_RESPONSE_INVALID'); return rows;
  } catch { fail('ATK_REMOTE_OUTCOME_UNVERIFIED'); }
}

export async function runRelease({ repoRoot, argv, now = () => new Date(), query, source = assertSource,
  receiptFactory = openReceipt, baselineReader = file => readFileSync(file, 'utf8') } = {}) {
  const options = parseArgs(argv ?? []), plan = loadPlan(repoRoot);
  source(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'ATK_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
    query = (sql, queryOptions) => managementQuery(sql, { ...queryOptions, token });
  }
  const receipt = receiptFactory(repoRoot, options['receipt-out']);
  const binding = { format: 'amora-tasks-release-receipt-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT_REF, releaseCommit: options['expected-commit'], baseCommit: BASE_COMMIT,
    manifestSha256: plan.manifestSha256, sqlSha256: plan.sqlSha256, fixtureSha256: plan.fixtureSha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildObservationSql(), { readOnly: true });
    requireValue(rows.length === 1 && rows[0].observation, 'ATK_OBSERVATION_RESPONSE_INVALID');
    return validateObservation(rows[0].observation, plan, now());
  };
  const unchanged = (a, b) => {
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'ledgerHead', 'migration'])
      same(a[key], b[key], 'ATK_REHEARSAL_NOT_ROLLED_BACK');
  };
  const verifyApplied = (before, after) => {
    requireValue(before.migration === null && after.migration !== null && after.ledgerCount === before.ledgerCount + 1
      && after.ledgerWithoutTargetSha === before.ledgerSha && after.preservedCatalogSha === before.preservedCatalogSha,
    'ATK_POST_APPLY_UNVERIFIED');
  };
  let mutationStarted = false;
  try {
    record('started');
    const before = await observe(); record('before-observed', { observation: before,
      backupScope: 'metadata-only-new-objects-absent-and-existing-catalog-ledger-digests-no-customer-rows' });
    if (options.mode === 'verify') {
      assertOutside(repoRoot, options['baseline-receipt']);
      let records;
      try { records = baselineReader(options['baseline-receipt']).trim().split(/\r?\n/u).map(line => JSON.parse(line)); }
      catch { fail('ATK_BASELINE_RECEIPT_INVALID'); }
      const baseline = records.find(r => r.status === 'before-observed' && r.format === binding.format
        && r.release === RELEASE && r.projectRef === PROJECT_REF && r.mode === 'apply'
        && r.releaseCommit === binding.releaseCommit && r.baseCommit === BASE_COMMIT
        && r.manifestSha256 === binding.manifestSha256
        && r.sqlSha256 === binding.sqlSha256 && r.fixtureSha256 === binding.fixtureSha256 && r.observation?.migration === null);
      requireValue(baseline, 'ATK_BASELINE_RECEIPT_BINDING_INVALID'); verifyApplied(baseline.observation, before);
      record('applied-and-readonly-postverified', { observation: before });
      return { status: 'applied-and-readonly-postverified', remoteWritesPerformed: false };
    }
    if (options.mode === 'inspect' || before.migration !== null) {
      const status = before.migration ? 'already-applied-catalog-verified' : 'inspected-new-objects-absent';
      record(status); return { status, remoteWritesPerformed: false };
    }
    const deadline = new Date(now().getTime() + 120_000).toISOString();
    const rehearsal = buildMutationSql({ sql: plan.sql, before, catalog: plan.catalog, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearsal), retryProhibitedOnAmbiguity: true });
    mutationStarted = true;
    await query(rehearsal, { readOnly: false });
    const rolledBack = await observe(); unchanged(before, rolledBack);
    record('rehearsed-and-rolled-back', { observation: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', remoteWritesPerformed: false,
      temporaryTransactionalWritesPerformed: true };
    requireValue(now().getTime() < Date.parse(deadline), 'ATK_DEADLINE_EXPIRED');
    source(repoRoot, options['expected-commit']); const fresh = loadPlan(repoRoot);
    requireValue(fresh.manifestSha256 === plan.manifestSha256 && fresh.sqlSha256 === plan.sqlSha256, 'ATK_SOURCE_CHANGED');
    const apply = buildMutationSql({ sql: plan.sql, before, catalog: plan.catalog, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(apply), retryProhibitedOnAmbiguity: true });
    await query(apply, { readOnly: false });
    const after = await observe(); verifyApplied(before, after);
    record('applied-and-postverified', { observation: after });
    return { status: 'applied-and-postverified', remoteWritesPerformed: true };
  } catch (error) {
    const code = /^ATK_[A-Z0-9_]+$/u.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'ATK_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* fsync한 앞선 기록을 보존한다. */ }
    fail(mutationStarted ? 'ATK_OUTCOME_REQUIRES_READONLY_INSPECTION' : code);
  } finally { receipt.close(); }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--check-only')) {
      requireValue(args.length >= 1 && args.length <= 2 && args[0] === '--check-only'
        && (args.length === 1 || /^--expected-commit=[a-f0-9]{40}$/u.test(args[1])), 'ATK_LOCAL_CHECK_ARGUMENT_INVALID');
      const result = checkLocalOnly(process.cwd(), args[1]?.slice('--expected-commit='.length));
      process.stdout.write(`AMORA_TASKS_LOCAL_VERIFIED: migrations=${result.migrationCount}; predecessor_files=${result.preservedPredecessorFiles}; remote_writes=false; deployment_authorized=false\n`);
    } else {
      const result = await runRelease({ repoRoot: process.cwd(), argv: args });
      process.stdout.write(`AMORA_TASKS_RELEASE: ${result.status}; durable_remote_writes=${result.remoteWritesPerformed}\n`);
    }
  } catch (error) {
    process.stderr.write(`AMORA_TASKS_RELEASE_BLOCKED: ${/^ATK_[A-Z0-9_]+$/u.test(error?.code ?? '') ? error.code : 'ATK_UNEXPECTED'}\n`);
    process.exitCode = 1;
  }
}

// Next's synchronous config loader must be able to require the static contract.
// CLI async work still owns its network/receipt handles and catches all failures.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
