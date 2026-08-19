import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CURRENT_PRODUCTION_MIGRATION_COUNT,
  emitVendorDisclosureSuccessorBackupEvidence,
  SUCCESSOR_LOGICAL_BACKUP_VERIFICATION_KIND,
  writeDurableEvidencePair,
} from "../lib/vendor-disclosure-successor-backup-evidence.mjs";
import { successorCreatedPublicTables } from "../lib/supabase-successor-release-contract.mjs";

const RELEASE = "vendor-disclosure-v2-20260718";
const PROJECT_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "a".repeat(40);
const ORIGIN = "https://github.com/Kyu-Sung-Cho/wedding-hanbang-web.git";
const REMOTE_REF = "origin/codex/amora-release-hardening-20260811";
const BASELINE_HEAD = "20260727090000";
const REQUIRED_REMOTE_HEAD = "20260716117000";
const SUCCESSOR_VERSIONS = ["20260730100000", "20260819100000"];
const POSTCHECK_IDS = ["successor-semantic-postcheck"];
const EXPECTED_TABLES = ["chat_messages", "profiles", "vendor_reviews"];
const TABLE_CONTRACT_SHA256 = textListSha256(EXPECTED_TABLES);
const NOW = new Date("2026-08-19T05:30:00.000Z");
const BACKUP_SET_ID = "12345678-1234-4234-8234-123456789abc";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE_CAPTURE_FILE = "scripts/vendor-disclosure-db-current-baseline.ps1";
const BASELINE_DEPENDENCY_FILES = [
  "scripts/vendor-disclosure-db-current-baseline-common.ps1",
  "scripts/amora-db-backup-common.ps1",
];
const BASELINE_VERIFIER_FILE =
  "scripts/vendor-disclosure-db-current-baseline-verify.ps1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

function canonicalJsonSha256(value) {
  const canonical = (candidate) => {
    if (candidate === null || typeof candidate !== "object") {
      return JSON.stringify(candidate);
    }
    if (Array.isArray(candidate)) return `[${candidate.map(canonical).join(",")}]`;
    return `{${Object.keys(candidate).sort().map(
      (key) => `${JSON.stringify(key)}:${canonical(candidate[key])}`,
    ).join(",")}}`;
  };
  return sha256(`${canonical(value)}\n`);
}

function controllerState(implementationPins) {
  const rollbackContract = {
    version: 1,
    strategy: "forward-fix-feature-off",
    migrationRollback: "prohibited",
    featureOffReceiptFileName: `${RELEASE}-feature-off-rollback.json`,
    maximumAgeMinutes: 30,
    requiredControls: { AMORA_OPENAI_ENABLED: "false" },
    requiredChecks: ["databaseWriteFenceHeld"],
  };
  const backupContract = {
    id: `pre-${RELEASE}-current-remote-backup`,
    version: 2,
    format: "hbam2-encrypted-current-user",
    expectedMigrationHead: BASELINE_HEAD,
    expectedTableCount: EXPECTED_TABLES.length,
    expectedTables: [...EXPECTED_TABLES],
    expectedTableContractSha256: TABLE_CONTRACT_SHA256,
    expectedCommitBinding: "release-expected-commit",
    expectedOrigin: ORIGIN,
    capture: implementationPins.capture,
    dependencies: implementationPins.dependencies,
    verifier: implementationPins.verifier,
    providerPhysicalBackup: {
      maximumAgeHours: 26,
      requiredStatus: "COMPLETED",
      requirePhysicalBackup: true,
      restoreCapability: "completed-physical-backup",
    },
    supabaseCli: {
      version: "2.106.0",
      binarySha256: "B".repeat(64),
    },
    requiredReceiptValues: {
      Verified: true,
      SourceCanonicalDigestsVerified: true,
      PGliteJsonbRoundTripVerified: true,
      PlaintextWrittenToDisk: false,
    },
  };
  const manifest = {
    release: RELEASE,
    projectRef: PROJECT_REF,
    status: "controller_ready",
    requiredRemoteHead: REQUIRED_REMOTE_HEAD,
    expandMigrations: SUCCESSOR_VERSIONS.map((version) => ({
      file: `${version}_fixture.sql`,
      sha256: "c".repeat(64),
    })),
    deploymentEvidence: {
      backup: {
        kind: "successor-release-backup-evidence-v1",
        maximumAgeMinutes: 30,
        rawEvidenceFileName: `${RELEASE}-backup-raw.json`,
        rawEvidenceSource: "verified-encrypted-database-backup",
        receiptFileName: `${RELEASE}-backup-evidence.json`,
        requiredChecks: [
          "databaseBackupVerified",
          "encryptedArtifactsVerified",
          "exactBaselineTableContractVerified",
          "providerPhysicalBackupAvailable",
          "restoreCandidateAvailable",
        ],
      },
    },
  };
  return {
    controllerReady: true,
    manifest,
    controllerManifest: {
      ...manifest,
      backupContract,
      postApplyChecks: POSTCHECK_IDS.map((id) => ({ id })),
      rollbackContract,
    },
    remoteBaseline: {
      observedRemoteHead: BASELINE_HEAD,
    },
  };
}

