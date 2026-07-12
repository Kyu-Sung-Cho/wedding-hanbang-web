import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RecoveryError,
  assertApprovedNonProductionSource,
  assertDatabaseSnapshotStable,
  assertPrivateManifestArchiveCoverage,
  assertProductionExportAllowed,
  assertPublicPrivateManifestConsistency,
  assertRestoreTargetAllowed,
  assertSafeStagingRoot,
  assertSafeSupabaseArgs,
  assertStorageManifestCoverage,
  buildMinimalChildEnv,
  containsCredentialMaterial,
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
  verifyPinnedSupabaseInstallation,
} from "./supabase-recovery-safe.mjs";

const PRODUCTION_REF = "p".repeat(20);
const SOURCE_REF = "s".repeat(20);
const RESTORE_REF = "r".repeat(20);

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
    size: 0,
  }));
  const copyTableDigests = {};
  const databaseSnapshotSha256 = assertDatabaseSnapshotStable(
    { artifacts: files, copyTableDigests },
    { artifacts: files, copyTableDigests },
  );
  return {
    manifest: {
      consistency: {
        stable: true,
        preInventorySha256: "8".repeat(64),
        postInventorySha256: "8".repeat(64),
        databaseSnapshotMethod: "independent-redump-v1",
        databaseSnapshotSha256,
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
    },
    extractedFiles: ["manifest.private.json", ...files.map((entry) => entry.path)],
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

test("independent database snapshots must match byte-for-byte before export is stable", () => {
  const primary = {
    artifacts: [
      {
        kind: "schema",
        path: "db/schema.sql",
        sha256: "a".repeat(64),
        size: 100,
      },
      {
        kind: "data-auth-public",
        path: "db/data-auth-public.sql",
        sha256: "b".repeat(64),
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

  const contentChanged = structuredClone(reordered);
  contentChanged.copyTableDigests['"public"."profiles"'].sumSha256 = "e".repeat(64);
  assert.throws(
    () => assertDatabaseSnapshotStable(primary, contentChanged),
    expectRecoveryCode("DATABASE_SNAPSHOT_DRIFT"),
  );

  const schemaChanged = structuredClone(reordered);
  schemaChanged.artifacts.find(({ kind }) => kind === "schema").sha256 = "f".repeat(64);
  assert.throws(
    () => assertDatabaseSnapshotStable(primary, schemaChanged),
    expectRecoveryCode("DATABASE_SNAPSHOT_DRIFT"),
  );

  const dataDumpChangedWithoutCountChange = structuredClone(reordered);
  dataDumpChangedWithoutCountChange.artifacts.find(
    ({ kind }) => kind === "data-auth-public",
  ).sha256 = "9".repeat(64);
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

test("public recovery metadata cannot relabel the encrypted source", () => {
  const privateManifest = {
    formatVersion: 1,
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
  };
  const publicManifest = {
    formatVersion: 1,
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

test("approved isolated restore readiness is explicit that no restore ran", async () => {
  const result = await restoreVerifyReadiness({
    sourceProjectRef: SOURCE_REF,
    targetProjectRef: RESTORE_REF,
    targets: {
      productionSupabaseProjectRefs: [PRODUCTION_REF],
      backupPolicy: {
        status: "verified-v1",
        allowedRestoreProjectRefs: [RESTORE_REF],
      },
    },
    archiveVerifier: async () => ({ ok: true }),
  });
  assert.equal(result.archiveVerified, true);
  assert.equal(result.databaseRestored, false);
  assert.equal(result.storageRestored, false);
  assert.equal(result.releaseEligible, false);
  assert.equal(result.status, "archive_verified_restore_execution_not_enabled");
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
