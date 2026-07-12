import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPROVED_CRON_CONTRACT,
  RecoveryError,
  approvedCronRecoveryContractMetadata,
  assertApprovedCronContract,
  assertApprovedNonProductionSource,
  assertApprovedCronRecoveryManifest,
  assertApprovedCronSnapshotsStable,
  assertDatabaseSnapshotStable,
  assertPrivateManifestArchiveCoverage,
  assertProductionExportAllowed,
  assertPublicPrivateManifestConsistency,
  assertRestoreTargetAllowed,
  assertRestoreCompletionEvidence,
  assertSafeStagingRoot,
  assertSafeSupabaseArgs,
  assertStorageManifestCoverage,
  buildMinimalChildEnv,
  buildApprovedCronActivationSql,
  buildApprovedCronReplaySql,
  buildRestorePlan,
  bindRestoreEvidence,
  canonicalizePgDumpForComparison,
  containsCredentialMaterial,
  createRestoreEvidenceIdentity,
  exportStorageObjects,
  extractQueryRows,
  parseCopyTableDigests,
  parseStorageConcurrency,
  redactSecrets,
  removeRecoveryPathVerified,
  restoreVerifyReadiness,
  resolvePinnedSupabaseBinary,
  resolveRecoveryTools,
  runBoundedRedacted,
  stableInventoryDigest,
  validateVerboseTarListing,
  verifyApprovedCronRecoveryArtifact,
  verifyPrivateManifestArtifactDigests,
  verifyPinnedSupabaseInstallation,
} from "./supabase-recovery-safe.mjs";

const PRODUCTION_REF = "p".repeat(20);
const SOURCE_REF = "s".repeat(20);
const RESTORE_REF = "r".repeat(20);
const ARTIFACT_ID = "11111111-1111-4111-8111-111111111111";
const RESTORE_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const BLOCKED_AUTHENTICITY = Object.freeze({
  contract: "age-sender-signature-external-immutable-anchor-v1",
  status: "blocked-key-custody-and-immutable-anchor-not-approved",
  senderSignatureVerified: false,
  externalImmutableAnchorVerified: false,
});

function cronArchiveEvidence(overrides = {}) {
  const metadata = approvedCronRecoveryContractMetadata();
  return {
    ok: true,
    archiveIntegrityVerified: true,
    artifactId: ARTIFACT_ID,
    archiveSha256: "a".repeat(64),
    sourceProjectRef: SOURCE_REF,
    sourceGitSha: "b".repeat(40),
    sourceCompletedAt: "2026-07-12T01:00:00.000Z",
    databaseSnapshotSha256: "c".repeat(64),
    storageMetadataSha256: "d".repeat(64),
    storageObjectCount: 2,
    storageTotalBytes: 10,
    cronContractVerified: true,
    cronContractVersion: metadata.contractVersion,
    cronContractSha256: metadata.contractSha256,
    cronJobCount: metadata.jobCount,
    cronReplayStrategy: metadata.replayStrategy,
    cronReplaySqlSha256: metadata.replaySqlSha256,
    cronPreActivationLauncherState: metadata.preActivationLauncherState,
    cronPostActivationLauncherState: metadata.postActivationLauncherState,
    cronPreActivationRunningJobCount: metadata.preActivationRunningJobCount,
    cronReplayedJobsActive: metadata.replayedJobsActive,
    cronTargetDatabaseBinding: metadata.targetDatabaseBinding,
    cronSchedulerRole: metadata.schedulerRole,
    cronTimezone: metadata.timezone,
    cronReplayRequired: true,
    postDeployRecheckRequired: true,
    cronActivationStrategy: metadata.activationStrategy,
    cronActivationSqlSha256: metadata.activationSqlSha256,
    cronActivationRequired: true,
    cronActivationAfterParityRequired: true,
    postActivationRecheckRequired: true,
    archiveAuthenticityVerified: false,
    senderSignatureVerified: false,
    externalImmutableAnchorVerified: false,
    ...overrides,
  };
}

function completeRestoreEvidenceFixture() {
  const archiveEvidence = cronArchiveEvidence({
    archiveAuthenticityVerified: true,
    senderSignatureVerified: true,
    externalImmutableAnchorVerified: true,
  });
  const restoreIdentity = createRestoreEvidenceIdentity({
    archiveEvidence,
    restoreAttemptId: RESTORE_ATTEMPT_ID,
    sourceProjectRef: SOURCE_REF,
    targetProjectRef: RESTORE_REF,
    targetDatabase: "postgres",
    restoreStartedAt: "2026-07-12T01:30:00.000Z",
  });
  let previousEvidenceSha256 = restoreIdentity.identitySha256;
  const bind = (kind, payload) => {
    const evidence = bindRestoreEvidence({
      identity: restoreIdentity,
      kind,
      previousEvidenceSha256,
      payload,
    });
    previousEvidenceSha256 = evidence.evidenceSha256;
    return evidence;
  };
  const metadata = approvedCronRecoveryContractMetadata();
  return {
    restoreIdentity,
    archiveEvidence,
    databaseRestoreEvidence: bind("database-restore", {
      ok: true,
      restoredAt: "2026-07-12T01:40:00.000Z",
      databaseSnapshotSha256: restoreIdentity.databaseSnapshotSha256,
    }),
    storageRestoreEvidence: bind("storage-restore", {
      ok: true,
      restoredAt: "2026-07-12T01:45:00.000Z",
      storageMetadataSha256: restoreIdentity.storageMetadataSha256,
      storageObjectCount: restoreIdentity.storageObjectCount,
      storageTotalBytes: restoreIdentity.storageTotalBytes,
    }),
    cronReplayEvidence: bind("cron-inactive-replay", {
      ok: true,
      contractSha256: metadata.contractSha256,
      jobCount: metadata.jobCount,
      replaySqlSha256: metadata.replaySqlSha256,
      replayedAt: "2026-07-12T01:50:00.000Z",
      launcherState: "off",
      runningJobCount: 0,
      jobsActive: false,
      targetDatabase: restoreIdentity.targetDatabase,
      schedulerRole: metadata.schedulerRole,
      timezone: metadata.timezone,
    }),
    postDeployEvidence: bind("post-deploy-inactive-contract", {
      ok: true,
      allNonCronContractsExact: true,
      allMaintenanceCronDefinitionsExact: true,
      allMaintenanceCronsInactiveExact: true,
      cronContractSha256: metadata.contractSha256,
      checkedAt: "2026-07-12T01:55:00.000Z",
      launcherState: "off",
      runningJobCount: 0,
    }),
    parityEvidence: bind("database-storage-parity", {
      ok: true,
      checkedAt: "2026-07-12T02:00:00.000Z",
      databaseSnapshotSha256: restoreIdentity.databaseSnapshotSha256,
      storageMetadataSha256: restoreIdentity.storageMetadataSha256,
      storageObjectCount: restoreIdentity.storageObjectCount,
      storageTotalBytes: restoreIdentity.storageTotalBytes,
    }),
    rtoEvidence: bind("rto-measurement", {
      ok: true,
      measuredAt: "2026-07-12T02:05:00.000Z",
      restoreStartedAt: restoreIdentity.restoreStartedAt,
      restoreCompletedAt: "2026-07-12T02:05:00.000Z",
      rtoSeconds: 2100,
    }),
  };
}