function logicalVerification(verifierSha256, overrides = {}) {
  return {
    ReceiptVersion: 1,
    Kind: SUCCESSOR_LOGICAL_BACKUP_VERIFICATION_KIND,
    Verified: true,
    Release: RELEASE,
    ProjectRef: PROJECT_REF,
    GitCommit: COMMIT,
    GitOrigin: ORIGIN,
    BackupContractId: `pre-${RELEASE}-current-remote-backup`,
    BackupContractVersion: 2,
    BackupSetId: BACKUP_SET_ID,
    ManifestSha256: "d".repeat(64),
    SourceCapturedAt: "2026-08-19T05:20:00.000Z",
    VerifiedAtUtc: "2026-08-19T05:25:00.000Z",
    SourceMigrationHead: BASELINE_HEAD,
    SourceMigrationCount: CURRENT_PRODUCTION_MIGRATION_COUNT,
    TableCount: EXPECTED_TABLES.length,
    ExpectedTables: [...EXPECTED_TABLES],
    TableContractSha256: TABLE_CONTRACT_SHA256,
    InventorySha256: "e".repeat(64),
    LiveSchemaContractSha256: "f".repeat(64),
    LogicalDataContractSha256: "1".repeat(64),
    AuthSchemaContractSha256: "6".repeat(64),
    AuthUsersCanonicalSha256: "7".repeat(64),
    AuthUsersContractSha256: "8".repeat(64),
    EncryptedArtifacts: {
      LogicalDataCiphertextSha256: "2".repeat(64),
      LogicalDataProtectedKeySha256: "3".repeat(64),
      SchemaInventoryCiphertextSha256: "4".repeat(64),
      SchemaInventoryProtectedKeySha256: "5".repeat(64),
    },
    SupabaseCli: {
      Version: "2.106.0",
      BinarySha256: "B".repeat(64),
    },
    Verifier: {
      File: "scripts/vendor-disclosure-db-current-baseline-verify.ps1",
      Sha256: verifierSha256,
    },
    EncryptedArtifactsVerified: true,
    SourceCanonicalDigestsVerified: true,
    PGliteJsonbRoundTripVerified: true,
    PlaintextWrittenToDisk: false,
    ContainsSecrets: false,
    ...overrides,
  };
}

function commandRunner({ dirty = false, remoteCommit = COMMIT } = {}) {
  return async (_command, args) => {
    const key = args.join(" ");
    if (key === "status --porcelain=v1 --untracked-files=all") {
      return { status: 0, stdout: dirty ? "?? private.txt\n" : "", stderr: "" };
    }
    if (key === "rev-parse HEAD") return { status: 0, stdout: `${COMMIT}\n`, stderr: "" };
    if (key === "remote get-url origin") return { status: 0, stdout: `${ORIGIN}\n`, stderr: "" };
    if (key === "ls-remote --exit-code origin refs/heads/codex/amora-release-hardening-20260811") {
      return {
        status: 0,
        stdout: `${remoteCommit}\trefs/heads/codex/amora-release-hardening-20260811\n`,
        stderr: "",
      };
    }
    return { status: 1, stdout: "", stderr: "unexpected command" };
  };
}

