import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, open, lstat, realpath, rename } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute, sep, join } from 'node:path';
import { canonical, digest, digestJson, loadCurrentBaselineContract, pinnedArtifact, readAnchored, validateObservation } from './current-baseline-release-contract.mjs';
import { transactionBody } from './current-baseline-hosted-synthetic.mjs';
import { resolvePinnedWindowsProductionToolchain } from './production-windows-toolchain.mjs';
import { validateVercelDeploymentRawEvidence } from './production-external-gate-provenance.mjs';

export const HOTFIX_CONTRACT_FILE = 'supabase/release-contracts/amora-runtime-hotfix-v1.json';
const SHA = /^[a-f0-9]{64}$/;
const nativeSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const COMMIT = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ID = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const LEASE = 'public.production_release_lease_20260717';
const MAX_SQL_BYTES = 4 * 1024 * 1024;
const EXCLUSIONS = { fullDatabaseRestoreVerified: false, storageObjectsRestored: false, authDataRestored: false };
export class HotfixBlocked extends Error {
  constructor(code) { super(code); this.name = 'HotfixBlocked'; this.code = code; }
}
const ensure = (ok, code) => { if (!ok) throw new HotfixBlocked(code); };
const equal = (a, b, code) => ensure(canonical(a) === canonical(b), code);
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => `${literal(JSON.stringify(value))}::jsonb`;
const identifier = value => { ensure(ID.test(value), 'IDENTIFIER_INVALID'); return `"${value}"`; };
const instant = value => { const ms = Date.parse(value); ensure(Number.isFinite(ms), 'EVIDENCE_TIME_INVALID'); return ms; };
const fresh = (value, now, maximumAgeMs) => ensure(instant(value) <= now && now - instant(value) <= maximumAgeMs, 'EVIDENCE_EXPIRED');
const safeCode = error => error instanceof HotfixBlocked ? error.code : 'HOTFIX_OPERATION_UNCONFIRMED';

export function parseHotfixArgs(argv) {
  const options = {};
  const values = new Set(['expected-commit', 'remote-ref', 'evidence-root', 'receipt-out', 'bundle-out', 'confirm-production']);
  for (const arg of argv) {
    if (['--amora-runtime-hotfix', '--check-only', '--apply'].includes(arg)) {
      ensure(!options[arg.slice(2)], 'ARGUMENT_DUPLICATE'); options[arg.slice(2)] = true;
    } else {
      const match = /^--([a-z-]+)=(.+)$/.exec(arg);
      ensure(match && values.has(match[1]) && !options[match[1]], 'ARGUMENT_INVALID'); options[match[1]] = match[2];
    }
  }
  ensure(options['amora-runtime-hotfix'] && Boolean(options.apply) !== Boolean(options['check-only']), 'MODE_REQUIRED');
  ensure(COMMIT.test(options['expected-commit'] ?? ''), 'COMMIT_INVALID');
  ensure(/^origin\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(options['remote-ref'] ?? '') && !options['remote-ref'].includes('..')
    && !options['remote-ref'].includes('//') && !options['remote-ref'].endsWith('/'), 'REMOTE_REF_INVALID');
  for (const key of ['evidence-root', 'receipt-out', 'bundle-out']) ensure(isAbsolute(options[key] ?? ''), 'PRIVATE_PATH_REQUIRED');
  ensure(options['receipt-out'].endsWith('.json') && options['bundle-out'].endsWith('.sql')
    && resolve(options['receipt-out']) !== resolve(options['bundle-out']), 'OUTPUT_PATH_INVALID');
  return options;
}

export function parseHotfixFinalizeArgs(argv) {
  const options = {};
  const values = new Set(['expected-commit', 'remote-ref', 'evidence-root', 'outcome', 'canary', 'receipt-out', 'confirm-production']);
  for (const arg of argv) {
    if (['--amora-runtime-hotfix', '--finalize'].includes(arg)) {
      ensure(!options[arg.slice(2)], 'ARGUMENT_DUPLICATE'); options[arg.slice(2)] = true;
    } else {
      const match = /^--([a-z-]+)=(.+)$/.exec(arg);
      ensure(match && values.has(match[1]) && !options[match[1]], 'ARGUMENT_INVALID'); options[match[1]] = match[2];
    }
  }
  ensure(options['amora-runtime-hotfix'] && options.finalize, 'MODE_REQUIRED');
  ensure(COMMIT.test(options['expected-commit'] ?? ''), 'COMMIT_INVALID');
  ensure(/^origin\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(options['remote-ref'] ?? '') && !options['remote-ref'].includes('..')
    && !options['remote-ref'].includes('//') && !options['remote-ref'].endsWith('/'), 'REMOTE_REF_INVALID');
  for (const key of ['evidence-root', 'outcome', 'canary', 'receipt-out']) ensure(isAbsolute(options[key] ?? ''), 'PRIVATE_PATH_REQUIRED');
  ensure(['outcome', 'canary', 'receipt-out'].every(key => options[key].endsWith('.json'))
    && new Set(['outcome', 'canary', 'receipt-out'].map(key => resolve(options[key]).toLowerCase())).size === 3, 'OUTPUT_PATH_INVALID');
  ensure(typeof options['confirm-production'] === 'string', 'PRODUCTION_CONFIRMATION_MISMATCH');
  return options;
}

