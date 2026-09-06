import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { assertSameBaseline, assertFencedBaseline, digest, digestJson, EVIDENCE_KINDS, loadCurrentBaselineContract,
  validateCurrentEvidence } from "../lib/current-baseline-release-contract.mjs";
import { createMigrationBundle, parseCurrentArgs, runCurrentBaselineRelease,
  verifyMigrationBundle } from "../lib/current-baseline-release-controller.mjs";
import { runProductionRelease } from "../lib/supabase-production-release-controller.mjs";
import { spawnSync } from "node:child_process";

const REPO = resolve(import.meta.dirname, "../..");
const NOW = new Date("2026-09-08T10:00:00Z");
const COMMIT = "a".repeat(40);
const clone = value => structuredClone(value);
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const blocked = code => error => error?.code === code;

function fixture() {
  const outer = mkdtempSync(join(tmpdir(), "current-baseline-test-")); roots.push(outer);
  const repo = join(outer, "repo"); const evidence = join(outer, "evidence"); const bundles = join(outer, "bundles");
  for (const path of [repo, evidence, bundles, join(repo, "supabase/release-contracts"), join(repo, "supabase/release-checks"), join(repo, "scripts"), join(evidence, "encrypted")]) mkdirSync(path, { recursive: true });
  cpSync(join(REPO, "supabase/migrations"), join(repo, "supabase/migrations"), { recursive: true });
  const contract = JSON.parse(readFileSync(join(REPO, "supabase/release-contracts/current-baseline-rollout-v1.json")));
  const baseline = JSON.parse(readFileSync(join(REPO, contract.baselineObservation.file)));
  // 소형 합성 DB를 사용한다. 실제 운영 baseline 파일은 별도 검사로 전량 검증한다.
  baseline.relations = baseline.relations.filter(x => ["public.profiles", "auth.users", "storage.objects", "storage.buckets", "supabase_migrations.schema_migrations", "vault.secrets", "cron.job"].includes(`${x.schema}.${x.name}`));
  baseline.objects = baseline.objects.filter(x => x.kind === "relation" && baseline.relations.some(r => `${r.schema}.${r.name}` === x.identity));
  json(join(repo, contract.baselineObservation.file), baseline);
  contract.baselineObservation.sha256 = digest(readFileSync(join(repo, contract.baselineObservation.file)));
  for (const pin of Object.values(contract.implementation)) cpSync(join(REPO, pin.file), join(repo, pin.file));
  const binaryDirectory = join(repo, "cli"); mkdirSync(binaryDirectory);
  writeFileSync(join(binaryDirectory, "supabase-go.exe"), "synthetic companion");
  contract.cli.companionSha256 = digest("synthetic companion");
  json(join(repo, "supabase/release-contracts/current-baseline-rollout-v1.json"), contract);
  const release = loadCurrentBaselineContract(repo);
  const common = { projectRef: contract.projectRef, releaseCommit: COMMIT, contractSha256: release.contractSha256,
    baselineSha256: release.baselineSha256, migrationSetSha256: release.migrationSetSha256, verifiedAt: NOW.toISOString() };
  const reports = Object.fromEntries(EVIDENCE_KINDS.map(kind => [kind, { ...common, kind: `current-baseline-${kind}-v1` }]));
  const artifacts = [];
  function artifact(scope) {
    const directory = `part-${String(artifacts.length).padStart(6, "0")}`;
    const name = scope === "schema-original" ? "schema-inventory.json" : "logical-data.json";
    const payload = Buffer.from(scope); const encrypted = Buffer.from(`synthetic encrypted ${scope}`); const key = Buffer.from(`synthetic key ${scope}`);
    const item = { directory, name, scope, artifact: `${name}.hbam2`, key: `${name}.key.dpapi`, backup_set_id: "e4981fe0-e5f8-4983-ae12-4b5fe2d981fc",
      plaintext_sha256: digest(payload), encrypted_sha256: digest(encrypted), key_sha256: digest(key), plaintext_bytes: payload.length, encrypted_bytes: encrypted.length };
    artifacts.push(item); mkdirSync(join(evidence, "encrypted", directory));
    writeFileSync(join(evidence, "encrypted", directory, item.artifact), encrypted); writeFileSync(join(evidence, "encrypted", directory, item.key), key);
    return item;
  }
  const relations = baseline.relations.filter(x => ["r", "p", "m", "S"].includes(x.kind)).map(x => {
    const identity = `${x.schema}.${x.name}`; return { identity, rows: 0, sha256: artifact(`relation:${identity}`).plaintext_sha256 };
  });
  artifact("schema-original"); artifact("storage-index");
  Object.assign(reports.backup, { ledger: clone(baseline.ledger), objects: clone(baseline.objects),
    fencedObjects: clone(baseline.objects), frozenStoragePolicies: baseline.storagePolicies.filter(x => x.command === "r"), relations, format: "hbam2-encrypted-current-user",
    beforeRelations: clone(relations), afterRelations: clone(relations), sourceWriters: { webWriteFenceEnabled: true,
      authSignupDisabled: true, authSignInDisabled: true, authRefreshDisabled: true,
      realtimeWritesDisabled: true, serviceWritersDisabled: true, backgroundWritersDisabled: true },
    plaintextWrittenToDisk: false, backupSetId: artifacts[0].backup_set_id, providerBackup: { status: "COMPLETED", physical: true, completedAt: NOW.toISOString() }, artifacts, directory: "encrypted" });
  Object.assign(reports.hostedRestore, { targetProjectRef: "r".repeat(20), isolation: { publicBuckets: 0, signupEnabled: false, enabledIdentityProviders: 0, outboundHooks: 0, cronJobs: 0,
    initialAuthUsers: 0, initialAuthSessions: 0, initialRefreshTokens: 0, initialStorageObjects: 0,
    exposedSchemas: [], publicDataApiGrants: 0, publicStorageReadAllowed: false, signInRequestsBlocked: true,
    refreshRequestsBlocked: true, realtimeConnectionsBlocked: true, outboundNetworkBlocked: true,
    productionRedirects: [], publicIngressBlocked: true }, authCanaryPassed: true,
    sourceRelations: clone(relations), targetRelations: clone(relations), targetObjects: clone(baseline.objects), targetLedger: clone(baseline.ledger), storageObjects: [] });
  Object.assign(reports.storage, { mutationPolicies: 0, databaseFenceHeld: true, maximumIssuedUploadTtlMinutes: 120,
    ttlSource: "supabase-createSignedUploadUrl-fixed-two-hours", webAndNativeIssuanceDisabled: true, serviceWritersDisabled: true,
    s3CredentialsRevokedAndWritesDrained: true, resumableUploadsDisabledAndDrained: true,
    frozenAt: "2026-09-08T07:40:00Z", firstSnapshotAt: "2026-09-08T09:50:00Z", secondSnapshotAt: "2026-09-08T09:55:00Z", firstObjects: [], secondObjects: [] });
  Object.assign(reports.hostedStaging, { targetProjectRef: "s".repeat(20), syntheticOnly: true, existingRowsPreserved: true, outboundAiCalls: 0,
    appliedMigrations: clone(contract.migrations), appliedLedgerRows: release.migrations.map(x => ({ version: x.version, name: x.file.slice(15, -4), statementsSha256: digest(x.sql) })),
    checks: ["actorBinding", "ownerPrivacy", "concurrentWrites", "approvalReceipt", "rollback", "featureFlagsOff"].map(name => ({ name, passed: true, rawEvidenceSha256: digest(name) })), postObjects: clone(baseline.objects), postRelations: clone(baseline.relations) });
  Object.assign(reports.finalizer, { targetProjectRef: "s".repeat(20), exactOwnerRejected: true, wrongPhaseRejected: true, wrongSchemaRejected: true, featureOffRollbackPassed: true, fenceHeldUntilCanary: true, rawEvidenceSha256: digest("finalizer"), postObjects: clone(baseline.objects), postRelations: clone(baseline.relations) });
  function save() {
    function writeReport(kind) {
      const report = reports[kind]; delete report.rawEvidence;
      const raw = { kind: `current-baseline-${kind}-observations-v1`, projectRef: report.projectRef, releaseCommit: report.releaseCommit,
        reportSha256: digestJson(report), exitCode: 0, transport: kind === "backup" ? "hbam2-and-supabase-hosted" : "supabase-hosted",
        observedAt: report.verifiedAt, commands: [{ commandSha256: digest(`synthetic ${kind}`), outputSha256: digest(`synthetic ${kind} output`), exitCode: 0 }] };
      const rawFile = `${kind}-raw.json`; json(join(evidence, rawFile), raw);
      report.rawEvidence = { file: rawFile, sha256: digest(readFileSync(join(evidence, rawFile))) };
      json(join(evidence, `${kind}.json`), report);
    }
    writeReport("backup");
    const backupHash = digest(readFileSync(join(evidence, "backup.json")));
    reports.hostedRestore.backupEvidenceSha256 = backupHash; reports.storage.backupEvidenceSha256 = backupHash;
    const index = {};
    for (const kind of EVIDENCE_KINDS) { writeReport(kind); const file = `${kind}.json`; index[kind] = { file, sha256: digest(readFileSync(join(evidence, file))) }; }
    json(join(evidence, "current-release-evidence.json"), index);
  }
  save();
  return { outer, repo, evidence, bundles, contract, baseline, release, reports, save, binary: join(binaryDirectory, "supabase.exe") };
}
const validate = f => validateCurrentEvidence({ root: f.evidence, release: f.release, expectedCommit: COMMIT, now: NOW });