function providerResponse({ insertedAt = "2026-08-19T05:00:00.000Z" } = {}) {
  return new Response(JSON.stringify({
    backups: [{
      is_physical_backup: true,
      status: "COMPLETED",
      inserted_at: insertedAt,
      database_password: "must-not-leak",
    }],
    physical_backup_data: {
      latest_physical_backup_date_unix: Math.floor(Date.parse(insertedAt) / 1000),
    },
    access_token: "must-not-leak",
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function dotNetGuidBytes(value) {
  const [data1, data2, data3, data4, data5] = value.split("-");
  const byte = (pair) => Number.parseInt(pair, 16);
  return Buffer.from([
    byte(data1.slice(6, 8)), byte(data1.slice(4, 6)),
    byte(data1.slice(2, 4)), byte(data1.slice(0, 2)),
    byte(data2.slice(2, 4)), byte(data2.slice(0, 2)),
    byte(data3.slice(2, 4)), byte(data3.slice(0, 2)),
    byte(data4.slice(0, 2)), byte(data4.slice(2, 4)),
    byte(data5.slice(0, 2)), byte(data5.slice(2, 4)),
    byte(data5.slice(4, 6)), byte(data5.slice(6, 8)),
    byte(data5.slice(8, 10)), byte(data5.slice(10, 12)),
  ]);
}

function hbam2Envelope(plaintextLength, fill) {
  const paddedLength = (Math.floor(plaintextLength / 16) + 1) * 16;
  const bytes = Buffer.alloc(46 + paddedLength + 32, fill);
  Buffer.from("HBAM2", "ascii").copy(bytes, 0);
  bytes[5] = 2;
  dotNetGuidBytes(BACKUP_SET_ID).copy(bytes, 6);
  Buffer.alloc(16, fill + 1).copy(bytes, 22);
  bytes.writeBigInt64LE(BigInt(plaintextLength), 38);
  return bytes;
}

function artifactMetadata(artifactName, plaintextLength, ciphertext, key) {
  return {
    backup_set_id: BACKUP_SET_ID,
    artifact: `${artifactName}.hbam2`,
    key: `${artifactName}.key.dpapi`,
    plaintext_sha256: sha256(Buffer.alloc(plaintextLength, 7)).toUpperCase(),
    encrypted_sha256: sha256(ciphertext).toUpperCase(),
    key_sha256: sha256(key).toUpperCase(),
    plaintext_bytes: plaintextLength,
    encrypted_bytes: ciphertext.length,
  };
}

async function createFixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "successor-backup-repo-"));
  const receiptRoot = await mkdtemp(join(tmpdir(), "successor-backup-receipts-"));
  const inputRoot = await mkdtemp(join(tmpdir(), "successor-backup-input-"));
  const implementationTexts = new Map([
    [BASELINE_CAPTURE_FILE, "# successor current-baseline capture fixture\n"],
    [BASELINE_DEPENDENCY_FILES[0], "# successor current-baseline common fixture\n"],
    [BASELINE_DEPENDENCY_FILES[1], "# shared HBAM2 backup common fixture\n"],
    [BASELINE_VERIFIER_FILE, "# successor verifier fixture\n"],
  ]);
  const implementationPins = {
    capture: {
      file: BASELINE_CAPTURE_FILE,
      sha256: sha256(implementationTexts.get(BASELINE_CAPTURE_FILE)),
    },
    dependencies: BASELINE_DEPENDENCY_FILES.map((file) => ({
      file,
      sha256: sha256(implementationTexts.get(file)),
    })),
    verifier: {
      file: BASELINE_VERIFIER_FILE,
      sha256: sha256(implementationTexts.get(BASELINE_VERIFIER_FILE)),
    },
  };
  const implementationDigests = Object.fromEntries(
    [
      implementationPins.capture,
      ...implementationPins.dependencies,
      implementationPins.verifier,
    ].map(({ file, sha256: digest }) => [file, digest]),
  );
  const verifierSha256 = implementationPins.verifier.sha256;
  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await Promise.all([...implementationTexts].map(([file, text]) =>
    writeFile(join(repoRoot, file), text, "utf8")));
  const logicalBackupDirectory = join(inputRoot, "20260819-052100");
  await mkdir(logicalBackupDirectory);
  const logicalData = hbam2Envelope(17, 21);
  const logicalKey = Buffer.alloc(64, 31);
  const schemaInventory = hbam2Envelope(33, 41);
  const schemaKey = Buffer.alloc(64, 51);
  const logicalMetadata = artifactMetadata(
    "logical-data.json",
    17,
    logicalData,
    logicalKey,
  );
  const schemaMetadata = artifactMetadata(
    "schema-inventory.json",
    33,
    schemaInventory,
    schemaKey,
  );
  const sourceDatabaseIdentity = {
    system_identifier: "1234567890123456789",
    database_name: "postgres",
    database_oid: "16384",
    server_version_num: "170005",
  };
  const manifest = {
    status: "complete",
    format: "HBAM2-AES-256-CBC-HMAC-SHA256-DPAPI-CurrentUser",
    format_version: 2,
    backup_type: "vendor-disclosure-successor-current-production-logical-snapshot",
    backup_set_id: BACKUP_SET_ID,
    release: RELEASE,
    backup_contract_id: `pre-${RELEASE}-current-remote-backup`,
    backup_contract_version: 2,
    created_at_utc: "2026-08-19T05:21:00.000Z",
    preflight_captured_at: "2026-08-19T05:19:00.000Z",
    inventory_before_captured_at: "2026-08-19T05:19:30.000Z",
    source_captured_at: "2026-08-19T05:20:00.000Z",
    inventory_after_captured_at: "2026-08-19T05:20:30.000Z",
    source_project_ref: PROJECT_REF,
    source_project_ref_sha256: sha256(PROJECT_REF),
    source_database_identity: sourceDatabaseIdentity,
    source_database_identity_sha256: canonicalJsonSha256(sourceDatabaseIdentity),
    source_current_user: "postgres",
    source_session_user: "postgres",
    source_role_bypasses_rls: true,
    source_row_security: "off",
    source_migration_head: BASELINE_HEAD,
    source_migration_count: CURRENT_PRODUCTION_MIGRATION_COUNT,
    source_migration_versions_sha256:
      "0ee207d75d2bd30e1a68d1f6d2f710f220cdd3dd8e1f681f9d2fa332852a0c23",
    expected_tables: [...EXPECTED_TABLES],
    table_count: EXPECTED_TABLES.length,
    table_contract_sha256: TABLE_CONTRACT_SHA256,
    inventory_contract_sha256: "e".repeat(64),
    source_relation_contract_sha256: "6".repeat(64),
    live_schema_contract_sha256: "f".repeat(64),
    logical_data_contract_sha256: "1".repeat(64),
    auth_schema_contract_sha256: "6".repeat(64),
    auth_users_canonical_sha256: "7".repeat(64),
    auth_users_contract_sha256: "8".repeat(64),
    auth_users_row_count: 2,
    git_commit: COMMIT,
    git_origin: ORIGIN,
    git_remote_ref: REMOTE_REF,
    implementation: {
      git_commit: COMMIT,
      files: { ...implementationDigests },
      git_blobs: { ...implementationDigests },
    },
    supabase_cli: {
      version: "2.106.0",
      files: { "supabase.exe": "B".repeat(64) },
    },
    verifier_runtime: { kind: "fixture" },
    verifier: {
      file: "scripts/vendor-disclosure-db-current-baseline-verify.ps1",
      sha256: verifierSha256,
    },
    source_fence: "exact-linked-production-ref-plus-clean-pushed-commit-plus-pinned-cli",
    consistency: "logical-data-single-statement-schema-before-after-fenced",
    query_timeout_seconds: 120,
    plaintext_written_to_disk: false,
    contains_secrets: false,
    key_scope: "Windows DPAPI CurrentUser on the creating computer",
    preflight: { estimated_total_bytes: 0, estimated_total_rows: 0 },
    tables: Object.fromEntries(EXPECTED_TABLES.map((table) => [table, 0])),
    artifacts: {
      schema_inventory: schemaMetadata,
      logical_data: logicalMetadata,
    },
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await Promise.all([
    writeFile(join(logicalBackupDirectory, "logical-data.json.hbam2"), logicalData),
    writeFile(join(logicalBackupDirectory, "logical-data.json.key.dpapi"), logicalKey),
    writeFile(join(logicalBackupDirectory, "schema-inventory.json.hbam2"), schemaInventory),
    writeFile(join(logicalBackupDirectory, "schema-inventory.json.key.dpapi"), schemaKey),
    writeFile(join(logicalBackupDirectory, "manifest.json"), manifestText, "utf8"),
  ]);
  const logicalBackupVerificationPath = join(
    inputRoot,
    `${BACKUP_SET_ID}-successor-logical-verification.json`,
  );
  await writeFile(
    logicalBackupVerificationPath,
    `${JSON.stringify(logicalVerification(verifierSha256, {
      ManifestSha256: sha256(manifestText),
      EncryptedArtifacts: {
        LogicalDataCiphertextSha256: sha256(logicalData),
        LogicalDataProtectedKeySha256: sha256(logicalKey),
        SchemaInventoryCiphertextSha256: sha256(schemaInventory),
        SchemaInventoryProtectedKeySha256: sha256(schemaKey),
      },
    }), null, 2)}\n`,
    "utf8",
  );
  return {
    repoRoot,
    receiptRoot,
    inputRoot,
    logicalBackupDirectory,
    verifierSha256,
    logicalBackupVerificationPath,
    implementationPins,
    state: controllerState(implementationPins),
  };
}

async function cleanup(fixture) {
  await Promise.all([
    rm(fixture.repoRoot, { recursive: true, force: true }),
    rm(fixture.receiptRoot, { recursive: true, force: true }),
    rm(fixture.inputRoot, { recursive: true, force: true }),
  ]);
}

test("pins the observed Production baseline at 147 migrations and 60 exact tables", async () => {
  const predecessor = JSON.parse(await readFile(
    join(REPO_ROOT, "supabase/release-manifests/amora-engine-v2-20260716.json"),
    "utf8",
  ));
  const baseline = JSON.parse(await readFile(
    join(
      REPO_ROOT,
      "supabase/release-contracts/vendor-disclosure-production-baseline-v1-20260815.json",
    ),
    "utf8",
  ));
  const remoteMigrations = (await readdir(join(REPO_ROOT, "supabase/migrations")))
    .filter((name) => /^\d{14}_[a-z0-9_.-]+\.sql$/.test(name))
    .filter((name) => name.slice(0, 14) <= baseline.observedRemoteHead)
    .sort();
  const tables = [...new Set([
    ...predecessor.postExpandBackupContract.expectedTables,
    ...successorCreatedPublicTables(REPO_ROOT, baseline.appliedSuccessorMigrations),
  ])].sort();

  assert.equal(baseline.projectRef, PROJECT_REF);
  assert.equal(baseline.observedRemoteHead, BASELINE_HEAD);
  assert.equal(remoteMigrations.length, CURRENT_PRODUCTION_MIGRATION_COUNT);
  assert.equal(remoteMigrations.at(-1).slice(0, 14), BASELINE_HEAD);
  assert.equal(tables.length, 60);
  assert.equal(
    textListSha256(tables),
    "d6494b9dfbebdea7f82535f81825e2698d5e0296a34ca935da382f91f5dae35f",
  );
});

test("emits exact private successor backup raw provenance and runtime receipt", async () => {
  const fixture = await createFixture();
  const accessToken = "supabase-management-token-must-not-leak";
  try {
    const result = await emitVendorDisclosureSuccessorBackupEvidence({
      repoRoot: fixture.repoRoot,
      receiptRoot: fixture.receiptRoot,
      expectedCommit: COMMIT,
      remoteRef: REMOTE_REF,
      logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
      logicalBackupDirectory: fixture.logicalBackupDirectory,
      env: { SUPABASE_ACCESS_TOKEN: accessToken },
      fetchImpl: async (url, options) => {
        assert.equal(
          String(url),
          `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/backups`,
        );
        assert.equal(options.method, "GET");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, `Bearer ${accessToken}`);
        return providerResponse();
      },
      now: () => NOW,
      runCommand: commandRunner(),
      releaseLoader: () => fixture.state,
    });

    assert.equal(result.status, "successor_backup_evidence_emitted");
    const rawText = await readFile(
      join(fixture.receiptRoot, `${RELEASE}-backup-raw.json`),
      "utf8",
    );
    const receiptText = await readFile(
      join(fixture.receiptRoot, `${RELEASE}-backup-evidence.json`),
      "utf8",
    );
    assert.doesNotMatch(`${rawText}${receiptText}${JSON.stringify(result)}`, /must-not-leak/);

    const raw = JSON.parse(rawText);
    assert.deepEqual(Object.keys(raw).sort(), [
      "capturedAt",
      "containsSecrets",
      "kind",
      "logicalBackup",
      "projectRef",
      "providerPhysicalBackup",
      "rawEvidenceVersion",
      "release",
      "releaseCommit",
    ].sort());
    assert.equal(raw.logicalBackup.sourceMigrationHead, BASELINE_HEAD);
    assert.equal(raw.logicalBackup.sourceMigrationCount, CURRENT_PRODUCTION_MIGRATION_COUNT);
    assert.deepEqual(raw.logicalBackup.expectedTables, EXPECTED_TABLES);
    assert.equal(raw.logicalBackup.authSchemaContractSha256, "6".repeat(64));
    assert.equal(raw.logicalBackup.authUsersCanonicalSha256, "7".repeat(64));
    assert.equal(raw.logicalBackup.authUsersContractSha256, "8".repeat(64));
    assert.equal(raw.providerPhysicalBackup.restoreCandidateAvailable, true);
    assert.match(raw.providerPhysicalBackup.responseSha256, /^[a-f0-9]{64}$/);
    assert.ok(raw.providerPhysicalBackup.responseBytes > 2);
    assert.equal(raw.providerPhysicalBackup.responseStatusCode, 200);
    assert.equal(raw.containsSecrets, false);

    const receipt = JSON.parse(receiptText);
    assert.deepEqual(Object.keys(receipt).sort(), [
      "capturedAt",
      "checks",
      "containsSecrets",
      "expectedMigrationHead",
      "expiresAt",
      "kind",
      "migrationCount",
      "migrationVersionsSha256",
      "observations",
      "postApplyCheckIds",
      "postApplyChecksSha256",
      "projectRef",
      "rawProvenance",
      "receiptVersion",
      "release",
      "releaseCommit",
      "requiredRemoteHead",
      "rollbackContractSha256",
    ].sort());
    assert.deepEqual(receipt.observations, {
      backupContractId: `pre-${RELEASE}-current-remote-backup`,
      backupContractVersion: 2,
      expectedMigrationHead: BASELINE_HEAD,
      expectedTableContractSha256: TABLE_CONTRACT_SHA256,
      expectedTableCount: EXPECTED_TABLES.length,
      providerPhysicalBackupStatus: "COMPLETED",
      restoreCandidateAvailable: true,
    });
    assert.equal(receipt.expectedMigrationHead, SUCCESSOR_VERSIONS.at(-1));
    assert.equal(receipt.migrationCount, SUCCESSOR_VERSIONS.length);
    assert.equal(receipt.migrationVersionsSha256, textListSha256(SUCCESSOR_VERSIONS));
    assert.equal(receipt.postApplyChecksSha256, textListSha256(POSTCHECK_IDS));
    assert.equal(
      receipt.rollbackContractSha256,
      canonicalJsonSha256(fixture.state.controllerManifest.rollbackContract),
    );
    assert.equal(receipt.rawProvenance.sha256, sha256(rawText));
    assert.equal(receipt.containsSecrets, false);
  } finally {
    await cleanup(fixture);
  }
});

test("rejects the predecessor 14-table backup instead of relabeling it as current baseline", async () => {
  const fixture = await createFixture();
  const predecessorTables = Array.from({ length: 14 }, (_, index) => `legacy_table_${index}`);
  await writeFile(
    fixture.logicalBackupVerificationPath,
    `${JSON.stringify(logicalVerification(fixture.verifierSha256, {
      SourceMigrationHead: "20260715210000",
      SourceMigrationCount: 115,
      TableCount: predecessorTables.length,
      ExpectedTables: predecessorTables,
      TableContractSha256: textListSha256(predecessorTables),
    }), null, 2)}\n`,
    "utf8",
  );
  try {
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => providerResponse(),
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_LOGICAL_VERIFICATION_INVALID",
    );
    await assert.rejects(
      readFile(join(fixture.receiptRoot, `${RELEASE}-backup-raw.json`)),
      /ENOENT/,
    );
    await assert.rejects(
      readFile(join(fixture.receiptRoot, `${RELEASE}-backup-evidence.json`)),
      /ENOENT/,
    );
  } finally {
    await cleanup(fixture);
  }
});