async function fakeChild(t, source) {
  const directory = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-child-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = path.join(directory, "child.mjs");
  await writeFile(script, source, "utf8");
  return script;
}

function expectRecoveryCode(code) {
  return (error) => error instanceof RecoveryError && error.code === code;
}

function privateManifestCoverageFixture() {
  const files = [
    ["roles", "db/roles.sql"],
    ["schema", "db/schema.sql"],
    ["data-auth-public", "db/data-auth-public.sql"],
    ["data-storage", "db/data-storage.sql"],
    ["migration-history-schema", "db/migration-history-schema.sql"],
    ["migration-history-data", "db/migration-history-data.sql"],
    ["managed-auth-storage-changes", "db/managed-auth-storage-changes.sql"],
  ].map(([kind, filePath], index) => ({
    kind,
    path: filePath,
    sha256: (index + 1).toString(16).repeat(64),
    comparisonSha256: (index + 1).toString(16).repeat(64),
    size: 0,
  }));
  const copyTableDigests = {};
  const databaseSnapshotSha256 = assertDatabaseSnapshotStable(
    { artifacts: files, copyTableDigests },
    { artifacts: files, copyTableDigests },
  );
  const cronMetadata = approvedCronRecoveryContractMetadata();
  return {
    manifest: {
      formatVersion: 2,
      consistency: {
        stable: true,
        preInventorySha256: "8".repeat(64),
        postInventorySha256: "8".repeat(64),
        databaseSnapshotMethod: "independent-redump-v2-restrict-canonical",
        databaseSnapshotSha256,
        cronSnapshotMethod: "independent-exact-query-v1",
        cronContractSha256: cronMetadata.contractSha256,
      },
      database: {
        inventory: {
          schemaVersion: 1,
          storage: { buckets: [], bucketCount: 0, objectCount: 0, totalBytes: 0 },
        },
        files,
        copyTableDigests,
      },
      storage: {
        bucketCount: 0,
        objects: [],
        totalBytes: 0,
        metadataSha256: createHash("sha256").update("[]").digest("hex"),
      },
      operations: {
        approvedCron: {
          ...cronMetadata,
          artifact: {
            path: "operations/approved-cron-contract.json",
            sha256: "f".repeat(64),
            size: 1,
          },
        },
      },
      authenticity: BLOCKED_AUTHENTICITY,
    },
    extractedFiles: [
      "manifest.private.json",
      ...files.map((entry) => entry.path),
      "operations/approved-cron-contract.json",
    ],
  };
}

test("forbids credential-revealing Supabase flags before execution", () => {
  for (const flag of [
    "--dry-run",
    "--debug",
    "--password",
    "--password=not-a-real-value",
    "--db-url",
    "--db-url=postgresql://placeholder",
    "-p",
    "-pattached-secret",
    "--log-level=debug",
    "--create-ticket",
  ]) {
    assert.throws(
      () => assertSafeSupabaseArgs(["db", "dump", "--linked", flag]),
      expectRecoveryCode("FORBIDDEN_SUPABASE_FLAG"),
    );
  }
  assert.doesNotThrow(() => assertSafeSupabaseArgs([
    "db",
    "dump",
    "--linked",
    "--data-only",
    "--use-copy",
    "--file",
    "safe.sql",
  ]));
  assert.throws(
    () => assertSafeSupabaseArgs(["db", "dump", "-pmessage-must-not-leak"]),
    (error) =>
      expectRecoveryCode("FORBIDDEN_SUPABASE_FLAG")(error)
      && !error.message.includes("message-must-not-leak"),
  );
});

test("resolves the installed pinned Supabase JS entry through absolute node", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const resolved = await resolvePinnedSupabaseBinary(repoRoot);
  assert.equal(resolved.version, "2.106.0");
  assert.equal(resolved.executable, await realpath(process.execPath));
  assert.equal(resolved.prefixArgs.length, 1);
  assert.match(resolved.entrypoint.replace(/\\/g, "/"), /\/node_modules\/supabase\/dist\/supabase\.js$/);
  const verified = await verifyPinnedSupabaseInstallation(repoRoot);
  assert.equal(verified.version, "2.106.0");
  assert.equal(verified.entrypoint, resolved.entrypoint);
});

test("resolves a package-declared JS CLI entry instead of guessed native paths", async (t) => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-package-"));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, "node_modules", "supabase", "dist"), { recursive: true });
  await writeFile(path.join(repoRoot, "package.json"), JSON.stringify({
    devDependencies: { supabase: "2.106.0" },
  }));
  await writeFile(path.join(repoRoot, "node_modules", "supabase", "package.json"), JSON.stringify({
    name: "supabase",
    version: "2.106.0",
    bin: { supabase: "dist/supabase.js" },
  }));
  await writeFile(
    path.join(repoRoot, "node_modules", "supabase", "dist", "supabase.js"),
    [
      "if (process.env.SUPABASE_GO_BINARY) process.exit(73);",
      'console.log("2.106.0");',
      "",
    ].join("\n"),
  );
  const resolved = await resolvePinnedSupabaseBinary(repoRoot);
  assert.equal(resolved.executable, await realpath(process.execPath));
  assert.deepEqual(resolved.prefixArgs, [resolved.entrypoint]);
  const previousOverride = process.env.SUPABASE_GO_BINARY;
  process.env.SUPABASE_GO_BINARY = path.join(repoRoot, "untrusted-supabase-go-binary.exe");
  try {
    assert.equal((await verifyPinnedSupabaseInstallation(repoRoot)).version, "2.106.0");
  } finally {
    if (previousOverride === undefined) delete process.env.SUPABASE_GO_BINARY;
    else process.env.SUPABASE_GO_BINARY = previousOverride;
  }
});

test("child environments omit unrelated credentials and executable overrides", () => {
  assert.deepEqual(
    buildMinimalChildEnv({
      PATH: "safe-path",
      OPENAI_API_KEY: "openai-canary",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-canary",
      SUPABASE_GO_BINARY: "untrusted-binary",
      NODE_OPTIONS: "--require untrusted-module",
    }),
    { PATH: "safe-path" },
  );
});

