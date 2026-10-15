#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMutationSql, buildObservationSql, FUNCTIONS, MIGRATION_VERSION, PROJECT_REF,
  SYSTEM_IDENTIFIER, TABLES, unwrapMigration } from './wedding-code36-release-catalog.mjs';

export const RELEASE = 'wedding-code36-20261015';
export const BASE_COMMIT = '56e564b0f2653a22f40ca1c07f1eb8e75f9d7fd1';
export const MANIFEST = 'supabase/release-contracts/wedding-code36-v1.json';
export const MIGRATION = 'supabase/migrations/20261015070000_wedding_code36_private_pairing.sql';
export const FIXTURE = 'supabase/release-contracts/wedding-code36-pg-catalog-v1.json';
const RUNTIME = 'scripts/wedding-code36-release.mjs';
const CATALOG = 'scripts/wedding-code36-release-catalog.mjs';
const PREPARE = 'scripts/wedding-code36-release-prepare.mjs';
export const PINNED_FILES = [MIGRATION, FIXTURE, RUNTIME, CATALOG, PREPARE];
const SHA = /^[a-f0-9]{64}$/u;
const MD5 = /^[a-f0-9]{32}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
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
      requireValue(!Object.hasOwn(options, 'mode'), 'WC36_MODE_DUPLICATE'); options.mode = arg.slice(2); continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|baseline-receipt|confirm-production)=(.+)$/u.exec(arg);
    requireValue(match && !Object.hasOwn(options, match[1]), 'WC36_ARGUMENT_INVALID'); options[match[1]] = match[2];
  }
  requireValue(options.mode && GIT_SHA.test(options['expected-commit'] ?? '') && options['project-ref'] === PROJECT_REF
    && isAbsolute(options['receipt-out'] ?? ''), 'WC36_ARGUMENT_REQUIRED');
  requireValue(options['confirm-production'] === `${RELEASE}:${PROJECT_REF}:${options.mode}:${options['expected-commit']}`,
    'WC36_EXPLICIT_RELEASE_CONFIRMATION_REQUIRED');
  requireValue(options.mode !== 'verify' || isAbsolute(options['baseline-receipt'] ?? ''), 'WC36_BASELINE_RECEIPT_REQUIRED');
  requireValue(options.mode === 'verify' || options['baseline-receipt'] === undefined, 'WC36_BASELINE_ARGUMENT_INVALID');
  return options;
}