test("verification JSON cannot self-attest without reopening the exact encrypted artifact set", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.inputRoot,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => providerResponse(),
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
    );
    assert.deepEqual(await readdir(fixture.receiptRoot), []);
  } finally {
    await cleanup(fixture);
  }
});

test("reopens and rejects a ciphertext changed after the verification receipt was written", async () => {
  const fixture = await createFixture();
  let fetched = false;
  try {
    const path = join(fixture.logicalBackupDirectory, "logical-data.json.hbam2");
    const changed = await readFile(path);
    changed[46] ^= 0xff;
    await writeFile(path, changed);
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => {
          fetched = true;
          return providerResponse();
        },
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
    );
    assert.equal(fetched, false);
    assert.deepEqual(await readdir(fixture.receiptRoot), []);
  } finally {
    await cleanup(fixture);
  }
});

test("rejects manifest schema expansion even when its new hash is copied into the receipt", async () => {
  const fixture = await createFixture();
  try {
    const manifestPath = join(fixture.logicalBackupDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.database_password = "must-not-be-trusted";
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestText, "utf8");
    const receipt = JSON.parse(await readFile(fixture.logicalBackupVerificationPath, "utf8"));
    receipt.ManifestSha256 = sha256(manifestText);
    await writeFile(
      fixture.logicalBackupVerificationPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => providerResponse(),
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
    );
    assert.deepEqual(await readdir(fixture.receiptRoot), []);
  } finally {
    await cleanup(fixture);
  }
});

