import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ExtendedReleaseContractError,
  validateAmoraExtendedReleaseContracts,
} from "./lib/amora-release-extended-contracts.mjs";
import { analyzeReadOnlySqlEnvelope } from "./lib/sql-read-only-envelope.mjs";
import {
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
} from "./lib/supabase-successor-release-contract.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifestPath = join(
  repoRoot,
  "supabase",
  "release-manifests",
  "amora-engine-v2-20260716.json"
);
const predecessorReleaseManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
let manifest = predecessorReleaseManifest;
const successorManifestPath = join(repoRoot, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
const args = new Set(process.argv.slice(2));
const SHA256 = /^[a-f0-9]{64}$/;
const UPPER_SHA256 = /^[A-F0-9]{64}$/;
const SAFE_ID = /^[a-z][a-z0-9-]{2,63}$/;
const MIGRATION_FILE = /^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/;
const BASELINE_CONTRACT_ID = "pre-amora-current-remote-14-table-baseline";
const EPHEMERAL_REBUILD_CONTRACT =
  "production_release_lease_20260717=temporary-release-control-dropped-by-paired-write-fence-finalizer;rate_limit_buckets=empty-on-restore-recreated-by-public.check_rate_limit(text,integer,integer)";
const HOSTED_RESTORE_REQUIRED_CHECKS = [
  "authApiSmokeVerified",
  "authUsersSchemaAndDataVerified",
  "checkConstraintsVerified",
  "columnDefaultsVerified",
  "destructiveRestoreDrillCompleted",
  "isolatedTargetConfirmed",
  "logicalDataDigestsVerified",
  "rowLevelSecurityPoliciesVerified",
  "rpcDefinitionsAndAclVerified",
  "storageMetadataRestoredVerified",
  "triggersVerified",
  "typedSchemaVerified",
];

function fail(message) {
  console.error(`SUPABASE_RELEASE_FENCE_BLOCKED: ${message}`);
  process.exit(1);
}

function sha256(path) {
  // Git may materialize text files with CRLF on Windows and LF on Linux.
  // Hash canonical UTF-8 text so the release fence detects content changes
  // without rejecting an otherwise identical checkout on another OS.
  const canonicalText = readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
  return createHash("sha256").update(canonicalText, "utf8").digest("hex");
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function filesFor(section) {
  return manifest[section].map((entry) => entry.file);
}

function verifyHashPinnedArtifact(entry, label) {
  if (!entry
      || typeof entry.file !== "string"
      || entry.file.includes("\\")
      || entry.file.includes("//")
      || !SHA256.test(entry.sha256 ?? "")) {
    fail(`${label} record is invalid`);
  }
  const path = resolve(repoRoot, entry.file);
  if (!inside(repoRoot, path)) fail(`${label} path escapes the repository: ${entry.file}`);
  if (!existsSync(path)) fail(`${label} missing: ${entry.file}`);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    fail(`${label} must be a non-symlink regular file: ${entry.file}`);
  }
  const actual = sha256(path);
  if (actual !== entry.sha256) {
    fail(`${label} hash mismatch for ${entry.file}; expected ${entry.sha256}, received ${actual}`);
  }
}

function assertReadOnlySqlEnvelope(entry, label) {
  const sql = readFileSync(resolve(repoRoot, entry.file), "utf8");
  const analysis = analyzeReadOnlySqlEnvelope(sql);
  if (!analysis.ok && analysis.reason === "transaction-escape") {
    fail(`${label} may not escape its read-only transaction`);
  }
  if (!analysis.ok) fail(`${label} must use an explicit read-only transaction`);
}

function verifyReleaseCheckList(section, allIds, allPaths, { allowEmpty = false } = {}) {
  const checks = manifest[section];
  if (!Array.isArray(checks) || (!allowEmpty && checks.length === 0)) {
    fail(`${section} must be ${allowEmpty ? "an array" : "a non-empty array"}`);
  }
  for (const entry of checks) {
    const evidenceEntries = entry?.expectedEvidence
      && typeof entry.expectedEvidence === "object"
      && !Array.isArray(entry.expectedEvidence)
      ? Object.entries(entry.expectedEvidence)
      : [];
    const evidenceInvalid = evidenceEntries.length === 0
      || evidenceEntries.some(([name, value]) =>
        !/^[a-z][a-z0-9_]*_count$/.test(name)
        || !Number.isSafeInteger(value)
        || value < 0
        || value > 1_000_000_000);
    if (!SAFE_ID.test(entry?.id ?? "")
        || allIds.has(entry.id)
        || entry?.type !== "read-only-sql"
        || typeof entry.file !== "string"
        || !/^supabase\/release-checks\/[a-z0-9][a-z0-9_.-]*\.sql$/.test(entry.file)
        || evidenceInvalid) {
      fail(`${section} contains an invalid or duplicate check record`);
    }
    const artifactPath = resolve(repoRoot, entry.file);
    if (allPaths.has(artifactPath)) fail(`${section} contains a duplicate check path`);
    allIds.add(entry.id);
    allPaths.add(artifactPath);
    verifyHashPinnedArtifact(entry, `${section} check`);
    assertReadOnlySqlEnvelope(entry, `${section} check`);
  }
}

function verifyOperationList(
  section,
  allIds,
  allPaths,
  {
    rollback = false,
    preApplyCheckIds = new Set(),
    postPushCheckIds = new Set(),
    manualOperationIds = new Set(),
    rollbackOperationIds = new Set(),
  } = {},
) {
  const entries = manifest[section];
  if (!Array.isArray(entries) || entries.length === 0) {
    fail(`${section} must be a non-empty array`);
  }
  for (const entry of entries) {
    const validPath = typeof entry?.file === "string"
      && /^supabase\/platform-operations\/(?:security|storage)\/[a-z0-9][a-z0-9_.-]*\.sql$/.test(entry.file)
      && (!rollback || /_rollback\.sql$/.test(entry.file));
    if (!SAFE_ID.test(entry?.id ?? "")
        || allIds.has(entry.id)
        || !validPath
        || allPaths.has(entry.file)) {
      fail(`${section} contains an invalid or duplicate operation record`);
    }
    allIds.add(entry.id);
    allPaths.add(entry.file);
    if (!rollback) {
      const phaseChecks = entry.phase === "pre-backup"
        ? preApplyCheckIds
        : entry.phase === "post-push-pre-deploy"
          ? postPushCheckIds
          : null;
      if (!phaseChecks
          || !SAFE_ID.test(entry.verificationCheckId ?? "")
          || !phaseChecks.has(entry.verificationCheckId)) {
        fail(`${section} operation is not bound to its exact release-phase read-only check`);
      }
      manualOperationIds.add(entry.id);
    } else {
      if (!SAFE_ID.test(entry.forOperationId ?? "")
          || rollbackOperationIds.has(entry.forOperationId)) {
        fail(`${section} rollback is not uniquely bound to a manual platform operation`);
      }
      rollbackOperationIds.add(entry.forOperationId);
    }
    verifyHashPinnedArtifact(entry, rollback ? "rollback artifact" : "manual platform operation");
  }
}

function verifyManualControlEvidence() {
  const postPushOperationCount = manifest.manualPlatformOperations.filter(
    (operation) => operation.phase === "post-push-pre-deploy",
  ).length;
  const evidence = manifest.manualControlEvidence;
  const expectedKeys = postPushOperationCount > 0
    ? [
      "maximumAgeMinutes",
      "postPushReceiptFileName",
      "receiptFileName",
      "signedUploadGraceMinutes",
      "signedUploadTokenTtlMinutes",
      "storageDrainReceiptFileName",
      "storageStabilityWindowMinutes",
    ]
    : [
      "maximumAgeMinutes",
      "receiptFileName",
      "signedUploadGraceMinutes",
      "signedUploadTokenTtlMinutes",
      "storageDrainReceiptFileName",
      "storageStabilityWindowMinutes",
    ];
  const actualKeys = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? Object.keys(evidence).sort()
    : [];
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
      || evidence.maximumAgeMinutes !== 30
      || evidence.signedUploadTokenTtlMinutes !== 120
      || evidence.signedUploadGraceMinutes !== 10
      || evidence.storageStabilityWindowMinutes !== 5
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(evidence.receiptFileName ?? "")
      || !/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
        evidence.storageDrainReceiptFileName ?? "",
      )
      || evidence.storageDrainReceiptFileName === evidence.receiptFileName
      || (postPushOperationCount > 0
        && (!/^[a-z0-9][a-z0-9_.-]{2,80}\.json$/.test(
          evidence.postPushReceiptFileName ?? "",
        )
          || evidence.postPushReceiptFileName === evidence.receiptFileName))
      || (postPushOperationCount > 0) !== (manifest.postPushChecks.length > 0)) {
    fail("manualControlEvidence does not match the exact pre-backup/post-push receipt contract");
  }
}

