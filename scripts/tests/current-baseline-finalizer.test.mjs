import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";
import { createHistoricalReleaseRepository } from './fixtures/legacy-release-repository.mjs';
import { pathToFileURL } from "node:url";
import { digest, digestJson } from "../lib/current-baseline-release-contract.mjs";
import { parseCurrentFinalizerArgs, validateCurrentFinalizationOutcome, validateCurrentFinalizationObservation,
  validateCurrentFinalizationGates, currentFinalizerObservationSql, renderCurrentBaselineFinalizerSql,
  runCurrentBaselineFinalizer, currentFinalizerEvidenceDeadline } from "../lib/current-baseline-finalizer.mjs";
import { PRODUCTION_CANARY_REQUIRED_CHECKS, buildVercelDeploymentReceipt, runProductionCanaryHttpEvidence,
  buildProductionCanaryReceiptWithProvenance, buildProductionFenceReadOnlyProbeSql, externalGateSha256 } from "../lib/production-external-gate-provenance.mjs";

const REPO = resolve(import.meta.dirname, "../..");
const historical = createHistoricalReleaseRepository(REPO);
test.after(historical.cleanup);
const RELEASE = "amora-current-baseline-20260907";
const SOURCE_REF = "slrtobkksjmxgzatjyqb";
const COMMIT = "a".repeat(40);
const TEAM_ID = "team_XwMZqiJ4wXM2Ypvs99icXaQx";
const PROJECT_ID = "prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes";
const DEPLOYMENT_ID = "dpl_abcdefghijklmnopqrstuvwxyz";
const PRODUCTION_HOST = "hanbang.ai";
const DEPLOYMENT_HOST = "wedding-hanbang-web-abc123.vercel.app";
const DATABASE_SYSTEM_IDENTIFIER = "7581440907192989109";
const CANARY_RAW_FILE = "canary-raw.json";
const VERCEL_SERVER_ERROR_RAW_FILE = "server-errors.json";
const NOW = new Date("2026-07-17T01:20:00.000Z");
const OWNER = "2b1e25e8-5e50-4a5d-8f2d-31fa3a407de5";
const clone = x => structuredClone(x);
const blocked = code => error => error?.code === code;
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function releaseDataFixture() {
  // 계약 loader의 파일 pin 검증은 기존 current-baseline-release suite가 담당한다.
  // 여기서는 finalizer 의미 변이가 자기 파일 pin 실패로 가려지지 않도록 계약 데이터만 가져온다.
  const bytes = readFileSync(join(historical.root, "supabase/release-contracts/current-baseline-rollout-v1.json"));
  const contract = JSON.parse(bytes);
  const baseline = JSON.parse(readFileSync(join(historical.root, contract.baselineObservation.file)));
  const migrations = contract.migrations.map(pin => ({ ...pin, version: pin.file.slice(0, 14), sql: readFileSync(join(historical.root, "supabase/migrations", pin.file), "utf8") }));
  return { contract, baseline, migrations, contractSha256: digest(bytes), baselineSha256: digestJson(baseline), migrationSetSha256: digestJson(contract.migrations) };
}
function allCanaryChecks() {
  return Object.fromEntries(
    PRODUCTION_CANARY_REQUIRED_CHECKS.map((check) => [check, true]),
  );
}