test("실관측206개 이력과 신규8개만 채택하고 옛12개는 적용대상에서 제외한다", () => {
  const release = loadCurrentBaselineContract(REPO);
  assert.equal(release.baseline.ledger.length, 206); assert.equal(release.migrations.length, 8);
  assert.equal(release.contract.excludedHistoricalFiles.length, 12);
  assert.ok(release.baseline.relations.some(x => x.schema === "auth"));
  assert.ok(release.baseline.relations.some(x => x.schema === "amora_archive"));
});

test("같은 head에서 중간 이력 변경도 차단한다", () => {
  const f = fixture(); const changed = clone(f.baseline); changed.ledger[0].name += "_changed";
  assert.throws(() => assertSameBaseline(changed, f.baseline, f.contract), blocked("LIVE_LEDGER_DRIFT"));
});
test("함수·권한을 포함한 metadata 지문 변경은 차단한다", () => {
  const f = fixture(); const changed = clone(f.baseline); changed.objects[0].sha256 = "f".repeat(64);
  assert.throws(() => assertSameBaseline(changed, f.baseline, f.contract), blocked("LIVE_SCHEMA_DRIFT"));
});
test("새 Vault 값 또는 cron 작업이 생기면 자동 적용하지 않는다", () => {
  const f = fixture(); assert.throws(() => assertSameBaseline({ ...f.baseline, cronJobs: 1 }, f.baseline, f.contract), blocked("BASELINE_EXTERNAL_STATE_CHANGED"));
});
test("Storage freeze는 mutation 정책 제거만 허용하고 구조/SELECT 정책 변경은 차단한다", () => {
  const f = fixture(); const actual = { ...clone(f.baseline), storagePolicies: f.baseline.storagePolicies.filter(x => x.command === "r") };
  actual.objects.find(x => x.identity === "storage.objects").sha256 = digest("frozen policy state");
  assert.doesNotThrow(() => assertFencedBaseline(actual, f.baseline, f.contract));
  assert.throws(() => assertFencedBaseline({ ...actual, storagePolicies: [] }, f.baseline, f.contract), blocked("STORAGE_FREEZE_POLICY_DRIFT"));
  assert.throws(() => assertFencedBaseline({ ...actual, storageStructureSha256: digest("changed columns") }, f.baseline, f.contract), blocked("STORAGE_STRUCTURE_DRIFT"));
});
test("파일 한 바이트가 바뀌면 같은 migration 이름이라도 거절한다", () => {
  const f = fixture(); const path = join(f.repo, "supabase/migrations", f.release.migrations[0].file); writeFileSync(path, readFileSync(path) + "\n");
  assert.throws(() => loadCurrentBaselineContract(f.repo), blocked("ARTIFACT_HASH_MISMATCH"));
});
test("추가된 미검토 새 migration을 조용히 누락하지 않는다", () => {
  const f = fixture(); writeFileSync(join(f.repo, "supabase/migrations/20260907160000_unreviewed.sql"), "SELECT 1;");
  assert.throws(() => loadCurrentBaselineContract(f.repo), blocked("NEW_MIGRATION_NOT_REVIEWED"));
});
test("다섯 종류의 원본·binding·시간·복구 범위를 모두 충족해야 통과한다", () => {
  const f = fixture(); assert.equal(validate(f).reports.backup.relations.length, 7);
});
for (const [name, mutate, code] of [
  ["오래된 백업", f => { f.reports.backup.verifiedAt = "2026-09-08T09:29:59Z"; }, "EVIDENCE_STALE_OR_FUTURE"],
  ["미래 증거", f => { f.reports.storage.verifiedAt = "2026-09-08T10:00:01Z"; }, "EVIDENCE_STALE_OR_FUTURE"],
  ["다른 커밋", f => { f.reports.backup.releaseCommit = "b".repeat(40); }, "EVIDENCE_BINDING_MISMATCH"],
  ["Auth 원본 누락", f => { f.reports.backup.relations = f.reports.backup.relations.filter(x => x.identity !== "auth.users"); }, "BACKUP_RELATION_SCOPE_MISMATCH"],
  ["source Auth refresh 쓰기 활성", f => { f.reports.backup.sourceWriters.authRefreshDisabled = false; }, "BACKUP_SOURCE_WRITERS_NOT_FENCED"],
  ["수집 중 managed relation 변경", f => { f.reports.backup.afterRelations[0].sha256 = digest("changed row"); }, "BACKUP_SOURCE_DATA_CHANGED"],
  ["같은 운영 DB로 복구", f => { f.reports.hostedRestore.targetProjectRef = f.contract.projectRef; }, "RESTORE_TARGET_INVALID"],
  ["공개 버킷으로 복구", f => { f.reports.hostedRestore.isolation.publicBuckets = 1; }, "RESTORE_NOT_ISOLATED"],
  ["public API가 열린 복구", f => { f.reports.hostedRestore.isolation.exposedSchemas = ["public", "graphql_public"]; }, "RESTORE_NOT_ISOLATED"],
  ["Auth refresh가 열린 복구", f => { f.reports.hostedRestore.isolation.refreshRequestsBlocked = false; }, "RESTORE_NOT_ISOLATED"],
  ["복구 행 손실", f => { f.reports.hostedRestore.targetRelations[0].rows = 1; }, "RESTORE_DATA_MISMATCH"],
  ["복구 ACL 손실", f => { f.reports.hostedRestore.targetObjects[0].sha256 = "f".repeat(64); }, "RESTORE_SCHEMA_MISMATCH"],
  ["signed URL drain 미달", f => { f.reports.storage.frozenAt = "2026-09-08T09:40:00Z"; }, "STORAGE_DRAIN_INCOMPLETE"],
  ["잔존 TUS 여부 미확인", f => { f.reports.storage.resumableUploadsDisabledAndDrained = false; }, "OTHER_STORAGE_WRITERS_UNVERIFIED"],
  ["staging 다른 적용집합", f => { f.reports.hostedStaging.appliedMigrations.pop(); }, "STAGING_MIGRATIONS_MISMATCH"],
  ["원하지 않은 스키마 변경", f => { f.reports.hostedStaging.postObjects[0].sha256 = "f".repeat(64); }, "UNREVIEWED_SCHEMA_CHANGE"],
  ["잘못된 lease-owner finalizer 허용", f => { f.reports.finalizer.exactOwnerRejected = false; }, "FINALIZER_REHEARSAL_MISSING"],
]) test(`${name}은 apply 증거로 셈하지 않는다`, () => { const f = fixture(); mutate(f); f.save(); assert.throws(() => validate(f), blocked(code)); });