function verifyBackupContract() {
  const contract = manifest.backupContract;
  const successorContract = manifest.status === "controller_ready"
    && manifest.rollbackContract
    && contract?.version === 2;
  const successorInvalid = successorContract && (
    contract.format !== "hbam2-encrypted-current-user"
    || contract.expectedMigrationHead !== manifest.requiredRemoteHead
    || !Array.isArray(contract.expectedTables)
    || contract.expectedTables.length !== contract.expectedTableCount
    || contract.expectedTableCount < 1
    || new Set(contract.expectedTables).size !== contract.expectedTables.length
    || contract.expectedTables.some((table, index) =>
      !/^[a-z][a-z0-9_]{1,62}$/.test(table)
      || (index > 0 && table <= contract.expectedTables[index - 1]))
    || sha256TextList(contract.expectedTables)
      !== contract.expectedTableContractSha256
    || contract.expectedCommitBinding !== "release-expected-commit"
    || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(
      contract.expectedOrigin ?? "",
    )
    || !/^scripts\/[a-z0-9][a-z0-9_.-]*\.ps1$/.test(contract.verifier?.file ?? "")
    || !SHA256.test(contract.verifier?.sha256 ?? "")
    || contract.providerPhysicalBackup?.maximumAgeHours !== 26
    || contract.providerPhysicalBackup?.requiredStatus !== "COMPLETED"
    || contract.providerPhysicalBackup?.requirePhysicalBackup !== true
    || contract.providerPhysicalBackup?.restoreCapability
      !== "completed-physical-backup"
    || contract.hostedRestoreEvidence?.receiptFileName
      !== `${manifest.release}-hosted-restore-evidence.json`
    || contract.hostedRestoreEvidence?.maximumAgeMinutes !== 1_440
    || contract.hostedRestoreEvidence?.requiredTargetIsolation
      !== "different-supabase-project"
    || JSON.stringify(contract.hostedRestoreEvidence?.requiredChecks)
      !== JSON.stringify(HOSTED_RESTORE_REQUIRED_CHECKS)
    || !/^\d+\.\d+\.\d+$/.test(contract.supabaseCli?.version ?? "")
    || !UPPER_SHA256.test(contract.supabaseCli?.binarySha256 ?? "")
  );
  const predecessorInvalid = !successorContract && (
    contract?.id !== BASELINE_CONTRACT_ID
      || contract.version !== 1
      || contract.expectedTableCount !== 14
      || contract.excludedEphemeralTables?.length !== 2
      || contract.excludedEphemeralTables[0]
        !== "production_release_lease_20260717"
      || contract.excludedEphemeralTables[1] !== "rate_limit_buckets"
      || contract.ephemeralRebuildContract !== EPHEMERAL_REBUILD_CONTRACT
      || contract.expectedCommitBinding !== "release-expected-commit"
      || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(contract.expectedOrigin ?? "")
      || contract.verifier?.file !== "scripts/amora-db-current-baseline-verify.ps1"
      || contract.providerPhysicalBackup?.maximumAgeHours !== 26
      || contract.providerPhysicalBackup?.requiredStatus !== "COMPLETED"
      || contract.providerPhysicalBackup?.requirePhysicalBackup !== true
      || contract.providerPhysicalBackup?.restoreCapability
        !== "completed-physical-backup"
      || contract.hostedRestoreEvidence?.receiptFileName
        !== `${manifest.release}-hosted-restore-evidence.json`
      || contract.hostedRestoreEvidence?.maximumAgeMinutes !== 1_440
      || contract.hostedRestoreEvidence?.requiredTargetIsolation
        !== "different-supabase-project"
      || JSON.stringify(contract.hostedRestoreEvidence?.requiredChecks)
        !== JSON.stringify(HOSTED_RESTORE_REQUIRED_CHECKS)
      || !/^\d+\.\d+\.\d+$/.test(contract.supabaseCli?.version ?? "")
      || !UPPER_SHA256.test(contract.supabaseCli?.binarySha256 ?? "")
  );
  if (successorInvalid || predecessorInvalid) {
    fail("current-remote backup contract and ephemeral rebuild contract are missing or invalid");
  }
  verifyHashPinnedArtifact(contract.verifier, "current-baseline verifier");
}

