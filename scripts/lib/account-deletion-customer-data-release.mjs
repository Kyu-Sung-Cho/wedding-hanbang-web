import { execFileSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { CurrentBaselineBlocked, digest, pinnedArtifact, same } from './current-baseline-release-contract.mjs';
import { loadCustomerDataReleasePlan } from './account-deletion-customer-data-release-contract.mjs';

const MODE = '--account-deletion-customer-data';
const PROJECT = 'slrtobkksjmxgzatjyqb';
const RELEASE = 'account-deletion-customer-data-20260913';
const MAX_AGE_MS = 120_000;
const fail = code => { throw new CurrentBaselineBlocked(code); };
const requireValue = (condition, code) => { if (!condition) fail(code); };

export function parseCustomerDataReleaseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if ([MODE, '--inspect', '--rehearse', '--apply'].includes(arg)) {
      const key = arg === MODE ? 'selected' : 'mode';
      requireValue(!Object.hasOwn(result, key), 'CUSTOMER_DATA_ARGUMENT_DUPLICATE');
      result[key] = arg === MODE ? true : arg.slice(2);
      continue;
    }
    const match = /^--(expected-commit|project-ref|receipt-out|confirm-production)=(.+)$/.exec(arg);
    requireValue(match && !Object.hasOwn(result, match[1]), 'CUSTOMER_DATA_ARGUMENT_INVALID');
    result[match[1]] = match[2];
  }
  requireValue(result.selected && result.mode && /^[a-f0-9]{40}$/.test(result['expected-commit'] ?? '')
    && result['project-ref'] === PROJECT && isAbsolute(result['receipt-out'] ?? ''), 'CUSTOMER_DATA_ARGUMENT_INVALID');
  requireValue(result['confirm-production'] === `${RELEASE}:${PROJECT}:${result.mode}:${result['expected-commit']}`,
    'CUSTOMER_DATA_CONFIRMATION_REQUIRED');
  return result;
}

