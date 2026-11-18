#!/usr/bin/env node
// 웨딩홀 문의 마이그레이션(20261117090000) 하나만 운영 DB 에 반영하는 좁은 배포 길(2026-11-18).
// 36문항 배포 길(scripts/wedding-code36-release.mjs)과 같은 꼴이다: 고정 원문·catalog 확인 → 읽기 전용 점검 →
// 같은 거래 안 연습 뒤 되돌림 확인 → 정확한 SQL 한 번 반영 → 읽기 전용 사후 확인. 영수증은 Git 밖에 남긴다.
// 이 파일이 하지 않는 것: Vercel 배포, 발송 스위치 켜기, 기존 고객 행 변경. 운영 반영은 소유자가 정확한 커밋으로만 부른다.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMutationSql, buildObservationSql, EXISTING_TABLE_TRIGGERS, FUNCTIONS, MIGRATION_NAME, MIGRATION_VERSION,
  PROJECT_REF, SYSTEM_IDENTIFIER, TABLES, topLevelSql, topLevelStatements, unwrapMigration } from './hall-inquiry-release-catalog.mjs';
import { loadPlan as loadWeddingCode36Plan } from './wedding-code36-release.mjs';

export const RELEASE = 'hall-inquiry-20261118';
// 이 길이 올라선 운영 main. 이 커밋의 supabase/migrations·release-contracts·scripts/lib 원문을 그대로 보존한다.
export const BASE_COMMIT = 'ccaecc823df3293d8de7f29416fdd2d56e0b7d76';
export const MANIFEST = 'supabase/release-contracts/hall-inquiry-v1.json';
export const MIGRATION = 'supabase/migrations/20261117090000_hall_listings_and_inquiries.sql';
export const FIXTURE = 'supabase/release-contracts/hall-inquiry-pg-catalog-v1.json';
export const PREDECESSOR_SNAPSHOT = 'supabase/release-contracts/hall-inquiry-predecessor-build-inputs-v1.json';
const RUNTIME = 'scripts/hall-inquiry-release.mjs';
const CATALOG = 'scripts/hall-inquiry-release-catalog.mjs';
const PREPARE = 'scripts/hall-inquiry-release-prepare.mjs';
const FIXTURE_SOURCE = 'scripts/hall-inquiry-release-fixture.mjs';
const BUILD_CONTRACT = 'scripts/hall-inquiry-release-build-contract.mjs';
export const PINNED_FILES = [MIGRATION, FIXTURE, RUNTIME, CATALOG, PREPARE, FIXTURE_SOURCE, BUILD_CONTRACT, PREDECESSOR_SNAPSHOT];
export const EXISTING_TRIGGER_NAMES = EXISTING_TABLE_TRIGGERS.map(t => `${t.schema}.${t.table}.${t.name}`);
const SHA = /^[a-f0-9]{64}$/u;
const MD5 = /^[a-f0-9]{32}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
// 운영에서 이 역할들에게는 새 표·칸·함수 권한이 하나도 없어야 한다. 회원 읽기는 authenticated, 운영자는 service_role 이다.
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
      requireValue(!Object.hasOwn(options, 'mode'), 'HIQ_MODE_DUPLICATE'); options.mode = arg.slice(2); continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|baseline-receipt|confirm-production)=(.+)$/u.exec(arg);
    requireValue(match && !Object.hasOwn(options, match[1]), 'HIQ_ARGUMENT_INVALID'); options[match[1]] = match[2];
  }
  requireValue(options.mode && GIT_SHA.test(options['expected-commit'] ?? '') && options['project-ref'] === PROJECT_REF
    && isAbsolute(options['receipt-out'] ?? ''), 'HIQ_ARGUMENT_REQUIRED');
  requireValue(options['confirm-production'] === `${RELEASE}:${PROJECT_REF}:${options.mode}:${options['expected-commit']}`,
    'HIQ_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED');
  requireValue(options.mode !== 'verify' || isAbsolute(options['baseline-receipt'] ?? ''), 'HIQ_BASELINE_RECEIPT_REQUIRED');
  requireValue(options.mode === 'verify' || options['baseline-receipt'] === undefined, 'HIQ_BASELINE_ARGUMENT_INVALID');
  return options;
}

function safeArtifact(root, file) {
  const path = resolve(root, file), rel = relative(resolve(root), path);
  requireValue(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'HIQ_ARTIFACT_PATH_INVALID');
  let cursor = resolve(root);
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(!stat.isSymbolicLink(), 'HIQ_ARTIFACT_SYMLINK_FORBIDDEN');
  }
  requireValue(lstatSync(path).isFile(), 'HIQ_ARTIFACT_NOT_FILE');
  return readFileSync(path);
}