test("native children receive the minimal environment by default", async (t) => {
  const child = await fakeChild(
    t,
    'console.log(process.env.RECOVERY_ENV_CANARY === undefined ? "missing" : "present");',
  );
  const previousCanary = process.env.RECOVERY_ENV_CANARY;
  process.env.RECOVERY_ENV_CANARY = "must-not-cross-process-boundary";
  try {
    const result = await runBoundedRedacted({
      executable: process.execPath,
      args: [child],
      captureStdout: true,
      timeoutMs: 5_000,
    });
    assert.equal(result.stdoutBuffer.toString("utf8").trim(), "missing");
  } finally {
    if (previousCanary === undefined) delete process.env.RECOVERY_ENV_CANARY;
    else process.env.RECOVERY_ENV_CANARY = previousCanary;
  }
});

test("production recovery tools require absolute hash-pinned policy", async () => {
  for (const policy of [
    {},
    { recoveryTools: { age: { path: "relative-age", sha256: "a".repeat(64) } } },
    { recoveryTools: { age: { path: path.resolve("age.exe"), sha256: "invalid" } } },
  ]) {
    await assert.rejects(
      resolveRecoveryTools({ isProduction: true, policy }),
      expectRecoveryCode("PRODUCTION_RECOVERY_TOOL_POLICY_MISSING"),
    );
  }
});

test("detects and redacts common credential material without returning its value", () => {
  const sample = [
    "PGPASSWORD=not-a-real-password",
    "Authorization: Bearer not-a-real-token",
    "postgresql://user:not-a-real-password@example.invalid/postgres",
  ].join("\n");
  assert.equal(containsCredentialMaterial(sample), true);
  const redacted = redactSecrets(sample);
  assert.match(redacted, /\[REDACTED\]/);
  assert.doesNotMatch(redacted, /not-a-real-password|not-a-real-token/);
});

test("suppresses a PGPASSWORD split across stdout chunks", async (t) => {
  const child = await fakeChild(t, `
    process.stdout.write("export PGP");
    setTimeout(() => {
      process.stdout.write('ASSWORD="chunked-canary-value"\\n');
    }, 10);
  `);
  await assert.rejects(
    runBoundedRedacted({
      executable: process.execPath,
      args: [child],
      captureStdout: true,
      timeoutMs: 5_000,
    }),
    (error) => {
      assert.equal(error.code, "CREDENTIAL_OUTPUT_DETECTED");
      assert.doesNotMatch(error.message, /chunked-canary-value/);
      return true;
    },
  );
});

test("suppresses a PGPASSWORD split across stderr chunks", async (t) => {
  const child = await fakeChild(t, `
    process.stderr.write("PGPASS");
    setTimeout(() => {
      process.stderr.write('WORD=stderr-canary-value\\n');
      process.exitCode = 9;
    }, 10);
  `);
  await assert.rejects(
    runBoundedRedacted({
      executable: process.execPath,
      args: [child],
      timeoutMs: 5_000,
    }),
    (error) => {
      assert.equal(error.code, "CREDENTIAL_OUTPUT_DETECTED");
      assert.doesNotMatch(error.message, /stderr-canary-value/);
      return true;
    },
  );
});

test("fails closed when captured stdout exceeds its safe bound", async (t) => {
  const child = await fakeChild(t, `process.stdout.write("x".repeat(4096));`);
  await assert.rejects(
    runBoundedRedacted({
      executable: process.execPath,
      args: [child],
      captureStdout: true,
      maxOutputBytes: 64,
      timeoutMs: 5_000,
    }),
    expectRecoveryCode("CHILD_OUTPUT_LIMIT"),
  );
});

test("nonzero child failures never interpolate unknown stderr formats", async (t) => {
  const child = await fakeChild(t, `
    process.stderr.write("TOTALLY_NEW_SECRET_FORMAT=opaque-canary-value\\n");
    process.exitCode = 17;
  `);
  await assert.rejects(
    runBoundedRedacted({
      executable: process.execPath,
      args: [child],
      timeoutMs: 5_000,
    }),
    (error) => {
      assert.equal(error.code, "CHILD_EXIT_NONZERO");
      assert.match(error.message, /Child output was suppressed/);
      assert.doesNotMatch(error.message, /opaque-canary-value|TOTALLY_NEW_SECRET_FORMAT/);
      return true;
    },
  );
});

test("credential output streamed toward an artifact deletes the artifact", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-output-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "managed.sql");
  const child = await fakeChild(t, `process.stdout.write("PGPASSWORD=artifact-canary-value\\n");`);
  await assert.rejects(
    runBoundedRedacted({
      executable: process.execPath,
      args: [child],
      stdoutFile: output,
      timeoutMs: 5_000,
    }),
    expectRecoveryCode("CREDENTIAL_OUTPUT_DETECTED"),
  );
  await assert.rejects(readFile(output), { code: "ENOENT" });
});

test("times out a stalled child without echoing child output", async (t) => {
  const child = await fakeChild(t, `setTimeout(() => {}, 60_000);`);
  await assert.rejects(
    runBoundedRedacted({
      executable: process.execPath,
      args: [child],
      timeoutMs: 50,
    }),
    expectRecoveryCode("CHILD_TIMEOUT"),
  );
});

test("timeout terminates a descendant before it can recreate plaintext", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-tree-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lateArtifact = path.join(directory, "late-plaintext.sql");
  const grandchildSource = `
    const { writeFileSync } = require("node:fs");
    setTimeout(() => writeFileSync(${JSON.stringify(lateArtifact)}, "late"), 300);
    setTimeout(() => {}, 60_000);
  `;
  const parent = await fakeChild(t, `
    import { spawn } from "node:child_process";
    spawn(process.execPath, ["-e", ${JSON.stringify(grandchildSource)}], {
      stdio: "ignore",
      windowsHide: true,
    });
    setTimeout(() => {}, 60_000);
  `);

  await assert.rejects(
    runBoundedRedacted({
      executable: process.execPath,
      args: [parent],
      timeoutMs: 75,
    }),
    expectRecoveryCode("CHILD_TIMEOUT"),
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  await assert.rejects(readFile(lateArtifact), { code: "ENOENT" });
});

test("rejects repository, Desktop, OneDrive, and temp plaintext staging", () => {
  const volumeRoot = path.parse(process.cwd()).root;
  const repoRoot = path.join(volumeRoot, "workspace", "hanbang");
  const home = path.join(volumeRoot, "users", "operator");
  const osTemp = path.join(volumeRoot, "system-temp");
  const options = { repoRoot, home, osTemp };
  assert.throws(
    () => assertSafeStagingRoot(path.join(repoRoot, "backup"), options),
    expectRecoveryCode("STAGING_IN_REPOSITORY"),
  );
  assert.throws(
    () => assertSafeStagingRoot(path.join(home, "Desktop", "backup"), options),
    expectRecoveryCode("STAGING_ON_DESKTOP"),
  );
  assert.throws(
    () => assertSafeStagingRoot(path.join(home, "OneDrive - Company", "backup"), options),
    expectRecoveryCode("STAGING_IN_ONEDRIVE"),
  );
  assert.throws(
    () => assertSafeStagingRoot(path.join(osTemp, "backup"), options),
    expectRecoveryCode("STAGING_IN_TEMP"),
  );
  assert.equal(
    assertSafeStagingRoot(path.join(volumeRoot, "encrypted-vault", "hanbang"), options),
    path.resolve(path.join(volumeRoot, "encrypted-vault", "hanbang")),
  );
});