function makeCanaryHarness({
  wrongCommit = false,
  publicStatus = 200,
  publicUrl = `https://${PRODUCTION_HOST}/wedding`,
} = {}) {
  const start = Date.parse("2026-07-17T01:10:00.000Z");
  let phase = "start";
  let tick = 0;
  return {
    now() {
      const phaseOffset = phase === "finish" ? 300_000 : 0;
      return new Date(start + phaseOffset + tick++);
    },
    async wait(milliseconds) {
      assert.equal(milliseconds, 300_000);
      phase = "finish";
      tick = 0;
    },
    async fetch(url, options) {
      const parsed = new URL(url);
      if (parsed.pathname === "/wedding") {
        return response({
          status: publicStatus,
          url: publicUrl,
          body: "<html>웨딩한방</html>",
          headers: { "cache-control": "public, max-age=0" },
        });
      }
      assert.equal(options.method, "POST");
      return response({
        status: 503,
        url,
        body: JSON.stringify({ error: "production_write_fence_enabled" }),
        headers: {
          "cache-control": "private, no-store",
          "x-hanbang-deployment-commit": wrongCommit ? "b".repeat(40) : COMMIT,
        },
      });
    },
    async browserRunner(context) {
      const startedAt = context.now();
      const completedAt = context.now();
      return {
        evidenceVersion: 1,
        runner: "playwright-core-public-v1",
        expectedHost: PRODUCTION_HOST,
        pagePath: "/wedding",
        finalUrl: `https://${PRODUCTION_HOST}/wedding`,
        status: 200,
        consoleErrorHashes: [],
        pageErrorHashes: [],
        requestFailureHashes: [],
        navigationDurationMs: completedAt.getTime() - startedAt.getTime(),
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        containsSecrets: false,
      };
    },
    async authenticatedSessionRunner(context) {
      const startedAt = context.now();
      const completedAt = context.now();
      return {
        evidenceVersion: 1,
        runner: "supabase-auth-rest-v1",
        projectRef: SOURCE_REF,
        userIdSha256: "c".repeat(64),
        loginStatus: 200,
        authenticatedReadStatus: 200,
        authenticatedReadRowCount: 1,
        logoutStatus: 204,
        refreshAfterLogoutStatus: 400,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        containsSecrets: false,
      };
    },
    async databaseFenceRunner(context) {
      const checkedAt = context.now().toISOString();
      return {
        probeVersion: 1,
        transactionReadOnly: true,
        databaseName: "postgres",
        projectRef: SOURCE_REF,
        databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
        productionWriteFenceVerifiedCount: 1,
        checkedAt,
        probeSqlSha256: externalGateSha256(
          buildProductionFenceReadOnlyProbeSql({ projectRef: SOURCE_REF }),
        ),
      };
    },
    async vercelServerErrorRunner() {
      return "[]\n";
    },
  };
}

function response({ status, url, body, headers = {} }) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    status,
    url,
    headers: {
      get(name) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
    async text() {
      return body;
    },
  };
}

function auxiliaryRunnerArguments(harness) {
  return {
    projectRef: SOURCE_REF,
    databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
    deploymentReady: true,
    browserRunner: harness.browserRunner,
    authenticatedSessionRunner: harness.authenticatedSessionRunner,
    databaseFenceRunner: harness.databaseFenceRunner,
    vercelServerErrorRunner: harness.vercelServerErrorRunner,
  };
}

async function buildCanary(deploymentRawSha256) {
  const harness = makeCanaryHarness();
  const evidence = await runProductionCanaryHttpEvidence({
    fetchImpl: harness.fetch,
    expectedHost: PRODUCTION_HOST,
    expectedCommit: COMMIT,
    deploymentRawEvidenceSha256: deploymentRawSha256,
    projectRef: SOURCE_REF,
    databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
    deploymentReady: true,
    browserRunner: harness.browserRunner,
    authenticatedSessionRunner: harness.authenticatedSessionRunner,
    databaseFenceRunner: harness.databaseFenceRunner,
    vercelServerErrorRunner: harness.vercelServerErrorRunner,
    now: harness.now,
    wait: harness.wait,
  });
  const baseReceipt = {
    receiptVersion: 1,
    kind: "production-write-fenced-canary",
    release: RELEASE,
    projectRef: SOURCE_REF,
    releaseCommit: COMMIT,
    observationStartedAt: evidence.raw.observationStartedAt,
    verifiedAt: evidence.raw.verifiedAt,
    expiresAt: new Date(
      Date.parse(evidence.raw.verifiedAt) + 15 * 60_000,
    ).toISOString(),
    observationWindowSeconds: 300,
    checks: allCanaryChecks(),
    containsSecrets: false,
  };
  return {
    evidence,
    receipt: buildProductionCanaryReceiptWithProvenance({
      baseReceipt,
      rawText: evidence.rawText,
      rawEvidenceFileName: CANARY_RAW_FILE,
      vercelServerErrorRawText: evidence.vercelServerErrorRawText,
      vercelServerErrorRawEvidenceFileName: VERCEL_SERVER_ERROR_RAW_FILE,
      expectedHost: PRODUCTION_HOST,
      expectedCommit: COMMIT,
      deploymentRawEvidenceSha256: deploymentRawSha256,
      databaseSystemIdentifier: DATABASE_SYSTEM_IDENTIFIER,
    }),
  };
}