function loadSql(repoRoot, plan) {
  const pin = plan.contract.migrations[0];
  return pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` }).toString('utf8');
}

import { buildCustomerDataObservationSql, buildCustomerDataMutationSql, validateCustomerDataObservation } from './account-deletion-customer-data-catalog.mjs';

function assertGitSource(repoRoot, expectedCommit) {
  const git = args => execFileSync('git', ['--no-replace-objects', '-C', repoRoot, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  }).trim();
  requireValue(git(['rev-parse', 'HEAD']) === expectedCommit && git(['status', '--porcelain', '--untracked-files=all']) === '',
    'CUSTOMER_DATA_SOURCE_NOT_CLEAN_EXACT_COMMIT');
}

export function appendCustomerDataReceipt(fd, value, { write = writeSync, flush = fsyncSync } = {}) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  let offset = 0;
  while (offset < bytes.length) {
    const written = write(fd, bytes, offset, bytes.length - offset, null);
    requireValue(Number.isSafeInteger(written) && written > 0 && written <= bytes.length - offset,
      'CUSTOMER_DATA_RECEIPT_WRITE_INCOMPLETE');
    offset += written;
  }
  flush(fd);
}

function openReceipt(file) {
  const target = resolve(file), parent = dirname(target);
  let cursor = parse(parent).root;
  for (const part of parent.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    requireValue(lstatSync(cursor).isDirectory() && !lstatSync(cursor).isSymbolicLink(), 'CUSTOMER_DATA_RECEIPT_PATH_INVALID');
  }
  requireValue(realpathSync(parent) === parent, 'CUSTOMER_DATA_RECEIPT_PATH_INVALID');
  const fd = openSync(target, 'wx', 0o600);
  return { append: value => appendCustomerDataReceipt(fd, value), close: () => closeSync(fd) };
}

async function managementQuery(sql, accessToken) {
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, read_only: false }), signal: AbortSignal.timeout(45_000),
    });
    requireValue(response.ok, 'CUSTOMER_DATA_REMOTE_OUTCOME_UNVERIFIED');
    const text = await response.text();
    requireValue(Buffer.byteLength(text) <= 256 * 1024, 'CUSTOMER_DATA_REMOTE_OUTCOME_UNVERIFIED');
    const rows = JSON.parse(text);
    requireValue(Array.isArray(rows), 'CUSTOMER_DATA_REMOTE_OUTCOME_UNVERIFIED');
    return rows;
  } catch { fail('CUSTOMER_DATA_REMOTE_OUTCOME_UNVERIFIED'); }
}

// 주입 의존성은 오프라인 검사 전용이다. CLI는 고정 HTTPS 대상과 실제 Git·원문 핀을 쓴다.
export async function runCustomerDataRelease({ repoRoot, argv, now = () => new Date(),
  query, assertSource = assertGitSource, receiptFactory = openReceipt } = {}) {
  const options = parseCustomerDataReleaseArgs(argv ?? []);
  const plan = loadCustomerDataReleasePlan(repoRoot);
  const sql = loadSql(repoRoot, plan);
  const fixture=JSON.parse(pinnedArtifact(repoRoot,plan.contract.catalogFixture));
  const previousSql=pinnedArtifact(repoRoot,plan.contract.previousFunction).toString('utf8');
  const previousClaimSql=pinnedArtifact(repoRoot,plan.contract.previousClaimFunction).toString('utf8');
  const predecessorSql = pinnedArtifact(repoRoot,plan.contract.predecessorMigration).toString('utf8');
  const context={sql,fixture,previousSql,previousClaimSql,predecessorSql};
  assertSource(repoRoot, options['expected-commit']);
  if (!query) {
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    requireValue(/^sbp_(?:oauth_)?[a-f0-9]{40}$/.test(token ?? ''), 'CUSTOMER_DATA_CREDENTIAL_UNAVAILABLE');
    query = text => managementQuery(text, token);
  }
  const receipt = receiptFactory(options['receipt-out']);
  const binding = { format: 'account-deletion-customer-data-runtime-v1', release: RELEASE, mode: options.mode,
    projectRef: PROJECT, releaseCommit: options['expected-commit'], contractSha256: plan.contractSha256,
    sqlSha256: plan.migrationSha256, catalogFixtureSha256: plan.contract.catalogFixture.sha256, runtimeSha256: plan.contract.runtime.sha256 };
  const record = (status, extra = {}) => receipt.append({ ...binding, status, recordedAt: now().toISOString(), ...extra });
  const observe = async () => {
    const rows = await query(buildCustomerDataObservationSql());
    requireValue(Array.isArray(rows) && rows.length === 1, 'CUSTOMER_DATA_OBSERVATION_INVALID');
    return validateCustomerDataObservation(rows[0].observation, { ...context, now: now() });
  };
  let mutationStarted = false;
  try {
    record('started');
    const before = await observe();
    record('before-observed', { before, catalogSha256: digest(JSON.stringify(before.catalog)) });
    if (options.mode === 'inspect' || before.migration) {
      const status = before.migration ? 'already-applied-verified' : 'inspected-unapplied';
      record(status);
      return { status, before, remoteWritesPerformed: false };
    }
    const deadline = new Date(now().getTime() + MAX_AGE_MS).toISOString();
    const rehearseSql = buildCustomerDataMutationSql({ ...context, before, deadline, rehearsal: true });
    record('rehearsal-outcome-unverified', { deadline, bundleSha256: digest(rehearseSql) });
    mutationStarted = true;
    await query(rehearseSql);
    const rolledBack = await observe();
    for (const key of ['catalog', 'authTriggerAllowed', 'customerRows', 'jobsCount', 'privateScopesCount', 'retiredRequestsCount', 'preservedCatalogSha', 'ledgerSha', 'ledgerWithoutTargetSha', 'ledgerCount', 'migration', 'predecessor'])
      same(rolledBack[key], before[key], 'CUSTOMER_DATA_REHEARSAL_NOT_ROLLED_BACK');
    record('rehearsed-and-rolled-back', { after: rolledBack });
    if (options.mode === 'rehearse') return { status: 'rehearsed-and-rolled-back', before, after: rolledBack, remoteWritesPerformed: false };
    requireValue(now().getTime() < Date.parse(deadline), 'CUSTOMER_DATA_DEADLINE_EXPIRED');
    assertSource(repoRoot, options['expected-commit']);
    // 적용 직전 원문과 구현도 다시 검증한다. 과거 rehearsal 영수증을 믿고 바로 적용하지 않는다.
    const freshPlan = loadCustomerDataReleasePlan(repoRoot);
    same(freshPlan.contractSha256, plan.contractSha256, 'CUSTOMER_DATA_SOURCE_CHANGED');
    const applySql = buildCustomerDataMutationSql({ ...context, before, deadline, rehearsal: false });
    record('apply-outcome-unverified', { deadline, bundleSha256: digest(applySql) });
    await query(applySql);
    const after = await observe();
    requireValue(after.migration !== null
      && after.ledgerCount === before.ledgerCount + 1 && after.ledgerWithoutTargetSha === before.ledgerSha,
    'CUSTOMER_DATA_POST_APPLY_UNVERIFIED');
    same(after.preservedCatalogSha, before.preservedCatalogSha, 'CUSTOMER_DATA_POST_APPLY_CATALOG_DRIFT');
    same(after.customerRows, before.customerRows, 'CUSTOMER_DATA_POST_APPLY_CUSTOMER_DRIFT');
    requireValue(after.jobsCount === 0 && after.privateScopesCount === 0 && after.retiredRequestsCount === 0, 'CUSTOMER_DATA_POST_APPLY_PREPARATION_DRIFT');
    record('applied-and-postverified', { after });
    return { status: 'applied-and-postverified', before, after, remoteWritesPerformed: true };
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'CUSTOMER_DATA_UNEXPECTED';
    try { record(mutationStarted ? 'outcome-requires-readonly-inspection' : 'blocked-before-mutation', { code, retryProhibited: mutationStarted }); } catch { /* 앞서 fsync한 결과 미확정 기록을 유지한다. */ }
    fail(mutationStarted ? 'CUSTOMER_DATA_OUTCOME_REQUIRES_INSPECTION' : code);
  } finally { receipt.close(); }
}