const grantees = entries => (Array.isArray(entries) ? entries : []).map(entry => entry?.[0]);
const opensTo = (entries, roles) => grantees(entries).some(role => roles.has(role));

// 고정 catalog 가 최소 권한을 지키는지 본다. 운영 적용 뒤에는 실제 catalog 를 이 값과 바이트까지 비교한다.
function validateFixtureCatalog(catalog) {
  requireValue(catalog && Array.isArray(catalog.relations) && Array.isArray(catalog.functions)
    && Array.isArray(catalog.existingTableTriggers), 'HIQ_FIXTURE_INVALID');
  same(catalog.relations.map(r => r.name).sort(), TABLES.map(n => `public.${n}`).sort(), 'HIQ_FIXTURE_TABLES_INVALID');
  same(catalog.functions.map(f => f.name).sort(), [...FUNCTIONS].sort(), 'HIQ_FIXTURE_FUNCTIONS_INVALID');
  same(catalog.existingTableTriggers.map(t => `${t[0]}.${t[1]}`).sort(), [...EXISTING_TRIGGER_NAMES].sort(),
    'HIQ_FIXTURE_EXISTING_TRIGGERS_INVALID');
  requireValue(catalog.existingTableTriggers.every(t => t[2] === 'O'), 'HIQ_FIXTURE_EXISTING_TRIGGERS_INVALID');
  requireValue(catalog.relations.every(r => r.owner === 'postgres' && r.rls === true && !opensTo(r.acl, NO_ACCESS_ROLES)
    && Array.isArray(r.columns) && r.columns.every(column => !opensTo(column[6], NO_ACCESS_ROLES))
    && Array.isArray(r.policies) && r.policies.every(policy => !(policy.roles ?? ['PUBLIC']).some(role => NO_ACCESS_ROLES.has(role)))),
  'HIQ_FIXTURE_PRIVILEGES_INVALID');
  requireValue(catalog.functions.every(f => f.owner === 'postgres' && !opensTo(f.acl, NO_ACCESS_ROLES)
    && Array.isArray(f.config) && f.config.some(entry => typeof entry === 'string' && entry.startsWith('search_path='))),
  'HIQ_FIXTURE_PRIVILEGES_INVALID');
}