async function fixture() {
  const outer = mkdtempSync(join(tmpdir(), "current-finalizer-test-")); roots.push(outer);
  const repo = join(outer, "repo"); const evidenceRoot = join(outer, "private");
  mkdirSync(join(repo, "supabase/.temp"), { recursive: true }); mkdirSync(evidenceRoot);
  writeFileSync(join(repo, "supabase/.temp/project-ref"), SOURCE_REF);
  const release = releaseDataFixture();
  const appliedLedgerRows = release.migrations.map(x => ({ version: x.version, name: x.file.slice(15, -4), statementsSha256: digest(x.sql) }));
  const evidence = { indexSha256: digest("synthetic evidence"), postObjects: clone(release.baseline.objects), reports: {
    backup: { artifacts: [] }, hostedStaging: { appliedLedgerRows, postRelations: clone(release.baseline.relations) },
  } };
  const expectedLedger = [...release.baseline.ledger, ...appliedLedgerRows];
  const outcomePath = join(evidenceRoot, "apply.json");
  const outcome = { version: 1, release: RELEASE, projectRef: SOURCE_REF, releaseCommit: COMMIT,
    status: "database_expand_verified_lease_held", contractSha256: release.contractSha256,
    baselineSha256: release.baselineSha256, migrationSetSha256: release.migrationSetSha256,
    evidenceIndexSha256: evidence.indexSha256, remoteReleaseLeasePhase: "deployment-canary", remoteWritesPerformed: true,
    rerunProhibited: true, ownerId: OWNER, outcomePathSha256: digest(outcomePath), bundleSha256: digest("bundle"),
    migrations: release.contract.migrations, postLedgerSha256: digestJson(expectedLedger), postSchemaSha256: digestJson(evidence.postObjects),
    capturedAt: "2026-07-17T00:58:00.000Z", completedAt: "2026-07-17T01:00:00.000Z" };
  writeFileSync(outcomePath, JSON.stringify(outcome));
  const deploymentRaw = JSON.stringify({ id: DEPLOYMENT_ID, teamId: TEAM_ID, projectId: PROJECT_ID,
    target: "production", readyState: "READY", url: DEPLOYMENT_HOST, alias: [PRODUCTION_HOST],
    createdAt: Date.parse("2026-07-17T01:01:00.000Z"), ready: Date.parse("2026-07-17T01:02:00.000Z"), meta: { githubCommitSha: COMMIT } });
  const deployment = buildVercelDeploymentReceipt({ rawText: deploymentRaw, rawEvidenceFileName: "deployment-raw.json", release: RELEASE,
    projectRef: SOURCE_REF, releaseCommit: COMMIT, teamId: TEAM_ID, projectId: PROJECT_ID, deploymentId: DEPLOYMENT_ID,
    productionHost: PRODUCTION_HOST, verifiedAt: "2026-07-17T01:03:00.000Z" });
  const built = await buildCanary(digest(deploymentRaw));
  const canary = { ...built.receipt, deploymentId: DEPLOYMENT_ID, deploymentUrlSha256: deployment.deploymentUrlSha256,
    deploymentReceiptSha256: digestJson(deployment), releaseOutcomeReceiptSha256: digestJson(outcome),
    currentBaselineEvidenceIndexSha256: evidence.indexSha256 };
  const row = { observation: { ...clone(release.baseline), ledger: expectedLedger,
    cliRoleExpirations: release.baseline.cliRoleExpirations ?? ["cli_login_postgres", "cli_login_supabase_read_only_user"].map(name => ({ name, validUntil: "2026-01-01T00:00:00.000Z" })) },
    ledger_sha256: digest("postgres ledger"), objects_sha256: digest("postgres objects"), relations_sha256: digest("postgres relations") };
  const binding = { version: 1, release: RELEASE, projectRef: SOURCE_REF, releaseCommit: COMMIT, ownerId: OWNER,
    outcomePathSha256: outcome.outcomePathSha256, outcomeSha256: digestJson(outcome), deploymentSha256: digestJson(deployment),
    canarySha256: digestJson(canary), evidenceIndexSha256: evidence.indexSha256, contractSha256: release.contractSha256,
    baselineSha256: release.baselineSha256, migrationSetSha256: release.migrationSetSha256 };
  const state = { release, evidence, outcome, canary, expectedLedger, binding, bindingSha256: digestJson(binding), deadlineMs: Date.parse(canary.expiresAt),
    inventory: readFileSync(join(historical.root, release.contract.implementation.inventory.file), "utf8"),
    fenceCheck: readFileSync(join(historical.root, release.contract.implementation.writeFenceCheck.file), "utf8"),
    legacyTemplate: readFileSync(join(historical.root, "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql")) };
  const gate = { release, evidence, outcome, outcomeSha256: digestJson(outcome), deployment, deploymentSha256: digestJson(deployment),
    deploymentRaw, canary, canaryRaw: built.evidence.rawText, serverErrorsRaw: built.evidence.vercelServerErrorRawText, now: NOW.getTime() };
  const receiptOut = join(evidenceRoot, "finalize.json");
  const args = (mode = "finalize", path = receiptOut) => ["--current-baseline", `--${mode}`, `--expected-commit=${COMMIT}`, "--remote-ref=origin/main",
    `--evidence-root=${evidenceRoot}`, `--release-outcome=${outcomePath}`, `--deployment-receipt=${join(evidenceRoot, "deployment.json")}`,
    `--canary-receipt=${join(evidenceRoot, "canary.json")}`, `--receipt-out=${path}`,
    `--confirm-production=${mode === "finalize" ? "FINALIZE" : "CHECK"}:${SOURCE_REF}:${RELEASE}:${COMMIT}:${OWNER}:${binding.canarySha256}`];
  const calls = []; let mutationResult; let loadCount = 0; let onLoad; let onCommand;
  const runtime = { resolveToolchain: async () => ({ git: "synthetic-git", powershell: "synthetic-ps" }), resolveCli: async () => "synthetic-supabase",
    readInputs: async () => { loadCount += 1; onLoad?.(loadCount); return { ...clone(state), legacyTemplate: Buffer.from(state.legacyTemplate) }; } };
  const runCommand = async (binary, commandArgs) => {
    calls.push({ binary, args: commandArgs }); onCommand?.(binary, commandArgs);
    let stdout;
    if (binary === "synthetic-git") stdout = ({ status: "", "rev-parse": COMMIT, remote: release.contract.expectedOrigin, "ls-remote": `${COMMIT}\trefs/heads/main` })[commandArgs[0]];
    else if (binary === "synthetic-ps") stdout = JSON.stringify({ verified: true, projectRef: SOURCE_REF, releaseCommit: COMMIT, evidenceIndexSha256: evidence.indexSha256, artifactCount: 0 });
    else if (commandArgs[3].includes("current_baseline_finalized_count")) {
      if (mutationResult) return mutationResult;
      const dispatchedBinding = commandArgs[3].match(/SELECT 1::integer AS current_baseline_finalized_count, '([a-f0-9]{64})'/)?.[1];
      assert.ok(dispatchedBinding);
      stdout = JSON.stringify([{ current_baseline_finalized_count: 1, binding_sha256: dispatchedBinding }]);
    } else stdout = JSON.stringify([commandArgs[3].includes("exact_owner_count") ? { exact_owner_count: 1 }
      : commandArgs[3].includes("production_write_fence_verified_count") ? { verified: true, production_write_fence_verified_count: 1 } : row]);
    return { status: 0, stdout };
  };
  return { repo, state, row, gate, outcomePath, receiptOut, args, calls, runtime, runCommand,
    setMutation: value => { mutationResult = value; }, setLoad: fn => { onLoad = fn; }, setCommand: fn => { onCommand = fn; } };
}
const run = (f, mode, path) => runCurrentBaselineFinalizer({ repoRoot: f.repo, argv: f.args(mode, path), runtime: f.runtime, runCommand: f.runCommand, now: () => NOW });
const mutations = f => f.calls.filter(x => x.args[3]?.includes("current_baseline_finalized_count"));