function sha256TextList(values) {
  return createHash("sha256")
    .update(`${values.join("\n")}\n`, "utf8")
    .digest("hex");
}

function verifyExtendedReleaseContracts(
  operationIds,
  operationPaths,
  preApplyCheckIds,
) {
  let contracts;
  try {
    contracts = validateAmoraExtendedReleaseContracts(manifest);
  } catch (error) {
    if (error instanceof ExtendedReleaseContractError) {
      fail(`${error.code}: ${error.message}`);
    }
    throw error;
  }

  for (const operation of contracts.forwardOnlySecurityOperations) {
    if (operationIds.has(operation.id)
        || !preApplyCheckIds.has(operation.verificationCheckId)) {
      fail("forward-only security operation id collides with another operation");
    }
    operationIds.add(operation.id);
    for (const [kind, artifact] of Object.entries({
      inventory: operation.inventory,
      apply: operation.apply,
      verify: operation.verify,
    })) {
      if (operationPaths.has(artifact.file)) {
        fail("forward-only security operation path collides with another artifact");
      }
      operationPaths.add(artifact.file);
      verifyHashPinnedArtifact(artifact, `forward-only ${kind} artifact`);
      if (kind !== "apply") {
        assertReadOnlySqlEnvelope(artifact, `forward-only ${kind} artifact`);
      } else {
        const sql = readFileSync(resolve(repoRoot, artifact.file), "utf8")
          .replace(/\r\n?/g, "\n")
          .trim();
        if (!/^begin\s*;/i.test(sql) || !/commit\s*;\s*$/i.test(sql)) {
          fail("forward-only apply artifact must use one explicit transaction");
        }
      }
    }
  }

  const finalizer = contracts.finalizationContract.operation;
  if (operationIds.has(finalizer.id) || operationPaths.has(finalizer.file)) {
    fail("finalizer artifact collides with another release operation");
  }
  operationIds.add(finalizer.id);
  operationPaths.add(finalizer.file);
  verifyHashPinnedArtifact(finalizer, "exact-owner finalizer artifact");

  const postExpandVerifier = contracts.postExpandBackupContract.verifier;
  verifyHashPinnedArtifact(
    contracts.postExpandBackupContract.capture,
    "post-expand backup capture",
  );
  verifyHashPinnedArtifact(postExpandVerifier, "post-expand backup verifier");
}

