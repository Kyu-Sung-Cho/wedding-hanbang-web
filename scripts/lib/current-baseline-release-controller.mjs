import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { analyzeReadOnlySqlEnvelope } from "./sql-read-only-envelope.mjs";
import { resolvePinnedWindowsProductionToolchain } from "./production-windows-toolchain.mjs";
import { assertFencedBaseline, digest, digestJson, loadCurrentBaselineContract,
  pinnedArtifact, requireRelease, same, validateCurrentEvidence, validateObservation } from "./current-baseline-release-contract.mjs";

export function parseCurrentArgs(argv) {
  const out = {};
  const values = new Set(["expected-commit", "remote-ref", "evidence-root", "bundle-root", "receipt-out", "confirm-production"]);
  for (const argument of argv) {
    if (["--current-baseline", "--apply", "--check-only"].includes(argument)) {
      requireRelease(!out[argument.slice(2)], "DUPLICATE_ARGUMENT");
      out[argument.slice(2)] = true;
    } else {
      const match = /^--([a-z-]+)=(.+)$/.exec(argument);
      requireRelease(match && values.has(match[1]) && !out[match[1]], "ARGUMENT_INVALID");
      out[match[1]] = match[2];
    }
  }
  requireRelease(out["current-baseline"] && Boolean(out.apply) !== Boolean(out["check-only"]), "MODE_REQUIRED");
  requireRelease(/^[a-f0-9]{40}$/.test(out["expected-commit"] ?? ""), "EXPECTED_COMMIT_INVALID");
  requireRelease(/^origin\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(out["remote-ref"] ?? "") && !out["remote-ref"].includes("..") && !out["remote-ref"].includes("//") && !out["remote-ref"].endsWith("/"), "REMOTE_REF_INVALID");
  for (const field of ["evidence-root", "bundle-root"]) requireRelease(typeof out[field] === "string" && isAbsolute(out[field]), "PRIVATE_PATH_REQUIRED");
  requireRelease(out.apply ? typeof out["receipt-out"] === "string" && isAbsolute(out["receipt-out"]) && out["receipt-out"].endsWith(".json") : !out["receipt-out"], "RECEIPT_PATH_INVALID");
  return out;
}
async function outsideRepoDirectory(repoRoot, path) {
  const before = await lstat(path);
  requireRelease(before.isDirectory() && !before.isSymbolicLink(), "PRIVATE_DIRECTORY_INVALID");
  const actual = await realpath(path);
  const delta = relative(await realpath(repoRoot), actual);
  requireRelease(delta && (delta === ".." || delta.startsWith(`..${sep}`) || isAbsolute(delta)), "PRIVATE_DIRECTORY_IN_REPO");
  requireRelease(resolve(path).toLowerCase() === actual.toLowerCase(), "PRIVATE_DIRECTORY_LINKED");
  return actual;
}
async function checkedCommand(runCommand, command, args, cwd, code, env) {
  const result = await runCommand(command, args, { cwd, ...(env ? { env } : {}) });
  requireRelease(result.status === 0 && !result.signal && !result.timedOut && !result.outputTruncated && !result.error, code);
  return result;
}
async function exclusiveFile(path, bytes) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}

