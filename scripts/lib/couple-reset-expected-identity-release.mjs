import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { CurrentBaselineBlocked, digest, pinnedArtifact, same } from './current-baseline-release-contract.mjs';
import { loadCoupleResetExpectedIdentityReleasePlan } from './couple-reset-expected-identity-release-contract.mjs';
import { COUPLE_RESET_EXPECTED_IDENTITY_PROJECT as PROJECT,
  buildCoupleResetExpectedIdentityObservationSql, buildCoupleResetExpectedIdentityMutationSql,
  validateCoupleResetExpectedIdentityObservation } from './couple-reset-expected-identity-catalog.mjs';

const MODE = '--couple-reset-expected-identity';
const RELEASE = 'couple-reset-expected-identity-20260928';
const MAX_AGE_MS = 120_000;
const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };

export function parseCoupleResetExpectedIdentityReleaseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if ([MODE, '--inspect', '--rehearse', '--apply'].includes(arg)) {
      const key = arg === MODE ? 'selected' : 'mode';
      requireValue(!Object.hasOwn(result, key), 'COUPLE_RESET_ARGUMENT_DUPLICATE');
      result[key] = arg === MODE ? true : arg.slice(2);
      continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
    requireValue(match && !Object.hasOwn(result, match[1]), 'COUPLE_RESET_ARGUMENT_INVALID');
    result[match[1]] = match[2];
  }
  requireValue(result.selected && result.mode && /^[a-f0-9]{40}$/.test(result['expected-commit'] ?? '')
    && result['project-ref'] === PROJECT && isAbsolute(result['receipt-out'] ?? ''), 'COUPLE_RESET_ARGUMENT_INVALID');
  requireValue(result['confirm-production'] === `${RELEASE}:${PROJECT}:${result.mode}:${result['expected-commit']}`,
    'COUPLE_RESET_CONFIRMATION_REQUIRED');
  return result;
}

function assertGitSource(repoRoot, expectedCommit) {
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'COUPLE_RESET_SOURCE_NOT_CLEAN_EXACT_COMMIT');
}

export function appendCoupleResetExpectedIdentityReceipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    requireValue(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset,
      'COUPLE_RESET_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

function openReceipt(file) {
  const target = resolve(file), parent = dirname(target);
  let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    const info = lstatSync(cursor);
    requireValue(info.isDirectory() && !info.isSymbolicLink(), 'COUPLE_RESET_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'COUPLE_RESET_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append: value => appendCoupleResetExpectedIdentityReceipt(fd, value), close: () => closeSync(fd) };
}

async function managementObservation(sql, accessToken, { readOnly }) {
  // 원본 복원·전역 write fence 연결 전에는 고정 운영 transport에 쓰기를 전달할 수 없다.
  requireValue(readOnly === true, 'COUPLE_RESET_GLOBAL_RELEASE_GATES_REQUIRED');
  try {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: true }), signal: AbortSignal.timeout(45_000),
    });
    requireValue(response.ok, 'COUPLE_RESET_REMOTE_OUTCOME_UNVERIFIED');
    const text = await response.text();
    requireValue(Buffer.byteLength(text) <= 256 * 1024, 'COUPLE_RESET_REMOTE_OUTCOME_UNVERIFIED');
    const rows = JSON.parse(text);
    requireValue(Array.isArray(rows), 'COUPLE_RESET_REMOTE_OUTCOME_UNVERIFIED');
    return rows;
  } catch { fail('COUPLE_RESET_REMOTE_OUTCOME_UNVERIFIED'); }
}