function verifyPredecessorManifest() {
  const entry = manifest.predecessorManifest;
  if (
    !entry
    || typeof entry.file !== "string"
    || !entry.file.startsWith("supabase/release-manifests/")
    || typeof entry.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(entry.sha256)
  ) {
    fail("predecessor release manifest pin is missing or invalid");
  }
  const predecessorManifestPath = resolve(repoRoot, entry.file);
  const releaseManifestDir = resolve(repoRoot, "supabase", "release-manifests");
  if (dirname(predecessorManifestPath) !== releaseManifestDir) {
    fail(`predecessor release manifest path escapes the release manifest directory: ${entry.file}`);
  }
  if (!existsSync(predecessorManifestPath)) {
    fail(`predecessor release manifest missing: ${entry.file}`);
  }
  verifyHashPinnedArtifact(entry, "predecessor release manifest");
  const predecessor = JSON.parse(readFileSync(predecessorManifestPath, "utf8"));
  if (predecessor.projectRef !== manifest.projectRef) {
    fail(`predecessor project ref mismatch; expected ${manifest.projectRef}, received ${predecessor.projectRef}`);
  }
  const predecessorMigrations = [
    ...(predecessor.historicalReconciliation ?? []),
    ...(predecessor.expandMigrations ?? []),
    ...(predecessor.appliedHotfixes ?? []),
  ];
  for (const entry of predecessorMigrations) {
    const path = join(repoRoot, "supabase", "migrations", entry.file);
    if (!existsSync(path)) fail(`predecessor migration missing: ${entry.file}`);
    const actual = sha256(path);
    if (actual !== entry.sha256) {
      fail(`predecessor migration hash mismatch for ${entry.file}; expected ${entry.sha256}, received ${actual}`);
    }
  }
  if (predecessor.historicalEffectAudit) {
    verifyHashPinnedArtifact(predecessor.historicalEffectAudit, "predecessor historical effect audit");
  }
  for (const entry of predecessor.manualPlatformOperations ?? []) {
    verifyHashPinnedArtifact(entry, "predecessor manual platform operation");
  }
  // A later release may intentionally revise operational documentation and
  // pin the new version in its own manifest. Immutable predecessor database
  // migrations, audits and platform operations remain chained here.
}