export function loadPlan(repoRoot) {
  let manifest;
  try { manifest = JSON.parse(safeArtifact(repoRoot, MANIFEST)); } catch { fail('HIQ_MANIFEST_UNAVAILABLE'); }
  requireValue(manifest.version === 1 && manifest.kind === 'hall-inquiry-isolated-additive-release'
    && manifest.release === RELEASE && manifest.status === 'requires-scoped-runtime-evidence'
    && manifest.projectRef === PROJECT_REF && manifest.systemIdentifier === SYSTEM_IDENTIFIER
    && manifest.baseCommit === BASE_COMMIT && manifest.migrationVersion === MIGRATION_VERSION
    && manifest.migrationName === MIGRATION_NAME
    && manifest.existingData === 'unchanged' && manifest.newRows === 'none'
    && manifest.runtimeEvidenceVerified === false && manifest.productionApplyImplemented === true,
  'HIQ_MANIFEST_CONTRACT_INVALID');
  same(manifest.scope, { newTables: TABLES.map(n => `public.${n}`), newFunctions: FUNCTIONS.map(n => `public.${n}`),
    existingTableTriggers: EXISTING_TRIGGER_NAMES, existingFunctions: 'unchanged',
    existingTables: 'unchanged-except-listed-triggers', auth: 'unchanged', storage: 'unchanged', cron: 'unchanged' },
  'HIQ_MANIFEST_SCOPE_INVALID');
  same((manifest.artifacts ?? []).map(pin => pin.file).sort(), [...PINNED_FILES].sort(), 'HIQ_ARTIFACT_SET_INVALID');
  const contents = new Map();
  for (const pin of manifest.artifacts) {
    requireValue(SHA.test(pin.sha256 ?? ''), 'HIQ_ARTIFACT_HASH_INVALID');
    const bytes = safeArtifact(repoRoot, pin.file);
    requireValue(digest(bytes) === pin.sha256, 'HIQ_ARTIFACT_HASH_MISMATCH'); contents.set(pin.file, bytes);
  }
  const sql = contents.get(MIGRATION).toString('utf8');
  requireValue(!sql.includes('\r') && !sql.includes('\0'), 'HIQ_MIGRATION_ENCODING_INVALID');
  let body;
  try { body = unwrapMigration(sql); } catch { fail('HIQ_SQL_TRANSACTION_BOUNDARY_INVALID'); }
  // 보조 정적 검사다. 실제 허용 범위는 고정 원문 + 같은 거래 안 전후 catalog 비교로 닫는다.
  const ddl = topLevelSql(body);
  // 줄 머리가 아니라 문장 첫 낱말로 본다(정책의 'WITH CHECK' 줄은 문장 머리가 아니다).
  // 데이터를 바꾸는 CTE(WITH … DELETE)와 준비문 실행, 소유권 넘기기도 막는다.
  requireValue(!topLevelStatements(body).some(statement =>
    /^(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|DO|CALL|COPY|MERGE|WITH|EXECUTE|PREPARE|REASSIGN)\b/iu.test(statement)),
  'HIQ_TOP_LEVEL_DML_FORBIDDEN');
  const declaredTables = [...ddl.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z_0-9]+)/giu)].map(m => m[1]).sort();
  const declaredFunctions = [...ddl.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_0-9]+)/giu)].map(m => m[1]).sort();
  same(declaredTables, [...TABLES].sort(), 'HIQ_DDL_TABLE_SCOPE_INVALID');
  same(declaredFunctions, [...FUNCTIONS].sort(), 'HIQ_DDL_FUNCTION_SCOPE_INVALID');
  // 새 표가 아닌 표를 건드리는 문장은 기존 표 트리거 하나뿐이어야 한다.
  const triggers = [...ddl.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+([a-z_0-9]+)[\s\S]*?\bON\s+public\.([a-z_0-9]+)/giu)]
    .filter(m => !TABLES.includes(m[2])).map(m => `public.${m[2]}.${m[1]}`).sort();
  same(triggers, [...EXISTING_TRIGGER_NAMES].sort(), 'HIQ_DDL_EXISTING_TABLE_SCOPE_INVALID');
  const touchesOtherTable = [
    ...ddl.matchAll(/ALTER\s+TABLE\s+(?:ONLY\s+)?(?:IF\s+EXISTS\s+)?public\.([a-z_0-9]+)/giu),
    ...ddl.matchAll(/CREATE\s+POLICY\s+[a-z_0-9]+\s+ON\s+public\.([a-z_0-9]+)/giu),
    ...ddl.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[a-z_0-9]+\s+ON\s+(?:ONLY\s+)?public\.([a-z_0-9]+)/giu),
  ].some(m => !TABLES.includes(m[1]));
  requireValue(!touchesOtherTable, 'HIQ_DDL_EXISTING_TABLE_SCOPE_INVALID');
  let fixture;
  try { fixture = JSON.parse(contents.get(FIXTURE)); } catch { fail('HIQ_FIXTURE_INVALID'); }
  requireValue(fixture.format === 'hall-inquiry-catalog-fixture-v1' && fixture.migrationSha256 === digest(contents.get(MIGRATION)),
    'HIQ_FIXTURE_INVALID');
  validateFixtureCatalog(fixture.catalog);
  return { manifest, manifestSha256: digest(safeArtifact(repoRoot, MANIFEST)), sql, catalog: fixture.catalog,
    sqlSha256: digest(contents.get(MIGRATION)), fixtureSha256: digest(contents.get(FIXTURE)) };
}

// 운영 반영은 이 길이 검토한 변경만 담은 커밋에서만 한다. CI 의 정적 검사는 다른 변경이 섞여도 돈다.
const SCOPE_PREFIXES = ['apps/web/src/', 'apps/web/public/images/amora/', 'apps/mobile/app/', 'apps/mobile/src/',
  'apps/mobile/assets/fonts/', 'apps/mobile/assets/amora/', 'packages/shared/src/', 'packages/design-tokens/src/'];
const SCOPE_FILES = new Set(['DESIGN.md', 'turbo.json', 'apps/web/.env.example', 'apps/web/weddingAppRoutes.ts',
  'apps/web/scripts/sync-design-token-css.mjs', 'apps/mobile/scripts/subset-invitation-fonts.py', 'packages/shared/package.json',
  'apps/web/vendorDisclosureProductionBuildFence.ts', '.github/workflows/ci.yml', 'scripts/verify-local.mjs',
  'scripts/repository-test-manifest.json', 'scripts/tests/amora-runtime-env-contract.test.mjs',
  'scripts/tests/amora-action-view-v2-current-source-rejection.test.mjs', 'scripts/tests/ci-signal-integrity.test.mjs',
  'scripts/tests/qa-merged-preflight.test.mjs', 'scripts/tests/repo-tests-are-all-wired.test.mjs',
  'scripts/tests/supabase-explicit-budget-static-fence.test.mjs', MIGRATION]);