// query 주입은 오프라인/로컬 PG 검증 전용이다. CLI는 이 주입 경로를 노출하지 않는다.
export async function runCoupleResetExpectedIdentityRelease({ repoRoot, argv, now = () => new Date(),
  query, assertSource = assertGitSource, receiptFactory = openReceipt } = {}) {
  const options = parseCoupleResetExpectedIdentityReleaseArgs(argv ?? []);
  const localValidation = typeof query === 'function';
  // 파일·환경·영수증·네트워크에 접근하기 전에 운영 변경 모드를 거절한다.
  requireValue(localValidation || options.mode === 'inspect', 'COUPLE_RESET_GLOBAL_RELEASE_GATES_REQUIRED');
  requireValue(query === undefined || localValidation, 'COUPLE_RESET_QUERY_INVALID');
  const receiptRelative = relative(realpathSync(repoRoot), resolve(options['receipt-out']));
  requireValue(receiptRelative === '..' || receiptRelative.startsWith(`..${sep}`) || isAbsolute(receiptRelative),
    'COUPLE_RESET_RECEIPT_PATH_INVALID');
  const plan = loadCoupleResetExpectedIdentityReleasePlan(repoRoot);
  const pin = plan.contract.migrations[0];
  const sql = pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` }).toString('utf8');
  const fixture = JSON.parse(pinnedArtifact(repoRoot, plan.contract.catalogFixture));
  const predecessorSql = pinnedArtifact(repoRoot, plan.contract.predecessorMigration).toString('utf8');
  const expectedVersions = plan.expectedLedgerVersions;
  const context = { sql, fixture, predecessorSql, expectedVersions };
  assertSource(repoRoot, options['expected-commit']);
  if (!localValidation) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token ?? ''), 'COUPLE_RESET_CREDENTIAL_UNAVAILABLE');
    query = (text, options) => managementObservation(text, token, options);
  }
  const receipt = receiptFactory(options['receipt-out']);
  const authority = { executionContext: localValidation ? 'injected-local-validation' : 'production-readonly-inspection',
    productionExecutionEnabled: false, runtimeEvidenceVerified: false, releaseAuthorized: false,
    fullOriginalRestore: 'not-proven', remoteWritesPerformed: false };
  const binding = { format: 'couple-reset-expected-identity-runtime-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT, releaseCommit: options['expected-commit'], contractSha256: plan.contractSha256,
    sqlSha256: plan.migrationSha256, runtimeSha256: plan.contract.runtime.sha256,
    catalogSha256: plan.contract.catalog.sha256, catalogFixtureSha256: plan.contract.catalogFixture.sha256, ...authority };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const result = (status, before, after, localMutationCommitted = false) => ({ status, before, ...(after ? { after } : {}),
    ...authority, localMutationCommitted });
  const observe = async () => {
    const rows = await query(buildCoupleResetExpectedIdentityObservationSql(), { readOnly: true });
    requireValue(Array.isArray(rows) && rows.length === 1, 'COUPLE_RESET_OBSERVATION_INVALID');
    return validateCoupleResetExpectedIdentityObservation(rows[0].observation, { ...context, now: now() });
  };
  const sourceStillExact = () => {
    assertSource(repoRoot, options['expected-commit']);
    const fresh = loadCoupleResetExpectedIdentityReleasePlan(repoRoot);
    same(fresh.contractSha256, plan.contractSha256, 'COUPLE_RESET_SOURCE_CHANGED');
  };
  let mutationStarted = false;
  try {
    record('started');
    const before = await observe();
    record('before-observed', { before });
    if (options.mode === 'inspect' || before.migration) {
      const status = before.migration ? 'already-applied-verified' : 'inspected-unapplied';
      record(status);
      return result(status, before);
    }
    const deadline = new Date(now().getTime() + MAX_AGE_MS).toISOString();
    sourceStillExact();
    const rehearseSql = buildCoupleResetExpectedIdentityMutationSql({ ...context, before, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearseSql) });
    requireValue(now().getTime() < Date.parse(deadline), 'COUPLE_RESET_DEADLINE_EXPIRED');
    mutationStarted = true;
    await query(rehearseSql, { readOnly: false });
    const rolledBack = await observe();
    for (const key of ['catalog', 'preservedCatalogSha', 'rowDigests', 'ledgerSha', 'ledgerWithoutTargetSha',
      'ledgerCount', 'ledgerVersions', 'migration', 'predecessor']) {
      same(rolledBack[key], before[key], 'COUPLE_RESET_REHEARSAL_NOT_ROLLED_BACK');
    }
    record('rehearsed-and-rolled-back', { after: rolledBack });
    if (options.mode === 'rehearse') return result('rehearsed-and-rolled-back', before, rolledBack);
    requireValue(now().getTime() < Date.parse(deadline), 'COUPLE_RESET_DEADLINE_EXPIRED');
    sourceStillExact();
    const applySql = buildCoupleResetExpectedIdentityMutationSql({ ...context, before, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(applySql) });
    requireValue(now().getTime() < Date.parse(deadline), 'COUPLE_RESET_DEADLINE_EXPIRED');
    await query(applySql, { readOnly: false });
    const after = await observe();
    requireValue(after.migration !== null && after.ledgerCount === before.ledgerCount + 1
      && after.ledgerWithoutTargetSha === before.ledgerSha, 'COUPLE_RESET_POST_APPLY_UNVERIFIED');
    same(after.preservedCatalogSha, before.preservedCatalogSha, 'COUPLE_RESET_POST_APPLY_CATALOG_DRIFT');
    same(after.rowDigests, before.rowDigests, 'COUPLE_RESET_POST_APPLY_ROWS_DRIFT');
    record('local-applied-and-postverified', { after, localMutationCommitted: true });
    return result('local-applied-and-postverified', before, after, true);
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'COUPLE_RESET_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation',
      { code, retryProhibited: mutationStarted }); } catch { /* 앞서 fsync한 결과 미확정 기록을 유지한다. */ }
    fail(mutationStarted ? 'COUPLE_RESET_OUTCOME_REQUIRES_INSPECTION' : code);
  } finally { receipt.close(); }
}