test("stable inventory digest ignores capture time and approximate stats", () => {
  const base = {
    schemaVersion: 1,
    capturedAt: "2026-07-12T00:00:00Z",
    databaseSizeBytes: 100,
    authUserCount: 2,
    publicTables: [{ name: "profiles", estimatedRows: 1, totalBytes: 10 }],
    publicTableCounts: { profiles: 2 },
    extensions: [{ name: "pgcrypto", version: "1" }],
    sequences: [],
    storage: { bucketCount: 0, objectCount: 0, totalBytes: 0, buckets: [] },
  };
  const later = {
    ...base,
    capturedAt: "2026-07-12T00:05:00Z",
    databaseSizeBytes: 200,
    publicTables: [{ name: "profiles", estimatedRows: 99, totalBytes: 20 }],
  };
  assert.equal(stableInventoryDigest(base, []), stableInventoryDigest(later, []));
  assert.notEqual(
    stableInventoryDigest(base, []),
    stableInventoryDigest({ ...later, publicTableCounts: { profiles: 3 } }, []),
  );
});

test("pg_dump comparison canonicalizes only a valid restrict marker pair", () => {
  const first = [
    "-- PostgreSQL database dump",
    "\\restrict random-key-one",
    "CREATE TABLE public.example (id integer);",
    "\\unrestrict random-key-one",
    "",
  ].join("\n");
  const second = first.replaceAll("random-key-one", "different-key-two");
  assert.equal(
    canonicalizePgDumpForComparison(first),
    canonicalizePgDumpForComparison(second),
  );
  assert.notEqual(
    canonicalizePgDumpForComparison(first),
    canonicalizePgDumpForComparison(
      second.replace("id integer", "id bigint"),
    ),
  );
  assert.throws(
    () => canonicalizePgDumpForComparison(
      first.replace("\\unrestrict random-key-one", "\\unrestrict wrong-key"),
    ),
    expectRecoveryCode("DATABASE_DUMP_RESTRICT_MARKER_INVALID"),
  );
  assert.throws(
    () => canonicalizePgDumpForComparison(first.replace("\\unrestrict random-key-one\n", "")),
    expectRecoveryCode("DATABASE_DUMP_RESTRICT_MARKER_INVALID"),
  );
});

test("independent database snapshots compare canonical SQL while preserving archive digests", () => {
  const primary = {
    artifacts: [
      {
        kind: "schema",
        path: "db/schema.sql",
        sha256: "a".repeat(64),
        comparisonSha256: "1".repeat(64),
        size: 100,
      },
      {
        kind: "data-auth-public",
        path: "db/data-auth-public.sql",
        sha256: "b".repeat(64),
        comparisonSha256: "2".repeat(64),
        size: 200,
      },
    ],
    copyTableDigests: {
      '"public"."profiles"': {
        rows: 2,
        sumSha256: "c".repeat(64),
        xorSha256: "d".repeat(64),
      },
    },
  };

  const reordered = {
    artifacts: [...primary.artifacts].reverse(),
    copyTableDigests: structuredClone(primary.copyTableDigests),
  };
  const evidence = assertDatabaseSnapshotStable(primary, reordered);
  assert.match(evidence, /^[0-9a-f]{64}$/);

  const randomRestrictKeyChanged = structuredClone(reordered);
  randomRestrictKeyChanged.artifacts[0].sha256 = "8".repeat(64);
  randomRestrictKeyChanged.artifacts[0].size += 7;
  assert.equal(
    assertDatabaseSnapshotStable(primary, randomRestrictKeyChanged),
    evidence,
  );

  const contentChanged = structuredClone(reordered);
  contentChanged.copyTableDigests['"public"."profiles"'].sumSha256 = "e".repeat(64);
  assert.throws(
    () => assertDatabaseSnapshotStable(primary, contentChanged),
    expectRecoveryCode("DATABASE_SNAPSHOT_DRIFT"),
  );

  const schemaChanged = structuredClone(reordered);
  schemaChanged.artifacts.find(
    ({ kind }) => kind === "schema",
  ).comparisonSha256 = "f".repeat(64);
  assert.throws(
    () => assertDatabaseSnapshotStable(primary, schemaChanged),
    expectRecoveryCode("DATABASE_SNAPSHOT_DRIFT"),
  );

  const dataDumpChangedWithoutCountChange = structuredClone(reordered);
  dataDumpChangedWithoutCountChange.artifacts.find(
    ({ kind }) => kind === "data-auth-public",
  ).comparisonSha256 = "9".repeat(64);
  assert.throws(
    () => assertDatabaseSnapshotStable(primary, dataDumpChangedWithoutCountChange),
    expectRecoveryCode("DATABASE_SNAPSHOT_DRIFT"),
  );
});

test("database query parsing accepts both raw rows and agent envelopes", () => {
  const rows = [{ recovery_inventory: { schemaVersion: 1 } }];
  assert.deepEqual(extractQueryRows(rows), rows);
  assert.deepEqual(extractQueryRows({ rows }), rows);
  assert.throws(
    () => extractQueryRows({ result: rows }),
    expectRecoveryCode("NATIVE_QUERY_SHAPE_INVALID"),
  );
});

