import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { BUDGET_DECISION_CONTRACT_FILE, BUDGET_DECISION_KIND, loadBudgetDecisionHotfixRelease } from './amora-budget-decision-release-contract.mjs';
import { digest, digestJson, pinnedArtifact, requireRelease, same } from './current-baseline-release-contract.mjs';
import { collectCurrentBackup } from './current-baseline-backup-collector.mjs';
import { createPostgresSource, createPrivateSink } from './current-baseline-backup-runtime.mjs';

const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
export const BUDGET_CAPTURE_KIND = 'amora-budget-decision-capture-v1';
export const CAPTURE_OPTIONS = Object.freeze(['expected-commit', 'expected-project', 'confirm-capture', 'ca-file', 'ca-sha256', 'pg-dump', 'pg-dump-sha256']);
// 기존 구현을 새 후보의 Git 파일로만 신뢰하지 않는다. 검토한 원문 byte도 고정한다.
export const REUSED_CAPTURE_PINS = Object.freeze([
  { file: 'scripts/lib/current-baseline-backup-collector.mjs', sha256: 'cc8ccff6c99adf99cd6b84e9ad7e2a8b94c7f06fef0b846686182a284d144b33' },
  { file: 'scripts/lib/current-baseline-backup-runtime.mjs', sha256: '274b4060cc49617a95ca79ceebe0394f72643dd7451cac6e081863a0ad9591c6' },
  { file: 'scripts/current-baseline-backup-worker.ps1', sha256: '31586887b9de7635e6624d5b39f3d719669d3b59d077e122eac3419025708ab1' },
  { file: 'scripts/amora-db-backup-common.ps1', sha256: 'b6f9eaa6a54edf92d868f61d25f00a2008ec42e34bbd5fb4dea75def61277079' },
].map(Object.freeze));

export function parseBudgetCaptureArgs(argv) {
  requireRelease(Array.isArray(argv) && argv.every(value => typeof value === 'string'), 'BUDGET_CAPTURE_ARGUMENT_INVALID');
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) return { mode: 'plan' };
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].slice(2); const value = argv[index + 1];
    requireRelease(argv[index].startsWith('--') && CAPTURE_OPTIONS.includes(key) && !Object.hasOwn(options, key)
      && typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'BUDGET_CAPTURE_ARGUMENT_INVALID');
    options[key] = value;
  }
  requireRelease(CAPTURE_OPTIONS.every(key => Object.hasOwn(options, key)), 'BUDGET_CAPTURE_ARGUMENT_MISSING');
  requireRelease(COMMIT.test(options['expected-commit']) && /^[a-z0-9]{20}$/.test(options['expected-project'])
    && SHA.test(options['ca-sha256']) && SHA.test(options['pg-dump-sha256'])
    && isAbsolute(options['ca-file']) && isAbsolute(options['pg-dump']), 'BUDGET_CAPTURE_ARGUMENT_INVALID');
  return { mode: 'capture', options };
}

export function captureConfirmation(release, commit) {
  return `CAPTURE-BUDGET-DECISION:${release.contract.projectRef}:${release.hotfix.release}:${release.hotfixSha256}:${commit}`;
}

export function validateReusedCapturePins(repoRoot) {
  for (const pin of REUSED_CAPTURE_PINS) pinnedArtifact(repoRoot, pin, 8 * 1024 * 1024);
}

export function validateCaptureCheckout(state, release, expectedCommit) {
  requireRelease(COMMIT.test(expectedCommit) && state.head === expectedCommit && state.status === '', 'CAPTURE_WORKTREE_NOT_FROZEN');
  requireRelease(state.origin === release.contract.expectedOrigin, 'CAPTURE_ORIGIN_MISMATCH');
  requireRelease(state.projectRef === release.contract.projectRef, 'CAPTURE_PROJECT_LINK_CHANGED');
}