export function loadHotfixRelease(repoRoot) {
  const source = loadCurrentBaselineContract(repoRoot);
  const bytes = readAnchored(repoRoot, HOTFIX_CONTRACT_FILE);
  const contract = JSON.parse(bytes);
  ensure(contract.version === 1 && contract.kind === 'amora-public-runtime-eight-sql-hotfix'
    && contract.release === 'amora-public-runtime-20260907', 'HOTFIX_CONTRACT_INVALID');
  ensure(contract.projectRef === source.contract.projectRef && contract.systemIdentifier === source.contract.systemIdentifier
    && contract.requiredRemoteHead === source.contract.requiredRemoteHead && contract.requiredLedgerCount === 206, 'HOTFIX_BASELINE_INVALID');
  equal(contract.migrations, source.contract.migrations, 'HOTFIX_MIGRATION_SET_MISMATCH');
  ensure(contract.migrations.length === 8, 'HOTFIX_MIGRATION_COUNT');
  equal(contract.excludedHistoricalFiles, source.contract.excludedHistoricalFiles, 'HOTFIX_HISTORY_CHANGED');
  equal(contract.scope, { database: 'public-schema-and-existing-public-rows', auth: 'unchanged', storage: 'unchanged', ...EXCLUSIONS }, 'HOTFIX_SCOPE_INVALID');
  equal(contract.requiredEvidence, ['backup', 'rollback', 'hosted', 'concurrency', 'fence', 'dryRun'], 'HOTFIX_EVIDENCE_CONTRACT_INVALID');
  const operatingBytes = pinnedArtifact(repoRoot, contract.operatingBaseline);
  const operatingBaseline = JSON.parse(operatingBytes);
  validateHotfixOperatingBaseline({ original: source.baseline, current: operatingBaseline, delta: contract.baselineDelta, contract: source.contract });
  const inventory = pinnedArtifact(repoRoot, source.contract.implementation.inventory).toString('utf8');
  const inventorySelect = inventory.slice(inventory.indexOf('WITH namespaces')).replace(/;\s*COMMIT;\s*$/, '');
  ensure(inventorySelect.startsWith('WITH namespaces') && !inventorySelect.endsWith(';'), 'INVENTORY_ENVELOPE_INVALID');
  const fence = pinnedArtifact(repoRoot, source.contract.implementation.writeFenceCheck).toString('utf8');
  const fenceBody = fence.replace(/^BEGIN TRANSACTION READ ONLY;\s*/, '').replace(/\s*ROLLBACK;\s*$/, '');
  ensure(fenceBody !== fence && !/\bROLLBACK\s*;\s*$/i.test(fenceBody), 'FENCE_ENVELOPE_INVALID');
  return { ...source, baseline: operatingBaseline, baselineSha256: digest(operatingBytes), hotfix: contract, hotfixSha256: digest(bytes), inventorySelect, fenceBody };
}
export function validateHotfixOperatingBaseline({ original, current, delta, contract }) {
  validateObservation(current, contract);
  for (const key of ['format', 'systemIdentifier', 'serverVersion', 'ledger', 'storageStructureSha256', 'storagePolicies', 'vaultRows', 'cronJobs'])
    equal(current[key], original[key], 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  const before = new Map(original.objects.map(o => [`${o.kind}:${o.identity}`, o.sha256]));
  const after = new Map(current.objects.map(o => [`${o.kind}:${o.identity}`, o.sha256]));
  const changes = [...new Set([...before.keys(), ...after.keys()])].sort().filter(k => before.get(k) !== after.get(k))
    .map(identity => ({ identity, beforeSha256: before.get(identity) ?? null, afterSha256: after.get(identity) ?? null }));
  equal(changes.map(c => c.identity), ['publication:supabase_realtime_messages_publication', 'relation:realtime.messages_2026_09_03', 'relation:realtime.messages_2026_09_10'], 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  equal(changes, delta?.objects, 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  ensure(changes.every(c => c.identity === 'relation:realtime.messages_2026_09_03'
    ? SHA.test(c.beforeSha256) && c.afterSha256 === null
    : SHA.test(c.afterSha256) && (c.identity.startsWith('relation:') ? c.beforeSha256 === null : SHA.test(c.beforeSha256))), 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  equal(delta?.relationsAdded, [{ schema: 'realtime', name: 'messages_2026_09_10', kind: 'r' }], 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  equal(delta?.relationsRemoved, [{ schema: 'realtime', name: 'messages_2026_09_03', kind: 'r' }], 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
  equal(current.relations, [...original.relations.filter(r => r.schema !== 'realtime' || r.name !== 'messages_2026_09_03'), ...delta.relationsAdded]
    .sort((a, b) => `${a.schema}.${a.name}` < `${b.schema}.${b.name}` ? -1 : 1), 'HOTFIX_BASELINE_UNAPPROVED_DRIFT');
}
function reportBinding(report, evidence, release, kind, now) {
  ensure(report?.format === `amora-hotfix-${kind}-v1` && report.projectRef === release.hotfix.projectRef
    && report.releaseCommit === evidence.releaseCommit && report.migrationSetSha256 === release.migrationSetSha256,
  'EVIDENCE_BINDING_INVALID');
  fresh(report.verifiedAt, now, kind === 'backup' || kind === 'fence' || kind === 'dryRun' ? 30 * 60_000 : 24 * 3600_000);
}
export function validateHotfixEvidence({ evidence, reports, raw, release, expectedCommit, now = new Date() }) {
  const time = now.getTime();
  ensure(evidence?.format === 'amora-runtime-hotfix-evidence-v1' && evidence.releaseCommit === expectedCommit
    && COMMIT.test(expectedCommit) && evidence.projectRef === release.hotfix.projectRef
    && evidence.systemIdentifier === release.hotfix.systemIdentifier && evidence.hotfixContractSha256 === release.hotfixSha256
    && evidence.migrationSetSha256 === release.migrationSetSha256, 'EVIDENCE_BINDING_INVALID');
  ensure(instant(evidence.expiresAt) > time && instant(evidence.expiresAt) <= time + 30 * 60_000, 'EVIDENCE_EXPIRED');
  equal(evidence.scope, release.hotfix.scope, 'EVIDENCE_SCOPE_INVALID');
  for (const kind of release.hotfix.requiredEvidence) {
    reportBinding(reports[kind], evidence, release, kind, time);
    ensure(typeof raw[kind] === 'string' && raw[kind].length > 2 && digest(raw[kind]) === reports[kind].rawEvidenceSha256, 'RAW_EVIDENCE_MISMATCH');
  }
  const before = evidence.before;
  validateObservation(before, release.contract);
  ensure(before.ledger.length === release.hotfix.requiredLedgerCount && before.ledger.at(-1)?.version === release.hotfix.requiredRemoteHead, 'BASELINE_LEDGER_MISMATCH');
  equal(before.ledger, release.baseline.ledger, 'BASELINE_LEDGER_MISMATCH');
  // 원래 baseline의 role/ACL/schema를 새 승인 문자열로 교체하지 않는다. fence는 inventory에서 이미 제외된다.
  equal(before.objects, release.baseline.objects, 'BASELINE_SCHEMA_MISMATCH');
  equal(before.relations, release.baseline.relations, 'BASELINE_RELATIONS_MISMATCH');
  equal(before.storagePolicies, release.baseline.storagePolicies, 'STORAGE_CHANGED');
  equal(before.storageStructureSha256, release.baseline.storageStructureSha256, 'STORAGE_CHANGED');
  const tables = publicTables(before);
  equal(evidence.beforeData?.map(row => row.relation), tables.map(row => `${row.schema}.${row.name}`), 'DATA_SCOPE_INCOMPLETE');
  ensure(evidence.beforeData.every(row => Number.isSafeInteger(row.rows) && row.rows >= 0 && SHA.test(row.rowsSha256)), 'DATA_SNAPSHOT_INVALID');
  const backup = reports.backup;
  const backupRaw = JSON.parse(raw.backup);
  ensure(backupRaw.kind === 'independent-postgres-logical-snapshot' && backupRaw.status === 'logical-snapshot-verified-not-restored'
    && backupRaw.projectRef === evidence.projectRef && backupRaw.releaseCommit === expectedCommit
    && backupRaw.capturedAt === backup.verifiedAt && backupRaw.actualSourceCapture === true
    && backupRaw.sourceReadOnly === true && backupRaw.sourceIdentity?.systemIdentifier === release.hotfix.systemIdentifier
    && backupRaw.sourceIdentity.readOnly === 'on' && backupRaw.sourceIdentity.clientTlsMode === 'verify-full'
    && backupRaw.sourceIdentity.clientTlsVerifiedBySuccessfulConnection === true && nativeSha(backupRaw.sourceIdentity.clientTlsCaSha256)
    && typeof backupRaw.sourceIdentity.poolerBackendTls === 'boolean'
    && Number.isSafeInteger(backupRaw.sourceIdentity.serverVersion)
    && backupRaw.sourceIdentity.serverVersion >= 170000 && backupRaw.sourceIdentity.serverVersion < 180000, 'BACKUP_SOURCE_MISMATCH');
  ensure(UUID.test(backupRaw.backupSetId) && backupRaw.storageBytesCaptured === false && backupRaw.rolesOrPasswordsDumped === false
    && backupRaw.restoreRehearsalCompleted === false && backupRaw.currentBaselineReleaseEvidence === false,
  'BACKUP_SCOPE_OVERCLAIM');
  const encryption = backupRaw.encryption;
  ensure(encryption?.backup_set_id === backupRaw.backupSetId && SHA.test(encryption.plaintext_sha256?.toLowerCase())
    && SHA.test(encryption.encrypted_sha256?.toLowerCase()) && SHA.test(encryption.key_sha256?.toLowerCase())
    && encryption.artifact === 'logical-data.json.hbam2' && encryption.key === 'logical-data.json.key.dpapi'
    && Number.isSafeInteger(encryption.plaintext_bytes) && encryption.plaintext_bytes > 0 && encryption.plaintext_bytes <= 32 * 1024 * 1024
    && Number.isSafeInteger(backupRaw.archiveBytes) && backupRaw.archiveBytes > 0 && backupRaw.archiveBytes <= 24 * 1024 * 1024
    && nativeSha(backupRaw.archiveSha256) && backupRaw.inspection?.archiveDecodePassed === true
    && nativeSha(backupRaw.inspection.tocSha256) && Number.isSafeInteger(backupRaw.inspection.tocEntries)
    && backupRaw.inspection.tocEntries > 0, 'BACKUP_ARTIFACT_INVALID');
  ensure(SHA.test(evidence.rollbackOriginal?.sha256) && evidence.rollbackOriginal.sha256 === digest(raw.rollbackOriginal), 'ROLLBACK_ORIGINAL_MISSING');
  for (const kind of ['rollback', 'hosted', 'concurrency']) {
    const report = reports[kind], actual = JSON.parse(raw[kind]);
    ensure(/^[a-z0-9]{20}$/.test(report.targetProjectRef) && report.targetProjectRef !== release.hotfix.projectRef
      && /^\d{10,32}$/.test(report.targetSystemIdentifier) && report.targetSystemIdentifier !== release.hotfix.systemIdentifier,
    'HOSTED_TARGET_INVALID');
    ensure(actual.targetProjectRef === report.targetProjectRef && actual.targetSystemIdentifier === report.targetSystemIdentifier
      && actual.databaseEngine === 'PostgreSQL' && /^17\./.test(actual.serverVersion)
      && actual.migrationSetSha256 === release.migrationSetSha256
      && COMMIT.test(report.sourceReleaseCommit ?? expectedCommit)
      && actual.releaseCommit === (report.sourceReleaseCommit ?? expectedCommit), 'HOSTED_RAW_BINDING_INVALID');
  }
  const restored = JSON.parse(raw.rollback);
  ensure(restored.kind === 'synthetic-eight-sql-transaction-rollback' && restored.sourceArchiveRestored === false
    && restored.originalDdlArtifactSha256 === evidence.rollbackOriginal.sha256
    && SHA.test(restored.beforeSchemaSha256) && restored.beforeSchemaSha256 === restored.afterRollbackSchemaSha256
    && SHA.test(restored.beforeDataSha256) && restored.beforeDataSha256 === restored.afterRollbackDataSha256
    && restored.transactionRollbackExecuted === true && restored.operatorFenceHeld === true, 'ROLLBACK_NOT_PROVEN');
  const hosted = JSON.parse(raw.hosted);
  equal(hosted.executedMigrations, release.migrations.map(m => ({ file: m.file, sha256: m.sha256, bodySha256: digest(transactionBody(m.sql.toString('utf8'))) })), 'HOSTED_MIGRATION_MISMATCH');
  const checks = ['actorBoundary', 'budgetPreservesOmittedAllocations', 'personalOwnerPrivacy', 'mediationChoices', 'rollback'];
  equal(hosted.checks?.map(c => c.name).sort(), [...checks].sort(), 'HOSTED_CHECKS_INCOMPLETE');
  ensure(hosted.checks.every(c => c.status === 'passed' && c.observed && c.rawEvidenceSha256 === digestJson(c.observed)), 'HOSTED_CHECK_FAILED');
  const concurrency = JSON.parse(raw.concurrency);
  equal(concurrency.cases?.map(c => c.name).sort(), ['actorRosterChange', 'budgetConcurrentChange', 'wrongOwnerLease'].sort(), 'CONCURRENCY_INCOMPLETE');
  ensure(concurrency.cases.every(c => Array.isArray(c.connections) && new Set(c.connections).size >= 2
    && (c.name === 'wrongOwnerLease' ? c.contenderSqlstate === 'P0001'
      : c.name === 'actorRosterChange' ? c.contenderSqlstate === '42501'
        : c.contenderSqlstate === null && c.contenderSuccess === false && c.contenderErrorCode === 'domain_state_changed')
    && c.unintendedWrites === 0 && SHA.test(c.transcriptSha256)), 'CONCURRENCY_FAILED');
  const fence = JSON.parse(raw.fence);
  ensure(fence.host === 'hanbang.ai' && COMMIT.test(fence.deploymentCommit) && fence.verifiedAt === reports.fence.verifiedAt
    && fence.webWriteStatus === 503 && fence.webWriteCode === 'production_write_fence_enabled'
    && fence.publicFenceSourceSha256 === release.contract.implementation.writeFenceCheck.sha256
    && fence.publicFenceVerified === true && fence.existingRequestsDrained === true
    && fence.newTableFenceVerified === true && fence.activePublicWriters === 0 && fence.activeCronJobs === 0, 'WRITER_FENCE_UNPROVEN');
  const dry = JSON.parse(raw.dryRun);
  ensure(dry.cliVersion === release.contract.cli.version && dry.cliBinarySha256 === release.contract.cli.binarySha256
    && dry.cliCompanionSha256 === release.contract.cli.companionSha256 && dry.exitCode === 0 && dry.remoteWritesPerformed === false
    && typeof dry.stdout === 'string' && /\bDRY\s+RUN\b/i.test(dry.stdout), 'DRY_RUN_INVALID');
  const files = dry.stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)
    .map(line => line.trim().match(/^(?:[•?*+-]\s*)?(\d{14}_[a-z0-9][a-z0-9_.-]*\.sql)$/i)?.[1]).filter(Boolean);
  equal(files, release.migrations.map(m => m.file), 'DRY_RUN_PENDING_MISMATCH');
  ensure(Array.isArray(evidence.transitions) && evidence.transitions.length > 0, 'SCHEMA_TRANSITIONS_MISSING');
  const identities = new Set();
  for (const row of evidence.transitions) {
    const identity = `${row.kind}:${row.identity}`;
    ensure(!identities.has(identity) && SHA.test(row.afterSha256) && (row.beforeSha256 === null || SHA.test(row.beforeSha256)), 'SCHEMA_TRANSITION_INVALID'); identities.add(identity);
    ensure(release.contract.allowedSchemaChanges.some(rule => rule === identity || (rule.endsWith('(*)') && identity.startsWith(rule.slice(0, -2)))), 'SCHEMA_CHANGE_OUT_OF_SCOPE');
    ensure((before.objects.find(o => o.kind === row.kind && o.identity === row.identity)?.sha256 ?? null) === row.beforeSha256, 'SCHEMA_TRANSITION_BEFORE_MISMATCH');
  }
  equal(hosted.transitions, evidence.transitions, 'SCHEMA_TRANSITION_EVIDENCE_MISMATCH');
  return { evidence, reports, raw, evidenceSha256: digestJson(evidence), deadlineMs: Math.min(instant(evidence.expiresAt),
    ...['backup', 'fence', 'dryRun'].map(kind => instant(reports[kind].verifiedAt) + 30 * 60_000),
    ...['rollback', 'hosted', 'concurrency'].map(kind => instant(reports[kind].verifiedAt) + 24 * 3600_000)) };
}

export async function verifyHotfixSourceLineage({ repoRoot, state, release, runCommand }) {
  const sources = [...new Set(['rollback', 'hosted', 'concurrency'].map(kind => state.reports[kind].sourceReleaseCommit
    ?? state.evidence.releaseCommit))].filter(commit => commit !== state.evidence.releaseCommit);
  if (sources.length === 0) return;
  ensure(typeof runCommand === 'function', 'SOURCE_LINEAGE_EXECUTOR_REQUIRED');
  const toolchain = await resolvePinnedWindowsProductionToolchain();
  for (const commit of sources) {
    ensure(COMMIT.test(commit), 'SOURCE_LINEAGE_INVALID');
    for (const migration of release.migrations) {
      // 실제 최초 실행 commit의 blob을 읽는다. 원문 영수증의 commit을 최종 후보로 바꾸지 않는다.
      const result = await runCommand(toolchain.git, ['--no-replace-objects', 'cat-file', 'blob', `${commit}:supabase/migrations/${migration.file}`],
        { cwd: repoRoot, timeoutMs: 10000 });
      ensure(result?.status === 0 && !result.signal && !result.timedOut && !result.outputTruncated
        && typeof result.stdout === 'string' && digest(result.stdout) === migration.sha256, 'SOURCE_LINEAGE_MIGRATION_CHANGED');
    }
  }
}

function publicTables(observation) {
  return observation.relations.filter(r => r.schema === 'public' && ['r', 'p'].includes(r.kind) && r.name !== 'production_release_lease_20260717');
}
export function renderPublicDataQuery(observation) {
  const tables = publicTables(observation); ensure(tables.length > 0 && tables.length <= 500, 'DATA_SCOPE_INVALID');
  const queries = tables.map(r => `SELECT ${literal(`${r.schema}.${r.name}`)} AS relation,count(*) AS rows,
    encode(sha256(convert_to(coalesce(string_agg(row_hash,'' ORDER BY row_hash),''),'UTF8')),'hex') AS "rowsSha256"
    FROM (SELECT encode(sha256(convert_to((to_jsonb(t)${r.name === 'community_posts' ? "-'hot_rank'" : ''})::text,'UTF8')),'hex') AS row_hash
      FROM ${identifier(r.schema)}.${identifier(r.name)} t) hashes`);
  return `SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY relation),'[]'::jsonb) AS data FROM (${queries.join('\nUNION ALL\n')}) s`;
}
function expectedObjects(evidence) {
  const values = evidence.before.objects.map(o => ({ ...o }));
  for (const change of evidence.transitions) {
    const row = values.find(o => o.kind === change.kind && o.identity === change.identity);
    if (row) row.sha256 = change.afterSha256; else values.push({ kind: change.kind, identity: change.identity, sha256: change.afterSha256 });
  }
  return values.sort((a, b) => a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0);
}
function leasePredicate(binding) {
  ensure(UUID.test(binding.ownerId) && SHA.test(binding.outcomePathSha256) && COMMIT.test(binding.releaseCommit), 'OWNER_BINDING_INVALID');
  return `singleton=true AND release_id=${literal(binding.release)} AND release_commit=${literal(binding.releaseCommit)}
    AND owner_id=${literal(binding.ownerId)}::uuid AND outcome_path_sha256=${literal(binding.outcomePathSha256)}`;
}
function identityCheck(release) {
  return `IF (SELECT system_identifier::text FROM pg_control_system())<>${literal(release.hotfix.systemIdentifier)}
    OR current_user<>'postgres' OR session_user<>'postgres'
    OR NULLIF(current_setting('request.jwt.claims',true),'') IS NOT NULL
    OR NULLIF(current_setting('request.jwt.claim.role',true),'') IS NOT NULL OR NULLIF(auth.role(),'') IS NOT NULL
    THEN RAISE EXCEPTION 'HOTFIX_DATABASE_IDENTITY'; END IF;`;
}
function ttlCheck() {
  return `IF jsonb_array_length(observed->'cliRoleExpirations')<>2 THEN RAISE EXCEPTION 'HOTFIX_CLI_TTL'; END IF;
    FOR cli IN SELECT value FROM jsonb_array_elements(observed->'cliRoleExpirations') LOOP
      IF cli->>'name' NOT IN ('cli_login_postgres','cli_login_supabase_read_only_user') OR cli->>'validUntil' IS NULL
        OR cli->>'validUntil' IN ('infinity','-infinity') OR (cli->>'validUntil')::timestamptz>clock_timestamp()+interval '310 seconds'
      THEN RAISE EXCEPTION 'HOTFIX_CLI_TTL'; END IF;
    END LOOP;`;
}
function guardBlock({ release, evidence, deadlineMs, phase }) {
  const expected = phase === 'before' ? evidence.before.objects : expectedObjects(evidence);
  const relations = phase === 'before' ? evidence.before.relations : [...evidence.before.relations,
    { schema: 'public', name: 'amora_mediation_responses', kind: 'r' }, { schema: 'public', name: 'amora_personal_actions', kind: 'r' }]
    .sort((a, b) => `${a.schema}.${a.name}` < `${b.schema}.${b.name}` ? -1 : 1);
  return `SET LOCAL search_path=pg_catalog,public;
DO $hotfix_${phase}$ DECLARE observed jsonb; actual_data jsonb; cli jsonb; BEGIN
    ${identityCheck(release)}
    IF clock_timestamp()>=to_timestamp(${deadlineMs}/1000.0) THEN RAISE EXCEPTION 'HOTFIX_EVIDENCE_EXPIRED'; END IF;
    SELECT observation INTO observed FROM (${release.inventorySelect}) captured;
    ${ttlCheck()}
    IF observed->'objects' IS DISTINCT FROM ${json(expected)} OR observed->'relations' IS DISTINCT FROM ${json(relations)}
      OR observed->'storagePolicies' IS DISTINCT FROM ${json(evidence.before.storagePolicies)}
      OR observed->>'storageStructureSha256' IS DISTINCT FROM ${literal(evidence.before.storageStructureSha256)}
      OR observed->'vaultRows' IS DISTINCT FROM ${json(evidence.before.vaultRows)} OR observed->'cronJobs' IS DISTINCT FROM ${json(evidence.before.cronJobs)}
      THEN RAISE EXCEPTION 'HOTFIX_${phase.toUpperCase()}_SCHEMA_DRIFT'; END IF;
    SELECT data INTO actual_data FROM (${renderPublicDataQuery(evidence.before)}) captured;
    IF actual_data IS DISTINCT FROM ${json(evidence.beforeData)} THEN RAISE EXCEPTION 'HOTFIX_EXISTING_ROWS_CHANGED'; END IF;
    ${phase === 'before' ? `IF observed->'ledger' IS DISTINCT FROM ${json(evidence.before.ledger)} THEN RAISE EXCEPTION 'HOTFIX_LEDGER_DRIFT'; END IF;`
      : `IF (SELECT jsonb_agg(value ORDER BY value->>'version') FROM jsonb_array_elements(observed->'ledger') WHERE value->>'version'<${literal(release.migrations[0].version)}) IS DISTINCT FROM ${json(evidence.before.ledger)} THEN RAISE EXCEPTION 'HOTFIX_ORIGINAL_LEDGER_CHANGED'; END IF;`}
  END $hotfix_${phase}$;`;
}

export function renderHotfixAtomicSql({ release, evidence, binding, deadlineMs }) {
  const predicate = leasePredicate(binding);
  ensure(binding.release === release.hotfix.release && binding.releaseCommit === evidence.releaseCommit
    && Number.isSafeInteger(deadlineMs), 'ATOMIC_BINDING_INVALID');
  const bodies = release.migrations.map(m => {
    ensure(digest(m.sql) === m.sha256, 'MIGRATION_SOURCE_CHANGED');
    const original = m.sql.toString('utf8'); const body = transactionBody(original);
    return { ...m, original, body, bodySha256: digest(body) };
  });
  const expectedLedger = bodies.map(m => `SELECT ${literal(m.version)}::text AS version,${literal(m.file.slice(15, -4))}::text AS name,
    ARRAY[${literal(m.original)}]::text[] AS statements`).join('\nUNION ALL\n');
  const sql = `BEGIN;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; SET LOCAL idle_in_transaction_session_timeout='90s';
SELECT pg_advisory_xact_lock(7523370826071712::bigint);
DO $hotfix_owner$ BEGIN ${identityCheck(release)}
  PERFORM 1 FROM ${LEASE} WHERE ${predicate} AND phase='claimed' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOTFIX_OWNER_OR_PHASE_CHANGED'; END IF;
END $hotfix_owner$;
LOCK TABLE ${publicTables(evidence.before).map(t => `${identifier(t.schema)}.${identifier(t.name)}`).join(',')} IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
${release.fenceBody}
${guardBlock({ release, evidence, deadlineMs, phase: 'before' })}
${bodies.map(m => `-- reviewed source ${m.file} sha256 ${m.sha256}; executed body sha256 ${m.bodySha256}
${m.body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES(${literal(m.version)},${literal(m.file.slice(15, -4))},ARRAY[${literal(m.original)}]::text[]);`).join('\n')}
${release.fenceBody}
${guardBlock({ release, evidence, deadlineMs, phase: 'after' })}
DO $hotfix_post$ BEGIN
  IF EXISTS(SELECT 1 FROM (${expectedLedger}) e FULL JOIN
    (SELECT version,name,statements FROM supabase_migrations.schema_migrations WHERE version IN (${bodies.map(m => literal(m.version)).join(',')})) a USING(version)
    WHERE e.version IS NULL OR a.version IS NULL OR a.name IS DISTINCT FROM e.name OR a.statements IS DISTINCT FROM e.statements)
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${evidence.before.ledger.length + bodies.length}
    THEN RAISE EXCEPTION 'HOTFIX_POST_LEDGER_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM public.community_posts WHERE hot_rank IS DISTINCT FROM (2::numeric*coalesce(upvote_count,0)+3::numeric*coalesce(comment_count,0)+coalesce(extract(epoch FROM(created_at AT TIME ZONE 'UTC')),0)/7200))
    OR EXISTS(SELECT 1 FROM public.amora_personal_actions)
    OR EXISTS(SELECT 1 FROM public.amora_mediation_acceptances a FULL JOIN public.amora_mediation_responses r ON a.message_id=r.message_id AND a.user_id=r.user_id
      WHERE a.message_id IS NULL OR r.message_id IS NULL OR r.couple_id IS DISTINCT FROM a.couple_id OR r.proposal_version IS DISTINCT FROM a.proposal_version
      OR r.roster_fingerprint IS DISTINCT FROM a.proposal_roster_fingerprint OR r.choice IS DISTINCT FROM 'ok')
    THEN RAISE EXCEPTION 'HOTFIX_BACKFILL_MISMATCH'; END IF;
  IF clock_timestamp()>=to_timestamp(${deadlineMs}/1000.0) THEN RAISE EXCEPTION 'HOTFIX_EVIDENCE_EXPIRED'; END IF;
  UPDATE ${LEASE} SET phase='deployment-canary',updated_at=clock_timestamp() WHERE ${predicate} AND phase='claimed';
  IF NOT FOUND THEN RAISE EXCEPTION 'HOTFIX_OWNER_OR_PHASE_CHANGED'; END IF;
END $hotfix_post$;
COMMIT;
SELECT 1::integer AS hotfix_committed_count,${literal(binding.ownerId)}::text AS owner_id,${literal(binding.releaseCommit)}::text AS release_commit;`;
  ensure(Buffer.byteLength(sql) <= MAX_SQL_BYTES, 'ATOMIC_BUNDLE_TOO_LARGE');
  return sql;
}

export function validateHotfixReadOnlyQuery(sql) {
  const envelope = /^\s*BEGIN(?:\s+TRANSACTION)?\s+READ\s+ONLY\s*;([\s\S]*)COMMIT\s*;\s*$/i.exec(sql);
  ensure(envelope, 'MANAGEMENT_READ_ONLY_ENVELOPE_REQUIRED');
  let body;
  try { body = transactionBody(`BEGIN TRANSACTION READ ONLY;${envelope[1]}COMMIT;`); }
  catch { throw new HotfixBlocked('MANAGEMENT_READ_ONLY_ENVELOPE_REQUIRED'); }
  // API의 read_only는 연결 역할 선택이다. SQL 자체의 READ ONLY와 첫 snapshot으로 중간 READ WRITE 전환도 막는다.
  return `BEGIN TRANSACTION READ ONLY;\nSELECT 1 FROM pg_catalog.pg_class LIMIT 0;\n${body}\nCOMMIT;`;
}

export function createManagementHotfixTransport({ accessToken, projectRef, fetchImpl = globalThis.fetch, timeoutMs = 120000 }) {
  ensure(typeof accessToken === 'string' && accessToken.length >= 20 && !/[\r\n]/.test(accessToken), 'MANAGEMENT_CREDENTIAL_REQUIRED');
  ensure(projectRef === 'slrtobkksjmxgzatjyqb', 'MANAGEMENT_PROJECT_MISMATCH');
  return { async query(sql, { readOnly = true } = {}) {
    ensure(typeof sql === 'string' && Buffer.byteLength(sql) <= MAX_SQL_BYTES, 'MANAGEMENT_QUERY_INVALID');
    const query = readOnly ? validateHotfixReadOnlyQuery(sql) : sql;
    let response;
    try {
      response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, read_only: false }), signal: AbortSignal.timeout(timeoutMs),
      });
      ensure(response.ok, 'MANAGEMENT_QUERY_UNCONFIRMED');
      const text = await response.text(); ensure(Buffer.byteLength(text) <= 4 * 1024 * 1024, 'MANAGEMENT_RESPONSE_TOO_LARGE');
      const rows = JSON.parse(text); ensure(Array.isArray(rows), 'MANAGEMENT_RECEIPT_INVALID'); return rows;
    } catch (error) { throw new HotfixBlocked(error instanceof HotfixBlocked ? error.code : 'MANAGEMENT_QUERY_UNCONFIRMED'); }
  } };
}

export function classifyHotfixObservation({ rows, release, binding }) {
  // 0개는 아직 실행 중인 transaction의 MVCC 결과일 수 있다. 자동 retry/unfence하지 않는다.
  if (!Array.isArray(rows) || rows.length !== 1) return 'ambiguous';
  const row = rows[0];
  return row.system_identifier === release.hotfix.systemIdentifier && row.owner_count === 1 && row.exact_migration_count === 8
    && row.ledger_count === release.hotfix.requiredLedgerCount + 8 && row.owner_id === binding.ownerId
    && row.release_commit === binding.releaseCommit && row.phase === 'deployment-canary' ? 'committed-lease-held' : 'ambiguous';
}
export function renderHotfixAdjudicationSql({ release, binding }) {
  const expected = release.migrations.map(m => `SELECT ${literal(m.version)}::text AS version,${literal(m.file.slice(15, -4))}::text AS name,ARRAY[${literal(m.sql.toString('utf8'))}]::text[] AS statements`).join(' UNION ALL ');
  return `BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public;
    SELECT (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
    (SELECT count(*)::integer FROM supabase_migrations.schema_migrations) AS ledger_count,
    (SELECT count(*)::integer FROM (${expected}) e JOIN supabase_migrations.schema_migrations a USING(version) WHERE e.name=a.name AND e.statements=a.statements) AS exact_migration_count,
    count(*)::integer AS owner_count,max(owner_id::text) AS owner_id,max(release_commit) AS release_commit,max(phase) AS phase
    FROM ${LEASE} WHERE ${leasePredicate(binding)}; COMMIT;`;
}

async function privateParent(repoRoot, file) {
  const parent = dirname(file); const stat = await lstat(parent); ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'OUTPUT_PARENT_INVALID');
  const actual = await realpath(parent); const delta = relative(await realpath(repoRoot), actual);
  ensure(delta && (delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)) && resolve(parent).toLowerCase() === actual.toLowerCase(), 'OUTPUT_NOT_PRIVATE');
}
async function exclusive(path, value) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
}
async function readEvidenceFiles(repoRoot, root, release, expectedCommit, now) {
  await privateParent(repoRoot, join(root, 'amora-hotfix-evidence.json'));
  const evidence = JSON.parse(readAnchored(root, 'amora-hotfix-evidence.json'));
  const reports = {}, raw = {};
  for (const kind of release.hotfix.requiredEvidence) {
    reports[kind] = JSON.parse(pinnedArtifact(root, evidence.reports?.[kind]));
    raw[kind] = pinnedArtifact(root, reports[kind].rawEvidence).toString('utf8');
    ensure(reports[kind].rawEvidence.sha256 === reports[kind].rawEvidenceSha256, 'RAW_EVIDENCE_MISMATCH');
  }
  raw.rollbackOriginal = pinnedArtifact(root, evidence.rollbackOriginal).toString('utf8');
  return validateHotfixEvidence({ evidence, reports, raw, release, expectedCommit, now });
}