test("approved cron recovery contract is exact, portable, and independently stable", async () => {
  const approved = structuredClone(APPROVED_CRON_CONTRACT);
  assert.deepEqual(approved.executionEnvironment, {
    preActivationLauncherState: "off",
    runningJobCount: 0,
    timezone: "GMT",
    schedulerRole: "postgres",
    databaseBinding: "current_database",
  });
  assert.deepEqual(assertApprovedCronContract(approved), approved);
  assert.match(assertApprovedCronSnapshotsStable(approved, approved), /^[0-9a-f]{64}$/);

  const missingJob = structuredClone(approved);
  missingJob.jobs.pop();
  assert.throws(
    () => assertApprovedCronContract(missingJob),
    expectRecoveryCode("APPROVED_CRON_CONTRACT_MISMATCH"),
  );
  const environmentBound = structuredClone(approved);
  environmentBound.jobs[0].database = "postgres";
  environmentBound.jobs[0].username = "postgres";
  assert.throws(
    () => assertApprovedCronContract(environmentBound),
    expectRecoveryCode("APPROVED_CRON_CONTRACT_MISMATCH"),
  );

  const replaySql = buildApprovedCronReplaySql(approved);
  assert.match(replaySql, /cron\.launch_active_jobs[^\n]+off/i);
  assert.match(replaySql, /cron\.job_run_details/);
  assert.equal((replaySql.match(/PERFORM cron\.schedule_in_database\(/g) ?? []).length, 5);
  assert.equal((replaySql.match(/PERFORM cron\.unschedule\(/g) ?? []).length, 5);
  assert.equal((replaySql.match(/false\s*\)/g) ?? []).length, 5);
  assert.doesNotMatch(replaySql, /ALTER SYSTEM SET cron\.launch_active_jobs TO on/i);
  assert.doesNotMatch(replaySql, /active\s*:=\s*true/i);
  for (const job of approved.jobs) {
    assert.match(replaySql, new RegExp(job.jobName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.ok(replaySql.split(job.schedule).length - 1 >= 2);
    assert.ok(replaySql.split(job.command).length - 1 >= 2);
  }
  assert.match(replaySql, /job_row\.database = pg_catalog\.current_database\(\)/);
  assert.match(replaySql, /job_row\.username = 'postgres'/);
  assert.doesNotMatch(replaySql, /\b(?:nodename|nodeport)\s*=/i);

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const captureSql = await readFile(
    path.join(repoRoot, "scripts", "sql", "supabase-recovery-cron-contract.sql"),
    "utf8",
  );
  assert.match(captureSql, /FROM cron\.job job_row/);
  assert.match(captureSql, /current_setting\('cron\.launch_active_jobs'/);
  assert.match(captureSql, /current_setting\('cron\.timezone'/);
  assert.match(captureSql, /job_row\.database = current_database\(\)/);
  assert.match(captureSql, /job_row\.username = 'postgres'/);
  assert.doesNotMatch(captureSql, /WHERE job_row\.jobname/);
  assert.doesNotMatch(
    captureSql,
    /job_row\.(?:jobid|nodename|nodeport)/,
  );
  assert.doesNotMatch(captureSql, /'(?:database|username|nodename|nodeport)'\s*,/);

  const activationSql = buildApprovedCronActivationSql(approved);
  assert.match(activationSql, /cron\.launch_active_jobs[^\n]+off/i);
  assert.match(activationSql, /cron\.job_run_details/);
  assert.equal((activationSql.match(/active\s*:=\s*true/g) ?? []).length, 5);
  assert.match(activationSql, /ALTER SYSTEM SET cron\.launch_active_jobs TO on/i);
  assert.equal(
    (activationSql.match(/current_setting\('cron\.launch_active_jobs',[\s\S]*?<> 'off'/g) ?? []).length,
    2,
  );
  for (const job of approved.jobs) {
    assert.match(activationSql, new RegExp(job.jobName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(activationSql, new RegExp(job.schedule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(activationSql, new RegExp(job.command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("approved cron artifact is a required canonical archive file", async (t) => {
  const extracted = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-cron-"));
  t.after(() => rm(extracted, { recursive: true, force: true }));
  const operations = path.join(extracted, "operations");
  await mkdir(operations, { recursive: true });
  const artifactPath = path.join(operations, "approved-cron-contract.json");
  const canonicalContract = assertApprovedCronContract(
    structuredClone(APPROVED_CRON_CONTRACT),
  );
  const artifactText = `${JSON.stringify(canonicalContract)}\n`;
  await writeFile(artifactPath, artifactText, "utf8");
  const metadata = approvedCronRecoveryContractMetadata();
  const manifest = {
    database: { files: [] },
    storage: { objects: [] },
    operations: {
      approvedCron: {
        ...metadata,
        artifact: {
          path: "operations/approved-cron-contract.json",
          sha256: createHash("sha256").update(artifactText).digest("hex"),
          size: Buffer.byteLength(artifactText),
        },
      },
    },
  };

  await assert.doesNotReject(
    verifyPrivateManifestArtifactDigests(manifest, extracted),
  );
  await assert.doesNotReject(
    verifyApprovedCronRecoveryArtifact(manifest, extracted),
  );

  await writeFile(
    artifactPath,
    `${JSON.stringify(APPROVED_CRON_CONTRACT, null, 2)}\n`,
    "utf8",
  );
  await assert.rejects(
    verifyApprovedCronRecoveryArtifact(manifest, extracted),
    expectRecoveryCode("CRON_RECOVERY_ARTIFACT_NONCANONICAL"),
  );
});

test("public recovery metadata cannot relabel the encrypted source", () => {
  const cronMetadata = approvedCronRecoveryContractMetadata();
  const privateManifest = {
    formatVersion: 2,
    artifactId: "artifact-1",
    source: { projectRef: SOURCE_REF, gitSha: "a".repeat(40) },
    consistency: { stable: true, preInventorySha256: "b".repeat(64) },
    database: { files: [{ path: "db/schema.sql" }], copyTableDigests: {} },
    storage: {
      bucketCount: 1,
      objects: [{ blob: `blobs/${"c".repeat(64)}` }],
      totalBytes: 10,
      metadataSha256: "d".repeat(64),
    },
    operations: {
      approvedCron: {
        ...cronMetadata,
        artifact: {
          path: "operations/approved-cron-contract.json",
          sha256: "e".repeat(64),
          size: 10,
        },
      },
    },
    authenticity: BLOCKED_AUTHENTICITY,
  };
  const publicManifest = {
    formatVersion: 2,
    artifactId: "artifact-1",
    source: privateManifest.source,
    consistency: privateManifest.consistency,
    database: { fileCount: 1, copyTableCount: 0 },
    storage: {
      bucketCount: 1,
      objectCount: 1,
      totalBytes: 10,
      privateMetadataSha256: "d".repeat(64),
    },
    operations: {
      approvedCron: {
        ...cronMetadata,
        privateArtifactSha256: "e".repeat(64),
      },
    },
    authenticity: BLOCKED_AUTHENTICITY,
    releaseEligible: false,
    restoreDrillVerified: false,
  };
  assert.doesNotThrow(() =>
    assertPublicPrivateManifestConsistency(publicManifest, privateManifest),
  );
  assert.throws(
    () => assertPublicPrivateManifestConsistency(
      { ...publicManifest, source: { ...publicManifest.source, projectRef: RESTORE_REF } },
      privateManifest,
    ),
    expectRecoveryCode("PUBLIC_PRIVATE_MANIFEST_MISMATCH"),
  );
  assert.throws(
    () => assertPublicPrivateManifestConsistency(
      { ...publicManifest, formatVersion: 1 },
      privateManifest,
    ),
    expectRecoveryCode("PUBLIC_PRIVATE_MANIFEST_MISMATCH"),
  );
  assert.throws(
    () => assertPublicPrivateManifestConsistency(
      { ...publicManifest, operations: undefined },
      privateManifest,
    ),
    expectRecoveryCode("PUBLIC_PRIVATE_MANIFEST_MISMATCH"),
  );
});

test("storage concurrency is an integer from one through eight", () => {
  for (const value of [1, "4", 8]) assert.equal(parseStorageConcurrency(value), Number(value));
  for (const value of [0, 9, "1.5", "not-a-number", Number.NaN]) {
    assert.throws(() => parseStorageConcurrency(value), expectRecoveryCode("STORAGE_CONCURRENCY_INVALID"));
  }
});

test("storage manifest coverage requires one valid entry per source object", () => {
  const source = [{ id: "id-1", bucket_id: "private", name: "A/한글.jpg" }];
  const sha256 = "b".repeat(64);
  assert.doesNotThrow(() => assertStorageManifestCoverage(source, [{
    object: source[0],
    byteSha256: sha256,
    byteSize: 0,
    blob: `blobs/${sha256}`,
  }]));
  assert.throws(
    () => assertStorageManifestCoverage(source, []),
    expectRecoveryCode("STORAGE_MANIFEST_COVERAGE_MISMATCH"),
  );
  assert.throws(
    () => assertStorageManifestCoverage(source, [{
      object: source[0],
      byteSha256: sha256,
      byteSize: 0,
      blob: "blobs/wrong",
    }]),
    expectRecoveryCode("STORAGE_MANIFEST_COVERAGE_MISMATCH"),
  );
});

test("Storage export waits for active workers to settle after the first failure", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-storage-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  let slowFinished = false;
  let thirdStarted = false;
  const objects = ["bad", "slow", "never"].map((name) => ({
    id: `id-${name}`,
    bucket_id: "private",
    name,
    metadata: { size: 1 },
  }));

  await assert.rejects(
    exportStorageObjects({
      objects,
      projectRef: SOURCE_REF,
      serviceRoleKey: "test-service-role-key",
      workspace,
      concurrency: 2,
      fetchImpl: async (url) => {
        if (url.pathname.endsWith("/bad")) return new Response(null, { status: 404 });
        if (url.pathname.endsWith("/never")) thirdStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
        slowFinished = true;
        return new Response("x", { status: 200 });
      },
    }),
    expectRecoveryCode("STORAGE_HTTP_404"),
  );
  assert.equal(slowFinished, true);
  assert.equal(thirdStarted, false);
});

test("private manifest requires the exact archive file and database artifact set", () => {
  const fixture = privateManifestCoverageFixture();
  assert.doesNotThrow(() =>
    assertPrivateManifestArchiveCoverage(fixture.manifest, fixture.extractedFiles),
  );

  const missingDatabaseArtifact = structuredClone(fixture.manifest);
  missingDatabaseArtifact.database.files.pop();
  assert.throws(
    () => assertPrivateManifestArchiveCoverage(
      missingDatabaseArtifact,
      fixture.extractedFiles.slice(0, -1),
    ),
    expectRecoveryCode("DATABASE_ARTIFACT_SET_MISMATCH"),
  );

  assert.throws(
    () => assertPrivateManifestArchiveCoverage(
      fixture.manifest,
      [...fixture.extractedFiles, "undeclared.txt"],
    ),
    expectRecoveryCode("ARCHIVE_FILE_SET_MISMATCH"),
  );

  const missingCronArtifact = structuredClone(fixture.manifest);
  delete missingCronArtifact.operations.approvedCron;
  assert.throws(
    () => assertPrivateManifestArchiveCoverage(
      missingCronArtifact,
      fixture.extractedFiles.slice(0, -1),
    ),
    expectRecoveryCode("CRON_RECOVERY_ARTIFACT_INVALID"),
  );

  const driftedCronArtifact = structuredClone(
    fixture.manifest.operations.approvedCron,
  );
  driftedCronArtifact.jobCount = 4;
  assert.throws(
    () => assertApprovedCronRecoveryManifest(driftedCronArtifact),
    expectRecoveryCode("CRON_RECOVERY_ARTIFACT_INVALID"),
  );

  const incorrectAggregate = structuredClone(fixture.manifest);
  incorrectAggregate.database.inventory.storage.totalBytes = 1;
  assert.throws(
    () => assertPrivateManifestArchiveCoverage(
      incorrectAggregate,
      fixture.extractedFiles,
    ),
    expectRecoveryCode("STORAGE_AGGREGATE_MISMATCH"),
  );

  const incorrectBucketAggregate = structuredClone(fixture.manifest);
  incorrectBucketAggregate.database.inventory.storage.bucketCount = 1;
  incorrectBucketAggregate.storage.bucketCount = 1;
  assert.throws(
    () => assertPrivateManifestArchiveCoverage(
      incorrectBucketAggregate,
      fixture.extractedFiles,
    ),
    expectRecoveryCode("STORAGE_AGGREGATE_MISMATCH"),
  );
});

test("archive verification rejects manifests without bound independent database evidence", () => {
  const fixture = privateManifestCoverageFixture();
  const missingEvidence = structuredClone(fixture.manifest);
  delete missingEvidence.consistency.databaseSnapshotMethod;
  assert.throws(
    () => assertPrivateManifestArchiveCoverage(
      missingEvidence,
      fixture.extractedFiles,
    ),
    expectRecoveryCode("DATABASE_STABILITY_EVIDENCE_INVALID"),
  );

  const relabelledEvidence = structuredClone(fixture.manifest);
  relabelledEvidence.consistency.databaseSnapshotSha256 = "7".repeat(64);
  assert.throws(
    () => assertPrivateManifestArchiveCoverage(
      relabelledEvidence,
      fixture.extractedFiles,
    ),
    expectRecoveryCode("DATABASE_STABILITY_EVIDENCE_INVALID"),
  );
});

test("archive digest verification treats Storage blobs as binary, not pg_dump text", async (t) => {
  const extracted = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-binary-"));
  t.after(() => rm(extracted, { recursive: true, force: true }));
  await mkdir(path.join(extracted, "db"), { recursive: true });
  await mkdir(path.join(extracted, "blobs"), { recursive: true });

  const databaseContents = [
    "-- PostgreSQL database dump",
    "\\restrict database-key",
    "CREATE TABLE public.example (id integer);",
    "\\unrestrict database-key",
    "",
  ].join("\n");
  const binaryContents = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x89, 0x50, 0x4e, 0x47]);
  const databasePath = path.join(extracted, "db", "schema.sql");
  const blobPath = path.join(extracted, "blobs", "binary-object");
  await writeFile(databasePath, databaseContents);
  await writeFile(blobPath, binaryContents);

  const rawSha256 = (value) => createHash("sha256").update(value).digest("hex");
  const privateManifest = {
    database: {
      files: [{
        kind: "schema",
        path: "db/schema.sql",
        sha256: rawSha256(databaseContents),
        comparisonSha256: rawSha256(
          canonicalizePgDumpForComparison(databaseContents),
        ),
        size: Buffer.byteLength(databaseContents),
      }],
    },
    storage: {
      objects: [{
        blob: "blobs/binary-object",
        byteSha256: rawSha256(binaryContents),
        byteSize: binaryContents.length,
      }],
    },
  };

  await assert.doesNotReject(
    verifyPrivateManifestArtifactDigests(privateManifest, extracted),
  );
});

test("verified cleanup rejects a successful remove that leaves residue", async (t) => {
  const target = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-residue-"));
  t.after(() => rm(target, { recursive: true, force: true }));
  await assert.rejects(
    removeRecoveryPathVerified(target, {
      recursive: true,
      removeImpl: async () => {
        throw new Error("simulated cleanup failure");
      },
    }),
    expectRecoveryCode("RECOVERY_CLEANUP_FAILED"),
  );
  await assert.rejects(
    removeRecoveryPathVerified(target, {
      recursive: true,
      removeImpl: async () => {},
    }),
    expectRecoveryCode("RECOVERY_CLEANUP_RESIDUE"),
  );
});

test("verbose tar listing rejects symlinks and hardlinks before extraction", () => {
  assert.doesNotThrow(() => validateVerboseTarListing([
    "drwx------ operator/group 0 2026-07-12 00:00 ./",
    "-rw------- operator/group 10 2026-07-12 00:00 ./manifest.private.json",
  ].join("\n")));
  assert.throws(
    () => validateVerboseTarListing("lrwxrwxrwx operator/group 0 date link -> ../../escape"),
    expectRecoveryCode("ARCHIVE_LINK_ENTRY_FORBIDDEN"),
  );
  assert.throws(
    () => validateVerboseTarListing("hrw------- operator/group 0 date hard link to ../../escape"),
    expectRecoveryCode("ARCHIVE_LINK_ENTRY_FORBIDDEN"),
  );
});

test("production export remains blocked until both fence and policy are verified", () => {
  const base = {
    expectedProjectRef: PRODUCTION_REF,
    trafficDrained: true,
    maintenanceStartedAt: new Date("2026-07-12T00:00:00Z").toISOString(),
    writeFenceEvidenceSha256: "a".repeat(64),
    now: new Date("2026-07-12T00:10:00Z"),
  };
  assert.throws(
    () => assertProductionExportAllowed({
      ...base,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        productionDatabaseWriteFence: "not_configured",
      },
    }),
    expectRecoveryCode("PRODUCTION_WRITE_FENCE_UNVERIFIED"),
  );
  assert.throws(
    () => assertProductionExportAllowed({
      ...base,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        productionDatabaseWriteFence: "verified-v1",
      },
    }),
    expectRecoveryCode("PRODUCTION_BACKUP_POLICY_UNVERIFIED"),
  );
  assert.throws(
    () => assertProductionExportAllowed({
      ...base,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        productionDatabaseWriteFence: "verified-v1",
        backupPolicy: { status: "verified-v1" },
      },
    }),
    expectRecoveryCode("PRODUCTION_RECOVERY_LIFECYCLE_UNVERIFIED"),
  );
});

test("recovery export defaults unknown non-production refs to denied", () => {
  const targets = {
    productionSupabaseProjectRefs: [PRODUCTION_REF],
    approvedNonProductionSupabaseProjectRefs: [SOURCE_REF],
  };

  assert.doesNotThrow(() => assertApprovedNonProductionSource(SOURCE_REF, targets));
  assert.throws(
    () => assertApprovedNonProductionSource(RESTORE_REF, targets),
    expectRecoveryCode("SOURCE_PROJECT_NOT_APPROVED"),
  );
});

test("production restore is forbidden before archive verification can run", async () => {
  let verifierCalled = false;
  await assert.rejects(
    restoreVerifyReadiness({
      sourceProjectRef: SOURCE_REF,
      targetProjectRef: PRODUCTION_REF,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        backupPolicy: {
          status: "verified-v1",
          allowedRestoreProjectRefs: [PRODUCTION_REF],
        },
      },
      archiveVerifier: async () => {
        verifierCalled = true;
        return { ok: true };
      },
    }),
    expectRecoveryCode("PRODUCTION_RESTORE_FORBIDDEN"),
  );
  assert.equal(verifierCalled, false);
});

test("isolated restore planning requires the bound cron artifact", async () => {
  const plan = buildRestorePlan(cronArchiveEvidence());
  assert.equal(plan.cron.jobCount, 5);
  assert.equal(plan.restored, false);
  assert.equal(plan.releaseEligible, false);
  assert.deepEqual(plan.requiredSequence, [
    "set-cron-launcher-off-and-drain",
    "restore-database-and-migration-ledger",
    "restore-storage-metadata-and-bytes",
    "replay-approved-cron-contract-inactive",
    "run-exact-post-deploy-contract-with-crons-inactive",
    "verify-database-storage-parity-and-rto",
    "activate-approved-crons-after-bound-evidence",
    "run-exact-post-activation-contract",
  ]);
  assert.equal(plan.cron.preActivationLauncherState, "off");
  assert.equal(plan.cron.postActivationLauncherState, "on");
  assert.equal(plan.cron.replayedJobsActive, false);
  assert.equal(plan.cron.activationRequired, true);

  await assert.rejects(
    restoreVerifyReadiness({
      sourceProjectRef: SOURCE_REF,
      targetProjectRef: RESTORE_REF,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        backupPolicy: {
          status: "verified-v1",
          allowedRestoreProjectRefs: [RESTORE_REF],
          archiveAuthenticity: {
            status: "verified-v1",
            contract: "age-sender-signature-external-immutable-anchor-v1",
            senderSigningKeyRef: "custody://test-signer",
            externalImmutableAnchorRef: "anchor://test-ledger",
          },
        },
      },
      archiveVerifier: async () => ({
        ok: true,
        archiveIntegrityVerified: true,
      }),
    }),
    expectRecoveryCode("ARCHIVE_CRON_CONTRACT_UNVERIFIED"),
  );
});

test("checked-in recovery policy explicitly blocks unimplemented authenticity", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const targets = JSON.parse(await readFile(
    path.join(repoRoot, "scripts", "release-targets.json"),
    "utf8",
  ));
  assert.deepEqual(targets.backupPolicy.archiveAuthenticity, {
    status: "blocked-key-custody-and-immutable-anchor-not-approved",
    contract: "age-sender-signature-external-immutable-anchor-v1",
    senderSigningKeyRef: null,
    externalImmutableAnchorRef: null,
  });
  await assert.rejects(
    restoreVerifyReadiness({
      sourceProjectRef: SOURCE_REF,
      targetProjectRef: RESTORE_REF,
      targets: {
        ...targets,
        backupPolicy: {
          ...targets.backupPolicy,
          status: "verified-v1",
          allowedRestoreProjectRefs: [RESTORE_REF],
        },
      },
      archiveVerifier: async () => cronArchiveEvidence(),
    }),
    expectRecoveryCode("ARCHIVE_AUTHENTICITY_UNVERIFIED"),
  );
});

test("restore execution remains a hard stop even with mocked external authenticity", async () => {
  await assert.rejects(
    restoreVerifyReadiness({
      sourceProjectRef: SOURCE_REF,
      targetProjectRef: RESTORE_REF,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        backupPolicy: {
          status: "verified-v1",
          allowedRestoreProjectRefs: [RESTORE_REF],
          archiveAuthenticity: {
            status: "verified-v1",
            contract: "age-sender-signature-external-immutable-anchor-v1",
            senderSigningKeyRef: "custody://test-signer",
            externalImmutableAnchorRef: "anchor://test-ledger",
          },
        },
      },
      archiveVerifier: async () => cronArchiveEvidence({
        archiveAuthenticityVerified: true,
        senderSignatureVerified: true,
        externalImmutableAnchorVerified: true,
      }),
    }),
    expectRecoveryCode("RESTORE_EXECUTION_NOT_ENABLED"),
  );
});

test("restore evidence rejects a valid item bound to another archive and target", () => {
  const archiveA = cronArchiveEvidence({
    archiveAuthenticityVerified: true,
    senderSignatureVerified: true,
    externalImmutableAnchorVerified: true,
  });
  const archiveB = {
    ...archiveA,
    artifactId: "33333333-3333-4333-8333-333333333333",
    archiveSha256: "e".repeat(64),
  };
  const identityA = createRestoreEvidenceIdentity({
    archiveEvidence: archiveA,
    restoreAttemptId: RESTORE_ATTEMPT_ID,
    sourceProjectRef: SOURCE_REF,
    targetProjectRef: RESTORE_REF,
    targetDatabase: "postgres",
    restoreStartedAt: "2026-07-12T01:30:00.000Z",
  });
  const identityB = createRestoreEvidenceIdentity({
    archiveEvidence: archiveB,
    restoreAttemptId: "44444444-4444-4444-8444-444444444444",
    sourceProjectRef: SOURCE_REF,
    targetProjectRef: "t".repeat(20),
    targetDatabase: "postgres",
    restoreStartedAt: "2026-07-12T01:30:00.000Z",
  });
  const databaseRestoreEvidence = bindRestoreEvidence({
    identity: identityA,
    kind: "database-restore",
    previousEvidenceSha256: identityA.identitySha256,
    payload: {
      ok: true,
      restoredAt: "2026-07-12T01:40:00.000Z",
      databaseSnapshotSha256: identityA.databaseSnapshotSha256,
    },
  });
  const storageRestoreEvidence = bindRestoreEvidence({
    identity: identityB,
    kind: "storage-restore",
    previousEvidenceSha256: databaseRestoreEvidence.evidenceSha256,
    payload: {
      ok: true,
      restoredAt: "2026-07-12T01:41:00.000Z",
      storageMetadataSha256: identityB.storageMetadataSha256,
      storageObjectCount: identityB.storageObjectCount,
      storageTotalBytes: identityB.storageTotalBytes,
    },
  });

  assert.throws(
    () => assertRestoreCompletionEvidence({
      restoreIdentity: identityA,
      archiveEvidence: archiveA,
      databaseRestoreEvidence,
      storageRestoreEvidence,
    }),
    expectRecoveryCode("RESTORE_EVIDENCE_IDENTITY_MISMATCH"),
  );

  const wrongPredecessor = bindRestoreEvidence({
    identity: identityA,
    kind: "storage-restore",
    previousEvidenceSha256: identityA.identitySha256,
    payload: {
      ok: true,
      restoredAt: "2026-07-12T01:41:00.000Z",
      storageMetadataSha256: identityA.storageMetadataSha256,
      storageObjectCount: identityA.storageObjectCount,
      storageTotalBytes: identityA.storageTotalBytes,
    },
  });
  assert.throws(
    () => assertRestoreCompletionEvidence({
      restoreIdentity: identityA,
      archiveEvidence: archiveA,
      databaseRestoreEvidence,
      storageRestoreEvidence: wrongPredecessor,
    }),
    expectRecoveryCode("RESTORE_EVIDENCE_CHAIN_MISMATCH"),
  );

  assert.throws(
    () => assertRestoreCompletionEvidence({
      restoreIdentity: identityA,
      archiveEvidence: archiveA,
      databaseRestoreEvidence: {
        ...databaseRestoreEvidence,
        payload: { ...databaseRestoreEvidence.payload, ok: false },
      },
    }),
    expectRecoveryCode("RESTORE_EVIDENCE_DIGEST_MISMATCH"),
  );
});

test("restored status requires one exact evidence chain and remains disabled", () => {
  assert.throws(
    () => assertRestoreCompletionEvidence(completeRestoreEvidenceFixture()),
    expectRecoveryCode("RESTORE_COMPLETION_ATTESTATION_NOT_ENABLED"),
  );
});

test("isolated restore readiness rejects unsuccessful archive evidence", async () => {
  await assert.rejects(
    restoreVerifyReadiness({
      sourceProjectRef: SOURCE_REF,
      targetProjectRef: RESTORE_REF,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        backupPolicy: {
          status: "verified-v1",
          allowedRestoreProjectRefs: [RESTORE_REF],
        },
      },
      archiveVerifier: async () => ({ ok: false }),
    }),
    expectRecoveryCode("ARCHIVE_VERIFICATION_FAILED"),
  );
});

test("restore allowlist cannot override production protection", () => {
  assert.throws(
    () => assertRestoreTargetAllowed({
      sourceProjectRef: SOURCE_REF,
      targetProjectRef: PRODUCTION_REF,
      targets: {
        productionSupabaseProjectRefs: [PRODUCTION_REF],
        backupPolicy: {
          status: "verified-v1",
          allowedRestoreProjectRefs: [PRODUCTION_REF],
        },
      },
    }),
    expectRecoveryCode("PRODUCTION_RESTORE_FORBIDDEN"),
  );
});

test("COPY table digest is independent of row order and counts duplicates", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-copy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = path.join(directory, "first.sql");
  const second = path.join(directory, "second.sql");
  await writeFile(first, [
    'COPY "public"."profiles" ("id", "name") FROM stdin;',
    "1\talpha",
    "2\tbeta",
    "1\talpha",
    "\\.",
    "",
  ].join("\n"));
  await writeFile(second, [
    'COPY "public"."profiles" ("id", "name") FROM stdin;',
    "1\talpha",
    "1\talpha",
    "2\tbeta",
    "\\.",
    "",
  ].join("\n"));
  assert.deepEqual(await parseCopyTableDigests(first), await parseCopyTableDigests(second));
  const digest = await parseCopyTableDigests(first);
  assert.equal(digest['"public"."profiles"'].rows, 3);
});

test("truncated COPY dump fails instead of producing partial evidence", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "hanbang-recovery-copy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "truncated.sql");
  await writeFile(file, [
    'COPY "auth"."users" ("id") FROM stdin;',
    "1",
  ].join("\n"));
  await assert.rejects(
    parseCopyTableDigests(file),
    expectRecoveryCode("COPY_DUMP_TRUNCATED"),
  );
});