test("rejects backup provenance that does not bind the pinned capture dependency chain", async () => {
  const fixture = await createFixture();
  let fetched = false;
  try {
    const manifestPath = join(fixture.logicalBackupDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.implementation.git_blobs[BASELINE_DEPENDENCY_FILES[1]] = "0".repeat(64);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, manifestText, "utf8");
    const receipt = JSON.parse(await readFile(fixture.logicalBackupVerificationPath, "utf8"));
    receipt.ManifestSha256 = sha256(manifestText);
    await writeFile(
      fixture.logicalBackupVerificationPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );

    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => {
          fetched = true;
          return providerResponse();
        },
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
    );
    assert.equal(fetched, false);
  } finally {
    await cleanup(fixture);
  }
});

test("rejects a duplicate manifest key that hides secret text before the parsed value", async () => {
  const fixture = await createFixture();
  try {
    const manifestPath = join(fixture.logicalBackupDirectory, "manifest.json");
    const original = await readFile(manifestPath, "utf8");
    const manifestText = original.replace(
      "{",
      `{"source_project_ref":"sb_secret_duplicate-must-not-be-trusted",`,
    );
    await writeFile(manifestPath, manifestText, "utf8");
    const receipt = JSON.parse(await readFile(fixture.logicalBackupVerificationPath, "utf8"));
    receipt.ManifestSha256 = sha256(manifestText);
    await writeFile(
      fixture.logicalBackupVerificationPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => providerResponse(),
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_ARTIFACT_INVALID",
    );
    assert.deepEqual(await readdir(fixture.receiptRoot), []);
  } finally {
    await cleanup(fixture);
  }
});