test("암호화 artifact 실제 bytes 변경도 거절한다", () => {
  const f = fixture(); const artifact = f.reports.backup.artifacts[0]; writeFileSync(join(f.evidence, "encrypted", artifact.directory, artifact.artifact), "tampered");
  assert.throws(() => validate(f), blocked("ARTIFACT_HASH_MISMATCH"));
});

test("4 MiB 초과 암호화 payload만 허용하며 JSON과 DPAPI key 바운드는 유지한다", () => {
  const f = fixture(); const artifact = f.reports.backup.artifacts[0];
  const payloadPath = join(f.evidence, "encrypted", artifact.directory, artifact.artifact);
  const large = Buffer.alloc(5 * 1024 * 1024, 7);
  writeFileSync(payloadPath, large); artifact.encrypted_sha256 = digest(large); f.save();
  assert.doesNotThrow(() => validate(f));
  writeFileSync(join(f.evidence, "encrypted", artifact.directory, artifact.key), large);
  artifact.key_sha256 = digest(large); f.save();
  assert.throws(() => validate(f), blocked("ARTIFACT_SIZE_INVALID"));
  const jsonFixture = fixture(); jsonFixture.reports.backup.padding = "x".repeat(5 * 1024 * 1024); jsonFixture.save();
  assert.throws(() => validate(jsonFixture), blocked("ARTIFACT_SIZE_INVALID"));
});