function verifyStaticManifest({ migrationCeiling = null } = {}) {
  if (!/^\d{14}$/.test(manifest.migrationFloor ?? "")) {
    fail("migration floor is missing or invalid");
  }
  if (!/^\d{14}$/.test(manifest.requiredRemoteHead ?? "")
      || manifest.requiredRemoteHead >= manifest.migrationFloor) {
    fail("required remote head is missing or invalid");
  }
  if (!Array.isArray(manifest.historicalReconciliation)
      || !Array.isArray(manifest.expandMigrations)
      || manifest.expandMigrations.length === 0
      || !Array.isArray(manifest.appliedHotfixes)) {
    fail("migration sections are missing or invalid");
  }
  const appliedHotfixes = manifest.appliedHotfixes;
  const declared = [
    ...manifest.historicalReconciliation,
    ...manifest.expandMigrations,
    ...appliedHotfixes,
  ];
  const declaredNames = new Set();
  const migrationDir = join(repoRoot, "supabase", "migrations");
  let previousExpandVersion = "";

  for (const entry of declared) {
    const match = typeof entry?.file === "string" ? entry.file.match(MIGRATION_FILE) : null;
    if (!match || basename(entry.file) !== entry.file || !SHA256.test(entry.sha256 ?? "")) {
      fail("manifest migration record is invalid");
    }
    if (declaredNames.has(entry.file)) fail(`duplicate manifest migration: ${entry.file}`);
    declaredNames.add(entry.file);
    if (manifest.expandMigrations.includes(entry)) {
      if (match[1] < manifest.migrationFloor || match[1] <= previousExpandVersion) {
        fail("expand migration order is not strictly increasing from the migration floor");
      }
      previousExpandVersion = match[1];
    }
    const path = join(migrationDir, entry.file);
    verifyHashPinnedArtifact(
      { ...entry, file: relative(repoRoot, path).split(sep).join("/") },
      "manifest migration",
    );
  }

  const releaseEraFiles = readdirSync(migrationDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .filter((name) => name.slice(0, 14) >= manifest.migrationFloor)
    .filter((name) => !migrationCeiling || name.slice(0, 14) < migrationCeiling)
    .sort();
  const expectedReleaseEra = declared
    .map((entry) => entry.file)
    .filter((name) => name.slice(0, 14) >= manifest.migrationFloor);
  if (releaseEraFiles.length !== expectedReleaseEra.length
      || releaseEraFiles.some((name, index) => name !== expectedReleaseEra[index])) {
    fail(`release-era migration set or order drifted; expected=${expectedReleaseEra.join(",") || "none"}; received=${releaseEraFiles.join(",") || "none"}`);
  }

  verifyHashPinnedArtifact(
    manifest.historicalEffectAudit,
    "historical effect audit"
  );
  const checkIds = new Set();
  const checkPaths = new Set();
  verifyReleaseCheckList("preApplyChecks", checkIds, checkPaths);
  verifyReleaseCheckList("postPushChecks", checkIds, checkPaths, { allowEmpty: true });
  verifyReleaseCheckList("postApplyChecks", checkIds, checkPaths);
  const operationIds = new Set();
  const operationPaths = new Set();
  const manualOperationIds = new Set();
  const rollbackOperationIds = new Set();
  const preApplyCheckIds = new Set(manifest.preApplyChecks.map((entry) => entry.id));
  const postPushCheckIds = new Set(manifest.postPushChecks.map((entry) => entry.id));
  verifyOperationList("manualPlatformOperations", operationIds, operationPaths, {
    preApplyCheckIds,
    postPushCheckIds,
    manualOperationIds,
    rollbackOperationIds,
  });
  verifyOperationList("rollbackArtifacts", operationIds, operationPaths, {
    rollback: true,
    preApplyCheckIds,
    postPushCheckIds,
    manualOperationIds,
    rollbackOperationIds,
  });
  if (manualOperationIds.size !== rollbackOperationIds.size
      || [...manualOperationIds].some((id) => !rollbackOperationIds.has(id))) {
    fail("every manual platform operation requires exactly one rollback artifact");
  }
  verifyExtendedReleaseContracts(operationIds, operationPaths, preApplyCheckIds);
  verifyManualControlEvidence();
  if (!Array.isArray(manifest.requiredDocuments) || manifest.requiredDocuments.length === 0) {
    fail("requiredDocuments must be a non-empty array");
  }
  const documentPaths = new Set();
  for (const entry of manifest.requiredDocuments) {
    if (typeof entry?.file !== "string"
        || !/^docs\/[A-Za-z0-9][A-Za-z0-9_./-]*\.md$/.test(entry.file)
        || entry.file.includes("..")
        || documentPaths.has(entry.file)) {
      fail("requiredDocuments contains an invalid or duplicate document record");
    }
    documentPaths.add(entry.file);
    verifyHashPinnedArtifact(entry, "required release document");
  }
  verifyBackupContract();

  console.log(`Static release manifest verified (${declared.length} migrations; applied-hotfix count ${appliedHotfixes.length}; ${manifest.manualPlatformOperations.length} platform operations; ${manifest.rollbackArtifacts.length} rollback artifacts; ${manifest.requiredDocuments.length} required documents).`);
}

function parsePending(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[•*]\s+([^\s]+\.sql)\s*$/)?.[1] ?? null)
    .filter(Boolean);
}