// 과거 이력은 실제 저장소 원문 또는 DB에 기록된 원문만 복사한다. placeholder/repair는 없다.
export async function createMigrationBundle({ repoRoot, parent, release, historicalSources }) {
  const root = await mkdtemp(join(parent, "current-release-"));
  await mkdir(join(root, "supabase", "migrations"), { recursive: true });
  await mkdir(join(root, "supabase", ".temp"));
  const files = [];
  const localFiles = (await readdir(join(repoRoot, "supabase", "migrations"))).filter(x => /^\d{14}_[a-z0-9_.-]+\.sql$/.test(x));
  for (const row of release.baseline.ledger) {
    const local = localFiles.filter(x => x.slice(0, 14) === row.version);
    requireRelease(local.length <= 1, "HISTORICAL_VERSION_AMBIGUOUS");
    let file, bytes, provenance;
    if (local.length === 1) {
      file = local[0]; bytes = await readFile(join(repoRoot, "supabase", "migrations", file));
      provenance = "repository-source-for-already-recorded-version";
    } else {
      const source = historicalSources.find(x => x.version === row.version);
      requireRelease(source && /^[a-z0-9_]+$/.test(row.name) && source.name === row.name && typeof source.statementsJson === "string" && digest(source.statementsJson) === row.statementsSha256, "RECORDED_HISTORY_SOURCE_MISSING");
      const statements = JSON.parse(source.statementsJson);
      requireRelease(Array.isArray(statements) && statements.length > 0 && statements.every(x => typeof x === "string" && x.trim()), "RECORDED_HISTORY_SOURCE_INVALID");
      file = `${row.version}_${row.name}.sql`;
      bytes = Buffer.from(statements.map(x => `${x.trim().replace(/;+$/, "")};`).join("\n") + "\n");
      provenance = "database-recorded-statements";
    }
    requireRelease(bytes.length > 0 && bytes.length <= 4 * 1024 * 1024, "MIGRATION_BYTES_INVALID");
    await exclusiveFile(join(root, "supabase", "migrations", file), bytes);
    files.push({ file: `supabase/migrations/${file}`, sha256: digest(bytes), provenance });
  }
  for (const migration of release.migrations) {
    await exclusiveFile(join(root, "supabase", "migrations", migration.file), migration.sql);
    files.push({ file: `supabase/migrations/${migration.file}`, sha256: migration.sha256, provenance: "new-reviewed-migration" });
  }
  const config = Buffer.from(`project_id = "${release.contract.projectRef}"\n[db]\nmajor_version = 17\n[db.seed]\nenabled = false\n`);
  await exclusiveFile(join(root, "supabase", "config.toml"), config);
  await exclusiveFile(join(root, "supabase", ".temp", "project-ref"), release.contract.projectRef);
  files.push({ file: "supabase/config.toml", sha256: digest(config), provenance: "controller-config" });
  files.push({ file: "supabase/.temp/project-ref", sha256: digest(release.contract.projectRef), provenance: "controller-project-binding" });
  files.sort((a, b) => a.file.localeCompare(b.file));
  const bundle = { root, files, sha256: digestJson(files) };
  await verifyMigrationBundle(bundle);
  return bundle;
}
export async function verifyMigrationBundle(bundle) {
  for (const pin of bundle.files) pinnedArtifact(bundle.root, pin);
  same((await readdir(join(bundle.root, "supabase", "migrations"))).sort(), bundle.files.filter(x => x.file.startsWith("supabase/migrations/")).map(x => x.file.slice("supabase/migrations/".length)).sort(), "BUNDLE_MIGRATION_SET_CHANGED");
  requireRelease(digestJson(bundle.files) === bundle.sha256, "BUNDLE_IDENTITY_CHANGED");
}