test("0-byte Storage 원본은 비어 있지 않은 암호화 envelope와 별도 원본 digest로 검증한다", () => {
  const f = fixture(); const directory = "part-000009"; const bytes = Buffer.from("synthetic empty-object envelope");
  const identity = digest("bucket\0empty"); const emptyHash = digest(Buffer.alloc(0));
  mkdirSync(join(f.evidence, "encrypted", directory));
  writeFileSync(join(f.evidence, "encrypted", directory, "logical-data.json.hbam2"), bytes);
  writeFileSync(join(f.evidence, "encrypted", directory, "logical-data.json.key.dpapi"), bytes);
  f.reports.backup.artifacts.push({ directory, name: "logical-data.json", scope: `storage:${identity}`,
    artifact: "logical-data.json.hbam2", key: "logical-data.json.key.dpapi", plaintext_bytes: bytes.length,
    plaintext_sha256: digest(bytes), encrypted_sha256: digest(bytes), key_sha256: digest(bytes),
    original_bytes: 0, original_sha256: emptyHash });
  const objects = [{ identity, bytes: 0, sha256: emptyHash }];
  f.reports.storage.firstObjects = objects; f.reports.storage.secondObjects = clone(objects);
  f.reports.hostedRestore.storageObjects = clone(objects); f.save();
  assert.doesNotThrow(() => validate(f));
  f.reports.backup.artifacts.at(-1).original_sha256 = digest("not empty"); f.save();
  assert.throws(() => validate(f), blocked("STORAGE_ORIGINAL_NOT_BACKED_UP"));
});