test("current-baseline 모드/정확한 커밋/별도 출력 경로를 강제한다", async () => {
  const f = await fixture(); assert.equal(parseCurrentFinalizerArgs(f.args()).finalize, true);
  for (const args of [f.args().concat("--include-all"), f.args().concat("--check-only"), f.args().filter(x => x !== "--current-baseline"),
    f.args().map(x => x.startsWith("--receipt-out=") ? `--receipt-out=${f.outcomePath}` : x)]) assert.throws(() => parseCurrentFinalizerArgs(args));
});
test("206+8 exact apply 영수증만 받고 owner/phase/출력경로/이력/스키마 변조를 거부한다", async () => {
  const f = await fixture(); const input = { ...f.state, outcomePath: f.outcomePath, expectedCommit: COMMIT, now: NOW.getTime() };
  assert.equal(validateCurrentFinalizationOutcome(input).length, 214);
  for (const patch of [{ status: "prepared" }, { remoteReleaseLeasePhase: "claimed" }, { ownerId: "invalid" }, { outcomePathSha256: digest("other") },
    { evidenceIndexSha256: digest("other") }, { postLedgerSha256: digest("other") }, { postSchemaSha256: digest("other") }, { remoteWritesPerformed: false }])
    assert.throws(() => validateCurrentFinalizationOutcome({ ...input, outcome: { ...input.outcome, ...patch } }));
});
test("원시 Vercel/HTTP/인증 canary와 정확한 apply/backup 결합이 모두 필요하다", async () => {
  const f = await fixture(); validateCurrentFinalizationGates(f.gate);
  for (const patch of [{ releaseOutcomeReceiptSha256: digest("other") }, { deploymentReceiptSha256: digest("other") },
    { currentBaselineEvidenceIndexSha256: digest("other") }, { observationWindowSeconds: 1 }, { expiresAt: NOW.toISOString() },
    { checks: { ...f.gate.canary.checks, databaseFenceStillVerified: false } }])
    assert.throws(() => validateCurrentFinalizationGates({ ...f.gate, canary: { ...f.gate.canary, ...patch } }));
  assert.throws(() => validateCurrentFinalizationGates({ ...f.gate, deploymentRaw: f.gate.deploymentRaw.replace(COMMIT, "b".repeat(40)) }));
  assert.throws(() => validateCurrentFinalizationGates({ ...f.gate, canaryRaw: "{}" }));
});
test("live metadata/중간 이력/managed relation 누락은 해제 전에 거부한다", async () => {
  const f = await fixture(); validateCurrentFinalizationObservation({ ...f.state, row: f.row });
  for (const key of ["objects", "ledger", "relations"]) {
    const row = clone(f.row); row.observation[key].pop();
    assert.throws(() => validateCurrentFinalizationObservation({ ...f.state, row }));
  }
});
test("물리 provider backup의 26시간 유효기간이 먼저 끝나면 SQL deadline도 그 시각이다", () => {
  const time = NOW.getTime(); const recent = NOW.toISOString();
  const evidence = { reports: { backup: { verifiedAt: recent, providerBackup: { completedAt: new Date(time - 26 * 3600_000 + 5000).toISOString() } },
    storage: { verifiedAt: recent, secondSnapshotAt: recent }, hostedRestore: { verifiedAt: recent }, hostedStaging: { verifiedAt: recent }, finalizer: { verifiedAt: recent } } };
  assert.equal(currentFinalizerEvidenceDeadline({ evidence, outcome: { completedAt: recent }, canary: { expiresAt: new Date(time + 900_000).toISOString() } }), time + 5000);
});
test("SQL은 DDL와 public writer 잠금 후 live 전체지문·lease 소유자 검사를 같은 원자 트랜잭션에서 한다", async () => {
  const f = await fixture();
  const sql = renderCurrentBaselineFinalizerSql({ ...f.state, observation: f.row });
  assert.ok(sql.length < 28_000); assert.match(sql, /CURRENT_FINALIZER_CATALOG_DRIFT/);
  for (const key of ["ledger", "objects", "relations"]) assert.ok(sql.includes(f.row[`${key}_sha256`]));
  assert.ok(sql.indexOf("pg_advisory_xact_lock") < sql.indexOf("CURRENT_FINALIZER_CATALOG_DRIFT"));
  assert.ok(sql.indexOf("CURRENT_FINALIZER_CATALOG_DRIFT") < sql.indexOf("DELETE FROM public.production_release_lease"));
  assert.match(sql, /owner_id = expected_lease_owner_id/); assert.match(sql, /lease.phase = 'deployment-canary'/);
  assert.match(sql, /CURRENT_FINALIZER_CANARY_EXPIRED/); assert.match(sql, /CURRENT_FINALIZER_DATABASE_IDENTITY_INVALID/);
  assert.ok(sql.indexOf("CURRENT_FINALIZER_EVIDENCE_EXPIRED") > sql.indexOf("DROP TABLE public.production_release_lease"));
  assert.match(currentFinalizerObservationSql(f.state.inventory), /^BEGIN TRANSACTION READ ONLY/);
  assert.throws(() => renderCurrentBaselineFinalizerSql({ ...f.state, observation: f.row, legacyTemplate: Buffer.from("different SQL") }), blocked("FINALIZER_LEGACY_TEMPLATE_CHANGED"));
});
test("check-only는 live 관측·lease·backup 재검증하지만 쓰기/claim 생성은 하지 않는다", async () => {
  const f = await fixture(); const result = await run(f, "check-only");
  assert.equal(result.remoteWritesPerformed, false); assert.equal(mutations(f).length, 0);
  assert.ok(f.calls.some(x => x.binary === "synthetic-ps")); assert.ok(f.calls.some(x => x.args[3]?.includes("exact_owner_count")));
  assert.equal(existsSync(f.receiptOut), false); assert.equal(existsSync(`${f.outcomePath}.finalize`), false);
});
test("실제 fence SQL의 verified+count 영수증이 아니면 해제를 전송하지 않는다", async () => {
  const f = await fixture();
  await assert.rejects(runCurrentBaselineFinalizer({ repoRoot: f.repo, argv: f.args(), runtime: f.runtime, now: () => NOW,
    runCommand: (binary, args) => args[3]?.includes("production_write_fence_verified_count")
      ? Promise.resolve({ status: 0, stdout: '[{"verified":false,"production_write_fence_verified_count":0}]' }) : f.runCommand(binary, args),
  }), blocked("FINALIZER_FENCE_INVALID"));
  assert.equal(mutations(f).length, 0); assert.equal(existsSync(`${f.outcomePath}.finalize`), false);
});
test("정상 finalizer는 exact receipt에서만 성공하며 같은 apply를 다른 출력명으로 재실행하지 않는다", async () => {
  const f = await fixture(); const result = await run(f);
  assert.equal(result.status, "current_baseline_finalized"); assert.equal(mutations(f).length, 1);
  assert.equal(JSON.parse(readFileSync(f.receiptOut)).bindingSha256, f.state.bindingSha256);
  await assert.rejects(run(f, "finalize", join(dirnameForTest(f.receiptOut), "other.json")), error => error.code === "EEXIST");
  assert.equal(mutations(f).length, 1);
});
function dirnameForTest(path) { return resolve(path, ".."); }
test("timeout·맞지 않는 SQL 영수증에는 재시도 없이 adjudication과 영구 claim을 남긴다", async () => {
  for (const result of [{ status: null, timedOut: true, stdout: "" }, { status: 0, stdout: '[{"current_baseline_finalized_count":1,"binding_sha256":"wrong"}]' }]) {
    const f = await fixture(); f.setMutation(result); await assert.rejects(run(f));
    assert.equal(mutations(f).length, 1); assert.equal(JSON.parse(readFileSync(f.receiptOut)).status, "finalization_requires_adjudication");
    assert.equal(existsSync(`${f.outcomePath}.finalize`), true);
    await assert.rejects(run(f, "finalize", join(dirnameForTest(f.receiptOut), "retry.json")));
    assert.equal(mutations(f).length, 1);
  }
});
test("대기 중 evidence/연결 대상 변경은 mutation 전에 중단한다", async () => {
  const f = await fixture(); f.setLoad(count => { if (count === 3) f.state.bindingSha256 = digest("changed"); });
  await assert.rejects(run(f), blocked("FINALIZER_EVIDENCE_CHANGED")); assert.equal(mutations(f).length, 0);
  const g = await fixture(); g.setCommand(binary => { if (binary === "synthetic-ps") writeFileSync(join(g.repo, "supabase/.temp/project-ref"), "t".repeat(20)); });
  await assert.rejects(run(g), blocked("FINALIZER_LINK_CHANGED")); assert.equal(mutations(g).length, 0);
});