test("requires a completely clean checkout at the exact pushed commit", async () => {
  for (const scenario of [
    {
      runner: commandRunner({ dirty: true }),
      code: "SUCCESSOR_BACKUP_WORKTREE_DIRTY",
    },
    {
      runner: commandRunner({ remoteCommit: "9".repeat(40) }),
      code: "SUCCESSOR_BACKUP_REMOTE_COMMIT_MISMATCH",
    },
  ]) {
    const fixture = await createFixture();
    let fetched = false;
    try {
      await assert.rejects(
        emitVendorDisclosureSuccessorBackupEvidence({
          repoRoot: fixture.repoRoot,
          receiptRoot: fixture.receiptRoot,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
          logicalBackupDirectory: fixture.logicalBackupDirectory,
          env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
          fetchImpl: async () => {
            fetched = true;
            return providerResponse();
          },
          now: () => NOW,
          runCommand: scenario.runner,
          releaseLoader: () => fixture.state,
        }),
        (error) => error?.code === scenario.code,
      );
      assert.equal(fetched, false);
    } finally {
      await cleanup(fixture);
    }
  }
});

test("fails closed when the provider has no fresh completed physical restore candidate", async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => providerResponse({
          insertedAt: "2026-08-17T00:00:00.000Z",
        }),
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_PROVIDER_EVIDENCE_INVALID",
    );
    await assert.rejects(
      readFile(join(fixture.receiptRoot, `${RELEASE}-backup-raw.json`)),
      /ENOENT/,
    );
  } finally {
    await cleanup(fixture);
  }
});

