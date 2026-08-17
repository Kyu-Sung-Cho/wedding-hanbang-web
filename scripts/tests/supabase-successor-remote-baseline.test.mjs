import assert from "node:assert/strict";
import test from "node:test";

import {
  auditSuccessorRemoteBaseline,
  analyzeSuccessorRemoteBaseline,
  assertSuccessorRemoteBaselineReportMatchesContract,
  buildReadOnlyMigrationListArguments,
  buildSuccessorRemoteBaselineReport,
  parseSupabaseMigrationList,
  validateSuccessorRemoteBaselineContract,
} from "../lib/supabase-successor-remote-baseline.mjs";

test("applied successor migrations form an exact prefix and leave one ordered pending set", () => {
  const result = analyzeSuccessorRemoteBaseline({
    requiredRemoteHead: "20260716117000",
    successorVersions: [
      "20260718120000",
      "20260718130000",
      "20260730100000",
    ],
    remoteVersions: [
      "20260716117000",
      "20260718120000",
      "20260718130000",
    ],
  });

  assert.deepEqual(result, {
    status: "reconciliation_required",
    manifestRequiredRemoteHead: "20260716117000",
    observedRemoteHead: "20260718130000",
    appliedSuccessorVersions: [
      "20260718120000",
      "20260718130000",
    ],
    pendingSuccessorVersions: ["20260730100000"],
  });
});

test("a remote successor gap is rejected instead of being mistaken for an applied prefix", () => {
  assert.throws(
    () => analyzeSuccessorRemoteBaseline({
      requiredRemoteHead: "20260716117000",
      successorVersions: [
        "20260718120000",
        "20260718130000",
        "20260730100000",
      ],
      remoteVersions: [
        "20260716117000",
        "20260718130000",
      ],
    }),
    /exact prefix/i,
  );
});

test("the Supabase ledger parser exposes remote-only versions instead of hiding drift", () => {
  const result = parseSupabaseMigrationList(`
   Local          | Remote         | Time (UTC)
  ----------------|----------------|---------------------
   20260716117000 | 20260716117000 | 2026-07-16 11:70:00
                  | 20260717120000 | 2026-07-17 12:00:00
   20260718120000 |                | 2026-07-18 12:00:00
  `);

  assert.deepEqual(result, {
    localVersions: ["20260716117000", "20260718120000"],
    remoteVersions: ["20260716117000", "20260717120000"],
    remoteOnlyVersions: ["20260717120000"],
  });
});

test("the public baseline audit rejects remote-only migrations before prefix analysis", () => {
  assert.throws(
    () => auditSuccessorRemoteBaseline({
      requiredRemoteHead: "20260716117000",
      successorVersions: ["20260718120000"],
      migrationListOutput: `
        Local          | Remote         | Time (UTC)
        ----------------|----------------|---------------------
        20260716117000 | 20260716117000 | 2026-07-16 11:70:00
                       | 20260717120000 | 2026-07-17 12:00:00
        20260718120000 |                | 2026-07-18 12:00:00
      `,
    }),
    /remote-only/i,
  );
});

test("the release report binds the linked project and emits only bounded baseline facts", () => {
  const manifest = {
    release: "vendor-disclosure-v2-20260718",
    projectRef: "test-project-ref",
    requiredRemoteHead: "20260716117000",
    expandMigrations: [
      { file: "20260718120000_first.sql", sha256: "a".repeat(64) },
      { file: "20260718130000_second.sql", sha256: "b".repeat(64) },
      { file: "20260730100000_third.sql", sha256: "c".repeat(64) },
    ],
  };
  const migrationListOutput = `
    Local          | Remote         | Time (UTC)
    ----------------|----------------|---------------------
    20260716117000 | 20260716117000 | 2026-07-16 11:70:00
    20260718120000 | 20260718120000 | 2026-07-18 12:00:00
    20260718130000 | 20260718130000 | 2026-07-18 13:00:00
    20260730100000 |                | 2026-07-30 10:00:00
  `;

  const report = buildSuccessorRemoteBaselineReport({
    manifest,
    linkedProjectRef: "test-project-ref",
    migrationListOutput,
  });

  assert.deepEqual(report, {
    kind: "successor-remote-baseline-audit-v1",
    release: "vendor-disclosure-v2-20260718",
    projectRef: "test-project-ref",
    status: "reconciliation_required",
    manifestRequiredRemoteHead: "20260716117000",
    observedRemoteHead: "20260718130000",
    successorMigrationCount: 3,
    appliedSuccessorCount: 2,
    appliedSuccessorHead: "20260718130000",
    pendingSuccessorCount: 1,
    firstPendingSuccessor: "20260730100000",
    lastPendingSuccessor: "20260730100000",
    remoteOnlyCount: 0,
  });
  assert.throws(
    () => buildSuccessorRemoteBaselineReport({
      manifest,
      linkedProjectRef: "wrong-project-ref",
      migrationListOutput,
    }),
    /linked project/i,
  );
});