test("bundle에는 과거 원문과 신규8개만 넣고 늦은 파일 추가/변경을 감지한다", async () => {
  const f = fixture();
  const missing = f.release.baseline.ledger.find(x => x.version === "20260820100000");
  // synthetic recorded source의 실제 JSON bytes hash를 baseline에 묶는다.
  const statementsJson = '["SELECT 1"]'; missing.statementsSha256 = digest(statementsJson);
  const bundle = await createMigrationBundle({ repoRoot: f.repo, parent: f.bundles, release: f.release, historicalSources: [{ ...missing, statementsJson }] });
  assert.equal(bundle.files.filter(x => x.provenance === "new-reviewed-migration").length, 8);
  assert.equal(bundle.files.filter(x => x.file.startsWith("supabase/migrations/")).length, 214);
  assert.ok(f.contract.excludedHistoricalFiles.every(x => !bundle.files.some(p => p.file.endsWith(x))));
  writeFileSync(join(bundle.root, "supabase/migrations/20260907160000_extra.sql"), "SELECT 1;");
  await assert.rejects(() => verifyMigrationBundle(bundle), blocked("BUNDLE_MIGRATION_SET_CHANGED"));
});
test("remote-only 이력 원문을 얻지 못하면 placeholder를 만들지 않는다", async () => {
  const f = fixture(); await assert.rejects(() => createMigrationBundle({ repoRoot: f.repo, parent: f.bundles, release: f.release, historicalSources: [] }), blocked("RECORDED_HISTORY_SOURCE_MISSING"));
});
test("기존 apply entrypoint가 새 분기를 실제 선택하며 include-all/repair 인자를 거절한다", async () => {
  await assert.rejects(() => runProductionRelease({ repoRoot: REPO, argv: ["--current-baseline", "--check-only", "--include-all"] }), blocked("ARGUMENT_INVALID"));
  assert.throws(() => parseCurrentArgs(["--current-baseline", "--apply", "--repair=1"]), blocked("ARGUMENT_INVALID"));
});