const SCOPE_PATTERNS = [/^scripts\/(?:tests\/)?hall-inquiry-release[^/]*\.mjs$/u, /^supabase\/release-contracts\/hall-inquiry-[^/]*\.json$/u];
export const inReleaseScope = file => typeof file === 'string' && (SCOPE_FILES.has(file)
  || SCOPE_PREFIXES.some(prefix => file.startsWith(prefix)) || SCOPE_PATTERNS.some(pattern => pattern.test(file)));

export function validateSourceChanges(changed, { staticOnly = false } = {}) {
  requireValue(Array.isArray(changed) && changed.every(file => typeof file === 'string') && typeof staticOnly === 'boolean',
    'HIQ_SOURCE_SCOPE_ARGUMENT_INVALID');
  if (staticOnly) return;
  requireValue(changed.length > 0 && changed.includes(MIGRATION) && changed.every(inReleaseScope), 'HIQ_SOURCE_SCOPE_DRIFT');
}

const gitRunner = (repoRoot, timeout) => (args, input) => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
  encoding: 'utf8', input, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024,
  stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
}).trim();

export function assertSource(repoRoot, expectedCommit, { staticOnly = false } = {}) {
  const git = gitRunner(repoRoot, 15_000);
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'HIQ_SOURCE_NOT_CLEAN_EXACT_COMMIT');
  const origin = git(['remote', 'get-url', 'origin']);
  requireValue(/^https:\/\/github\.com\/Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(origin)
    || /^git@github\.com:Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(origin), 'HIQ_ORIGIN_MISMATCH');
  try { git(['merge-base', '--is-ancestor', BASE_COMMIT, expectedCommit]); } catch { fail('HIQ_BASE_COMMIT_NOT_ANCESTOR'); }
  // 이름 바꾸기 감지를 끈다. 켜 두면 기존 파일을 범위 안 경로로 옮긴 변경이 새 경로 하나로만 보인다.
  const changed = git(['diff', '--name-only', '--no-renames', BASE_COMMIT, expectedCommit]).split(/\r?\n/u).filter(Boolean);
  validateSourceChanges(changed, { staticOnly });
  // 운영 반영 때도 CI 의 정적 검사(기준 원문 보존·정확한 마이그레이션 묶음·36문항 길 원문)를 다시 본다.
  if (!staticOnly) assertPredecessorPins(repoRoot);
}

// 기준 커밋의 모든 기존 마이그레이션·릴리스 계약·scripts/lib 원문을 보존하고, 새 SQL 은 이 하나뿐인지 본다.
// 36문항 길의 고정 원문(실행기·catalog·빌드 계약 포함)도 그대로인지 그 길의 loadPlan 으로 함께 본다.
export function assertPredecessorPins(repoRoot) {
  try { loadWeddingCode36Plan(repoRoot); } catch { fail('HIQ_PREDECESSOR_LANE_INVALID'); }
  const git = gitRunner(repoRoot, 30_000);
  const old = git(['ls-tree', '-r', BASE_COMMIT, '--', 'supabase/migrations', 'supabase/release-contracts', 'scripts/lib'])
    .split(/\r?\n/u).filter(Boolean).map(line => {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
      requireValue(match, 'HIQ_PREDECESSOR_TREE_INVALID'); return { oid: match[1], file: match[2] };
    });
  requireValue(old.length > 100, 'HIQ_PREDECESSOR_TREE_INCOMPLETE');
  for (const pin of old) safeArtifact(repoRoot, pin.file);
  const hashes = git(['hash-object', '--no-filters', '--stdin-paths'], `${old.map(pin => pin.file).join('\n')}\n`).split(/\r?\n/u);
  requireValue(hashes.length === old.length && hashes.every((hash, i) => hash === old[i].oid), 'HIQ_PREDECESSOR_PIN_DRIFT');
  const expectedSql = [...old.filter(pin => pin.file.startsWith('supabase/migrations/')).map(pin => pin.file.split('/').at(-1)),
    MIGRATION.split('/').at(-1)].sort();
  same(readdirSync(resolve(repoRoot, 'supabase/migrations')).filter(name => /\.sql$/iu.test(name)).sort(), expectedSql,
    'HIQ_UNREVIEWED_MIGRATION');
  return { preservedPredecessorFiles: old.length, migrationCount: expectedSql.length };
}

