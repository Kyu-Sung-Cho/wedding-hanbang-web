#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBudgetDecisionHotfixRelease } from './lib/amora-budget-decision-release-contract.mjs';
import { digest, pinnedArtifact, requireRelease } from './lib/current-baseline-release-contract.mjs';
import { CAPTURE_OPTIONS, parseBudgetCaptureArgs, captureConfirmation, validateReusedCapturePins,
  createBudgetCaptureSourceFence } from './lib/amora-budget-decision-backup-collector.mjs';
import { createPostgresSource, createPrivateSink, parseDatabaseConnection } from './lib/current-baseline-backup-runtime.mjs';
import { capturePostgresSnapshotArchive, assertArchiveTool } from './lib/postgres-snapshot-archive.mjs';
import { ARCHIVE_CAPTURE_KIND, collectBudgetDecisionArchiveBackup } from './lib/amora-budget-decision-archive-collector.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const names = [...CAPTURE_OPTIONS, 'pg-restore', 'pg-restore-sha256'];
let source; let sink;
try {
  const argv = process.argv.slice(2);
  const release = loadBudgetDecisionHotfixRelease(root);
  validateReusedCapturePins(root);
  if (!argv.length || (argv.length === 1 && argv[0] === '--help')) {
    process.stdout.write(JSON.stringify({ mode: 'plan-only', kind: ARCHIVE_CAPTURE_KIND,
      hotfixSha256: release.hotfixSha256, baselineLedgerCount: release.baseline.ledger.length,
      reviewedSqlFileCount: release.hotfix.reviewedLocalHistory.migrations.length + release.migrations.length,
      options: names, confirmationTemplate: 'ARCHIVE:' + captureConfirmation(release, '<expected-commit>'),
      scope: 'same exported snapshot custom DB archive plus existing encrypted relation/schema/globals/Storage capture',
      credentialsRead: false, remoteCalls: 0, releaseReady: false, fullRestoreVerified: false }, null, 2) + '\n');
  } else {
    const options = {};
    for (let index = 0; index < argv.length; index += 2) {
      const key = argv[index]?.slice(2); const value = argv[index + 1];
      requireRelease(argv[index].startsWith('--') && names.includes(key) && !Object.hasOwn(options, key)
        && typeof value === 'string' && value.length > 0 && !value.startsWith('--'), 'ARCHIVE_ARGUMENT_INVALID');
      options[key] = value;
    }
    requireRelease(names.every(key => Object.hasOwn(options, key)), 'ARCHIVE_ARGUMENT_MISSING');
    const expectedCommit = options['expected-commit'];
    requireRelease(options['confirm-capture'] === 'ARCHIVE:' + captureConfirmation(release, expectedCommit),
      'ARCHIVE_CONFIRMATION_INVALID');
    parseBudgetCaptureArgs(CAPTURE_OPTIONS.flatMap(key => ['--' + key, key === 'confirm-capture'
      ? captureConfirmation(release, expectedCommit) : options[key]]));
    requireRelease(process.platform === 'win32' && options['expected-project'] === release.contract.projectRef,
      'ARCHIVE_PLATFORM_OR_PROJECT_INVALID');
    for (const [file, sha] of [['ca-file', 'ca-sha256'], ['pg-dump', 'pg-dump-sha256'], ['pg-restore', 'pg-restore-sha256']])
      assertArchiveTool(options[file], options[sha]);
    const baseFence = createBudgetCaptureSourceFence(root, release, expectedCommit);
    const extraPins = ['scripts/amora-budget-decision-archive-collect.mjs',
      'scripts/lib/amora-budget-decision-archive-collector.mjs', 'scripts/lib/postgres-snapshot-archive.mjs']
      .map(file => ({ file, sha256: digest(execFileSync('git', ['show', expectedCommit + ':' + file],
        { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 1024 * 1024 })) }));
    const check = async () => {
      await baseFence.check();
      for (const pin of extraPins) pinnedArtifact(root, pin);
    };
    await check();
    const credentials = { databaseUrl: process.env.HBAM2_DATABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY };
    const config = parseDatabaseConnection({ databaseUrl: credentials.databaseUrl, projectRef: release.contract.projectRef,
      ca: readFileSync(options['ca-file'], 'utf8') });
    source = await createPostgresSource({ repoRoot: root, release, ...credentials,
      caFile: options['ca-file'], caSha256: options['ca-sha256'],
      pgDump: options['pg-dump'], pgDumpSha256: options['pg-dump-sha256'] });
    await check();
    sink = createPrivateSink({ repoRoot: root });
    const receipt = await collectBudgetDecisionArchiveBackup({ release, expectedCommit, source, sink, assertStable: check,
      implementationPins: [...baseFence.hashes, ...extraPins],
      captureArchive: async ({ snapshotId, binding }) => {
        assertArchiveTool(options['ca-file'], options['ca-sha256']);
        return capturePostgresSnapshotArchive({ snapshotId, binding, readerRole: config.readerRole,
          connectionEnv: { PGHOST: config.host, PGPORT: '5432', PGDATABASE: 'postgres', PGUSER: config.user,
            PGPASSWORD: config.password, PGSSLMODE: 'verify-full', PGSSLROOTCERT: options['ca-file'] },
          pgDump: options['pg-dump'], pgDumpSha256: options['pg-dump-sha256'],
          pgRestore: options['pg-restore'], pgRestoreSha256: options['pg-restore-sha256'],
          requiredSchemas: ['auth', 'public', 'storage', 'realtime', 'supabase_migrations'] });
      } });
    process.stdout.write(JSON.stringify({ kind: receipt.kind, backupSetId: receipt.backupSetId,
      releaseCommit: receipt.releaseCommit, captureBindingSha256: receipt.captureBindingSha256,
      artifactCount: receipt.artifacts.length, databaseArchiveBytes: receipt.databaseArchive.archiveBytes,
      databaseArchiveSha256: receipt.databaseArchive.archiveSha256, releaseReady: false, fullRestoreVerified: false }) + '\n');
  }
} catch {
  process.stderr.write('BUDGET_DECISION_ARCHIVE_CAPTURE_FAILED; incomplete captures are not restore or release evidence.\n');
  process.exitCode = 1;
} finally {
  if (source) await source.close().catch(() => {});
  if (sink) await sink.close().catch(() => {});
}