test("the baseline command is restricted to the linked read-only migration list", () => {
  const argumentsList = buildReadOnlyMigrationListArguments({
    wrapperPath: "C:/repo/node_modules/supabase/dist/supabase.js",
    repoRoot: "C:/repo",
  });

  assert.deepEqual(argumentsList, [
    "C:/repo/node_modules/supabase/dist/supabase.js",
    "migration",
    "list",
    "--linked",
    "--workdir",
    "C:/repo",
    "--agent",
    "no",
  ]);
  assert.equal(argumentsList.includes("push"), false);
  assert.equal(argumentsList.includes("repair"), false);
});

test("the historical baseline contract pins the exact applied prefix and pending suffix", () => {
  const manifest = {
    release: "vendor-disclosure-v2-20260718",
    projectRef: "test-project-ref",
    requiredRemoteHead: "20260716117000",
    expandMigrations: [
      { file: "20260718120000_first.sql", sha256: "a".repeat(64) },
      { file: "20260718130000_second.sql", sha256: "b".repeat(64) },
      { file: "20260730100000_third.sql", sha256: "c".repeat(64) },
    ],
  };
  const contract = {
    contractVersion: 1,
    kind: "successor-production-ledger-baseline-v1",
    release: manifest.release,
    projectRef: manifest.projectRef,
    predecessorHead: manifest.requiredRemoteHead,
    observedRemoteHead: "20260718130000",
    appliedSuccessorMigrations: manifest.expandMigrations.slice(0, 2),
    pendingSuccessorCount: 1,
    firstPendingSuccessor: "20260730100000",
    lastPendingSuccessor: "20260730100000",
    requiredRuntimeChecks: [
      "linked-project-exact",
      "remote-only-version-count-zero",
      "applied-successor-exact-prefix",
      "applied-migration-names-exact",
      "read-only-schema-preconditions-pass",
    ],
    verificationLimit:
      "ledger-version-and-name-equality-without-stored-sql-statements",
  };

  const validated = validateSuccessorRemoteBaselineContract({ manifest, contract });
  assert.deepEqual(validated.appliedMigrations, manifest.expandMigrations.slice(0, 2));
  assert.deepEqual(validated.pendingMigrations, manifest.expandMigrations.slice(2));
  const beforeFirstApply = validateSuccessorRemoteBaselineContract({
    manifest,
    contract: {
      ...contract,
      observedRemoteHead: manifest.requiredRemoteHead,
      appliedSuccessorMigrations: [],
      pendingSuccessorCount: 3,
      firstPendingSuccessor: "20260718120000",
      lastPendingSuccessor: "20260730100000",
    },
  });
  assert.equal(beforeFirstApply.appliedMigrations.length, 0);
  assert.equal(beforeFirstApply.pendingMigrations.length, 3);
  assert.throws(
    () => validateSuccessorRemoteBaselineContract({
      manifest,
      contract: {
        ...contract,
        appliedSuccessorMigrations: [
          manifest.expandMigrations[0],
          { ...manifest.expandMigrations[1], sha256: "d".repeat(64) },
        ],
      },
    }),
    /applied successor/i,
  );
});

test("the live read-only report must match the pinned historical baseline", () => {
  const remoteBaseline = {
    observedRemoteHead: "20260718130000",
    appliedMigrations: [{}, {}],
    pendingMigrations: [{}],
  };
  const report = {
    observedRemoteHead: "20260718130000",
    appliedSuccessorCount: 2,
    pendingSuccessorCount: 1,
    remoteOnlyCount: 0,
  };

  assert.equal(
    assertSuccessorRemoteBaselineReportMatchesContract({ report, remoteBaseline }),
    report,
  );
  assert.throws(
    () => assertSuccessorRemoteBaselineReportMatchesContract({
      report: { ...report, pendingSuccessorCount: 2 },
      remoteBaseline,
    }),
    /pinned historical baseline/i,
  );
});