export function createBudgetCaptureSourceFence(repoRoot, release, expectedCommit) {
  requireRelease(COMMIT.test(expectedCommit), 'CAPTURE_COMMIT_INVALID');
  const git = args => execFileSync('git', args, { cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10000, maxBuffer: 8 * 1024 * 1024 });
  const files = [...new Set([
    'scripts/amora-budget-decision-backup-collect.mjs', 'scripts/lib/amora-budget-decision-backup-collector.mjs',
    'scripts/lib/amora-budget-decision-release-contract.mjs', 'scripts/lib/current-baseline-release-contract.mjs',
    'scripts/lib/sql-read-only-envelope.mjs', 'pnpm-lock.yaml', BUDGET_DECISION_CONTRACT_FILE,
    ...REUSED_CAPTURE_PINS.map(pin => pin.file), ...Object.values(release.contract.implementation).map(pin => pin.file),
  ])].sort();
  const hashes = files.map(file => ({ file, sha256: digest(git(['show', `${expectedCommit}:${file}`])) }));
  const check = async () => {
    validateCaptureCheckout({ head: git(['rev-parse', 'HEAD']).toString().trim(),
      status: git(['status', '--porcelain', '--untracked-files=all']).toString(),
      origin: git(['remote', 'get-url', 'origin']).toString().trim(),
      projectRef: readFileSync(resolve(repoRoot, 'supabase/.temp/project-ref'), 'utf8').trim() }, release, expectedCommit);
    const current = loadBudgetDecisionHotfixRelease(repoRoot);
    for (const field of ['hotfixSha256', 'contractSha256', 'baselineSha256', 'migrationSetSha256'])
      same(current[field], release[field], 'BUDGET_CAPTURE_CONTRACT_CHANGED');
    validateReusedCapturePins(repoRoot);
    for (const pin of hashes) pinnedArtifact(repoRoot, pin, 8 * 1024 * 1024);
  };
  return { check, hashes };
}

function validateToolPins(options) {
  for (const [pathKey, shaKey] of [['ca-file', 'ca-sha256'], ['pg-dump', 'pg-dump-sha256']]) {
    const path = options[pathKey];
    requireRelease(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'CAPTURE_TOOL_PIN_INVALID');
    requireRelease(digest(readFileSync(path)) === options[shaKey], 'CAPTURE_TOOL_PIN_CHANGED');
  }
}

export function bindBudgetCaptureReceipt(receipt, release, expectedCommit, implementationPins) {
  requireRelease(receipt.kind === 'current-baseline-capture-v1' && receipt.status === 'captured-awaiting-release-evidence'
    && receipt.projectRef === release.contract.projectRef && receipt.releaseCommit === expectedCommit
    && receipt.contractSha256 === release.contractSha256 && receipt.baselineSha256 === release.baselineSha256
    && receipt.migrationSetSha256 === release.migrationSetSha256 && receipt.plaintextWrittenToDisk === false
    && /^[a-f0-9-]{36}$/.test(receipt.backupSetId), 'BUDGET_CAPTURE_RECEIPT_MISMATCH');
  requireRelease(release.hotfix.kind === BUDGET_DECISION_KIND && SHA.test(release.hotfixSha256)
    && release.hotfixSha256 !== release.contractSha256 && Array.isArray(implementationPins) && implementationPins.length > 0
    && implementationPins.every(pin => typeof pin.file === 'string' && SHA.test(pin.sha256)), 'BUDGET_CAPTURE_BINDING_INVALID');
  const binding = { kind: BUDGET_CAPTURE_KIND, release: release.hotfix.release, projectRef: receipt.projectRef,
    systemIdentifier: release.contract.systemIdentifier, releaseCommit: expectedCommit, backupSetId: receipt.backupSetId,
    hotfixSha256: release.hotfixSha256, predecessorContractSha256: release.contractSha256,
    baselineSha256: release.baselineSha256, migrationSetSha256: release.migrationSetSha256,
    implementationSha256: digestJson(implementationPins), artifactsSha256: digestJson(receipt.artifacts) };
  return { ...receipt, kind: BUDGET_CAPTURE_KIND, contractSha256: release.hotfixSha256,
    predecessorContractSha256: release.contractSha256, captureBinding: binding, captureBindingSha256: digestJson(binding),
    implementationPins, releaseReady: false };
}

