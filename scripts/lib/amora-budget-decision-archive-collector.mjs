import { digest, digestJson, requireRelease, same } from './current-baseline-release-contract.mjs';
import { collectBudgetDecisionBackup } from './amora-budget-decision-backup-collector.mjs';
import { ARCHIVE_FORMAT, MAX_ARCHIVE_ENVELOPE_BYTES } from './postgres-snapshot-archive.mjs';

export const ARCHIVE_CAPTURE_KIND = 'amora-budget-decision-archive-capture-v1';
const SHA = /^[a-f0-9]{64}$/;
const SNAPSHOT = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{8}-[0-9]+$/;

/** 기존 worker의 연속 part 번호를 유지하기 위해 마지막에 archive 한 part만 추가한다. */
export async function collectBudgetDecisionArchiveBackup({ release, expectedCommit, source, sink, assertStable,
  implementationPins, captureArchive, now }) {
  let binding; let firstSnapshot; let begins = 0; let active = false; let archive; let completed;
  const wrappedSource = {
    ...source,
    async begin() {
      requireRelease(!active, 'ARCHIVE_SNAPSHOT_ALREADY_ACTIVE');
      const observation = await source.begin(); active = true; begins++;
      requireRelease(begins <= 2, 'ARCHIVE_SNAPSHOT_COUNT_INVALID');
      if (begins === 1) {
        requireRelease(SNAPSHOT.test(observation.snapshotId), 'ARCHIVE_SNAPSHOT_ID_INVALID');
        firstSnapshot = observation.snapshotId;
      }
      return observation;
    },
    async captureSchema() {
      requireRelease(active && begins === 1 && binding && !archive, 'ARCHIVE_SNAPSHOT_NOT_ACTIVE');
      const schema = await source.captureSchema();
      try {
        await assertStable();
        archive = await captureArchive({ snapshotId: firstSnapshot, binding: {
          projectRef: binding.projectRef, systemIdentifier: release.contract.systemIdentifier,
          releaseCommit: binding.expectedCommit, backupSetId: binding.backupSetId,
          hotfixSha256: release.hotfixSha256, baselineSha256: release.baselineSha256 } });
        requireRelease(active && begins === 1, 'ARCHIVE_SNAPSHOT_NOT_ACTIVE');
        await assertStable();
        return schema;
      } catch (error) { schema.statements = []; schema.globals = null; throw error; }
    },
    async end() {
      requireRelease(active && (begins !== 1 || archive), 'ARCHIVE_SNAPSHOT_NOT_CAPTURED');
      const observation = await source.end(); active = false; return observation;
    },
    async abort() { try { await source.abort(); } finally { active = false; } },
  };
  const wrappedSink = {
    async initialize(value) { binding = value; await sink.initialize(value); },
    write: value => sink.write(value),
    progress: value => sink.progress(value),
    fail: value => sink.fail(value),
    async finish(receipt) {
      requireRelease(begins === 2 && !active && archive && Buffer.isBuffer(archive.bytes)
        && archive.bytes.length > 0 && archive.bytes.length <= MAX_ARCHIVE_ENVELOPE_BYTES, 'ARCHIVE_CAPTURE_INCOMPLETE');
      const summary = archive.summary;
      requireRelease(summary?.format === ARCHIVE_FORMAT && summary.archiveDecoded === true
        && summary.databaseRestoreExecuted === false && summary.clusterRolePasswordsCaptured === false,
      'ARCHIVE_CAPTURE_SUMMARY_INVALID');
      const expected = { projectRef: receipt.projectRef, systemIdentifier: release.contract.systemIdentifier,
        releaseCommit: expectedCommit, backupSetId: receipt.backupSetId, hotfixSha256: release.hotfixSha256,
        baselineSha256: release.baselineSha256, snapshotIdentitySha256: receipt.snapshotIdentitySha256 };
      for (const [key, value] of Object.entries(expected)) same(summary[key], value, 'ARCHIVE_CAPTURE_BINDING_MISMATCH');
      requireRelease(summary.snapshotIdentitySha256 === digest(firstSnapshot), 'ARCHIVE_CAPTURE_SNAPSHOT_MISMATCH');
      // 공개 요약과 실제 암호화할 envelope가 다른 자료가 아닌지 확인한다.
      const envelope = JSON.parse(archive.bytes.toString('utf8'));
      const { archiveBase64, ...payloadSummary } = envelope;
      same(payloadSummary, summary, 'ARCHIVE_CAPTURE_ENVELOPE_MISMATCH');
      requireRelease(typeof archiveBase64 === 'string' && archiveBase64.length % 4 === 0
        && /^[A-Za-z0-9+/]*={0,2}$/.test(archiveBase64), 'ARCHIVE_CAPTURE_ENVELOPE_MISMATCH');
      const decoded = Buffer.from(archiveBase64, 'base64');
      try {
        requireRelease(decoded.toString('base64') === archiveBase64 && decoded.length === summary.archiveBytes
          && digest(decoded) === summary.archiveSha256 && decoded.subarray(0, 5).toString('ascii') === 'PGDMP',
        'ARCHIVE_CAPTURE_ENVELOPE_MISMATCH');
      } finally { decoded.fill(0); }
      requireRelease(Array.isArray(summary.commands) && summary.commands.length === 3
        && summary.commands.every(row => SHA.test(row.commandSha256) && SHA.test(row.outputSha256) && row.exitCode === 0),
      'ARCHIVE_CAPTURE_COMMANDS_INVALID');
      requireRelease(receipt.artifacts.length < 1000000, 'ARCHIVE_CAPTURE_PART_LIMIT');
      const directory = 'part-' + String(receipt.artifacts.length).padStart(6, '0');
      const name = 'logical-data.json';
      await assertStable();
      const metadata = await sink.write({ directory, name, bytes: archive.bytes, backupSetId: receipt.backupSetId });
      requireRelease(metadata.backup_set_id === receipt.backupSetId && metadata.artifact === name + '.hbam2'
        && metadata.key === name + '.key.dpapi' && metadata.plaintext_bytes === archive.bytes.length
        && metadata.plaintext_sha256?.toLowerCase() === digest(archive.bytes)
        && SHA.test(metadata.encrypted_sha256?.toLowerCase()) && SHA.test(metadata.key_sha256?.toLowerCase()),
      'ARCHIVE_CAPTURE_ENCRYPTION_INVALID');
      const artifact = { ...metadata, directory, name, scope: 'database-custom-archive',
        original_sha256: summary.archiveSha256, original_bytes: summary.archiveBytes };
      const artifacts = [...receipt.artifacts, artifact];
      await sink.progress({ phase: 'database-archive', artifactCount: artifacts.length });
      await assertStable();
      const captureBinding = { ...receipt.captureBinding, kind: ARCHIVE_CAPTURE_KIND,
        artifactsSha256: digestJson(artifacts), databaseArchiveSha256: summary.archiveSha256,
        snapshotIdentitySha256: summary.snapshotIdentitySha256 };
      const finalReceipt = { ...receipt, kind: ARCHIVE_CAPTURE_KIND, artifacts, databaseArchive: summary,
        commands: [...receipt.commands, ...summary.commands], captureBinding,
        captureBindingSha256: digestJson(captureBinding), releaseReady: false };
      await sink.finish(finalReceipt); completed = finalReceipt;
    },
  };
  try {
    await collectBudgetDecisionBackup({ release, expectedCommit, source: wrappedSource, sink: wrappedSink,
      assertStable, implementationPins, now });
    requireRelease(completed, 'ARCHIVE_CAPTURE_INCOMPLETE');
    return completed;
  } finally { archive?.bytes?.fill(0); }
}