export async function runCurrentBaselineRelease({ repoRoot, argv, runCommand, now, primitives,
  resolveToolchain = resolvePinnedWindowsProductionToolchain }) {
  const options = parseCurrentArgs(argv);
  const release = loadCurrentBaselineContract(repoRoot);
  const { contract, baseline } = release;
  const expectedCommit = options["expected-commit"];
  const mode = options.apply ? "APPLY" : "CHECK";
  requireRelease(options["confirm-production"] === `${mode}:${contract.projectRef}:${contract.release}:${expectedCommit}`, "PRODUCTION_CONFIRMATION_MISMATCH");
  const evidenceRoot = await outsideRepoDirectory(repoRoot, options["evidence-root"]);
  const bundleParent = await outsideRepoDirectory(repoRoot, options["bundle-root"]);
  if (options.apply) await outsideRepoDirectory(repoRoot, dirname(options["receipt-out"]));
  const evidence = validateCurrentEvidence({ root: evidenceRoot, release, expectedCommit, now: now() });
  const gitFence = () => primitives.assertReleaseGitFence({ repoRoot, expectedCommit, expectedOrigin: contract.expectedOrigin, remoteRef: options["remote-ref"], runCommand });
  await gitFence();
  const cli = await primitives.resolvePinnedSupabaseCli(repoRoot, { SupabaseCliVersion: contract.cli.version, SupabaseCliBinarySha256: contract.cli.binarySha256.toUpperCase() });
  requireRelease(digest(await readFile(join(dirname(cli), "supabase-go.exe"))) === contract.cli.companionSha256, "CLI_COMPANION_MISMATCH");
  const toolchain = await resolveToolchain();
  // 기존 HBAM2 구현으로 모든 원본을 실제 복호화·hash 비교한다. metadata hash만 보고 성공하지 않는다.
  const verifyArgs = ["-NoProfile", "-NonInteractive", "-File", join(repoRoot, contract.implementation.backupVerifier.file),
    "-EvidenceRoot", evidenceRoot, "-BackupReport", evidence.indexSha256,
    "-ExpectedProjectRef", contract.projectRef, "-ExpectedCommit", expectedCommit];
  const verifierEnv = { ...process.env }; delete verifierEnv.PSModulePath;
  const verified = await checkedCommand(runCommand, toolchain.powershell, verifyArgs, repoRoot, "ENCRYPTED_BACKUP_VERIFY_FAILED", verifierEnv);
  const verification = JSON.parse(verified.stdout);
  same(verification, { verified: true, projectRef: contract.projectRef, releaseCommit: expectedCommit,
    evidenceIndexSha256: evidence.indexSha256, artifactCount: evidence.reports.backup.artifacts.length }, "ENCRYPTED_BACKUP_RECEIPT_MISMATCH");
  const sourceLink = await primitives.createLinkedRefFence(repoRoot, contract.projectRef);
  async function query(sql, code) {
    await sourceLink();
    const result = await checkedCommand(runCommand, cli, ["db", "query", "--linked", sql, "--output", "json", "--agent", "no", "--workdir", repoRoot], repoRoot, code);
    await sourceLink();
    let rows; try { rows = JSON.parse(result.stdout); } catch { requireRelease(false, "QUERY_RECEIPT_INVALID"); }
    requireRelease(Array.isArray(rows), "QUERY_RECEIPT_INVALID");
    return rows;
  }
  const inventorySql = pinnedArtifact(repoRoot, contract.implementation.inventory).toString("utf8");
  requireRelease(analyzeReadOnlySqlEnvelope(inventorySql).ok, "INVENTORY_NOT_READONLY");
  async function observation() {
    const rows = await query(inventorySql, "LIVE_INVENTORY_QUERY_FAILED");
    requireRelease(rows.length === 1 && rows[0].observation, "LIVE_INVENTORY_INVALID");
    return rows[0].observation;
  }
  const frozenObservation = await observation();
  assertFencedBaseline(frozenObservation, baseline, contract);
  same(frozenObservation.objects, evidence.reports.backup.fencedObjects, "LIVE_FROZEN_BACKUP_DRIFT");
  const existingFiles = await readdir(join(repoRoot, "supabase/migrations"));
  const remoteOnly = baseline.ledger.filter(x => !existingFiles.some(f => f.slice(0, 14) === x.version));
  const historicalSources = [];
  if (remoteOnly.length) {
    const rows = await query(`BEGIN TRANSACTION READ ONLY; SELECT version,name,to_jsonb(statements)::text AS "statementsJson" FROM supabase_migrations.schema_migrations WHERE version IN (${remoteOnly.map(x => `'${x.version}'`).join(",")}) ORDER BY version; COMMIT;`, "RECORDED_HISTORY_QUERY_FAILED");
    requireRelease(rows.length === remoteOnly.length, "RECORDED_HISTORY_SOURCE_MISSING");
    historicalSources.push(...rows);
  }
  const bundle = await createMigrationBundle({ repoRoot, parent: bundleParent, release, historicalSources });
  const bundleLink = await primitives.createLinkedRefFence(bundle.root, contract.projectRef);
  const stable = async () => {
    await sourceLink(); await bundleLink(); await verifyMigrationBundle(bundle);
    same(loadCurrentBaselineContract(repoRoot).contractSha256, release.contractSha256, "CONTRACT_CHANGED");
    same(validateCurrentEvidence({ root: evidenceRoot, release, expectedCommit, now: now() }).indexSha256, evidence.indexSha256, "EVIDENCE_CHANGED");
  };
  async function dryRun(expected) {
    await stable();
    const result = await checkedCommand(runCommand, cli, ["db", "push", "--linked", "--dry-run", "--agent", "no", "--workdir", bundle.root], bundle.root, "INCREMENTAL_DRY_RUN_FAILED");
    await stable();
    const output = `${result.stdout}\n${result.stderr}`;
    primitives.assertDryRunRecognized(output, "INCREMENTAL_DRY_RUN_UNRECOGNIZED", { allowUpToDate: expected.length === 0 });
    primitives.assertExactOrdered(primitives.parsePendingMigrations(output), expected, "INCREMENTAL_PENDING_MISMATCH");
  }
  const fencePin = contract.implementation.writeFenceCheck;
  requireRelease(analyzeReadOnlySqlEnvelope(pinnedArtifact(repoRoot, fencePin).toString("utf8")).ok, "FENCE_CHECK_NOT_READONLY");
  const checkFence = () => primitives.runReadOnlyChecks({ checks: [{ id: "current-baseline-write-fence", path: join(repoRoot, fencePin.file), expectedEvidence: { production_write_fence_verified_count: 1 } }], phase: "pre", runCommand, supabaseCli: cli, repoRoot, assertLinkedRef: sourceLink });
  await checkFence();
  await dryRun(release.migrations.map(x => x.file));
  await gitFence();
  const baseReceipt = { version: 1, release: contract.release, projectRef: contract.projectRef, releaseCommit: expectedCommit,
    contractSha256: release.contractSha256, baselineSha256: release.baselineSha256, evidenceIndexSha256: evidence.indexSha256,
    migrationSetSha256: release.migrationSetSha256, bundleSha256: bundle.sha256, migrations: contract.migrations,
    capturedAt: now().toISOString(), remoteWritesPerformed: false };
  if (!options.apply) return { ...baseReceipt, status: "current_baseline_preflight_verified" };
  // 하나의 결과 경로에 한 번만 진입한다. 프로세스 종료·응답 유실도 재적용 허가가 아니다.
  const ownerId = randomUUID();
  const receiptOut = options["receipt-out"];
  await primitives.writeReceipt(receiptOut, { ...baseReceipt, status: "prepared", ownerId, rerunProhibited: true }, { exclusive: true });
  const outcomePathSha256 = digest(resolve(receiptOut));
  const lease = action => primitives.runRemoteReleaseLease({ action, repoRoot, receiptOut, manifest: contract, expectedCommit,
    ownerId, outcomePathSha256, runCommand, supabaseCli: cli, assertLinkedRef: sourceLink });
  let phase = "claiming";
  try {
    await lease("claim");
    await lease("verify_claimed");
    await stable(); await gitFence(); await checkFence();
    const prePushObservation = await observation();
    assertFencedBaseline(prePushObservation, baseline, contract);
    same(prePushObservation.objects, evidence.reports.backup.fencedObjects, "LIVE_FROZEN_BACKUP_DRIFT");
    await dryRun(release.migrations.map(x => x.file));
    phase = "push_started";
    await primitives.writeReceipt(receiptOut, { ...baseReceipt, status: phase, ownerId, remoteWritesPerformed: true, rerunProhibited: true });
    await checkedCommand(runCommand, cli, ["db", "push", "--linked", "--yes", "--agent", "no", "--workdir", bundle.root], bundle.root, "PUSH_OUTCOME_AMBIGUOUS");
    await stable(); await lease("verify_claimed");
    await dryRun([]);
    const after = validateObservation(await observation(), contract);
    same(after.ledger.slice(0, baseline.ledger.length), baseline.ledger, "POST_BASELINE_LEDGER_CHANGED");
    same(after.ledger.slice(baseline.ledger.length), evidence.reports.hostedStaging.appliedLedgerRows, "POST_LEDGER_MISMATCH");
    same(after.objects, evidence.postObjects, "POST_SCHEMA_MISMATCH");
    same(after.relations, evidence.reports.hostedStaging.postRelations, "POST_RELATIONS_MISMATCH");
    await checkFence();
    await lease("mark_deploying_from_claimed"); await lease("verify_deploying");
    const receipt = { ...baseReceipt, status: "database_expand_verified_lease_held", ownerId, outcomePathSha256,
      remoteWritesPerformed: true, remoteReleaseLeasePhase: "deployment-canary", completedAt: now().toISOString(),
      postLedgerSha256: digestJson(after.ledger), postSchemaSha256: digestJson(after.objects), rerunProhibited: true,
      operatorAction: "Keep the fence held. Deployment, canary and exact-owner finalization are separate gates." };
    await primitives.writeReceipt(receiptOut, receipt); return receipt;
  } catch (error) {
    await primitives.writeReceipt(receiptOut, { ...baseReceipt, status: "release_requires_adjudication", phase, ownerId,
      remoteWritesPerformed: true, rerunProhibited: true, errorCode: /^[A-Z_]+$/.test(error.code ?? "") ? error.code : "UNEXPECTED" }).catch(() => {});
    // 불확실한 결과에는 lease/fence를 자동 해제하거나 DB push를 재시도하지 않는다.
    throw error;
  }
}