export function checkLocalOnly(repoRoot, expectedCommit) {
  const plan = loadPlan(repoRoot);
  const pins = assertPredecessorPins(repoRoot);
  if (expectedCommit !== undefined) {
    requireValue(GIT_SHA.test(expectedCommit), 'HIQ_LOCAL_SOURCE_ARGUMENT_INVALID');
    assertSource(repoRoot, expectedCommit, { staticOnly: true });
  }
  return { status: 'local-manifest-and-predecessor-pins-verified', sqlSha256: plan.sqlSha256, migrationCount: pins.migrationCount,
    preservedPredecessorFiles: pins.preservedPredecessorFiles, remoteWritesPerformed: false, deploymentAuthorized: false };
}

const emptyTarget = { relations: [], functions: [], existingTableTriggers: [] };

export function validateObservation(observed, plan, now = new Date()) {
  requireValue(observed?.format === 'hall-inquiry-catalog-v1' && observed.identityReady === true && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM_IDENTIFIER && /^17\./u.test(observed.serverVersion ?? '')
    && observed.database === 'postgres' && observed.currentUser === 'supabase_read_only_user'
    && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(v => MD5.test(v ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0 && /^\d{14}$/u.test(observed.ledgerHead ?? '')
    && Array.isArray(observed.missingPrerequisites), 'HIQ_OBSERVATION_INVALID');
  const time = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(time) && time > now.getTime() - 120_000 && time <= now.getTime() + 10_000,
    'HIQ_OBSERVATION_EXPIRED');
  requireValue(observed.missingPrerequisites.length === 0, 'HIQ_PREREQUISITE_MISSING');
  if (observed.migration === null) {
    same(observed.catalog, emptyTarget, 'HIQ_TARGET_OBJECTS_ALREADY_EXIST');
    requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'HIQ_LEDGER_CONFLICT');
  } else {
    same(observed.migration, { version: MIGRATION_VERSION, name: MIGRATION_NAME,
      statementCount: 1, sqlMd5: md5(plan.sql) }, 'HIQ_APPLIED_LEDGER_CONFLICT');
    same(observed.catalog, plan.catalog, 'HIQ_APPLIED_CATALOG_DRIFT');
  }
  return observed;
}