function safeArtifact(root, file) {
  const path = resolve(root, file), rel = relative(resolve(root), path);
  requireValue(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`), 'WC36_ARTIFACT_PATH_INVALID');
  let cursor = resolve(root);
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(!stat.isSymbolicLink(), 'WC36_ARTIFACT_SYMLINK_FORBIDDEN');
  }
  requireValue(lstatSync(path).isFile(), 'WC36_ARTIFACT_NOT_FILE');
  return readFileSync(path);
}

export function loadPlan(repoRoot) {
  let manifest;
  try { manifest = JSON.parse(safeArtifact(repoRoot, MANIFEST)); } catch { fail('WC36_MANIFEST_UNAVAILABLE'); }
  requireValue(manifest.version === 1 && manifest.kind === 'wedding-code36-isolated-additive-release'
    && manifest.release === RELEASE && manifest.status === 'requires-scoped-runtime-evidence'
    && manifest.projectRef === PROJECT_REF && manifest.systemIdentifier === SYSTEM_IDENTIFIER
    && manifest.baseCommit === BASE_COMMIT && manifest.migrationVersion === MIGRATION_VERSION
    && manifest.existingData === 'unchanged' && manifest.newRows === 'none'
    && manifest.runtimeEvidenceVerified === false && manifest.productionApplyImplemented === true,
  'WC36_MANIFEST_CONTRACT_INVALID');
  same(manifest.scope, { newTables: TABLES.map(n => `public.${n}`), newFunctions: FUNCTIONS.map(n => `public.${n}`),
    existingFunctions: 'unchanged', existingTables: 'unchanged', auth: 'unchanged', storage: 'unchanged', cron: 'unchanged' },
  'WC36_MANIFEST_SCOPE_INVALID');
  same((manifest.artifacts ?? []).map(pin => pin.file).sort(), [...PINNED_FILES].sort(), 'WC36_ARTIFACT_SET_INVALID');
  const contents = new Map();
  for (const pin of manifest.artifacts) {
    requireValue(SHA.test(pin.sha256 ?? ''), 'WC36_ARTIFACT_HASH_INVALID');
    const bytes = safeArtifact(repoRoot, pin.file);
    requireValue(digest(bytes) === pin.sha256, 'WC36_ARTIFACT_HASH_MISMATCH'); contents.set(pin.file, bytes);
  }
  const sql = contents.get(MIGRATION).toString('utf8');
  requireValue(!sql.includes('\r') && !sql.includes('\0'), 'WC36_MIGRATION_ENCODING_INVALID');
  const body = unwrapMigration(sql);
  // 보조 정적 검사다. 실제 허용 범위는 고정 원문+transaction 전후 catalog 비교로 닫는다.
  const ddl = body.replace(/\$([a-zA-Z_][a-zA-Z_0-9]*|)\$[\s\S]*?\$\1\$/gu, '').replace(/--[^\n]*/gu, '');
  requireValue(!/^\s*(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|DO|CALL|COPY)\b/imu.test(ddl), 'WC36_TOP_LEVEL_DML_FORBIDDEN');
  const declaredTables = [...ddl.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.([a-z_0-9]+)/giu)].map(m => m[1]).sort();
  const declaredFunctions = [...ddl.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_0-9]+)/giu)].map(m => m[1]).sort();
  same(declaredTables, [...TABLES].sort(), 'WC36_DDL_TABLE_SCOPE_INVALID');
  same(declaredFunctions, [...FUNCTIONS].sort(), 'WC36_DDL_FUNCTION_SCOPE_INVALID');
  let fixture;
  try { fixture = JSON.parse(contents.get(FIXTURE)); } catch { fail('WC36_FIXTURE_INVALID'); }
  requireValue(fixture.format === 'wedding-code36-catalog-fixture-v1' && fixture.catalog
    && Array.isArray(fixture.catalog.relations) && Array.isArray(fixture.catalog.functions), 'WC36_FIXTURE_INVALID');
  same(fixture.catalog.relations.map(r => r.name).sort(), TABLES.map(n => `public.${n}`).sort(), 'WC36_FIXTURE_TABLES_INVALID');
  same(fixture.catalog.functions.map(f => f.name).sort(), [...FUNCTIONS].sort(), 'WC36_FIXTURE_FUNCTIONS_INVALID');
  requireValue(fixture.catalog.relations.every(r => r.owner === 'postgres' && r.rls === true && r.policies.length === 0)
    && fixture.catalog.functions.every(f => f.owner === 'postgres' && f.securityDefiner === true), 'WC36_FIXTURE_PRIVILEGES_INVALID');
  return { manifest, manifestSha256: digest(safeArtifact(repoRoot, MANIFEST)), sql, catalog: fixture.catalog,
    sqlSha256: digest(contents.get(MIGRATION)), fixtureSha256: digest(contents.get(FIXTURE)) };
}

export function assertSource(repoRoot, expectedCommit) {
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'WC36_SOURCE_NOT_CLEAN_EXACT_COMMIT');
  requireValue(/^https:\/\/github\.com\/Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(git(['remote', 'get-url', 'origin']))
    || /^git@github\.com:Kyu-Sung-Cho\/wedding-hanbang-web(?:\.git)?$/u.test(git(['remote', 'get-url', 'origin'])),
  'WC36_ORIGIN_MISMATCH');
  try { git(['merge-base', '--is-ancestor', BASE_COMMIT, expectedCommit]); } catch { fail('WC36_BASE_COMMIT_NOT_ANCESTOR'); }
  const changed = git(['diff', '--name-only', BASE_COMMIT, expectedCommit]).split(/\r?\n/u).filter(Boolean);
  const inScope = file => file.startsWith('apps/web/src/app/wedding-code/')
    || file.startsWith('apps/web/src/app/api/wedding-code/v36/')
    || file.startsWith('apps/web/src/lib/weddingCode36/') || file.startsWith('apps/web/src/lib/weddingCode36Server/')
    || file === 'apps/web/src/constants/weddingCode36.ts'
    || file.startsWith('apps/web/src/app/api/cron/wedding-code-research-retention/')
    || file === 'apps/web/src/app/privacy/page.tsx' || file === 'PRINCIPLES.md'
    || file === 'docs/wedding-code/README.md' || file === '.github/workflows/ci.yml'
    || file === 'scripts/repository-test-manifest.json' || file === 'scripts/qa-wedding-code36-live.mjs'
    || file === 'scripts/tests/wedding-code36-sql-regression.mjs'
    || /^scripts\/(?:tests\/)?wedding-code36-release[^/]*\.mjs$/u.test(file)
    || /^supabase\/release-contracts\/wedding-code36-[^/]*\.json$/u.test(file)
    || file === MIGRATION || file.startsWith('docs/wedding-code/results36-2026-10-15/')
    || file.startsWith('docs/wedding-code/app36-production-2026-10-15/')
    || file.startsWith('docs/operations/wedding-code36-production-2026-10-15/');
  requireValue(changed.length > 0 && changed.every(inScope), 'WC36_SOURCE_SCOPE_DRIFT');
}

// 이전 lane의 원문 핀을 수정하지 않고, 실제 운영 base의 모든 기존 release 파일을 보존한다.
export function checkLocalOnly(repoRoot, expectedCommit) {
  const plan = loadPlan(repoRoot);
  const git = (args, input) => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', input, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  const old = git(['ls-tree', '-r', BASE_COMMIT, '--', 'supabase/migrations', 'supabase/release-contracts', 'scripts/lib'])
    .split(/\r?\n/u).filter(Boolean).map(line => {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/u.exec(line);
      requireValue(match, 'WC36_PREDECESSOR_TREE_INVALID'); return { oid: match[1], file: match[2] };
    });
  requireValue(old.length > 100, 'WC36_PREDECESSOR_TREE_INCOMPLETE');
  for (const pin of old) safeArtifact(repoRoot, pin.file);
  const hashes = git(['hash-object', '--no-filters', '--stdin-paths'], `${old.map(pin => pin.file).join('\n')}\n`).split(/\r?\n/u);
  requireValue(hashes.length === old.length && hashes.every((hash, i) => hash === old[i].oid), 'WC36_PREDECESSOR_PIN_DRIFT');
  const expectedSql = [...old.filter(pin => pin.file.startsWith('supabase/migrations/')).map(pin => pin.file.split('/').at(-1)), MIGRATION.split('/').at(-1)].sort();
  same(readdirSync(resolve(repoRoot, 'supabase/migrations')).filter(name => /\.sql$/iu.test(name)).sort(), expectedSql,
    'WC36_UNREVIEWED_MIGRATION');
  if (expectedCommit !== undefined) {
    requireValue(GIT_SHA.test(expectedCommit), 'WC36_LOCAL_SOURCE_ARGUMENT_INVALID'); assertSource(repoRoot, expectedCommit);
  }
  return { status: 'local-manifest-and-predecessor-pins-verified', sqlSha256: plan.sqlSha256,
    preservedPredecessorFiles: old.length, remoteWritesPerformed: false, deploymentAuthorized: false };
}

export function validateObservation(observed, plan, now = new Date()) {
  requireValue(observed?.format === 'wedding-code36-catalog-v1' && observed.identityReady === true && observed.readOnly === true
    && observed.systemIdentifier === SYSTEM_IDENTIFIER && /^17\./u.test(observed.serverVersion ?? '')
    && observed.database === 'postgres' && observed.currentUser === 'supabase_read_only_user'
    && [observed.preservedCatalogSha, observed.ledgerSha, observed.ledgerWithoutTargetSha].every(v => MD5.test(v ?? ''))
    && Number.isSafeInteger(observed.ledgerCount) && observed.ledgerCount > 0 && /^\d{14}$/u.test(observed.ledgerHead ?? ''),
  'WC36_OBSERVATION_INVALID');
  const time = Date.parse(observed.observedAt);
  requireValue(Number.isFinite(time) && time > now.getTime() - 120_000 && time <= now.getTime() + 10_000,
    'WC36_OBSERVATION_EXPIRED');
  if (observed.migration === null) {
    same(observed.catalog, { relations: [], functions: [] }, 'WC36_TARGET_OBJECTS_ALREADY_EXIST');
    requireValue(observed.ledgerSha === observed.ledgerWithoutTargetSha, 'WC36_LEDGER_CONFLICT');
  } else {
    same(observed.migration, { version: MIGRATION_VERSION, name: 'wedding_code36_private_pairing',
      statementCount: 1, sqlMd5: md5(plan.sql) }, 'WC36_APPLIED_LEDGER_CONFLICT');
    same(observed.catalog, plan.catalog, 'WC36_APPLIED_CATALOG_DRIFT');
  }
  return observed;
}

function assertOutside(repoRoot, path) {
  const rel = relative(resolve(repoRoot), resolve(path));
  requireValue(isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`), 'WC36_RECEIPT_MUST_BE_OUTSIDE_GIT');
}
function openReceipt(repoRoot, path) {
  assertOutside(repoRoot, path);
  const target = resolve(path), parent = dirname(target); let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/u).filter(Boolean)) {
    cursor = join(cursor, part); const stat = lstatSync(cursor);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink(), 'WC36_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'WC36_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append(record) { const bytes = Buffer.from(`${JSON.stringify(record)}\n`); let offset = 0;
    while (offset < bytes.length) { const n = writeSync(fd, bytes, offset, bytes.length - offset, null);
      requireValue(Number.isSafeInteger(n) && n > 0 && n <= bytes.length - offset, 'WC36_RECEIPT_WRITE_FAILED'); offset += n; }
    fsyncSync(fd); }, close() { closeSync(fd); } };
}