function boundedProviderStream({ contentLength, chunks }) {
  const state = { bodyCancelled: 0, readerCancelled: 0, reads: 0, textCalls: 0 };
  const reader = {
    async read() {
      const value = chunks[state.reads];
      state.reads += 1;
      return value ? { done: false, value } : { done: true, value: undefined };
    },
    async cancel() { state.readerCancelled += 1; },
    releaseLock() {},
  };
  const headers = new Headers();
  if (contentLength !== undefined) headers.set("content-length", String(contentLength));
  return {
    state,
    response: {
      status: 200,
      headers,
      body: {
        getReader() { return reader; },
        async cancel() { state.bodyCancelled += 1; },
      },
      async text() {
        state.textCalls += 1;
        return " ".repeat(300 * 1024);
      },
    },
  };
}

test("rejects oversized provider Content-Length before reading and cancels the body", async () => {
  const fixture = await createFixture();
  const streamed = boundedProviderStream({
    contentLength: 256 * 1024 + 1,
    chunks: [new Uint8Array([123, 125])],
  });
  try {
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => streamed.response,
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_PROVIDER_EVIDENCE_INVALID",
    );
    assert.equal(streamed.state.reads, 0);
    assert.equal(streamed.state.textCalls, 0);
    assert.equal(streamed.state.bodyCancelled, 1);
    assert.deepEqual(await readdir(fixture.receiptRoot), []);
  } finally {
    await cleanup(fixture);
  }
});

test("enforces a hard 256 KiB cap on chunked provider bodies and cancels the reader", async () => {
  const fixture = await createFixture();
  const streamed = boundedProviderStream({
    chunks: Array.from({ length: 5 }, () => new Uint8Array(70 * 1024).fill(32)),
  });
  try {
    await assert.rejects(
      emitVendorDisclosureSuccessorBackupEvidence({
        repoRoot: fixture.repoRoot,
        receiptRoot: fixture.receiptRoot,
        expectedCommit: COMMIT,
        remoteRef: REMOTE_REF,
        logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
        logicalBackupDirectory: fixture.logicalBackupDirectory,
        env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
        fetchImpl: async () => streamed.response,
        now: () => NOW,
        runCommand: commandRunner(),
        releaseLoader: () => fixture.state,
      }),
      (error) => error?.code === "SUCCESSOR_BACKUP_PROVIDER_EVIDENCE_INVALID",
    );
    assert.equal(streamed.state.reads, 4);
    assert.equal(streamed.state.textCalls, 0);
    assert.equal(streamed.state.readerCancelled, 1);
    assert.deepEqual(await readdir(fixture.receiptRoot), []);
  } finally {
    await cleanup(fixture);
  }
});

function durabilityHarness({ failReceiptSync = false } = {}) {
  const events = [];
  const owned = new Set();
  return {
    events,
    owned,
    io: {
      async open(path, flags, mode) {
        events.push(["open", path, flags, mode]);
        if (flags === "wx") {
          if (owned.has(path)) throw new Error("collision");
          owned.add(path);
          return {
            async writeFile(text, encoding) { events.push(["write", path, text, encoding]); },
            async sync() {
              events.push(["sync-file", path]);
              if (failReceiptSync && path.endsWith("receipt.json")) {
                throw new Error("receipt sync failed");
              }
            },
            async close() { events.push(["close-file", path]); },
          };
        }
        return {
          async sync() { events.push(["sync-parent", path]); },
          async close() { events.push(["close-parent", path]); },
        };
      },
      async unlink(path) {
        events.push(["unlink", path]);
        owned.delete(path);
      },
    },
  };
}