function runnerFixture(f, { failPush = false, postLedgerDrift = false, postRelationDrift = false,
  postStatementDrift = false, pendingMissing = false } = {}) {
  const calls = []; let applied = false; let snapshot = clone(f.baseline);
  const source = { version: "20260820100000", name: "community_report_privacy_reason", statementsJson: '["SELECT 1"]' };
  const historicalRow = f.baseline.ledger.find(x => x.version === source.version); historicalRow.statementsSha256 = digest(source.statementsJson);
  // bundle's runtime historical source must be identical to this synthetic baseline pin.
  json(join(f.repo, f.contract.baselineObservation.file), f.baseline);
  f.contract.baselineObservation.sha256 = digest(readFileSync(join(f.repo, f.contract.baselineObservation.file)));
  json(join(f.repo, "supabase/release-contracts/current-baseline-rollout-v1.json"), f.contract);
  f.release = loadCurrentBaselineContract(f.repo); snapshot = { ...clone(f.baseline), storagePolicies: f.baseline.storagePolicies.filter(x => x.command === "r") };
  for (const report of Object.values(f.reports)) { report.contractSha256 = f.release.contractSha256; report.baselineSha256 = f.release.baselineSha256; }
  f.reports.backup.ledger = clone(f.baseline.ledger); f.reports.hostedRestore.targetLedger = clone(f.baseline.ledger); f.save();
  const result = stdout => ({ status: 0, stdout, stderr: "", signal: null });
  const primitives = {
    assertReleaseGitFence: async () => { calls.push("git-fence"); },
    resolvePinnedSupabaseCli: async () => f.binary,
    createLinkedRefFence: async () => async () => { calls.push("linked-ref"); },
    assertDryRunRecognized: output => assert.match(output, /DRY RUN/),
    parsePendingMigrations: output => output.split("\n").filter(x => /^\d{14}_.*\.sql$/.test(x)),
    assertExactOrdered: (a, b, code) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw Object.assign(new Error(code), { code }); },
    runReadOnlyChecks: async () => { calls.push("db-fence"); },
    runRemoteReleaseLease: async ({ action }) => { calls.push(`lease:${action}`); },
    writeReceipt: async (path, value, opts = {}) => writeFileSync(path, JSON.stringify(value), opts.exclusive ? { flag: "wx" } : undefined),
  };
  const runCommand = async (command, args) => {
    if (command === "synthetic-powershell") { calls.push("decrypt"); return result(JSON.stringify({ verified: true, projectRef: f.contract.projectRef, releaseCommit: COMMIT, evidenceIndexSha256: validate(f).indexSha256, artifactCount: f.reports.backup.artifacts.length })); }
    if (args[0] === "db" && args[1] === "query") return result(JSON.stringify(args[3].includes('AS "statementsJson"') ? [source] : [{ observation: snapshot }]));
    if (args.includes("--dry-run")) { calls.push("dry-run"); return result(`DRY RUN\n${applied ? "" : f.release.migrations.slice(pendingMissing ? 1 : 0).map(x => x.file).join("\n")}`); }
    if (args[0] === "db" && args[1] === "push") {
      calls.push("push"); if (failPush) return { status: 1, stdout: "", stderr: "synthetic failure" };
      applied = true; snapshot.ledger.push(...f.release.migrations.map(x => ({ version: x.version, name: x.file.slice(15, -4), statementsSha256: digest(x.sql) })));
      if (postLedgerDrift) snapshot.ledger[0].name = "unexpected_rewrite";
      if (postStatementDrift) snapshot.ledger.at(-1).statementsSha256 = digest("different statements with same version/name");
      if (postRelationDrift) snapshot.relations.find(x => x.schema === "storage" && x.name === "buckets").kind = "p";
      return result("success");
    }
    throw new Error("Unexpected synthetic command");
  };
  const invoke = apply => runCurrentBaselineRelease({ repoRoot: f.repo, argv: ["--current-baseline", apply ? "--apply" : "--check-only", `--expected-commit=${COMMIT}`, "--remote-ref=origin/main", `--evidence-root=${f.evidence}`, `--bundle-root=${f.bundles}`, ...(apply ? [`--receipt-out=${join(f.outer, "outcome.json")}`] : []), `--confirm-production=${apply ? "APPLY" : "CHECK"}:${f.contract.projectRef}:${f.contract.release}:${COMMIT}`], runCommand, now: () => NOW, primitives, resolveToolchain: async () => ({ powershell: "synthetic-powershell" }) });
  return { calls, invoke };
}

test("전량 검증된 check-only는 dry-run까지 실행하고 lease/write는 하지 않는다", async () => {
  const f = fixture(); const runner = runnerFixture(f); const result = await runner.invoke(false);
  assert.equal(result.status, "current_baseline_preflight_verified"); assert.ok(runner.calls.includes("decrypt"));
  assert.ok(runner.calls.includes("dry-run")); assert.ok(!runner.calls.some(x => x.startsWith("lease:") || x === "push"));
});
test("정상 apply는 검증·lease·push1회·전체postcheck 순서로 실제 실행하고 fence를 유지한다", async () => {
  const f = fixture(); const runner = runnerFixture(f); const result = await runner.invoke(true);
  assert.equal(result.status, "database_expand_verified_lease_held");
  assert.equal(runner.calls.filter(x => x === "push").length, 1);
  assert.ok(runner.calls.indexOf("decrypt") < runner.calls.indexOf("lease:claim"));
  assert.ok(runner.calls.indexOf("lease:verify_claimed") < runner.calls.indexOf("push"));
  assert.ok(runner.calls.includes("lease:verify_deploying")); assert.ok(!runner.calls.includes("lease:release"));
  await assert.rejects(() => runner.invoke(true)); assert.equal(runner.calls.filter(x => x === "push").length, 1);
});
test("응답 실패나 postcheck 실패 뒤는 lease해제/자동재시도 없이 ambiguous로 보존한다", async () => {
  for (const scenario of [{ failPush: true }, { postLedgerDrift: true }, { postRelationDrift: true }, { postStatementDrift: true }]) {
    const f = fixture(); const runner = runnerFixture(f, scenario);
    await assert.rejects(() => runner.invoke(true));
    assert.equal(runner.calls.filter(x => x === "push").length, 1); assert.ok(!runner.calls.includes("lease:release"));
    assert.equal(JSON.parse(readFileSync(join(f.outer, "outcome.json"))).status, "release_requires_adjudication");
  }
});

