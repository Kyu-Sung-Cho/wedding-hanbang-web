import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 읽기 전용: 인증 파일/백업 payload를 열지 않고 공개 영수증과 기존 도구만 확인한다.
// 실행 명령은 고정 --version뿐이다. DB/네트워크/계정/VM/메일 실행 기능은 없다.
const args = process.argv.slice(2);
if (args.length === 0 || args.includes('--help')) {
  console.log('Usage: node scripts/launch-operations-diagnose.mjs --evidence-root <launch-close-20260912> --pg-bin <existing PostgreSQL 17 bin> [--qemu-bin <existing portable bin>]');
  process.exit(0);
}
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!['--evidence-root', '--pg-bin', '--qemu-bin'].includes(key) || !value || value.startsWith('--') || options.has(key)) {
    throw new Error('INVALID_DIAGNOSTIC_ARGUMENTS');
  }
  options.set(key, realpathSync(resolve(value)));
}
if (!options.has('--evidence-root') || !options.has('--pg-bin')) throw new Error('DIAGNOSTIC_PATHS_REQUIRED');
const root = options.get('--evidence-root');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const records = [];
function receipt(relative) {
  const path = join(root, relative);
  if (!existsSync(path)) { records.push({ file: relative, present: false }); return null; }
  if (statSync(path).size > 2 * 1024 * 1024) throw new Error('DIAGNOSTIC_RECEIPT_TOO_LARGE');
  const bytes = readFileSync(path);
  const value = JSON.parse(bytes.toString('utf8'));
  records.push({ file: relative, present: true, sha256: sha(bytes) });
  return value;
}
function version(bin, name) {
  const path = join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
  if (!existsSync(path)) return { name, present: false };
  const bytes = readFileSync(path);
  try {
    // DB 접속 환경변수나 비밀값은 child에 넘기지 않는다.
    const env = {};
    for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
    const text = execFileSync(path, ['--version'], { env, windowsHide: true, timeout: 5000, maxBuffer: 8192, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const firstLine = text.trim().split(/\r?\n/)[0];
    if (!/^(?:postgres|psql|pg_dump|pg_restore|initdb|pg_ctl) \(PostgreSQL\) 17\.\d+|^QEMU emulator version \d+\./.test(firstLine)) {
      return { name, present: true, sha256: sha(bytes), versionConfirmed: false };
    }
    return { name, present: true, sha256: sha(bytes), version: firstLine, versionConfirmed: true };
  } catch { return { name, present: true, sha256: sha(bytes), versionConfirmed: false }; }
}
const actors = receipt('accounts/two-actor-api-result-safe.json');
const cleanupC = receipt('accounts/actor-c-cleanup-safe.json');
const cleanupD = receipt('accounts/actor-d-cleanup-safe.json');
const deletedAccess = receipt('accounts/deleted-actor-access-result-safe.json');
const restore = receipt('restore/CURRENT_RESTORE_STATUS.json');
const pgBin = options.get('--pg-bin');
const clean = (value) => value?.ownedUserIdentityVerified === true && value?.ownSessionsRevoked === true
  && value?.ownUserDeleted === true && value?.ownProfileAbsent === true && value?.otherUsersModified === false;
const expectedChecks = [
  'independent-signed-auth-identities', 'two-owned-actors-one-new-sealed-space',
  'both-independent-rls-private-denials-shared-visibility', 'duplicate-message-one-canonical-row',
  'other-private-write-403', 'C-confirm-1000-both-read-D-only-notification',
  'D-confirm-zero-both-read-C-only-notification', 'owned-space-reset-profile-null-primary-records-absent',
];
const expectedTables = ['wedding_journeys', 'chat_messages', 'decision_nodes', 'couple_plan_change_requests', 'couple_change_notifications', 'couple_plan_change_acceptances'];
const actorHashesMatch = typeof cleanupC?.syntheticActorSha256 === 'string'
  && typeof cleanupD?.syntheticActorSha256 === 'string' && cleanupC.syntheticActorSha256 !== cleanupD.syntheticActorSha256
  && Array.isArray(actors?.actorHashes) && actors.actorHashes.length === 2
  && [cleanupC.syntheticActorSha256, cleanupD.syntheticActorSha256].every((hash) => actors.actorHashes.includes(hash));
const result = {
  format: 'launch-operations-readonly-diagnostic-v1', observedAt: new Date().toISOString(),
  observerSourceSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  historicalEvidence: {
    actorApiPassed: actors?.success === true && actors?.verificationComplete === true
      && expectedChecks.every((name) => actors.checks?.some((check) => check.name === name && check.value === true))
      && expectedTables.every((name) => actors.ownedPostResetCounts?.[name] === 0)
      && actors.finalBudget === 0 && actors.existingUserSpaceMutations === 0,
    actorCleanupPassed: clean(cleanupC) && clean(cleanupD) && actorHashesMatch,
    actorRunFinishedAt: actors?.finishedAt ?? null, verifiedDeploymentCommit: actors?.expectedCommit ?? null,
    currentlyReusableActors: false,
    deletedUnexpiredAccessRejected: deletedAccess?.success === true && deletedAccess?.requestsAttempted === 2
      && deletedAccess?.refreshCalls === 0 && deletedAccess?.otherApiCalls === 0
      && Array.isArray(deletedAccess.results) && deletedAccess.results.length === 2
      && ['C', 'D'].every((actor) => deletedAccess.results.some((row) => row.actor === actor && row.status === 401 && row.userAbsent === true && row.authenticationRejected === true && row.tokenStillUnexpiredForFiveMinutes === true)),
    productAccountDeletionVerified: actors?.productAccountDeletionVerified === true,
    fullRestoreVerified: restore?.fullRestoreVerified === true,
    restoreObservedAt: restore?.observedAt ?? null,
    qemuOsBootObserved: restore?.localToolsStage?.guestOsBootObserved === true,
    qemuStrictProbePassed: restore?.localToolsStage?.strictProbePassed === true,
    originalDataAdmissionAllowed: false,
  },
  existingRuntime: {
    postgres: ['postgres', 'initdb', 'pg_ctl', 'pg_dump', 'pg_restore', 'psql'].map((name) => version(pgBin, name)),
    extensionControlFiles: Object.fromEntries(['pg_cron', 'supabase_vault', 'pgcrypto', 'uuid-ossp'].map((name) => [name, existsSync(join(dirname(pgBin), 'share', 'extension', `${name}.control`))])),
    qemu: options.has('--qemu-bin') ? version(options.get('--qemu-bin'), 'qemu-system-x86_64') : null,
  },
  evidenceFiles: records,
  scope: { historicalReceiptBytesRehashed: true, originalEncryptedPayloadOpened: false, runtimeVersionOnly: true, historicalRunsRepeated: false, networkRequests: 0, databaseConnections: 0, databaseWrites: 0, authMutations: 0, storageMutations: 0, emailsSent: 0, virtualMachinesStarted: 0, operatingSystemChanges: 0, releaseAuthorized: false },
  limits: ['Receipt consistency is not an independent replay of historical API execution.', 'PostgreSQL 17 tools and synthetic restore evidence do not prove full Supabase DB/Auth/Storage restore.', 'This diagnostic does not fetch Sentry events or verify operator delivery.'],
};
console.log(JSON.stringify(result, null, 2));