function assertExact(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const unexpected = actual.filter((file) => !expectedSet.has(file));
  const missing = expected.filter((file) => !actualSet.has(file));
  if (actual.length !== actualSet.size) fail(`${label}: duplicate pending migration names`);
  if (unexpected.length || missing.length) {
    fail(`${label}: pending set mismatch; unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}`);
  }
  const firstOutOfOrder = expected.findIndex((file, index) => actual[index] !== file);
  if (firstOutOfOrder !== -1) {
    fail(`${label}: pending migration order mismatch at index ${firstOutOfOrder}; expected=${expected[firstOutOfOrder] ?? "none"}; received=${actual[firstOutOfOrder] ?? "none"}`);
  }
}

function verifyRemotePending() {
  const expectedMode = process.argv.find((arg) => arg.startsWith("--expect="))?.split("=")[1];
  if (!expectedMode || !["before-reconcile", "expand-only", "clean"].includes(expectedMode)) {
    fail("--remote requires --expect=before-reconcile|expand-only|clean");
  }

  const linkedRefPath = join(repoRoot, "supabase", ".temp", "project-ref");
  if (!existsSync(linkedRefPath)) fail("Supabase project is not linked");
  const linkedRef = readFileSync(linkedRefPath, "utf8").trim();
  const expectedRef = process.argv.find((arg) => arg.startsWith("--project-ref="))?.split("=")[1]
    ?? manifest.projectRef;
  if (linkedRef !== expectedRef) {
    fail(`linked project mismatch; expected ${expectedRef}, received ${linkedRef}`);
  }

  const supabaseCli = join(repoRoot, "node_modules", "supabase", "dist", "supabase.js");
  if (!existsSync(supabaseCli)) fail("Supabase CLI is not installed; run pnpm install --frozen-lockfile");
  const result = spawnSync(
    process.execPath,
    [supabaseCli, "db", "push", "--linked", "--dry-run"],
    { cwd: repoRoot, encoding: "utf8", shell: false }
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error) fail(`Supabase CLI could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`Supabase dry-run failed\n${output}`);
  const pending = parsePending(output);
  const expected = expectedMode === "before-reconcile"
    ? [...filesFor("historicalReconciliation"), ...filesFor("expandMigrations")]
    : expectedMode === "expand-only"
      ? filesFor("expandMigrations")
      : [];
  assertExact(pending, expected, expectedMode);
  console.log(`Remote pending set verified for ${linkedRef}: ${expectedMode} (${pending.length} migrations).`);
}

// 새 후속 릴리스는 기존 기본 fence의 목록/핀을 바꾸지 않고 명시 모드로만 검증한다.
// 이 분기는 로컬 계약 검사이며 hosted 증거 수집이나 원격 명령을 실행하지 않는다.
if (args.has("--wedding-code-pair-session-conflict")) {
  if (process.argv.slice(2).length !== 1) fail("WEDDING_CODE_PAIR_SESSION_CONFLICT_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadWeddingCodePairSessionConflictReleasePlan } = await import("./lib/wedding-code-pair-session-conflict-release-contract.mjs");
    const plan = loadWeddingCodePairSessionConflictReleasePlan(repoRoot);
    console.log(`WeddingCode pair session conflict contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "WEDDING_CODE_PAIR_SESSION_CONFLICT_STATIC_UNCONFIRMED");
  }
}