test("CLI dry-run이 신규 SQL 하나를 빠뜨리면 lease를 잡거나 push하지 않는다", async () => {
  const f = fixture(); const runner = runnerFixture(f, { pendingMissing: true });
  await assert.rejects(() => runner.invoke(true), blocked("INCREMENTAL_PENDING_MISMATCH"));
  assert.ok(!runner.calls.some(x => x.startsWith("lease:") || x === "push"));
});

test("실제 Windows DPAPI/HBAM2 복호화 뒤 동일개수의 다른 schema/ledger/index를 거절한다", { skip: process.platform !== "win32" }, () => {
  const outer = mkdtempSync(join(tmpdir(), "current-backup-crypto-test-")); roots.push(outer);
  const script = join(outer, "probe.ps1");
  const quote = value => `'${value.replace(/'/g, "''")}'`;
  writeFileSync(script, `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. ${quote(join(REPO, "scripts/amora-db-backup-common.ps1"))}
$anchor = Resolve-HBAM2BackupRoot -SelfTest $false
Initialize-HBAM2BackupRoot -Root $anchor.Root -Anchor $anchor.Anchor
$testDirectory = Join-Path $anchor.Root ('current-release-self-test-' + [Guid]::NewGuid().ToString('D'))
[IO.Directory]::CreateDirectory($testDirectory) | Out-Null
Set-HBAM2PrivateDirectoryAcl -Path $testDirectory
$encrypted = Join-Path $testDirectory 'encrypted'
[IO.Directory]::CreateDirectory($encrypted) | Out-Null
Set-HBAM2PrivateDirectoryAcl -Path $encrypted
$ref = 'ssssssssssssssssssss'
$commit = '${COMMIT}'
$setId = [Guid]::NewGuid().ToString('D')
$schema = [PSCustomObject]@{format='current-baseline-schema-original-v1';statements=@('CREATE TABLE public.example(id integer);');objects=@([PSCustomObject]@{kind='relation';identity='public.example';sha256=('a'*64)});ledger=@([PSCustomObject]@{version='20260901000000';name='example';statementsSha256=('b'*64)})}
$emptyHash='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
$keyBytes=[Text.Encoding]::UTF8.GetBytes('synthetic-bucket'+[char]0+'empty')
$storageIdentity=(Get-HBAM2Sha256Hex -Bytes $keyBytes).ToLowerInvariant()
$storage = [PSCustomObject]@{format='current-baseline-storage-index-v1';objects=@([PSCustomObject]@{identity=$storageIdentity;bucket='synthetic-bucket';name='empty';sha256=$emptyHash;bytes=0})}
$emptyObject=[PSCustomObject]@{format='current-baseline-storage-object-v1';identity=$storageIdentity;bytes=0;sha256=$emptyHash;base64=''}
$relation = [PSCustomObject]@{format='current-baseline-relation-v1';identity='public.example';columns=@('id');rows=@()}
$artifacts = @()
function Save-Json([string] $Path,$Value) {
  $bytes=[Text.Encoding]::UTF8.GetBytes(($Value|ConvertTo-Json -Depth 100 -Compress))
  [IO.File]::WriteAllBytes($Path,$bytes)
  return (Get-HBAM2Sha256Hex -Bytes $bytes).ToLowerInvariant()
}
try {
  $schema.statements=@('SELECT 1; -- '+('x'*(5*1024*1024)))
  $payloads = @(@{directory='part-000000';name='schema-inventory.json';scope='schema-original';value=$schema},@{directory='part-000001';name='logical-data.json';scope='storage-index';value=$storage},@{directory='part-000002';name='logical-data.json';scope='relation:public.example';value=$relation},@{directory='part-000003';name='logical-data.json';scope=('storage:'+$storageIdentity);value=$emptyObject})
  foreach($item in $payloads) {
    $shardDirectory=Join-Path $encrypted $item.directory
    [IO.Directory]::CreateDirectory($shardDirectory)|Out-Null
    Set-HBAM2PrivateDirectoryAcl -Path $shardDirectory
    $bytes=[Text.Encoding]::UTF8.GetBytes(($item.value|ConvertTo-Json -Depth 100 -Compress))
    try {$metadata=[PSCustomObject](Protect-HBAM2Artifact -Directory $shardDirectory -Plaintext $bytes -ArtifactName $item.name -ProjectRef $ref -BackupSetId $setId)}
    finally {[Array]::Clear($bytes,0,$bytes.Length)}
    $metadata|Add-Member -NotePropertyName name -NotePropertyValue $item.name
    $metadata|Add-Member -NotePropertyName scope -NotePropertyValue $item.scope
    $metadata|Add-Member -NotePropertyName directory -NotePropertyValue $item.directory
    if ($item.scope.StartsWith('storage:')) {
      $metadata|Add-Member -NotePropertyName original_bytes -NotePropertyValue $item.value.bytes
      $metadata|Add-Member -NotePropertyName original_sha256 -NotePropertyValue $item.value.sha256
    }
    $artifacts+=,$metadata
  }
  $report=[PSCustomObject]@{projectRef=$ref;releaseCommit=$commit;format='hbam2-encrypted-current-user';plaintextWrittenToDisk=$false;directory='encrypted';backupSetId=$setId;artifacts=$artifacts;objects=$schema.objects;ledger=$schema.ledger;relations=@([PSCustomObject]@{identity='public.example';rows=0})}
  $storageReport=[PSCustomObject]@{firstObjects=@([PSCustomObject]@{identity=$storageIdentity;sha256=$emptyHash;bytes=0})}
  function Run-Verify {
    $backupHash=Save-Json (Join-Path $testDirectory 'backup.json') $report
    $storageHash=Save-Json (Join-Path $testDirectory 'storage.json') $storageReport
    $index=[PSCustomObject]@{backup=@{file='backup.json';sha256=$backupHash};storage=@{file='storage.json';sha256=$storageHash}}
    $indexHash=Save-Json (Join-Path $testDirectory 'current-release-evidence.json') $index
    $oldPreference=$ErrorActionPreference
    $ErrorActionPreference='Continue'
    $null = & 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' -NoProfile -NonInteractive -File ${quote(join(REPO, "scripts/current-baseline-backup-verify.ps1"))} -EvidenceRoot $testDirectory -BackupReport $indexHash -ExpectedProjectRef $ref -ExpectedCommit $commit 2>$null
    $code=$LASTEXITCODE
    $ErrorActionPreference=$oldPreference
    return $code
  }
  if ((Run-Verify) -ne 0) {throw 'CLEAN_CRYPTO_FAILED'}
  $report.objects=@([PSCustomObject]@{kind='relation';identity='public.changed';sha256=('a'*64)})
  if ((Run-Verify) -eq 0) {throw 'SCHEMA_REPLACEMENT_ACCEPTED'}
  $report.objects=$schema.objects
  $report.ledger=@([PSCustomObject]@{version='20260901000000';name='changed';statementsSha256=('b'*64)})
  if ((Run-Verify) -eq 0) {throw 'LEDGER_REPLACEMENT_ACCEPTED'}
  $report.ledger=$schema.ledger
  $report.artifacts[3].original_sha256=('e'*64)
  if ((Run-Verify) -eq 0) {throw 'EMPTY_ORIGINAL_REPLACEMENT_ACCEPTED'}
  $report.artifacts[3].original_sha256=$emptyHash
  $storageReport.firstObjects=@([PSCustomObject]@{identity=('c'*64);sha256=('d'*64);bytes=4})
  if ((Run-Verify) -eq 0) {throw 'STORAGE_INDEX_REPLACEMENT_ACCEPTED'}
  Write-Output 'CRYPTO_PAYLOAD_BOUNDARIES_VERIFIED'
} finally {
  $resolved=[IO.Path]::GetFullPath($testDirectory)
  if ([IO.Path]::GetDirectoryName($resolved) -ceq [IO.Path]::GetFullPath($anchor.Root) -and [IO.Path]::GetFileName($resolved) -match '^current-release-self-test-[a-f0-9-]{36}$') {
    Assert-HBAM2PathUnderAnchorWithoutReparsePoints -Path $resolved -Anchor $anchor.Root
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
`);
  const env = { ...process.env }; delete env.PSModulePath;
  const result = spawnSync("C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script], { env, windowsHide: true, encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CRYPTO_PAYLOAD_BOUNDARIES_VERIFIED/);
});