export async function managementQuery(sql, { readOnly, token }) {
  requireValue(typeof readOnly === 'boolean' && /^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'WC36_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: readOnly }), signal: AbortSignal.timeout(45_000),
    });
    requireValue(response.ok, 'WC36_REMOTE_OUTCOME_UNVERIFIED');
    const bytes = await response.text(); requireValue(Buffer.byteLength(bytes) <= 256 * 1024, 'WC36_REMOTE_RESPONSE_LIMIT');
    const rows = JSON.parse(bytes); requireValue(Array.isArray(rows), 'WC36_REMOTE_RESPONSE_INVALID'); return rows;
  } catch { fail('WC36_REMOTE_OUTCOME_UNVERIFIED'); }
}

export async function runRelease({ repoRoot, argv, now = () => new Date(), query, source = assertSource,
  receiptFactory = openReceipt, baselineReader = file => readFileSync(file, 'utf8') } = {}) {
  const options = parseArgs(argv ?? []), plan = loadPlan(repoRoot);
  source(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/u.test(token ?? ''), 'WC36_MANAGEMENT_CREDENTIAL_UNAVAILABLE');
    query = (sql, queryOptions) => managementQuery(sql, { ...queryOptions, token });
  }
  const receipt = receiptFactory(repoRoot, options['receipt-out']);
  const binding = { format: 'wedding-code36-release-receipt-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT_REF, releaseCommit: options['expected-commit'], baseCommit: BASE_COMMIT,
    manifestSha256: plan.manifestSha256, sqlSha256: plan.sqlSha256, fixtureSha256: plan.fixtureSha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildObservationSql(), { readOnly: true });
    requireValue(rows.length === 1 && rows[0].observation, 'WC36_OBSERVATION_RESPONSE_INVALID');
    return validateObservation(rows[0].observation, plan, now());
  };
  const unchanged = (a, b) => {
    for (const key of ['catalog', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'ledgerHead', 'migration'])
      same(a[key], b[key], 'WC36_REHEARSAL_NOT_ROLLED_BACK');
  };
  const verifyApplied = (before, after) => {
    requireValue(before.migration === null && after.migration !== null && after.ledgerCount === before.ledgerCount + 1
      && after.ledgerWithoutTargetSha === before.ledgerSha && after.preservedCatalogSha === before.preservedCatalogSha,
    'WC36_POST_APPLY_UNVERIFIED');
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
      catch { fail('WC36_BASELINE_RECEIPT_INVALID'); }
      const baseline = records.find(r => r.status === 'before-observed' && r.format === binding.format
        && r.release === RELEASE && r.projectRef === PROJECT_REF && r.mode === 'apply'
        && r.releaseCommit === binding.releaseCommit && r.baseCommit === BASE_COMMIT
        && r.manifestSha256 === binding.manifestSha256
        && r.sqlSha256 === binding.sqlSha256 && r.fixtureSha256 === binding.fixtureSha256 && r.observation?.migration === null);
      requireValue(baseline, 'WC36_BASELINE_RECEIPT_BINDING_INVALID'); verifyApplied(baseline.observation, before);
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
    requireValue(now().getTime() < Date.parse(deadline), 'WC36_DEADLINE_EXPIRED');
    source(repoRoot, options['expected-commit']); const fresh = loadPlan(repoRoot);
    requireValue(fresh.manifestSha256 === plan.manifestSha256 && fresh.sqlSha256 === plan.sqlSha256, 'WC36_SOURCE_CHANGED');
    const apply = buildMutationSql({ sql: plan.sql, before, catalog: plan.catalog, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(apply), retryProhibitedOnAmbiguity: true });
    await query(apply, { readOnly: false });
    const after = await observe(); verifyApplied(before, after);
    record('applied-and-postverified', { observation: after });
    return { status: 'applied-and-postverified', remoteWritesPerformed: true };
  } catch (error) {
    const code = /^WC36_[A-Z_]+$/u.test(error?.code ?? error?.message ?? '') ? (error.code ?? error.message) : 'WC36_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* fsync한 앞선 기록을 보존한다. */ }
    fail(mutationStarted ? 'WC36_OUTCOME_REQUIRES_READONLY_INSPECTION' : code);
  } finally { receipt.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--check-only')) {
      requireValue(args.length >= 1 && args.length <= 2 && args[0] === '--check-only'
        && (args.length === 1 || /^--expected-commit=[a-f0-9]{40}$/u.test(args[1])), 'WC36_LOCAL_CHECK_ARGUMENT_INVALID');
      const result = checkLocalOnly(process.cwd(), args[1]?.slice('--expected-commit='.length));
      process.stdout.write(`WEDDING_CODE36_LOCAL_VERIFIED: predecessor_files=${result.preservedPredecessorFiles}; remote_writes=false; deployment_authorized=false\n`);
    } else {
      const result = await runRelease({ repoRoot: process.cwd(), argv: args });
      process.stdout.write(`WEDDING_CODE36_RELEASE: ${result.status}; durable_remote_writes=${result.remoteWritesPerformed}\n`);
    }
  } catch (error) {
    process.stderr.write(`WEDDING_CODE36_RELEASE_BLOCKED: ${/^WC36_[A-Z_]+$/u.test(error?.code ?? '') ? error.code : 'WC36_UNEXPECTED'}\n`);
    process.exitCode = 1;
  }
}