export async function collectBudgetDecisionBackup({ release, expectedCommit, source, sink, assertStable, implementationPins, now }) {
  let completed;
  const boundSink = {
    initialize: value => sink.initialize(value), write: value => sink.write(value), progress: value => sink.progress(value),
    fail: value => sink.fail(value),
    async finish(receipt) {
      const bound = bindBudgetCaptureReceipt(receipt, release, expectedCommit, implementationPins);
      await sink.finish(bound); completed = bound;
    },
  };
  await collectCurrentBackup({ release, expectedCommit, source, sink: boundSink, assertStable, now });
  requireRelease(completed, 'BUDGET_CAPTURE_RECEIPT_MISSING');
  return completed;
}

function capturePlan(release) {
  return { mode: 'plan-only', kind: BUDGET_CAPTURE_KIND, projectRef: release.contract.projectRef,
    hotfixSha256: release.hotfixSha256, baselineSha256: release.baselineSha256, baselineLedgerCount: release.baseline.ledger.length,
    reviewedSqlFileCount: release.hotfix.reviewedLocalHistory.migrations.length + release.hotfix.migrations.length,
    migrationSetSha256: release.migrationSetSha256, scope: 'all-inventoried-durable-relations/schema/globals/storage-originals',
    options: CAPTURE_OPTIONS, confirmationTemplate: captureConfirmation(release, '<expected-commit>'),
    requirements: ['Windows DPAPI', 'clean expected commit / origin / linked project', 'pinned CA and pg_dump',
      'HBAM2_DATABASE_URL and SUPABASE_SERVICE_ROLE_KEY in memory/environment', 'actual active database write fence'],
    establishes: 'encrypted original capture only; no restore, apply, authorization or platform readiness', releaseReady: false };
}

// 테스트는 경계의 실제 호출 순서를 대조한다. CLI에는 주입/fixture/우회 인자가 없다.
export async function runBudgetDecisionCapture({ argv, repoRoot, platform = process.platform,
  readCredentials = () => ({ databaseUrl: process.env.HBAM2_DATABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY }),
  sourceFactory = createPostgresSource, sinkFactory = createPrivateSink, fenceFactory = createBudgetCaptureSourceFence }) {
  let source; let sink;
  try {
    const parsed = parseBudgetCaptureArgs(argv);
    const release = loadBudgetDecisionHotfixRelease(repoRoot);
    validateReusedCapturePins(repoRoot);
    if (parsed.mode === 'plan') return capturePlan(release);
    const options = parsed.options; const expectedCommit = options['expected-commit'];
    requireRelease(platform === 'win32', 'CAPTURE_WINDOWS_REQUIRED');
    requireRelease(options['expected-project'] === release.contract.projectRef
      && options['confirm-capture'] === captureConfirmation(release, expectedCommit), 'CAPTURE_CONFIRMATION_INVALID');
    validateToolPins(options);
    const fence = fenceFactory(repoRoot, release, expectedCommit);
    await fence.check();
    source = await sourceFactory({ repoRoot, release, ...readCredentials(), caFile: options['ca-file'],
      caSha256: options['ca-sha256'], pgDump: options['pg-dump'], pgDumpSha256: options['pg-dump-sha256'] });
    await fence.check();
    sink = sinkFactory({ repoRoot });
    const receipt = await collectBudgetDecisionBackup({ release, expectedCommit, source, sink,
      assertStable: fence.check, implementationPins: fence.hashes });
    return { kind: receipt.kind, status: receipt.status, backupSetId: receipt.backupSetId,
      releaseCommit: receipt.releaseCommit, hotfixSha256: receipt.contractSha256, captureBindingSha256: receipt.captureBindingSha256,
      relationCount: receipt.relations.length, objectCount: receipt.storageObjects.length,
      artifactCount: receipt.artifacts.length, releaseReady: false };
  } catch {
    // 인증값·SQL·SDK 오류·파일 경로는 cause와 표준 출력에도 남기지 않는다.
    throw Object.assign(new Error('BUDGET_DECISION_CAPTURE_FAILED'), { code: 'BUDGET_DECISION_CAPTURE_FAILED' });
  } finally {
    if (source) await source.close().catch(() => {});
    if (sink) await sink.close().catch(() => {});
  }
}