if (args.has("--wedding-code-pair-session")) {
  if (process.argv.slice(2).length !== 1) fail("WEDDING_CODE_PAIR_SESSION_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadWeddingCodePairSessionReleasePlan } = await import("./lib/wedding-code-pair-session-release-contract.mjs");
    const plan = loadWeddingCodePairSessionReleasePlan(repoRoot);
    console.log(`WeddingCode pair session contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "WEDDING_CODE_PAIR_SESSION_STATIC_UNCONFIRMED");
  }
}

if (args.has("--preparation-style")) {
  if (process.argv.slice(2).length !== 1) fail("PREPARATION_STYLE_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadPreparationStyleReleasePlan } = await import("./lib/preparation-style-release-contract.mjs");
    const plan = loadPreparationStyleReleasePlan(repoRoot);
    console.log(`Preparation style contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "PREPARATION_STYLE_STATIC_UNCONFIRMED");
  }
}

if (args.has("--wedding-code-research-scene-v10")) {
  if (process.argv.slice(2).length !== 1) fail("WEDDING_CODE_SCENE_V10_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadWeddingCodeSceneV10ReleasePlan } = await import("./lib/wedding-code-research-scene-v10-release-contract.mjs");
    const plan = loadWeddingCodeSceneV10ReleasePlan(repoRoot);
    console.log(`WeddingCode research scene v1.0 contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    // 이 lane의 오류 코드에는 판 이름 숫자(V10)가 들어간다.
    fail(/^[A-Z0-9_]+$/.test(error?.code ?? "") ? error.code : "WEDDING_CODE_SCENE_V10_STATIC_UNCONFIRMED");
  }
}

if (args.has("--wedding-code-research-scene-v09")) {
  if (process.argv.slice(2).length !== 1) fail("WEDDING_CODE_SCENE_VERSION_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadWeddingCodeSceneVersionReleasePlan } = await import("./lib/wedding-code-research-scene-v09-release-contract.mjs");
    const plan = loadWeddingCodeSceneVersionReleasePlan(repoRoot);
    console.log(`WeddingCode research scene v0.9 contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "WEDDING_CODE_SCENE_VERSION_STATIC_UNCONFIRMED");
  }
}

if (args.has("--wedding-code-research-contributions")) {
  if (process.argv.slice(2).length !== 1) fail("WEDDING_CODE_RESEARCH_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadWeddingCodeResearchReleasePlan } = await import("./lib/wedding-code-research-contributions-release-contract.mjs");
    const plan = loadWeddingCodeResearchReleasePlan(repoRoot);
    console.log(`WeddingCode research contributions contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "WEDDING_CODE_RESEARCH_STATIC_UNCONFIRMED");
  }
}

if (args.has("--amora-not-applicable-status")) {
  if (process.argv.slice(2).length !== 1) fail("NOT_APPLICABLE_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadNotApplicableStatusReleasePlan } = await import("./lib/amora-not-applicable-status-release-contract.mjs");
    const plan = loadNotApplicableStatusReleasePlan(repoRoot);
    console.log(`Amora not-applicable status contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "NOT_APPLICABLE_STATIC_UNCONFIRMED");
  }
}

if (args.has("--account-deletion-customer-data")) {
  if (process.argv.slice(2).length !== 1) fail("CUSTOMER_DATA_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadCustomerDataReleasePlan } = await import("./lib/account-deletion-customer-data-release-contract.mjs");
    const plan = loadCustomerDataReleasePlan(repoRoot);
    console.log(`Account deletion customer-data expand contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "CUSTOMER_DATA_STATIC_UNCONFIRMED");
  }
}

if (args.has("--profile-avatar")) {
  if (process.argv.slice(2).length !== 1) fail("PROFILE_AVATAR_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadProfileAvatarReleasePlan } = await import("./lib/profile-avatar-release-contract.mjs");
    const plan = loadProfileAvatarReleasePlan(repoRoot);
    console.log(`Private profile avatar static contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "PROFILE_AVATAR_STATIC_UNCONFIRMED");
  }
}