test("durably creates both evidence files and fsyncs their POSIX parent", async () => {
  const harness = durabilityHarness();
  const root = resolve("C:\\external-successor-backup-evidence");
  const rawPath = join(root, "raw.json");
  const receiptPath = join(root, "receipt.json");
  await writeDurableEvidencePair({
    rawPath,
    rawText: "raw\n",
    receiptPath,
    receiptText: "receipt\n",
    platform: "linux",
    io: harness.io,
  });
  assert.deepEqual([...harness.owned].sort(), [rawPath, receiptPath].sort());
  assert.deepEqual(
    harness.events.filter(([event]) => event === "sync-file").map(([, path]) => path),
    [rawPath, receiptPath],
  );
  assert.deepEqual(
    harness.events.filter(([event]) => event === "sync-parent"),
    [["sync-parent", root]],
  );
});

test("durable write failure removes every file inode created by this attempt", async () => {
  const harness = durabilityHarness({ failReceiptSync: true });
  const root = resolve("C:\\external-successor-backup-evidence-failure");
  const rawPath = join(root, "raw.json");
  const receiptPath = join(root, "receipt.json");
  await assert.rejects(
    writeDurableEvidencePair({
      rawPath,
      rawText: "raw\n",
      receiptPath,
      receiptText: "receipt\n",
      platform: "linux",
      io: harness.io,
    }),
  );
  assert.deepEqual([...harness.owned], []);
  assert.deepEqual(
    harness.events.filter(([event]) => event === "unlink").map(([, path]) => path),
    [receiptPath, rawPath],
  );
  assert.equal(
    harness.events.filter(([event]) => event === "sync-parent").length,
    1,
  );
});

test("rejects drift in the manifest-pinned capture and both dot-sourced dependencies", async () => {
  for (const file of [BASELINE_CAPTURE_FILE, ...BASELINE_DEPENDENCY_FILES]) {
    const fixture = await createFixture();
    try {
      await writeFile(join(fixture.repoRoot, file), "# altered backup implementation\n", "utf8");
      await assert.rejects(
        emitVendorDisclosureSuccessorBackupEvidence({
          repoRoot: fixture.repoRoot,
          receiptRoot: fixture.receiptRoot,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
          logicalBackupDirectory: fixture.logicalBackupDirectory,
          env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
          fetchImpl: async () => providerResponse(),
          now: () => NOW,
          runCommand: commandRunner(),
          releaseLoader: () => fixture.state,
        }),
        (error) => error?.code === "SUCCESSOR_BACKUP_IMPLEMENTATION_INVALID",
      );
    } finally {
      await cleanup(fixture);
    }
  }
});

test("rejects unpinned verifier drift and non-canonical logical receipt fields", async () => {
  for (const scenario of ["verifier-drift", "extra-secret-field", "invalid-auth-digest"]) {
    const fixture = await createFixture();
    try {
      if (scenario === "verifier-drift") {
        await writeFile(
          join(
            fixture.repoRoot,
            "scripts",
            "vendor-disclosure-db-current-baseline-verify.ps1",
          ),
          "# altered verifier\n",
          "utf8",
        );
      } else if (scenario === "extra-secret-field") {
        await writeFile(
          fixture.logicalBackupVerificationPath,
          `${JSON.stringify({
            ...logicalVerification(fixture.verifierSha256),
            SupabaseAccessToken: "must-never-be-accepted",
          }, null, 2)}\n`,
          "utf8",
        );
      } else {
        await writeFile(
          fixture.logicalBackupVerificationPath,
          `${JSON.stringify({
            ...logicalVerification(fixture.verifierSha256),
            AuthUsersContractSha256: "not-a-digest",
          }, null, 2)}\n`,
          "utf8",
        );
      }
      await assert.rejects(
        emitVendorDisclosureSuccessorBackupEvidence({
          repoRoot: fixture.repoRoot,
          receiptRoot: fixture.receiptRoot,
          expectedCommit: COMMIT,
          remoteRef: REMOTE_REF,
          logicalBackupVerificationPath: fixture.logicalBackupVerificationPath,
          logicalBackupDirectory: fixture.logicalBackupDirectory,
          env: { SUPABASE_ACCESS_TOKEN: "private-management-token-for-test" },
          fetchImpl: async () => providerResponse(),
          now: () => NOW,
          runCommand: commandRunner(),
          releaseLoader: () => fixture.state,
        }),
        (error) => error?.code === (scenario === "verifier-drift"
          ? "SUCCESSOR_BACKUP_VERIFIER_INVALID"
          : "SUCCESSOR_BACKUP_LOGICAL_VERIFICATION_INVALID"),
      );
    } finally {
      await cleanup(fixture);
    }
  }
});

test("CLI refuses incomplete invocations without echoing environment secrets", () => {
  const secret = "cli-secret-must-not-leak";
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../vendor-disclosure-successor-backup-evidence.mjs", import.meta.url))],
    {
      encoding: "utf8",
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: secret },
      windowsHide: true,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr.replace(/\r\n/g, "\n"), "SUCCESSOR_BACKUP_ARGUMENT_INVALID\n");
  assert.doesNotMatch(result.stderr, new RegExp(secret));
});