// 원본은 기존 HBAM2 구현으로 메모리 복호화하고 폐기한다. 키/원문/PowerShell 오류를 출력하지 않는다.
export async function verifyHotfixRecovery({ repoRoot, evidenceRoot, state }) {
  const toolchain = await resolvePinnedWindowsProductionToolchain();
  const release = loadCurrentBaselineContract(repoRoot);
  pinnedArtifact(repoRoot, release.contract.implementation.crypto);
  const program = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
try { $v=[Console]::In.ReadToEnd()|ConvertFrom-Json; . $v.crypto;
  Assert-HBAM2PrivateDirectoryAcl -Path $v.root;
  $d=[IO.Path]::GetFullPath((Join-Path $v.root $v.directory)); Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $d -Anchor $v.root;
  Assert-HBAM2PrivateDirectoryAcl -Path $d; $b=$null; $archive=$null;
  try { $b=Unprotect-HBAM2Artifact -Directory $d -Metadata $v.metadata -ArtifactName 'logical-data.json' -ProjectRef $v.project -BackupSetId $v.backupSet;
    $payload=[Text.Encoding]::UTF8.GetString($b)|ConvertFrom-Json;
    if($payload.kind -cne 'postgres-custom-logical-snapshot-v1' -or $payload.projectRef -cne $v.project -or $payload.releaseCommit -cne $v.commit -or $payload.backupSetId -cne $v.backupSet -or $payload.systemIdentifier -cne $v.systemIdentifier){throw 'BINDING'}
    $archive=[Convert]::FromBase64String($payload.archiveBase64);
    if($archive.Length -ne $v.archiveBytes -or $payload.archiveBytes -ne $v.archiveBytes -or $payload.archiveSha256 -cne $v.archiveSha256 -or (Get-HBAM2Sha256Hex -Bytes $archive) -ine $v.archiveSha256 -or [Text.Encoding]::ASCII.GetString($archive,0,5) -cne 'PGDMP'){throw 'DIGEST'}
  } finally {if($null -ne $b){[Array]::Clear($b,0,$b.Length)}; if($null -ne $archive){[Array]::Clear($archive,0,$archive.Length)}; $payload=$null}
  [Console]::Out.Write('VERIFIED')
} catch { [Console]::Out.Write('UNCONFIRMED'); exit 1 }`;
  const backup = JSON.parse(state.raw.backup);
  const request = { crypto: resolve(repoRoot, release.contract.implementation.crypto.file), root: evidenceRoot,
    directory: state.reports.backup.snapshotDirectory, metadata: backup.encryption, project: release.contract.projectRef,
    backupSet: backup.backupSetId, commit: state.evidence.releaseCommit, systemIdentifier: release.contract.systemIdentifier,
    archiveBytes: backup.archiveBytes, archiveSha256: backup.archiveSha256 };
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/SUPABASE|DATABASE_URL|PGPASSWORD|OPENAI|^PSModulePath$/i.test(key)) delete env[key];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(toolchain.powershell, ['-NoProfile', '-NonInteractive', '-Command', program], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env });
    let output = ''; const timer = setTimeout(() => { child.kill(); reject(new HotfixBlocked('RECOVERY_VERIFY_UNCONFIRMED')); }, 120000);
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 64) child.kill(); }); child.stderr.on('data', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new HotfixBlocked('RECOVERY_VERIFY_UNCONFIRMED')); });
    child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); code === 0 && output === 'VERIFIED' ? resolvePromise(true) : reject(new HotfixBlocked('RECOVERY_VERIFY_UNCONFIRMED')); });
    child.stdin.end(JSON.stringify(request));
  });
}

export async function runAmoraRuntimeHotfix({ repoRoot, argv, transport, primitives, now = () => new Date(), verifyRecovery = verifyHotfixRecovery }) {
  const options = parseHotfixArgs(argv); const release = loadHotfixRelease(repoRoot);
  ensure(typeof transport?.query === 'function' && typeof primitives?.assertReleaseGitFence === 'function', 'RUNTIME_DEPENDENCY_REQUIRED');
  const expectedCommit = options['expected-commit'];
  ensure(options['confirm-production'] === `${options.apply ? 'APPLY' : 'CHECK'}:${release.hotfix.projectRef}:${release.hotfix.release}:${expectedCommit}`, 'PRODUCTION_CONFIRMATION_MISMATCH');
  const sourceFence = () => primitives.assertReleaseGitFence({ repoRoot, expectedCommit, expectedOrigin: release.contract.expectedOrigin, remoteRef: options['remote-ref'], runCommand: primitives.runCommand });
  await sourceFence();
  await privateParent(repoRoot, options['receipt-out']); await privateParent(repoRoot, options['bundle-out']);
  const state = await readEvidenceFiles(repoRoot, options['evidence-root'], release, expectedCommit, now());
  await verifyHotfixSourceLineage({ repoRoot, state, release, runCommand: primitives.runCommand });
  await verifyRecovery({ repoRoot, evidenceRoot: options['evidence-root'], state });
  const binding = { release: release.hotfix.release, releaseCommit: expectedCommit, ownerId: randomUUID(), outcomePathSha256: digest(resolve(options['receipt-out'])) };
  const sql = renderHotfixAtomicSql({ release, ...state, binding });
  const base = { format: 'amora-runtime-hotfix-outcome-v1', ...binding, projectRef: release.hotfix.projectRef,
    systemIdentifier: release.hotfix.systemIdentifier, hotfixContractSha256: release.hotfixSha256,
    migrationSetSha256: release.migrationSetSha256, evidenceSha256: state.evidenceSha256, bundleSha256: digest(sql),
    scope: release.hotfix.scope, ...EXCLUSIONS, fenceMustRemainHeld: true, rerunProhibited: true };
  await exclusive(options['bundle-out'], sql);
  await exclusive(options['receipt-out'], JSON.stringify({ ...base, status: 'prepared', remoteWritesPerformed: false }));
  const stable = async () => {
    await sourceFence(); ensure(loadHotfixRelease(repoRoot).hotfixSha256 === release.hotfixSha256, 'HOTFIX_CONTRACT_CHANGED');
    ensure((await readEvidenceFiles(repoRoot, options['evidence-root'], release, expectedCommit, now())).evidenceSha256 === state.evidenceSha256, 'HOTFIX_EVIDENCE_CHANGED');
    ensure(digest(await readFile(options['bundle-out'])) === base.bundleSha256, 'ATOMIC_BUNDLE_CHANGED');
  };
  const report = async value => {
    const receipt = { ...base, ...value, verifiedAt: now().toISOString() };
    await exclusive(`${options['receipt-out']}.${value.status}.json`, JSON.stringify(receipt));
    await replaceReceipt(options['receipt-out'], receipt); return receipt;
  };
  // check-only는 실제 SQL을 실행하는 dry-run이 아니다. 읽기 precondition과 원문 번들만 검증한다.
  const preflight = `BEGIN READ ONLY; SET LOCAL search_path=pg_catalog,public; ${release.fenceBody}\n${guardBlock({ release, ...state, phase: 'before' })}\nSELECT 1::integer AS hotfix_preflight_count; COMMIT;`;
  const pre = await transport.query(preflight, { readOnly: true });
  ensure(pre.some(row => row.hotfix_preflight_count === 1), 'PREFLIGHT_UNCONFIRMED');
  await stable();
  if (!options.apply) return report({ status: 'hotfix-preflight-verified', remoteWritesPerformed: false });
  let phase = 'claiming';
  try {
    const claimed = await transport.query(`BEGIN; DO $identity$ BEGIN ${identityCheck(release)} END $identity$;
      WITH claimed AS (INSERT INTO ${LEASE}(singleton,release_id,release_commit,owner_id,outcome_path_sha256,phase)
        VALUES(true,${literal(binding.release)},${literal(expectedCommit)},${literal(binding.ownerId)}::uuid,${literal(binding.outcomePathSha256)},'claimed')
        ON CONFLICT(singleton) DO NOTHING RETURNING 1) SELECT count(*)::integer AS claim_count FROM claimed; COMMIT;`, { readOnly: false });
    ensure(claimed.length === 1 && claimed[0].claim_count === 1, 'LEASE_CLAIM_UNCONFIRMED');
    await stable();
    phase = 'apply-requested'; await report({ status: phase, remoteWritesPerformed: true });
    await transport.query(sql, { readOnly: false });
    await stable();
    const observed = await transport.query(renderHotfixAdjudicationSql({ release, binding }), { readOnly: true });
    ensure(classifyHotfixObservation({ rows: observed, release, binding }) === 'committed-lease-held', 'APPLY_OUTCOME_AMBIGUOUS');
    return report({ status: 'database-expand-verified-lease-held', remoteWritesPerformed: true, remoteReleaseLeasePhase: 'deployment-canary' });
  } catch (error) {
    // 통신 응답 유실은 DB rollback 증거가 아니다. 같은 요청을 재전송하거나 잠금을 자동 해제하지 않는다.
    await report({ status: 'release-requires-adjudication', phase, remoteWritesPerformed: true, errorCode: safeCode(error) });
    throw new HotfixBlocked(safeCode(error));
  }
}

async function replaceReceipt(path, receipt) {
  const stat = await lstat(path); ensure(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'RECEIPT_PATH_CHANGED');
  const prior = JSON.parse(await readFile(path, 'utf8'));
  ensure(prior.ownerId === receipt.ownerId && prior.releaseCommit === receipt.releaseCommit, 'RECEIPT_OWNER_CHANGED');
  const temporary = `${path}.${randomUUID()}.partial`;
  await exclusive(temporary, JSON.stringify(receipt)); await rename(temporary, path);
}

export function validateHotfixCanary({ canary, deploymentRaw, httpRaw, outcome, release, now = new Date() }) {
  ensure(canary?.format === 'amora-runtime-hotfix-canary-v1' && canary.releaseCommit === outcome.releaseCommit
    && canary.ownerId === outcome.ownerId && canary.outcomeSha256 === digestJson(outcome)
    && canary.migrationSetSha256 === release.migrationSetSha256, 'CANARY_BINDING_INVALID');
  ensure(digest(deploymentRaw) === canary.deploymentRaw?.sha256 && digest(httpRaw) === canary.httpRaw?.sha256, 'CANARY_RAW_MISMATCH');
  // Vercel v13의 실제 team.id/ownerId를 함께 검사한다. 원문 파일에는 가상의 teamId를 넣지 않는다.
  const provider = JSON.parse(deploymentRaw);
  const teamId = 'team_XwMZqiJ4wXM2Ypvs99icXaQx';
  ensure(provider.team?.id === teamId && provider.ownerId === teamId
    && (provider.teamId === undefined || provider.teamId === teamId), 'CANARY_PROVIDER_OWNER_INVALID');
  const projection = JSON.stringify({ ...provider, teamId });
  const deployed = validateVercelDeploymentRawEvidence(projection, { teamId,
    projectId: 'prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes', deploymentId: canary.deploymentId,
    releaseCommit: outcome.releaseCommit, productionHost: 'hanbang.ai' });
  const http = JSON.parse(httpRaw);
  ensure(http.format === 'amora-hotfix-http-observations-v1' && http.releaseCommit === outcome.releaseCommit
    && http.deploymentId === canary.deploymentId && http.productionHost === 'hanbang.ai', 'CANARY_HTTP_BINDING_INVALID');
  const start = instant(http.startedAt), end = instant(http.finishedAt);
  ensure(start >= instant(outcome.verifiedAt) && start >= instant(deployed.readyAt)
    && end - start >= 300_000 && end - start <= 3_600_000, 'CANARY_WINDOW_INVALID');
  fresh(http.finishedAt, now.getTime(), 15 * 60_000);
  ensure(Array.isArray(http.observations) && http.observations.length === 5, 'CANARY_CHECKS_INCOMPLETE');
  const find = (path, method, status) => {
    const hits = http.observations.filter(o => o.path === path && o.method === method);
    ensure(hits.length === 1 && hits[0].host === 'hanbang.ai' && hits[0].status === status
      && instant(hits[0].observedAt) >= start && instant(hits[0].observedAt) <= end, 'CANARY_CHECK_FAILED'); return hits[0];
  };
  const health = find('/api/health', 'GET', 200);
  ensure(health.body?.ok === true && health.body.database === 'up' && health.body.commit === outcome.releaseCommit.slice(0, 12), 'CANARY_COMMIT_MISMATCH');
  const landing = find('/landing', 'GET', 200); ensure(SHA.test(landing.bodySha256) && landing.renderedLanding === true, 'CANARY_RENDER_FAILED');
  const community = find('/api/community/posts?sort=hot&page=1', 'GET', 200);
  ensure(SHA.test(community.bodySha256) && community.postsArrayVerified === true, 'CANARY_COMMUNITY_FAILED');
  const authenticated = find('/api/amora/notes', 'GET', 200);
  ensure(SHA.test(authenticated.bodySha256) && SHA.test(authenticated.syntheticActorSha256) && authenticated.authenticatedNotesArrayVerified === true, 'CANARY_AUTH_READ_FAILED');
  const fence = find('/api/release/write-fence-probe', 'POST', 503);
  ensure(fence.body?.error === 'production_write_fence_enabled' && fence.deploymentCommitHeader === outcome.releaseCommit, 'CANARY_FENCE_NOT_HELD');
  ensure(http.serverErrors?.deploymentId === canary.deploymentId && http.serverErrors.from === http.startedAt && http.serverErrors.to === http.finishedAt
    && http.serverErrors.count === 0 && SHA.test(http.serverErrors.rawEvidenceSha256), 'CANARY_SERVER_ERRORS_UNVERIFIED');
  return { canarySha256: digestJson(canary), providerSourceSha256: digest(deploymentRaw),
    providerAdapterSha256: digest(projection), deadlineMs: end + 15 * 60_000 };
}

export function renderHotfixFinalizeSql({ release, evidence, binding, deadlineMs, canarySha256 }) {
  ensure(SHA.test(canarySha256) && Number.isSafeInteger(deadlineMs) && deadlineMs > 0, 'CANARY_BINDING_INVALID');
  const predicate = leasePredicate(binding);
  const expectedLedger = release.migrations.map(m => `SELECT ${literal(m.version)}::text AS version,${literal(m.file.slice(15, -4))}::text AS name,ARRAY[${literal(m.sql.toString('utf8'))}]::text[] AS statements`).join(' UNION ALL ');
  return `BEGIN;
SET LOCAL search_path=pg_catalog,public;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(7523370826071712::bigint);
DO $owner$ BEGIN ${identityCheck(release)}
  PERFORM 1 FROM ${LEASE} WHERE ${predicate} AND phase='deployment-canary' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'HOTFIX_FINALIZER_OWNER_OR_PHASE'; END IF;
END $owner$;
LOCK TABLE ${publicTables(evidence.before).map(t => `${identifier(t.schema)}.${identifier(t.name)}`).join(',')},public.amora_personal_actions,public.amora_mediation_responses IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
${release.fenceBody}
${guardBlock({ release, evidence, deadlineMs, phase: 'after' })}
DO $ledger$ BEGIN
  IF (SELECT count(*) FROM (${expectedLedger}) e JOIN supabase_migrations.schema_migrations a USING(version) WHERE e.name=a.name AND e.statements=a.statements)<>8
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${evidence.before.ledger.length + 8}
  THEN RAISE EXCEPTION 'HOTFIX_FINALIZER_LEDGER'; END IF;
END $ledger$;
DROP EVENT TRIGGER evt_production_write_fence_ddl_lock_20260717;
DROP EVENT TRIGGER evt_production_write_fence_20260717;
DO $drop_known_fence$ DECLARE target record; BEGIN
  FOR target IN SELECT n.nspname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND t.tgname='trg_production_write_fence_20260717' AND NOT t.tgisinternal
      AND t.tgfoid='public.production_write_fence_guard_20260717()'::regprocedure ORDER BY c.oid
  LOOP EXECUTE format('DROP TRIGGER %I ON %I.%I','trg_production_write_fence_20260717',target.nspname,target.relname); END LOOP;
  DELETE FROM ${LEASE} WHERE ${predicate} AND phase='deployment-canary';
  IF NOT FOUND THEN RAISE EXCEPTION 'HOTFIX_FINALIZER_OWNER_OR_PHASE'; END IF;
  IF EXISTS(SELECT 1 FROM ${LEASE}) THEN RAISE EXCEPTION 'HOTFIX_FINALIZER_FOREIGN_LEASE'; END IF;
END $drop_known_fence$;
DROP TABLE ${LEASE};
DROP FUNCTION public.production_write_fence_attach_20260717();
DROP FUNCTION public.production_write_fence_guard_20260717();
DROP FUNCTION public.production_live_schema_contract_20260717();
DO $deadline$ BEGIN IF clock_timestamp()>=to_timestamp(${deadlineMs}/1000.0) THEN RAISE EXCEPTION 'HOTFIX_EVIDENCE_EXPIRED'; END IF; END $deadline$;
COMMIT;
SELECT 1::integer AS hotfix_finalized_count,${literal(binding.ownerId)}::text AS owner_id,${literal(binding.releaseCommit)}::text AS release_commit,${literal(canarySha256)}::text AS canary_sha256;`;
}

export async function runAmoraRuntimeHotfixFinalize({ repoRoot, evidenceRoot, outcomePath, canaryPath, receiptOut,
  expectedCommit, remoteRef, confirmProduction, transport, primitives, now = () => new Date(), verifyRecovery = verifyHotfixRecovery }) {
  ensure(COMMIT.test(expectedCommit) && [evidenceRoot, outcomePath, canaryPath, receiptOut].every(isAbsolute), 'FINALIZER_PATH_OR_COMMIT_INVALID');
  const release = loadHotfixRelease(repoRoot);
  for (const file of [outcomePath, canaryPath, receiptOut]) await privateParent(repoRoot, file);
  const sourceFence = () => primitives.assertReleaseGitFence({ repoRoot, expectedCommit, expectedOrigin: release.contract.expectedOrigin, remoteRef, runCommand: primitives.runCommand });
  await sourceFence();
  const state = await readEvidenceFiles(repoRoot, evidenceRoot, release, expectedCommit, now());
  await verifyHotfixSourceLineage({ repoRoot, state, release, runCommand: primitives.runCommand });
  const outcomeText = readAnchored(dirname(outcomePath), outcomePath.slice(dirname(outcomePath).length + 1)).toString('utf8');
  const outcome = JSON.parse(outcomeText);
  ensure(outcome.format === 'amora-runtime-hotfix-outcome-v1' && outcome.status === 'database-expand-verified-lease-held'
    && outcome.releaseCommit === expectedCommit && outcome.hotfixContractSha256 === release.hotfixSha256
    && outcome.migrationSetSha256 === release.migrationSetSha256 && outcome.evidenceSha256 === state.evidenceSha256
    && outcome.projectRef === release.hotfix.projectRef && outcome.systemIdentifier === release.hotfix.systemIdentifier
    && outcome.release === release.hotfix.release && outcome.outcomePathSha256 === digest(resolve(outcomePath)) && outcome.remoteReleaseLeasePhase === 'deployment-canary'
    && outcome.remoteWritesPerformed === true && outcome.fenceMustRemainHeld === true, 'FINALIZER_OUTCOME_INVALID');
  fresh(outcome.verifiedAt, now().getTime(), 30 * 60_000);
  equal(outcome.scope, release.hotfix.scope, 'FINALIZER_SCOPE_INVALID');
  const canary = JSON.parse(readAnchored(dirname(canaryPath), canaryPath.slice(dirname(canaryPath).length + 1)));
  const deploymentRaw = pinnedArtifact(dirname(canaryPath), canary.deploymentRaw).toString('utf8');
  const httpRaw = pinnedArtifact(dirname(canaryPath), canary.httpRaw).toString('utf8');
  const checked = validateHotfixCanary({ canary, deploymentRaw, httpRaw, outcome, release, now: now() });
  const http = JSON.parse(httpRaw);
  const errorsRaw = pinnedArtifact(dirname(canaryPath), http.serverErrors.rawEvidence).toString('utf8');
  const errors = JSON.parse(errorsRaw);
  ensure(digest(errorsRaw) === http.serverErrors.rawEvidenceSha256 && errors.deploymentId === canary.deploymentId
    && errors.from === http.startedAt && errors.to === http.finishedAt && Array.isArray(errors.errors) && errors.errors.length === 0,
  'CANARY_SERVER_ERRORS_UNVERIFIED');
  ensure(confirmProduction === `FINALIZE:${release.hotfix.projectRef}:${release.hotfix.release}:${expectedCommit}:${outcome.ownerId}:${checked.canarySha256}`, 'FINALIZER_CONFIRMATION_MISMATCH');
  await verifyRecovery({ repoRoot, evidenceRoot, state });
  const binding = { release: outcome.release, releaseCommit: outcome.releaseCommit, ownerId: outcome.ownerId, outcomePathSha256: outcome.outcomePathSha256 };
  const sql = renderHotfixFinalizeSql({ release, ...state, binding, deadlineMs: Math.min(state.deadlineMs, checked.deadlineMs), canarySha256: checked.canarySha256 });
  const base = { format: 'amora-runtime-hotfix-finalizer-v1', ...binding, ...EXCLUSIONS, canarySha256: checked.canarySha256,
    providerSourceSha256: checked.providerSourceSha256, providerAdapterSha256: checked.providerAdapterSha256,
    sourceOutcomeSha256: digest(outcomeText), finalizerSqlSha256: digest(sql), scope: release.hotfix.scope, rerunProhibited: true };
  await exclusive(receiptOut, JSON.stringify({ ...base, status: 'prepared', remoteWritesPerformed: false }));
  const stable = async () => {
    await sourceFence(); ensure(loadHotfixRelease(repoRoot).hotfixSha256 === release.hotfixSha256, 'HOTFIX_CONTRACT_CHANGED');
    ensure((await readEvidenceFiles(repoRoot, evidenceRoot, release, expectedCommit, now())).evidenceSha256 === state.evidenceSha256, 'HOTFIX_EVIDENCE_CHANGED');
    ensure(digest(await readFile(outcomePath)) === base.sourceOutcomeSha256, 'FINALIZER_OUTCOME_CHANGED');
    equal(JSON.parse(await readFile(canaryPath, 'utf8')), canary, 'FINALIZER_CANARY_CHANGED');
    pinnedArtifact(dirname(canaryPath), canary.deploymentRaw); pinnedArtifact(dirname(canaryPath), canary.httpRaw);
    pinnedArtifact(dirname(canaryPath), http.serverErrors.rawEvidence);
  };
  try {
    await stable();
    const rows = await transport.query(sql, { readOnly: false });
    ensure(rows.length === 1 && rows[0].hotfix_finalized_count === 1 && rows[0].owner_id === outcome.ownerId
      && rows[0].release_commit === expectedCommit && rows[0].canary_sha256 === checked.canarySha256, 'FINALIZER_OUTCOME_AMBIGUOUS');
    const receipt = { ...base, status: 'scoped-database-fence-finalized', remoteWritesPerformed: true, externalWebFenceReleaseRequired: true, verifiedAt: now().toISOString() };
    await replaceReceipt(receiptOut, receipt); return receipt;
  } catch (error) {
    await replaceReceipt(receiptOut, { ...base, status: 'finalizer-requires-adjudication', remoteWritesPerformed: true, errorCode: safeCode(error) });
    throw new HotfixBlocked(safeCode(error));
  }
}