if (args.has("--profile-wedding-roles")) {
  if (process.argv.slice(2).length !== 1) fail("PROFILE_ROLE_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  try {
    const { loadProfileWeddingRolesReleasePlan } = await import("./lib/profile-wedding-roles-release-contract.mjs");
    const plan = loadProfileWeddingRolesReleasePlan(repoRoot);
    console.log(`Profile wedding roles static contract verified (${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    fail(/^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "PROFILE_ROLE_STATIC_UNCONFIRMED");
  }
}

if (args.has("--chat-feedback-nullability")) {
  if (process.argv.slice(2).length !== 1) {
    fail("CHAT_FEEDBACK_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  }
  try {
    const { loadChatFeedbackNullabilityReleasePlan } = await import("./lib/chat-feedback-nullability-release-contract.mjs");
    const plan = loadChatFeedbackNullabilityReleasePlan(repoRoot);
    console.log(`Chat-feedback nullability static contract verified (${plan.contract.release}; ${plan.migrationCount} exact SQL files; runtime evidence not verified; deployment not authorized; no remote writes).`);
    process.exit(0);
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "CHAT_FEEDBACK_STATIC_UNCONFIRMED";
    fail(code);
  }
}

if (args.has("--amora-explicit-budget-hotfix")) {
  if (process.argv.slice(2).length !== 1) {
    fail("EXPLICIT_BUDGET_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  }
  try {
    const { loadExplicitBudgetHotfixRelease } = await import("./lib/amora-explicit-budget-release-contract.mjs");
    const release = loadExplicitBudgetHotfixRelease(repoRoot);
    console.log(`Explicit-budget static contract verified (${release.hotfix.release}; ${release.migrations.length} pinned migration; hosted evidence not verified; deployment not authorized).`);
    process.exit(0);
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "EXPLICIT_BUDGET_STATIC_UNCONFIRMED";
    fail(code);
  }
}

if (args.has("--amora-budget-decision-hotfix")) {
  if (process.argv.slice(2).length !== 1) {
    fail("BUDGET_DECISION_STATIC_ARGUMENTS_INVALID: only the explicit non-deploy mode is allowed");
  }
  try {
    const { loadEffectiveBudgetDecisionHotfixRelease } = await import("./lib/amora-budget-decision-effective-release-contract.mjs");
    const release = loadEffectiveBudgetDecisionHotfixRelease(repoRoot);
    console.log(`Budget-decision static contract verified (${release.hotfix.release}; ${release.migrations.length} pinned migration; hosted evidence not verified; deployment not authorized).`);
    process.exit(0);
  } catch (error) {
    const code = /^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "BUDGET_DECISION_STATIC_UNCONFIRMED";
    fail(code);
  }
}

let successorContract = null;
if (existsSync(successorManifestPath)) {
  try {
    successorContract = validateSuccessorReleaseContract({ repoRoot });
  } catch (error) {
    if (error instanceof SuccessorReleaseContractError) {
      fail(`${error.code}: ${error.message}`);
    }
    throw error;
  }
}

verifyPredecessorManifest();
verifyStaticManifest({
  migrationCeiling: successorContract?.manifest.migrationFloor ?? null,
});

if (successorContract) {
  console.log(
    `Successor release manifest verified (${successorContract.manifest.release}; ${successorContract.manifest.status}; ${successorContract.migrationCount} migrations; predecessor head ${successorContract.predecessorHead}).`,
  );
  if (successorContract.controllerReady) {
    manifest = successorContract.controllerManifest;
    verifyPredecessorManifest();
    verifyStaticManifest();
    console.log(
      `Controller-ready successor release body verified (${manifest.expandMigrations.length} exact pending migrations; remote head ${manifest.requiredRemoteHead}).`,
    );
  }
}

if (args.has("--refuse-direct-push")) {
  fail("direct push/history-repair entry points are disabled; follow docs/operations/AMORA_ENGINE_V2_PRODUCTION_RELEASE_2026-07-16.md");
}
if (args.has("--remote")) {
  if (successorContract?.deploymentBlocked) {
    fail(
      `successor release ${successorContract.manifest.release} is deployment_blocked until the reviewed controller contract is pinned and fresh private hosted-staging, backup, restore, storage and finalizer evidence is supplied`,
    );
  }
  verifyRemotePending();
}
