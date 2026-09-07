import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export const CURRENT_BASELINE_CONTRACT = "supabase/release-contracts/current-baseline-rollout-v1.json";
export const EVIDENCE_KINDS = Object.freeze(["backup", "hostedRestore", "hostedStaging", "storage", "finalizer"]);
const SHA = /^[a-f0-9]{64}$/;
const FILE = /^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/;
const REF = /^[a-z0-9]{20}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CLI_ROLE_NAMES = Object.freeze(["cli_login_postgres", "cli_login_supabase_read_only_user"]);
const CLI_ROLE_MAX_FUTURE_MS = 310_000; // 관측된 공식 TTL 300초 + DB 관측 시각 여유 10초.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class CurrentBaselineBlocked extends Error {
  constructor(code) { super(code); this.name = "CurrentBaselineBlocked"; this.code = code; }
}
export function requireRelease(condition, code) { if (!condition) throw new CurrentBaselineBlocked(code); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash("sha256").update(value).digest("hex");
export const digestJson = value => digest(canonical(value));
export function same(actual, expected, code) { requireRelease(canonical(actual) === canonical(expected), code); }

// 경로 전체의 symlink/junction과 저장소 탈출을 거절한다. 파일을 읽은 뒤에도 같은 파일인지 확인한다.
export function readAnchored(root, file, maximumBytes = 4 * 1024 * 1024) {
  requireRelease(typeof file === "string" && !isAbsolute(file) && !file.includes("\\") && !file.split("/").some(x => !x || x === "." || x === ".."), "ARTIFACT_PATH_INVALID");
  const anchor = realpathSync(root);
  let path = anchor;
  for (const part of file.split("/")) {
    path = join(path, part);
    requireRelease(!lstatSync(path).isSymbolicLink(), "ARTIFACT_LINK_FORBIDDEN");
  }
  const delta = relative(anchor, realpathSync(path));
  requireRelease(delta && !isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`), "ARTIFACT_PATH_INVALID");
  const before = lstatSync(path);
  requireRelease(before.isFile() && before.size > 0 && before.size <= maximumBytes, "ARTIFACT_SIZE_INVALID");
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  requireRelease(before.ino === after.ino && before.dev === after.dev && before.size === after.size && before.mtimeMs === after.mtimeMs && bytes.length === before.size, "ARTIFACT_CHANGED_WHILE_READING");
  return bytes;
}
export function pinnedArtifact(root, pin, maximumBytes) {
  requireRelease(pin && SHA.test(pin.sha256), "ARTIFACT_PIN_MISSING");
  const bytes = readAnchored(root, pin.file, maximumBytes);
  requireRelease(digest(bytes) === pin.sha256, "ARTIFACT_HASH_MISMATCH");
  return bytes;
}
function uniqueOrdered(values, key, code) {
  requireRelease(Array.isArray(values) && values.length > 0, code);
  const names = values.map(key);
  requireRelease(names.every((name, i) => typeof name === "string" && name.length > 0 && (i === 0 || names[i - 1] < name)), code);
}
export function validateObservation(observation, contract) {
  requireRelease(observation?.format === "current-baseline-observation-v1" && observation.readOnly === true && observation.systemIdentifier === contract.systemIdentifier && /^17\./.test(observation.serverVersion), "BASELINE_IDENTITY_MISMATCH");
  requireRelease(Number.isFinite(Date.parse(observation.observedAt)), "BASELINE_TIME_INVALID");
  const expirations = observation.cliRoleExpirations;
  requireRelease(Array.isArray(expirations) && expirations.length === CLI_ROLE_NAMES.length, "CLI_ROLE_EXPIRATION_INVALID");
  for (const [index, row] of expirations.entries()) {
    requireRelease(row && row.name === CLI_ROLE_NAMES[index] && Object.keys(row).sort().join(",") === "name,validUntil"
      && typeof row.validUntil === "string" && ISO_TIMESTAMP.test(row.validUntil)
      && Number.isFinite(Date.parse(row.validUntil))
      && Date.parse(row.validUntil) <= Date.parse(observation.observedAt) + CLI_ROLE_MAX_FUTURE_MS, "CLI_ROLE_EXPIRATION_INVALID");
  }
  uniqueOrdered(observation.ledger, x => x.version, "BASELINE_LEDGER_INVALID");
  for (const row of observation.ledger) requireRelease(/^\d{14}$/.test(row.version) && typeof row.name === "string" && (row.statementsSha256 === null || SHA.test(row.statementsSha256)), "BASELINE_LEDGER_INVALID");
  uniqueOrdered(observation.objects, x => `${x.kind}\0${x.identity}`, "BASELINE_OBJECTS_INVALID");
  for (const object of observation.objects) requireRelease(SHA.test(object.sha256), "BASELINE_OBJECTS_INVALID");
  for (const name of CLI_ROLE_NAMES) requireRelease(observation.objects.some(x => x.kind === "role" && x.identity === name), "CLI_ROLE_EXPIRATION_INVALID");
  uniqueOrdered(observation.relations, x => `${x.schema}\0${x.name}`, "BASELINE_RELATIONS_INVALID");
  for (const relation of observation.relations) requireRelease(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(relation.schema) && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(relation.name) && ["r", "p", "v", "m", "S"].includes(relation.kind), "BASELINE_RELATIONS_INVALID");
  for (const required of ["public.profiles", "auth.users", "storage.objects", "storage.buckets", "supabase_migrations.schema_migrations", "vault.secrets", "cron.job"])
    requireRelease(observation.relations.some(r => `${r.schema}.${r.name}` === required), "BASELINE_MANAGED_SCOPE_MISSING");
  requireRelease(observation.vaultRows === 0 && observation.cronJobs === 0, "BASELINE_EXTERNAL_STATE_CHANGED");
  return observation;
}
export function assertSameBaseline(actual, expected, contract) {
  validateObservation(actual, contract);
  same(actual.ledger, expected.ledger, "LIVE_LEDGER_DRIFT");
  same(actual.objects, expected.objects, "LIVE_SCHEMA_DRIFT");
  same(actual.relations, expected.relations, "LIVE_RELATION_DRIFT");
}
export function assertFencedBaseline(actual, expected, contract) {
  validateObservation(actual, contract);
  requireRelease(SHA.test(actual.storageStructureSha256) && actual.storageStructureSha256 === expected.storageStructureSha256, "STORAGE_STRUCTURE_DRIFT");
  same(actual.storagePolicies, expected.storagePolicies.filter(x => x.command === "r"), "STORAGE_FREEZE_POLICY_DRIFT");
  const objects = actual.objects.map(x => x.kind === "relation" && x.identity === "storage.objects"
    ? expected.objects.find(y => y.kind === x.kind && y.identity === x.identity) : x);
  assertSameBaseline({ ...actual, objects }, expected, contract);
}
// 원래 관측을 덮어쓰지 않는다. 공식 CLI로 생긴 정확한 세 변화 외에는 보충 채택할 수 없다.
export function validateBaselineSupplement(original, baseline, supplement, contract) {
  requireRelease(supplement?.version === 1, "BASELINE_SUPPLEMENT_INVALID");
  for (const key of ["format", "readOnly", "systemIdentifier", "serverVersion", "ledger", "relations",
    "storageStructureSha256", "storagePolicies", "vaultRows", "cronJobs"])
    same(baseline[key], original[key], "BASELINE_SUPPLEMENT_DRIFT");
  const expectedIdentities = ["membership:supabase_read_only_user:cli_login_supabase_read_only_user",
    "role:cli_login_postgres", "role:cli_login_supabase_read_only_user"];
  const before = new Map(original.objects.map(x => [`${x.kind}:${x.identity}`, x.sha256]));
  const after = new Map(baseline.objects.map(x => [`${x.kind}:${x.identity}`, x.sha256]));
  const changes = [...new Set([...before.keys(), ...after.keys()])].sort().filter(key => before.get(key) !== after.get(key))
    .map(identity => ({ identity, beforeSha256: before.get(identity) ?? null, afterSha256: after.get(identity) ?? null }));
  same(changes.map(x => x.identity), expectedIdentities, "BASELINE_SUPPLEMENT_DRIFT");
  requireRelease(changes.every(x => SHA.test(x.afterSha256) && (x.identity === "role:cli_login_postgres" ? SHA.test(x.beforeSha256) : x.beforeSha256 === null)), "BASELINE_SUPPLEMENT_INVALID");
  same(changes, supplement.objectChanges, "BASELINE_SUPPLEMENT_DRIFT");
  const evidence = baseline.cliRoleTransitionEvidence;
  requireRelease(evidence?.originalObservationSha256 === supplement.originalObservation.sha256
    && SHA.test(evidence.rawObservationSha256) && SHA.test(evidence.issuance?.sourceSha256)
    && evidence.issuance.projectRef === contract.projectRef && evidence.issuance.cliVersion === contract.cli.version
    && evidence.issuance.readOnlyRequested === true && evidence.issuance.ttlSeconds === 300
    && evidence.roleReconstruction?.reconstructedOriginalSha256 === before.get("role:cli_login_postgres")
    && evidence.roleReconstruction.stableSha256 === after.get("role:cli_login_postgres"), "BASELINE_SUPPLEMENT_EVIDENCE_INVALID");
}
export function loadCurrentBaselineContract(repoRoot) {
  const bytes = readAnchored(repoRoot, CURRENT_BASELINE_CONTRACT);
  const contract = JSON.parse(bytes);
  requireRelease(contract.version === 1 && contract.kind === "current-baseline-rollout" && contract.status === "requires-runtime-evidence", "CURRENT_CONTRACT_INVALID");
  requireRelease(REF.test(contract.projectRef) && /^\d{10,32}$/.test(contract.systemIdentifier) && /^[a-z0-9-]+$/.test(contract.release), "CURRENT_CONTRACT_INVALID");
  requireRelease(contract.expectedOrigin === "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git", "CURRENT_ORIGIN_INVALID");
  same(contract.historicalReconciliation, [], "HISTORY_REPAIR_FORBIDDEN");
  same(contract.appliedHotfixes, [], "HISTORY_REPAIR_FORBIDDEN");
  same(contract.requiredEvidence, EVIDENCE_KINDS, "EVIDENCE_SCOPE_WEAKENED");
  const baseline = validateObservation(JSON.parse(pinnedArtifact(repoRoot, contract.baselineObservation)), contract);
  const original = JSON.parse(pinnedArtifact(repoRoot, contract.baselineSupplement?.originalObservation));
  validateBaselineSupplement(original, baseline, contract.baselineSupplement, contract);
  requireRelease(baseline.ledger.at(-1).version === contract.requiredRemoteHead && contract.requiredRemoteHead < contract.migrationFloor, "BASELINE_HEAD_MISMATCH");
  const seen = new Set();
  const migrations = contract.migrations.map(pin => {
    const match = FILE.exec(pin.file);
    requireRelease(match && match[1] >= contract.migrationFloor && !seen.has(match[1]), "MIGRATION_SCOPE_INVALID");
    seen.add(match[1]);
    requireRelease(!baseline.ledger.some(row => row.version === match[1]), "MIGRATION_ALREADY_APPLIED");
    const sql = pinnedArtifact(repoRoot, { ...pin, file: `supabase/migrations/${pin.file}` });
    return { ...pin, version: match[1], sql };
  });
  uniqueOrdered(migrations, x => x.file, "MIGRATION_ORDER_INVALID");
  const local = readdirSync(join(repoRoot, "supabase/migrations")).filter(f => FILE.test(f)).sort();
  same(local.filter(f => f.slice(0, 14) >= contract.migrationFloor), migrations.map(x => x.file), "NEW_MIGRATION_NOT_REVIEWED");
  const remote = new Set(baseline.ledger.map(x => x.version));
  same(local.filter(f => f.slice(0, 14) < contract.migrationFloor && !remote.has(f.slice(0, 14))), contract.excludedHistoricalFiles, "HISTORICAL_DRIFT_CHANGED");
  for (const pin of Object.values(contract.implementation)) pinnedArtifact(repoRoot, pin);
  return { contract, baseline, migrations, contractSha256: digest(bytes), migrationSetSha256: digestJson(contract.migrations), baselineSha256: digestJson(baseline) };
}

function fresh(time, now, minutes) {
  const timestamp = Date.parse(time);
  requireRelease(Number.isFinite(timestamp) && timestamp <= now.getTime() && now.getTime() - timestamp <= minutes * 60_000, "EVIDENCE_STALE_OR_FUTURE");
}
const durable = observation => observation.relations.filter(x => ["r", "p", "m", "S"].includes(x.kind)).map(x => `${x.schema}.${x.name}`);

// 체크박스 true만으로는 통과하지 않는다. 원본 보고서 hash와 실제 비교 결과를 묶는다.
export function validateCurrentEvidence({ root, release, expectedCommit, now = new Date() }) {
  requireRelease(COMMIT.test(expectedCommit), "COMMIT_REQUIRED");
  const indexBytes = readAnchored(root, "current-release-evidence.json");
  const index = JSON.parse(indexBytes);
  same(Object.keys(index).sort(), [...EVIDENCE_KINDS].sort(), "EVIDENCE_SET_INCOMPLETE");
  const reports = {};
  for (const kind of EVIDENCE_KINDS) {
    const raw = pinnedArtifact(root, index[kind]);
    const report = JSON.parse(raw);
    requireRelease(report.kind === `current-baseline-${kind}-v1` && report.projectRef === release.contract.projectRef && report.releaseCommit === expectedCommit && report.contractSha256 === release.contractSha256 && report.baselineSha256 === release.baselineSha256 && report.migrationSetSha256 === release.migrationSetSha256, "EVIDENCE_BINDING_MISMATCH");
    fresh(report.verifiedAt, now, kind === "backup" || kind === "storage" ? 30 : 1440);
    const observation = JSON.parse(pinnedArtifact(root, report.rawEvidence));
    const { rawEvidence: _rawEvidence, ...semanticReport } = report;
    requireRelease(observation.kind === `current-baseline-${kind}-observations-v1`
      && observation.projectRef === report.projectRef && observation.releaseCommit === expectedCommit
      && observation.reportSha256 === digestJson(semanticReport) && observation.exitCode === 0
      && observation.transport === (kind === "backup" ? "hbam2-and-supabase-hosted" : "supabase-hosted")
      && observation.observedAt === report.verifiedAt
      && Array.isArray(observation.commands) && observation.commands.length > 0
      && observation.commands.every(c => SHA.test(c.commandSha256) && SHA.test(c.outputSha256) && c.exitCode === 0), "RAW_EVIDENCE_INVALID");
    reports[kind] = report;
  }
  const { backup, hostedRestore: restore, hostedStaging: staging, storage, finalizer } = reports;
  same(backup.ledger, release.baseline.ledger, "BACKUP_LEDGER_MISMATCH");
  same(backup.objects, release.baseline.objects, "BACKUP_SCHEMA_SCOPE_MISMATCH");
  assertFencedBaseline({ ...release.baseline, objects: backup.fencedObjects, storagePolicies: backup.frozenStoragePolicies }, release.baseline, release.contract);
  same(backup.relations?.map(x => x.identity), durable(release.baseline), "BACKUP_RELATION_SCOPE_MISMATCH");
  requireRelease(backup.relations.every(x => Number.isSafeInteger(x.rows) && x.rows >= 0 && SHA.test(x.sha256)), "BACKUP_DATA_DIGEST_MISSING");
  same(backup.sourceWriters, { webWriteFenceEnabled: true, authSignupDisabled: true,
    authSignInDisabled: true, authRefreshDisabled: true, realtimeWritesDisabled: true,
    serviceWritersDisabled: true, backgroundWritersDisabled: true }, "BACKUP_SOURCE_WRITERS_NOT_FENCED");
  same(backup.beforeRelations, backup.relations, "BACKUP_SOURCE_DATA_CHANGED");
  same(backup.afterRelations, backup.relations, "BACKUP_SOURCE_DATA_CHANGED");
  requireRelease(backup.format === "hbam2-encrypted-current-user" && backup.plaintextWrittenToDisk === false && /^[a-f0-9-]{36}$/.test(backup.backupSetId), "BACKUP_ENCRYPTION_MISSING");
  requireRelease(backup.providerBackup?.status === "COMPLETED" && backup.providerBackup.physical === true, "PHYSICAL_BACKUP_MISSING");
  fresh(backup.providerBackup.completedAt, now, 26 * 60);
  requireRelease(Array.isArray(backup.artifacts) && backup.artifacts.length >= backup.relations.length + 2, "BACKUP_ARTIFACTS_INCOMPLETE");
  uniqueOrdered(backup.artifacts, x => x.directory, "BACKUP_ARTIFACTS_INVALID");
  for (const artifact of backup.artifacts) {
    requireRelease(/^part-[0-9]{6}$/.test(artifact.directory) && artifact.name === (artifact.scope === "schema-original" ? "schema-inventory.json" : "logical-data.json")
      && artifact.artifact === `${artifact.name}.hbam2` && artifact.key === `${artifact.name}.key.dpapi`
      && SHA.test(artifact.plaintext_sha256?.toLowerCase()) && Number.isSafeInteger(artifact.plaintext_bytes) && artifact.plaintext_bytes > 0 && artifact.plaintext_bytes <= 32 * 1024 * 1024, "BACKUP_ARTIFACT_INVALID");
    pinnedArtifact(root, { file: `${backup.directory}/${artifact.directory}/${artifact.artifact}`, sha256: artifact.encrypted_sha256?.toLowerCase() }, 32 * 1024 * 1024 + 1024);
    pinnedArtifact(root, { file: `${backup.directory}/${artifact.directory}/${artifact.key}`, sha256: artifact.key_sha256?.toLowerCase() }, 16 * 1024);
    if (artifact.scope.startsWith("storage:")) requireRelease(SHA.test(artifact.original_sha256)
      && Number.isSafeInteger(artifact.original_bytes) && artifact.original_bytes >= 0
      && artifact.original_bytes <= 24 * 1024 * 1024 - 1024, "STORAGE_ENVELOPE_INVALID");
  }
  for (const relation of backup.relations) requireRelease(backup.artifacts.some(a => a.scope === `relation:${relation.identity}` && a.plaintext_sha256.toLowerCase() === relation.sha256), "BACKUP_RELATION_ARTIFACT_MISSING");
  requireRelease(backup.artifacts.some(a => a.scope === "schema-original") && backup.artifacts.some(a => a.scope === "storage-index"), "BACKUP_MANAGED_ORIGINAL_MISSING");
  requireRelease(restore.targetProjectRef !== release.contract.projectRef && REF.test(restore.targetProjectRef), "RESTORE_TARGET_INVALID");
  same(restore.isolation, { publicBuckets: 0, signupEnabled: false, enabledIdentityProviders: 0, outboundHooks: 0, cronJobs: 0,
    initialAuthUsers: 0, initialAuthSessions: 0, initialRefreshTokens: 0, initialStorageObjects: 0,
    exposedSchemas: [], publicDataApiGrants: 0, publicStorageReadAllowed: false,
    signInRequestsBlocked: true, refreshRequestsBlocked: true, realtimeConnectionsBlocked: true,
    outboundNetworkBlocked: true, productionRedirects: [], publicIngressBlocked: true }, "RESTORE_NOT_ISOLATED");
  requireRelease(restore.backupEvidenceSha256 === index.backup.sha256 && restore.authCanaryPassed === true, "RESTORE_BACKUP_MISMATCH");
  same(restore.sourceRelations, backup.relations, "RESTORE_SOURCE_MISMATCH");
  same(restore.targetRelations, backup.relations, "RESTORE_DATA_MISMATCH");
  same(restore.targetObjects, backup.objects, "RESTORE_SCHEMA_MISMATCH");
  same(restore.targetLedger, backup.ledger, "RESTORE_LEDGER_MISMATCH");
  requireRelease(storage.backupEvidenceSha256 === index.backup.sha256 && storage.mutationPolicies === 0 && storage.databaseFenceHeld === true, "STORAGE_FENCE_MISSING");
  fresh(storage.secondSnapshotAt, now, 30);
  requireRelease(Number.isSafeInteger(storage.maximumIssuedUploadTtlMinutes) && storage.maximumIssuedUploadTtlMinutes >= 120
    && storage.ttlSource === "supabase-createSignedUploadUrl-fixed-two-hours"
    && storage.webAndNativeIssuanceDisabled === true && storage.serviceWritersDisabled === true, "STORAGE_WRITER_TTL_UNVERIFIED");
  requireRelease(storage.s3CredentialsRevokedAndWritesDrained === true
    && typeof storage.resumableUploadsDisabledAndDrained === "boolean"
    && (storage.resumableUploadsDisabledAndDrained || storage.maximumIssuedUploadTtlMinutes >= 1440), "OTHER_STORAGE_WRITERS_UNVERIFIED");
  requireRelease(Date.parse(storage.firstSnapshotAt) - Date.parse(storage.frozenAt) >= (storage.maximumIssuedUploadTtlMinutes + 10) * 60_000 && Date.parse(storage.secondSnapshotAt) - Date.parse(storage.firstSnapshotAt) >= 5 * 60_000, "STORAGE_DRAIN_INCOMPLETE");
  same(storage.firstObjects, storage.secondObjects, "STORAGE_CHANGED_DURING_BACKUP");
  requireRelease(Array.isArray(storage.firstObjects) && storage.firstObjects.every(x => SHA.test(x.identity) && SHA.test(x.sha256) && Number.isSafeInteger(x.bytes) && x.bytes >= 0), "STORAGE_ORIGINAL_DIGEST_MISSING");
  requireRelease(new Set(storage.firstObjects.map(x => x.identity)).size === storage.firstObjects.length, "STORAGE_OBJECT_DUPLICATED");
  same(storage.firstObjects, restore.storageObjects, "RESTORE_STORAGE_BYTES_MISMATCH");
  for (const object of storage.firstObjects) requireRelease(backup.artifacts.some(a => a.scope === `storage:${object.identity}` && a.original_sha256 === object.sha256 && a.original_bytes === object.bytes), "STORAGE_ORIGINAL_NOT_BACKED_UP");
  same(backup.artifacts.map(x => x.scope).sort(), [...backup.relations.map(x => `relation:${x.identity}`),
    "schema-original", "storage-index", ...storage.firstObjects.map(x => `storage:${x.identity}`)].sort(), "BACKUP_SCOPE_SET_MISMATCH");
  requireRelease(staging.targetProjectRef !== release.contract.projectRef && REF.test(staging.targetProjectRef) && staging.syntheticOnly === true && staging.existingRowsPreserved === true && staging.outboundAiCalls === 0, "STAGING_ISOLATION_MISSING");
  same(staging.appliedMigrations, release.contract.migrations, "STAGING_MIGRATIONS_MISMATCH");
  same(staging.appliedLedgerRows?.map(x => x.version), release.migrations.map(x => x.version), "STAGING_LEDGER_MISMATCH");
  requireRelease(staging.appliedLedgerRows.every((x, i) => x.name === release.migrations[i].file.slice(15, -4) && SHA.test(x.statementsSha256)), "STAGING_LEDGER_MISMATCH");
  const checks = ["actorBinding", "ownerPrivacy", "concurrentWrites", "approvalReceipt", "rollback", "featureFlagsOff"];
  same(staging.checks?.map(x => x.name).sort(), [...checks].sort(), "STAGING_CHECKS_MISSING");
  requireRelease(staging.checks.every(x => x.passed === true && SHA.test(x.rawEvidenceSha256)), "STAGING_CHECK_FAILED");
  uniqueOrdered(staging.postObjects, x => `${x.kind}\0${x.identity}`, "POST_SCHEMA_MISSING");
  uniqueOrdered(staging.postRelations, x => `${x.schema}\0${x.name}`, "POST_RELATIONS_MISSING");
  const before = new Map(backup.fencedObjects.map(x => [`${x.kind}:${x.identity}`, x.sha256]));
  const after = new Map(staging.postObjects.map(x => [`${x.kind}:${x.identity}`, x.sha256]));
  for (const key of new Set([...before.keys(), ...after.keys()])) if (before.get(key) !== after.get(key))
    requireRelease(release.contract.allowedSchemaChanges.some(rule => key === rule || (rule.endsWith("(*)") && key.startsWith(rule.slice(0, -2)))), "UNREVIEWED_SCHEMA_CHANGE");
  requireRelease(finalizer.targetProjectRef === staging.targetProjectRef && finalizer.exactOwnerRejected === true && finalizer.wrongPhaseRejected === true && finalizer.wrongSchemaRejected === true && finalizer.featureOffRollbackPassed === true && finalizer.fenceHeldUntilCanary === true && SHA.test(finalizer.rawEvidenceSha256), "FINALIZER_REHEARSAL_MISSING");
  same(finalizer.postObjects, staging.postObjects, "FINALIZER_SCHEMA_MISMATCH");
  same(finalizer.postRelations, staging.postRelations, "FINALIZER_RELATIONS_MISMATCH");
  return { reports, indexSha256: digest(indexBytes), postObjects: staging.postObjects };
}