test("실제 PostgreSQL 비교블록은 관측 뒤 바뀐 schema/ledger/relations를 거절하고 정상 상태를 허용한다", async () => {
  const { PGlite } = await import(pathToFileURL(join(REPO, "apps/web/node_modules/@electric-sql/pglite/dist/index.js")).href);
  const db = new PGlite();
  try {
    const f = await fixture();
    const original = { ledger: [{ version: "20260906151956", name: "owner_boundary" }], objects: [{ identity: "public.profiles", sha256: digest("safe") }],
      relations: [{ schema: "public", name: "profiles", kind: "r" }], vaultRows: 0, cronJobs: 0,
      cliRoleExpirations: ["cli_login_postgres", "cli_login_supabase_read_only_user"].map(name => ({ name, validUntil: new Date(Date.now() - 1000).toISOString() })) };
    await db.exec("CREATE TABLE live_observation (value jsonb NOT NULL)");
    await db.query("INSERT INTO live_observation VALUES ($1::jsonb)", [JSON.stringify(original)]);
    const inventory = "BEGIN TRANSACTION READ ONLY; WITH namespaces AS MATERIALIZED (SELECT value FROM live_observation) SELECT value AS observation FROM namespaces; COMMIT;";
    // 실제 고정 inventory의 출력명과 동일한 SELECT를 사용하되 합성 데이터는 한 테이블에 격리한다.
    const adapted = inventory.replace("SELECT value AS observation FROM namespaces", "SELECT (SELECT value FROM namespaces) || jsonb_build_object('observedAt',clock_timestamp()) AS observation");
    const read = await db.exec(currentFinalizerObservationSql(adapted));
    const row = read.find(x => x.rows?.[0]?.ledger_sha256).rows[0];
    const now = Date.now(); const canary = { ...f.state.canary, verifiedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 600_000).toISOString() };
    const sql = renderCurrentBaselineFinalizerSql({ ...f.state, inventory: adapted, observation: row, canary, deadlineMs: now + 600_000 });
    const block = sql.slice(sql.indexOf("DO $current_catalog$"), sql.indexOf("$current_catalog$;", sql.indexOf("DO $current_catalog$") + 3) + "$current_catalog$;".length);
    await db.exec(block);
    for (const key of ["ledger", "objects", "relations"]) {
      const changed = clone(original); changed[key] = [];
      await db.query("UPDATE live_observation SET value = $1::jsonb", [JSON.stringify(changed)]);
      await assert.rejects(db.exec(block), /CURRENT_FINALIZER_CATALOG_DRIFT/);
    }
    await db.query("UPDATE live_observation SET value = $1::jsonb", [JSON.stringify(original)]);
    await db.exec(block);
    for (const roles of [null, [], original.cliRoleExpirations.slice(0, 1), [...original.cliRoleExpirations].reverse(),
      [...original.cliRoleExpirations, original.cliRoleExpirations[0]],
      ...[null, "infinity", "-infinity", "today", "not-a-time", new Date(Date.now() + 600_000).toISOString()].map(validUntil => [{ ...original.cliRoleExpirations[0], validUntil }, original.cliRoleExpirations[1]])]) {
      await db.query("UPDATE live_observation SET value = $1::jsonb", [JSON.stringify({ ...original, cliRoleExpirations: roles })]);
      await assert.rejects(db.exec(block), /CURRENT_FINALIZER_CLI_ROLE_EXPIRY_INVALID/);
    }
    await db.query("UPDATE live_observation SET value = $1::jsonb", [JSON.stringify(original)]);
    await db.exec(block);
    const expiredCanary = { ...canary, verifiedAt: new Date(Date.now() - 600_000).toISOString() };
    const expiredSql = renderCurrentBaselineFinalizerSql({ ...f.state, inventory: adapted, observation: row,
      canary: expiredCanary, deadlineMs: Date.now() - 1000 });
    const deadlineStart = expiredSql.indexOf("DO $deadline_before_commit$");
    const deadlineBlock = expiredSql.slice(deadlineStart, expiredSql.indexOf("$deadline_before_commit$;", deadlineStart + 3) + "$deadline_before_commit$;".length);
    await assert.rejects(db.exec(`BEGIN; UPDATE live_observation SET value = '{}'::jsonb; ${deadlineBlock} COMMIT;`), /CURRENT_FINALIZER_EVIDENCE_EXPIRED/);
    await db.exec("ROLLBACK");
    assert.deepEqual((await db.query("SELECT value FROM live_observation")).rows[0].value, original);
  } finally { await db.close(); }
});
