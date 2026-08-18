import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const EVIDENCE_PATH =
  "docs/operations/evidence/amora-final-candidate-freeze-20260818.json";

const HOTSPOTS = [
  "apps/mobile/app/(tabs)/chat.tsx",
  "apps/mobile/app/schedule/index.tsx",
  "apps/web/src/app/api/chat/__tests__/routeOpenAIContract.test.ts",
  "apps/web/src/app/api/chat/route.ts",
];

function gitBuffer(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: null,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr?.toString("utf8") || result.stdout?.toString("utf8")}`,
  );
  return result.stdout;
}

function git(args) {
  return gitBuffer(args).toString("utf8").trim();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readEvidence() {
  return JSON.parse(readFileSync(EVIDENCE_PATH, "utf8"));
}

test("EX-009 evidence binds one immutable candidate and exact path allowlist", () => {
  const evidence = readEvidence();
  assert.deepEqual(Object.keys(evidence).sort(), [
    "baselineCommit",
    "candidateCommit",
    "candidateDelta",
    "candidateTree",
    "capturedAt",
    "excludedLocalPaths",
    "gateEvidence",
    "hotspotOwnership",
    "release",
    "schemaVersion",
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.match(evidence.candidateCommit, /^[a-f0-9]{40}$/u);
  assert.match(evidence.baselineCommit, /^[a-f0-9]{40}$/u);
  assert.match(evidence.candidateTree, /^[a-f0-9]{40}$/u);
  assert.equal(git(["rev-parse", `${evidence.candidateCommit}^{tree}`]), evidence.candidateTree);

  const actualStatus = git([
    "diff",
    "--name-status",
    evidence.baselineCommit,
    evidence.candidateCommit,
  ])
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [status, path] = line.split("\t");
      return { status, path };
    });

  const frozenStatus = evidence.candidateDelta.paths.map(({ status, path }) => ({
    status,
    path,
  }));
  assert.deepEqual(frozenStatus, actualStatus);
  assert.equal(evidence.candidateDelta.pathCount, actualStatus.length);
  assert.equal(
    evidence.candidateDelta.addedCount,
    actualStatus.filter(({ status }) => status === "A").length,
  );
  assert.equal(
    evidence.candidateDelta.modifiedCount,
    actualStatus.filter(({ status }) => status === "M").length,
  );
  assert.equal(
    evidence.candidateDelta.deletedCount,
    actualStatus.filter(({ status }) => status === "D").length,
  );
  assert.ok(actualStatus.every(({ path }) => !path.startsWith("tmp/")));
  assert.ok(
    actualStatus.every(({ path }) => !path.startsWith("apps/web/src/constants/decisionMap/")),
  );

  for (const entry of evidence.candidateDelta.paths) {
    assert.match(entry.blobOid, /^[a-f0-9]{40}$/u);
    assert.equal(
      git(["rev-parse", `${evidence.candidateCommit}:${entry.path}`]),
      entry.blobOid,
      `${entry.path} candidate blob drifted`,
    );
  }
});

test("EX-009 evidence freezes all mixed-hotspot commit owners", () => {
  const evidence = readEvidence();
  assert.deepEqual(
    evidence.hotspotOwnership.map(({ path }) => path).sort(),
    HOTSPOTS,
  );

  for (const hotspot of evidence.hotspotOwnership) {
    const actualCommits = git([
      "log",
      "--format=%H",
      `${evidence.baselineCommit}..${evidence.candidateCommit}`,
      "--",
      hotspot.path,
    ])
      .split(/\r?\n/u)
      .filter(Boolean)
      .sort();
    const frozenCommits = hotspot.owners
      .map(({ commit, primaryAmr, regression }) => {
        assert.match(commit, /^[a-f0-9]{40}$/u);
        assert.match(primaryAmr, /^AMR-[A-Z0-9~/]+$/u);
        assert.ok(Array.isArray(regression) && regression.length > 0);
        return commit;
      })
      .sort();
    assert.deepEqual(frozenCommits, actualCommits, `${hotspot.path} has an unowned commit`);
    assert.equal(new Set(frozenCommits).size, frozenCommits.length);
  }
});

test("EX-009 evidence pins migration delta and fail-closed release state", () => {
  const evidence = readEvidence();
  const migrationEntries = evidence.candidateDelta.paths.filter(({ path }) =>
    path.startsWith("supabase/migrations/"),
  );
  assert.deepEqual(
    evidence.release.migrationDelta.map(({ path, status, blobOid }) => ({
      path,
      status,
      blobOid,
    })),
    migrationEntries.map(({ path, status, blobOid }) => ({ path, status, blobOid })),
  );
  for (const migration of evidence.release.migrationDelta) {
    assert.match(migration.sha256, /^[a-f0-9]{64}$/u);
    const content = gitBuffer(["show", `${evidence.candidateCommit}:${migration.path}`]);
    assert.equal(sha256(content), migration.sha256, `${migration.path} SHA-256 drifted`);
  }

  const manifestBuffer = gitBuffer([
    "show",
    `${evidence.candidateCommit}:${evidence.release.manifestPath}`,
  ]);
  const baselineBuffer = gitBuffer([
    "show",
    `${evidence.candidateCommit}:${evidence.release.baselinePath}`,
  ]);
  const manifest = JSON.parse(manifestBuffer.toString("utf8"));
  const baseline = JSON.parse(baselineBuffer.toString("utf8"));
  assert.equal(manifest.status, "deployment_blocked");
  assert.equal(manifest.expandMigrations.length, evidence.release.manifestMigrationCount);
  assert.equal(
    baseline.appliedSuccessorMigrations.length,
    evidence.release.observedProductionAppliedCount,
  );
  assert.equal(
    baseline.pendingSuccessorCount,
    evidence.release.observedProductionPendingCount,
  );
  assert.equal(
    baseline.lastPendingSuccessor,
    evidence.release.tailMigration,
  );
  assert.equal(
    sha256(manifestBuffer),
    evidence.release.manifestSha256,
  );
  assert.equal(
    sha256(baselineBuffer),
    evidence.release.baselineSha256,
  );
});

test("EX-009 local exclusions stay outside the candidate", () => {
  const evidence = readEvidence();
  assert.deepEqual(evidence.excludedLocalPaths.hold, [
    "apps/web/src/constants/decisionMap/types.ts",
    "apps/web/src/constants/decisionMap/venue.ts",
  ]);
  assert.equal(evidence.excludedLocalPaths.temporaryPrefix, "tmp/");
  assert.equal(evidence.excludedLocalPaths.observedTemporaryPathCount, 36);
  assert.equal(evidence.excludedLocalPaths.disposition, "EXCLUDED_NOT_DELETED");
});

test("EX-009 gate record does not overclaim CI, device, hosted, or Production", () => {
  const evidence = readEvidence();
  assert.equal(evidence.gateEvidence.localPrePush, "PASS");
  assert.equal(evidence.gateEvidence.preview, "PASS");
  assert.equal(evidence.gateEvidence.githubActions, "BLOCKED_EXTERNAL_BILLING");
  assert.equal(evidence.gateEvidence.realDevice, "NOT_RUN");
  assert.equal(evidence.gateEvidence.twoAccountTwoDevice, "NOT_RUN");
  assert.equal(evidence.gateEvidence.finalCandidateHostedStaging, "NOT_RUN");
  assert.equal(evidence.gateEvidence.production, "NO_GO");
});