function assertOutside(repoRoot, path) {
  const rel = relative(resolve(repoRoot), resolve(path));
  requireValue(isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`), 'HIQ_RECEIPT_MUST_BE_OUTSIDE_GIT');
}
function openReceipt(repoRoot, path) {
  assertOutside(repoRoot, path);
  const target = resolve(path), parent = dirname(target); let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/u).filter(Boolean)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'HIQ_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'HIQ_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append(record) { const bytes = Buffer.from(`${JSON.stringify(record)}\n`); let offset = 0;
    while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset, null);
      requireValue(Number.isSafeInteger(n) && n > 0 && n <= bytes.length - offset, 'HIQ_RECEIPT_WRITE_FAILED'); offset += n; }
    fsyncSync(fd); }, close() { closeSync(fd); } };
}

// 적용 뒤 관측에는 새 객체 catalog 전체가 실려 36문항보다 크다. 그래서 응답 상한을 1MiB 로 둔다.
export const MANAGEMENT_RESPONSE_LIMIT_BYTES = 1024 * 1024;
export async function managementQuery(sql, { readOnly, token }) {
  requireValue(typeof readOnly === 'boolean' && /^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'HIQ_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // 마이그레이션이 statement_timeout 을 60초로 올리고 반영 묶음의 마감은 120초다. 그보다 먼저 끊지 않는다.
      body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(130_000),
    });
    requireValue(response.ok, 'HIQ_REMOTE_OUTCOME_UNVERIFIED');
    const bytes = await response.text();
    requireValue(Buffer.byteLength(bytes) <= MANAGEMENT_RESPONSE_LIMIT_BYTES, 'HIQ_REMOTE_RESPONSE_LIMIT');
    const rows = JSON.parse(bytes); requireValue(Array.isArray(rows), 'HIQ_REMOTE_RESPONSE_INVALID'); return rows;
  } catch { fail('HIQ_REMOTE_OUTCOME_UNVERIFIED'); }
}

export async function runRelease({ repoRoot, argv, now = () => new Date(), query, source = assertSource,
  receiptFactory = openReceipt, baselineReader = file => readFileSync(file, 'utf8') } = {}) {
  const options = parseArgs(argv ?? []), plan = loadPlan(repoRoot);
  source(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'HIQ_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
    query = (sql, queryOptions) => managementQuery(sql, { ...queryOptions, token });
  }
  const receipt = receiptFactory(repoRoot, options['receipt-out']);
  const binding = { format: 'hall-inquiry-release-receipt-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT_REF, releaseCommit: options['expected-commit'], baseCommit: BASE_COMMIT,
    manifestSha256: plan.manifestSha256, sqlSha256: plan.sqlSha256, fixtureSha256: plan.fixtureSha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildObservationSql(), { readOnly: true });
    requireValue(rows.length === 1 && rows[0].observation, 'HIQ_OBSERVATION_RESPONSE_INVALID');
    return validateObservation(rows[0].observation, plan, now());
  };
  const unchanged = (a, b) => {
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'ledgerHead', 'migration'])
      same(a[key], b[key], 'HIQ_REHEARSAL_NOT_ROLLED_BACK');
  };
  const verifyApplied = (before, after) => {
    requireValue(before.migration === null && after.migration !== null && after.ledgerCount === before.ledgerCount + 1
      && after.ledgerWithoutTargetSha === before.ledgerSha && after.preservedCatalogSha === before.preservedCatalogSha,
    'HIQ_POST_APPLY_UNVERIFIED');
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
      catch { fail('HIQ_BASELINE_RECEIPT_INVALID'); }
      const baseline = records.find(r => r.status === 'before-observed' && r.format === binding.format
        && r.release === RELEASE && r.projectRef === PROJECT_REF && r.mode === 'apply'
        && r.releaseCommit === binding.releaseCommit && r.baseCommit === BASE_COMMIT
        && r.manifestSha256 === binding.manifestSha256
        && r.sqlSha256 === binding.sqlSha256 && r.fixtureSha256 === binding.fixtureSha256 && r.observation?.migration === null);
      requireValue(baseline, 'HIQ_BASELINE_RECEIPT_BINDING_INVALID'); verifyApplied(baseline.observation, before);
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
    requireValue(now().getTime() < Date.parse(deadline), 'HIQ_DEADLINE_EXPIRED');
    source(repoRoot, options['expected-commit']); const fresh = loadPlan(repoRoot);
    requireValue(fresh.manifestSha256 === plan.manifestSha256 && fresh.sqlSha256 === plan.sqlSha256, 'HIQ_SOURCE_CHANGED');
    const apply = buildMutationSql({ sql: plan.sql, before, catalog: plan.catalog, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(apply), retryProhibitedOnAmbiguity: true });
    await query(apply, { readOnly: false });
    const after = await observe(); verifyApplied(before, after);
    record('applied-and-postverified', { observation: after });
    return { status: 'applied-and-postverified', remoteWritesPerformed: true };
  } catch (error) {
    const code = /^HIQ_[A-Z0-9_]+$/u.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'HIQ_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* fsync한 앞선 기록을 보존한다. */ }
    fail(mutationStarted ? 'HIQ_OUTCOME_REQUIRES_READONLY_INSPECTION' : code);
  } finally { receipt.close(); }
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--check-only')) {
      requireValue(args.length >= 1 && args.length <= 2 && args[0] === '--check-only'
        && (args.length === 1 || /^--expected-commit=[a-f0-9]{40}$/u.test(args[1])), 'HIQ_LOCAL_CHECK_ARGUMENT_INVALID');
      const result = checkLocalOnly(process.cwd(), args[1]?.slice('--expected-commit='.length));
      process.stdout.write(`HALL_INQUIRY_LOCAL_VERIFIED: migrations=${result.migrationCount}; predecessor_files=${result.preservedPredecessorFiles}; remote_writes=false; deployment_authorized=false\n`);
    } else {
      const result = await runRelease({ repoRoot: process.cwd(), argv: args });
      process.stdout.write(`HALL_INQUIRY_RELEASE: ${result.status}; durable_remote_writes=${result.remoteWritesPerformed}\n`);
    }
  } catch (error) {
    process.stderr.write(`HALL_INQUIRY_RELEASE_BLOCKED: ${/^HIQ_[A-Z0-9_]+$/u.test(error?.code ?? '') ? error.code : 'HIQ_UNEXPECTED'}\n`);
    process.exitCode = 1;
  }
}

// Next's synchronous config loader must be able to require the static contract.
// CLI async work still owns its network/receipt handles and catches all failures.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
