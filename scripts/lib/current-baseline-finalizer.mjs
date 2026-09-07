import { lstat, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { digest, digestJson, loadCurrentBaselineContract, pinnedArtifact, readAnchored,
  requireRelease, same, validateCurrentEvidence, validateObservation } from "./current-baseline-release-contract.mjs";
import { analyzeReadOnlySqlEnvelope } from "./sql-read-only-envelope.mjs";
import { resolvePinnedWindowsProductionToolchain } from "./production-windows-toolchain.mjs";
import { productionWriteFenceFinalizerTestHooks } from "./production-write-fence-finalizer.mjs";
import { PRODUCTION_CANARY_REQUIRED_CHECKS, validateVercelDeploymentReceiptProvenance,
  validateProductionCanaryReceiptProvenance } from "./production-external-gate-provenance.mjs";

const SHA = /^[a-f0-9]{64}$/;
const OWNER = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const LEGACY_TEMPLATE = Object.freeze({
  file: "supabase/platform-operations/security/20260717121000_production_write_fence_finalize.sql",
  sha256: "cb328473e789b8d669fe1dcd0052077d3f812fbc099b27333ac95f3bef75893e",
});
const VERCEL = Object.freeze({ teamId: "team_XwMZqiJ4wXM2Ypvs99icXaQx",
  projectId: "prj_LyKeU6DJGaIa4iJLqgn6rS3Qehes", productionHost: "hanbang.ai" });
const defaultRunCommand = productionWriteFenceFinalizerTestHooks.defaultRunCommand;
const compactSql = productionWriteFenceFinalizerTestHooks.compactFinalizerSql;
const inside = (root, path) => { const part = relative(root, path); return !part || (!isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`)); };
const instant = value => { const n = Date.parse(value); requireRelease(typeof value === "string" && Number.isFinite(n) && new Date(n).toISOString() === value, "FINALIZER_TIME_INVALID"); return n; };
const fresh = (value, now, minutes) => { const n = instant(value); requireRelease(n <= now && now - n <= minutes * 60_000, "FINALIZER_EVIDENCE_STALE"); return n; };
const json = bytes => JSON.parse(bytes.toString("utf8"));

export function parseCurrentFinalizerArgs(argv) {
  const out = {};
  const values = new Set(["expected-commit", "remote-ref", "evidence-root", "release-outcome", "deployment-receipt", "canary-receipt", "receipt-out", "confirm-production"]);
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.+))?$/.exec(arg);
    requireRelease(match && !Object.hasOwn(out, match[1]), "FINALIZER_ARGUMENT_INVALID");
    if (["current-baseline", "check-only", "finalize"].includes(match[1])) {
      requireRelease(!match[2], "FINALIZER_ARGUMENT_INVALID"); out[match[1]] = true;
    } else {
      requireRelease(values.has(match[1]) && match[2], "FINALIZER_ARGUMENT_INVALID"); out[match[1]] = match[2];
    }
  }
  requireRelease(out["current-baseline"] && Boolean(out.finalize) !== Boolean(out["check-only"]), "FINALIZER_MODE_REQUIRED");
  requireRelease(/^[a-f0-9]{40}$/.test(out["expected-commit"] ?? ""), "FINALIZER_COMMIT_INVALID");
  requireRelease(/^origin\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(out["remote-ref"] ?? "") && !out["remote-ref"].includes("..") && !out["remote-ref"].includes("//") && !out["remote-ref"].endsWith("/"), "FINALIZER_REMOTE_REF_INVALID");
  for (const key of ["evidence-root", "release-outcome", "deployment-receipt", "canary-receipt", "receipt-out"])
    requireRelease(typeof out[key] === "string" && isAbsolute(out[key]) && (key === "evidence-root" || out[key].endsWith(".json")), "FINALIZER_PRIVATE_PATH_REQUIRED");
  requireRelease(new Set(["release-outcome", "deployment-receipt", "canary-receipt", "receipt-out"].map(k => resolve(out[k]).toLowerCase())).size === 4, "FINALIZER_PATH_COLLISION");
  return out;
}

export function validateCurrentFinalizationOutcome({ release, evidence, outcome, outcomePath, expectedCommit, now }) {
  const { contract, baseline } = release;
  requireRelease(outcome?.version === 1 && outcome.status === "database_expand_verified_lease_held"
    && outcome.release === contract.release && outcome.projectRef === contract.projectRef && outcome.releaseCommit === expectedCommit
    && outcome.contractSha256 === release.contractSha256 && outcome.baselineSha256 === release.baselineSha256
    && outcome.migrationSetSha256 === release.migrationSetSha256 && outcome.evidenceIndexSha256 === evidence.indexSha256
    && outcome.remoteReleaseLeasePhase === "deployment-canary" && outcome.remoteWritesPerformed === true
    && outcome.rerunProhibited === true && OWNER.test(outcome.ownerId ?? "")
    && outcome.outcomePathSha256 === digest(resolve(outcomePath)) && SHA.test(outcome.bundleSha256 ?? ""), "FINALIZER_OUTCOME_INVALID");
  same(outcome.migrations, contract.migrations, "FINALIZER_OUTCOME_MIGRATIONS_CHANGED");
  const expectedLedger = [...baseline.ledger, ...evidence.reports.hostedStaging.appliedLedgerRows];
  requireRelease(outcome.postLedgerSha256 === digestJson(expectedLedger)
    && outcome.postSchemaSha256 === digestJson(evidence.postObjects), "FINALIZER_OUTCOME_POST_STATE_INVALID");
  requireRelease(instant(outcome.capturedAt) <= fresh(outcome.completedAt, now, 30), "FINALIZER_OUTCOME_TIME_INVALID");
  return expectedLedger;
}

export function validateCurrentFinalizationGates({ release, evidence, outcome, outcomeSha256, deployment, deploymentSha256,
  deploymentRaw, canary, canaryRaw, serverErrorsRaw, now }) {
  const { contract } = release;
  for (const receipt of [deployment, canary]) requireRelease(receipt?.receiptVersion === 1
    && receipt.release === contract.release && receipt.projectRef === contract.projectRef
    && receipt.releaseCommit === outcome.releaseCommit && receipt.containsSecrets === false, "FINALIZER_GATE_IDENTITY_INVALID");
  requireRelease(deployment.kind === "vercel-production-deployment" && deployment.target === "production"
    && deployment.readyState === "READY" && deployment.source === "vercel-api", "FINALIZER_DEPLOYMENT_INVALID");
  const verifiedAt = fresh(deployment.verifiedAt, now, 1440);
  requireRelease(instant(deployment.deploymentCreatedAt) <= instant(deployment.readyAt)
    && instant(deployment.readyAt) <= verifiedAt && instant(outcome.completedAt) <= instant(deployment.readyAt), "FINALIZER_DEPLOYMENT_TIME_INVALID");
  const raw = validateVercelDeploymentReceiptProvenance({ receipt: deployment, rawText: deploymentRaw,
    expected: { ...VERCEL, releaseCommit: outcome.releaseCommit } });
  requireRelease(canary.kind === "production-write-fenced-canary"
    && canary.deploymentId === deployment.deploymentId && canary.deploymentUrlSha256 === deployment.deploymentUrlSha256
    && canary.deploymentReceiptSha256 === deploymentSha256 && canary.releaseOutcomeReceiptSha256 === outcomeSha256
    && canary.currentBaselineEvidenceIndexSha256 === evidence.indexSha256, "FINALIZER_CANARY_BINDING_INVALID");
  const started = instant(canary.observationStartedAt); const ended = fresh(canary.verifiedAt, now, 15);
  requireRelease(started >= instant(deployment.readyAt) && started >= instant(outcome.completedAt)
    && Number.isSafeInteger(canary.observationWindowSeconds) && canary.observationWindowSeconds >= 300
    && canary.observationWindowSeconds <= 3600 && ended - started === canary.observationWindowSeconds * 1000
    && instant(canary.expiresAt) === ended + 900_000 && instant(canary.expiresAt) > now, "FINALIZER_CANARY_TIME_INVALID");
  validateProductionCanaryReceiptProvenance({ receipt: canary, rawText: canaryRaw, expected: {
    expectedHost: VERCEL.productionHost, expectedCommit: outcome.releaseCommit, deploymentRawEvidenceSha256: raw.rawSha256,
    requiredChecks: PRODUCTION_CANARY_REQUIRED_CHECKS, databaseSystemIdentifier: contract.systemIdentifier, vercelServerErrorRawText: serverErrorsRaw,
  } });
}

function inventorySelect(inventory) {
  requireRelease(analyzeReadOnlySqlEnvelope(inventory).ok, "FINALIZER_INVENTORY_NOT_READ_ONLY");
  const start = inventory.indexOf("WITH namespaces AS MATERIALIZED (");
  const end = inventory.lastIndexOf(" AS observation;");
  requireRelease(start > 0 && end > start, "FINALIZER_INVENTORY_SHAPE_CHANGED");
  return inventory.slice(start, end + " AS observation".length);
}
export function currentFinalizerObservationSql(inventory) {
  return `BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = '30s';
SELECT observation, ${["ledger", "objects", "relations"].map(k => `encode(sha256(convert_to((observation->'${k}')::text,'UTF8')),'hex') AS ${k}_sha256`).join(", ")}
FROM (${inventorySelect(inventory)}) AS snapshot; COMMIT;`;
}

export function validateCurrentFinalizationObservation({ row, release, evidence, expectedLedger }) {
  requireRelease(row && Object.keys(row).sort().join() === ["observation", "ledger_sha256", "objects_sha256", "relations_sha256"].sort().join(), "FINALIZER_OBSERVATION_INVALID");
  validateObservation(row.observation, release.contract);
  same(row.observation.ledger, expectedLedger, "FINALIZER_LIVE_LEDGER_DRIFT");
  same(row.observation.objects, evidence.postObjects, "FINALIZER_LIVE_SCHEMA_DRIFT");
  same(row.observation.relations, evidence.reports.hostedStaging.postRelations, "FINALIZER_LIVE_RELATION_DRIFT");
  for (const key of ["ledger", "objects", "relations"]) requireRelease(SHA.test(row[`${key}_sha256`] ?? ""), "FINALIZER_OBSERVATION_HASH_INVALID");
  return row;
}

export function currentFinalizerEvidenceDeadline({ evidence, outcome, canary }) {
  const deadline = Math.min(instant(canary.expiresAt), instant(outcome.completedAt) + 30 * 60_000,
    Date.parse(evidence.reports.backup.verifiedAt) + 30 * 60_000,
    Date.parse(evidence.reports.backup.providerBackup.completedAt) + 26 * 3600_000,
    Date.parse(evidence.reports.storage.verifiedAt) + 30 * 60_000,
    Date.parse(evidence.reports.storage.secondSnapshotAt) + 30 * 60_000,
    ...["hostedRestore", "hostedStaging", "finalizer"].map(k => Date.parse(evidence.reports[k].verifiedAt) + 1440 * 60_000));
  requireRelease(Number.isSafeInteger(deadline), "FINALIZER_DEADLINE_INVALID");
  return deadline;
}

// 7월 실행기 자체는 바꾸지 않는다. 검증된 소유자/trigger/ACL/잠금/원자 삭제 블록만 바이트 고정해 재사용한다.
export function renderCurrentBaselineFinalizerSql({ legacyTemplate, inventory, release, outcome, observation, canary, bindingSha256, deadlineMs }) {
  requireRelease(digest(legacyTemplate) === LEGACY_TEMPLATE.sha256, "FINALIZER_LEGACY_TEMPLATE_CHANGED");
  requireRelease(SHA.test(bindingSha256), "FINALIZER_BINDING_INVALID");
  const template = legacyTemplate.toString("utf8").replace(/\r\n/g, "\n");
  const section = (start, end) => { const a = template.indexOf(start); const b = template.indexOf(end, a + start.length);
    requireRelease(a >= 0 && b > a, "FINALIZER_LEGACY_SECTION_MISSING"); return template.slice(a, b); };
  const locks = section("DO $serialize_against_all_ddl$", "DO $post_expand_live_contract_precondition$");
  const cleanup = section("DO $exact_owner_and_fence_precondition$", "\nSELECT\n").replace(/\r\n/g, "\n");
  const { contract } = release;
  const settings = { project_ref: contract.projectRef, release_id: contract.release, release_commit: outcome.releaseCommit,
    lease_owner_id: outcome.ownerId, outcome_path_sha256: outcome.outcomePathSha256 };
  for (const value of Object.values(settings)) requireRelease(/^[a-zA-Z0-9_-]+$/.test(value), "FINALIZER_SQL_IDENTITY_INVALID");
  const expires = instant(canary.expiresAt); const verified = instant(canary.verifiedAt);
  requireRelease(Number.isSafeInteger(deadlineMs) && deadlineMs > verified && deadlineMs <= expires, "FINALIZER_DEADLINE_INVALID");
  const hashChecks = ["ledger", "objects", "relations"].map(k => {
    requireRelease(SHA.test(observation[`${k}_sha256`] ?? ""), "FINALIZER_OBSERVATION_HASH_INVALID");
    return `encode(sha256(convert_to((observed->'${k}')::text,'UTF8')),'hex') IS DISTINCT FROM '${observation[`${k}_sha256`]}'`;
  }).join(" OR ");
  const sql = `BEGIN; SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s';
${Object.entries(settings).map(([k, v]) => `DO $$ BEGIN PERFORM set_config('hanbang.finalizer.${k}', '${v}', true); END $$;`).join("\n")}
DO $identity$ BEGIN
 IF current_user <> 'postgres' OR session_user <> 'postgres'
 OR coalesce(current_setting('request.jwt.claims',true),'') <> '' OR coalesce(current_setting('request.jwt.claim.role',true),'') <> ''
 OR auth.role() IS NOT NULL OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '${contract.systemIdentifier}'
 THEN RAISE EXCEPTION 'CURRENT_FINALIZER_DATABASE_IDENTITY_INVALID'; END IF;
END $identity$;
${locks}
LOCK TABLE supabase_migrations.schema_migrations, vault.secrets, cron.job IN SHARE ROW EXCLUSIVE MODE;
DO $current_catalog$ DECLARE observed jsonb; cli_role jsonb; cli_expiry timestamptz; snapshot_time timestamptz; BEGIN
 IF clock_timestamp() >= to_timestamp(${deadlineMs}::double precision/1000) OR clock_timestamp() < to_timestamp(${verified}::double precision/1000)
 THEN RAISE EXCEPTION 'CURRENT_FINALIZER_CANARY_EXPIRED'; END IF;
 SELECT snapshot.observation INTO observed FROM (${inventorySelect(inventory)}) snapshot;
 snapshot_time := (observed->>'observedAt')::timestamptz;
 IF snapshot_time IS NULL OR NOT isfinite(snapshot_time) OR snapshot_time < statement_timestamp() OR snapshot_time > clock_timestamp()
 OR jsonb_typeof(observed->'cliRoleExpirations') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'CURRENT_FINALIZER_CLI_ROLE_EXPIRY_INVALID'; END IF;
 IF jsonb_array_length(observed->'cliRoleExpirations') <> 2 OR
 (SELECT jsonb_agg(item->'name' ORDER BY ordinal) FROM jsonb_array_elements(observed->'cliRoleExpirations') WITH ORDINALITY AS roles(item,ordinal))
 IS DISTINCT FROM '["cli_login_postgres","cli_login_supabase_read_only_user"]'::jsonb
 THEN RAISE EXCEPTION 'CURRENT_FINALIZER_CLI_ROLE_EXPIRY_INVALID'; END IF;
 FOR cli_role IN SELECT value FROM jsonb_array_elements(observed->'cliRoleExpirations') LOOP
   IF jsonb_typeof(cli_role) IS DISTINCT FROM 'object' OR jsonb_typeof(cli_role->'validUntil') IS DISTINCT FROM 'string'
   OR (cli_role->>'validUntil') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
   THEN RAISE EXCEPTION 'CURRENT_FINALIZER_CLI_ROLE_EXPIRY_INVALID'; END IF;
   IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(cli_role) AS keys(key)) IS DISTINCT FROM ARRAY['name','validUntil']::text[]
   THEN RAISE EXCEPTION 'CURRENT_FINALIZER_CLI_ROLE_EXPIRY_INVALID'; END IF;
   cli_expiry := (cli_role->>'validUntil')::timestamptz;
   IF NOT isfinite(cli_expiry) OR cli_expiry > snapshot_time + interval '310 seconds'
   THEN RAISE EXCEPTION 'CURRENT_FINALIZER_CLI_ROLE_EXPIRY_INVALID'; END IF;
 END LOOP;
 IF ${hashChecks} OR (observed->>'vaultRows')::bigint <> 0 OR (observed->>'cronJobs')::bigint <> 0
 THEN RAISE EXCEPTION 'CURRENT_FINALIZER_CATALOG_DRIFT'; END IF;
END $current_catalog$;
${cleanup}
DO $deadline_before_commit$ BEGIN
 IF clock_timestamp() >= to_timestamp(${deadlineMs}::double precision/1000)
 THEN RAISE EXCEPTION 'CURRENT_FINALIZER_EVIDENCE_EXPIRED'; END IF;
END $deadline_before_commit$;
SELECT 1::integer AS current_baseline_finalized_count, '${bindingSha256}'::text AS binding_sha256;
COMMIT;`;
  const compact = compactSql(sql);
  requireRelease(compact.length < 28_000, "FINALIZER_SQL_ARGUMENT_TOO_LARGE");
  return compact;
}

async function privateDirectory(repoRoot, path) {
  const actual = await realpath(path); const stat = await lstat(path);
  requireRelease(stat.isDirectory() && !stat.isSymbolicLink() && resolve(path).toLowerCase() === actual.toLowerCase()
    && !inside(await realpath(repoRoot), actual), "FINALIZER_PRIVATE_PATH_REQUIRED");
  let parent = actual;
  while (dirname(parent) !== parent) { requireRelease(!(await lstat(parent)).isSymbolicLink(), "FINALIZER_PATH_LINK"); parent = dirname(parent); }
  return actual;
}
async function receiptFile(repoRoot, path) {
  await privateDirectory(repoRoot, dirname(path));
  const bytes = readAnchored(dirname(path), basename(path), 256 * 1024);
  return { value: json(bytes), sha256: digest(bytes) };
}
function rawSibling(path, file, sha256) {
  requireRelease(typeof file === "string" && basename(file) === file && !file.includes("\\"), "FINALIZER_RAW_PATH_INVALID");
  return pinnedArtifact(dirname(path), { file, sha256 }, 8 * 1024 * 1024).toString("utf8");
}

export async function readCurrentFinalizationInputs({ repoRoot, options, now }) {
  await privateDirectory(repoRoot, options["evidence-root"]);
  const release = loadCurrentBaselineContract(repoRoot);
  const evidence = validateCurrentEvidence({ root: options["evidence-root"], release, expectedCommit: options["expected-commit"], now });
  const outcome = await receiptFile(repoRoot, options["release-outcome"]);
  const deployment = await receiptFile(repoRoot, options["deployment-receipt"]);
  const canary = await receiptFile(repoRoot, options["canary-receipt"]);
  const expectedLedger = validateCurrentFinalizationOutcome({ release, evidence, outcome: outcome.value,
    outcomePath: options["release-outcome"], expectedCommit: options["expected-commit"], now: now.getTime() });
  const dp = deployment.value.provenance; const cp = canary.value.provenance;
  validateCurrentFinalizationGates({ release, evidence, outcome: outcome.value, outcomeSha256: outcome.sha256,
    deployment: deployment.value, deploymentSha256: deployment.sha256,
    deploymentRaw: rawSibling(options["deployment-receipt"], dp?.rawEvidenceFileName, dp?.rawEvidenceSha256),
    canary: canary.value, canaryRaw: rawSibling(options["canary-receipt"], cp?.rawHttpObservationsFileName, cp?.rawHttpObservationsSha256),
    serverErrorsRaw: rawSibling(options["canary-receipt"], cp?.vercelServerErrorRawEvidenceFileName, cp?.vercelServerErrorRawEvidenceSha256), now: now.getTime() });
  const binding = { version: 1, release: release.contract.release, projectRef: release.contract.projectRef,
    releaseCommit: outcome.value.releaseCommit, ownerId: outcome.value.ownerId, outcomePathSha256: outcome.value.outcomePathSha256,
    outcomeSha256: outcome.sha256, deploymentSha256: deployment.sha256, canarySha256: canary.sha256,
    evidenceIndexSha256: evidence.indexSha256, contractSha256: release.contractSha256,
    baselineSha256: release.baselineSha256, migrationSetSha256: release.migrationSetSha256 };
  // 복호화/원격 명령 대기 중에도 원래 백업·storage 증거의 유효기간을 연장하지 않는다.
  const deadlineMs = currentFinalizerEvidenceDeadline({ evidence, outcome: outcome.value, canary: canary.value });
  return { release, evidence, outcome: outcome.value, canary: canary.value, expectedLedger,
    binding, bindingSha256: digestJson(binding), deadlineMs,
    inventory: pinnedArtifact(repoRoot, release.contract.implementation.inventory).toString("utf8"),
    fenceCheck: pinnedArtifact(repoRoot, release.contract.implementation.writeFenceCheck).toString("utf8"),
    legacyTemplate: pinnedArtifact(repoRoot, LEGACY_TEMPLATE) };
}

async function command(runCommand, binary, args, options) {
  const result = await runCommand(binary, args, options);
  requireRelease(result.status === 0 && !result.signal && !result.timedOut && !result.outputTruncated && !result.error, "FINALIZER_COMMAND_FAILED");
  return result.stdout;
}

async function pinnedCli(repoRoot, contract) {
  requireRelease(process.platform === "win32" && ["x64", "arm64"].includes(process.arch), "FINALIZER_PLATFORM_UNSUPPORTED");
  const wrapperPath = join(repoRoot, "node_modules/supabase/package.json");
  const wrapper = json(await readFile(wrapperPath));
  requireRelease(json(await readFile(join(repoRoot, "package.json"))).devDependencies?.supabase === contract.cli.version
    && wrapper.version === contract.cli.version, "FINALIZER_CLI_VERSION_INVALID");
  const wrapperDir = await realpath(dirname(wrapperPath));
  requireRelease(inside(await realpath(repoRoot), wrapperDir), "FINALIZER_CLI_PATH_INVALID");
  const binaryDir = join(dirname(wrapperDir), "@supabase", `cli-windows-${process.arch}`, "bin");
  requireRelease(json(await readFile(join(binaryDir, "../package.json"))).version === contract.cli.version, "FINALIZER_CLI_VERSION_INVALID");
  for (const [name, sha] of [["supabase.exe", contract.cli.binarySha256], ["supabase-go.exe", contract.cli.companionSha256]])
    pinnedArtifact(binaryDir, { file: name, sha256: sha }, 128 * 1024 * 1024);
  return join(binaryDir, "supabase.exe");
}

async function releaseGitFence({ repoRoot, options, state, runCommand, toolchain }) {
  const run = args => command(runCommand, toolchain.git, args, { cwd: repoRoot });
  requireRelease(!(await run(["status", "--porcelain=v1", "--untracked-files=all"])).trim(), "FINALIZER_WORKTREE_DIRTY");
  requireRelease((await run(["rev-parse", "HEAD"])).trim() === options["expected-commit"], "FINALIZER_HEAD_CHANGED");
  requireRelease((await run(["remote", "get-url", "origin"])).trim() === state.release.contract.expectedOrigin, "FINALIZER_ORIGIN_CHANGED");
  const ref = `refs/heads/${options["remote-ref"].slice(7)}`;
  same((await run(["ls-remote", "--exit-code", "origin", ref])).trim().split(/\s+/), [options["expected-commit"], ref], "FINALIZER_REMOTE_CHANGED");
}

async function reverifyBackup({ repoRoot, options, state, runCommand, toolchain }) {
  const env = { ...process.env }; delete env.PSModulePath;
  const output = await command(runCommand, toolchain.powershell, ["-NoProfile", "-NonInteractive", "-File",
    join(repoRoot, state.release.contract.implementation.backupVerifier.file), "-EvidenceRoot", options["evidence-root"],
    "-BackupReport", state.evidence.indexSha256, "-ExpectedProjectRef", state.release.contract.projectRef,
    "-ExpectedCommit", options["expected-commit"]], { cwd: repoRoot, env, timeoutMs: 600_000 });
  same(JSON.parse(output), { verified: true, projectRef: state.release.contract.projectRef, releaseCommit: options["expected-commit"],
    evidenceIndexSha256: state.evidence.indexSha256, artifactCount: state.evidence.reports.backup.artifacts.length }, "FINALIZER_BACKUP_REVERIFY_FAILED");
}

// 1회만 dispatch한다. timeout/잘못된 응답/로컬 쓰기 실패면 receipt claim을 남겨 무심코 재실행하지 못하게 한다.
export async function runCurrentBaselineFinalizer({ repoRoot = process.cwd(), argv = [], runCommand = defaultRunCommand, now = () => new Date(),
  runtime = {} } = {}) {
  const options = parseCurrentFinalizerArgs(argv); repoRoot = resolve(repoRoot);
  requireRelease(!Object.entries(process.env).some(([k, v]) => v && /^(?:NODE_OPTIONS|NODE_PATH|SUPABASE_CLI_BINARY_OVERRIDE|GIT_(?:DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_.*|CEILING_DIRECTORIES))$/i.test(k)), "FINALIZER_UNSAFE_ENVIRONMENT");
  const load = runtime.readInputs ?? readCurrentFinalizationInputs;
  const state = await load({ repoRoot, options, now: now() });
  const mode = options.finalize ? "FINALIZE" : "CHECK";
  requireRelease(options["confirm-production"] === `${mode}:${state.binding.projectRef}:${state.binding.release}:${options["expected-commit"]}:${state.binding.ownerId}:${state.binding.canarySha256}`, "FINALIZER_CONFIRMATION_MISMATCH");
  await privateDirectory(repoRoot, dirname(options["receipt-out"]));
  requireRelease(!(await lstat(options["receipt-out"]).catch(() => null)), "FINALIZER_RECEIPT_EXISTS");
  const toolchain = await (runtime.resolveToolchain ?? resolvePinnedWindowsProductionToolchain)();
  const cli = await (runtime.resolveCli ?? pinnedCli)(repoRoot, state.release.contract);
  const linkPath = join(repoRoot, "supabase/.temp/project-ref");
  const link = readAnchored(repoRoot, "supabase/.temp/project-ref");
  const linkStat = await lstat(linkPath);
  requireRelease(link.toString().trim() === state.binding.projectRef, "FINALIZER_LINK_MISMATCH");
  const assertLink = async () => { const current = await lstat(linkPath); same([current.ino, current.dev, current.size, current.mtimeMs], [linkStat.ino, linkStat.dev, linkStat.size, linkStat.mtimeMs], "FINALIZER_LINK_CHANGED");
    requireRelease(readAnchored(repoRoot, "supabase/.temp/project-ref").equals(link), "FINALIZER_LINK_CHANGED"); };
  const stable = async () => { await assertLink(); const current = await load({ repoRoot, options, now: now() });
    requireRelease(current.bindingSha256 === state.bindingSha256, "FINALIZER_EVIDENCE_CHANGED");
    await releaseGitFence({ repoRoot, options, state, runCommand, toolchain });
    requireRelease(await (runtime.resolveCli ?? pinnedCli)(repoRoot, state.release.contract) === cli, "FINALIZER_CLI_CHANGED"); };
  const query = async sql => { await assertLink(); const text = await command(runCommand, cli,
    ["db", "query", "--linked", sql, "--output", "json", "--agent", "no", "--workdir", repoRoot], { cwd: repoRoot, timeoutMs: 120_000 });
    await assertLink(); const rows = JSON.parse(text); requireRelease(Array.isArray(rows) && rows.length === 1, "FINALIZER_QUERY_RECEIPT_INVALID"); return rows[0]; };
  await stable(); await reverifyBackup({ repoRoot, options, state, runCommand, toolchain });
  const observation = validateCurrentFinalizationObservation({ row: await query(currentFinalizerObservationSql(state.inventory)), ...state });
  requireRelease(analyzeReadOnlySqlEnvelope(state.fenceCheck).ok, "FINALIZER_FENCE_CHECK_NOT_READ_ONLY");
  same(await query(state.fenceCheck), { verified: true, production_write_fence_verified_count: 1 }, "FINALIZER_FENCE_INVALID");
  const sql = renderCurrentBaselineFinalizerSql({ ...state, observation });
  // check-only도 실제 remote lease가 정확히 본인 deployment-canary인지를 확인한다.
  const owner = state.binding.ownerId; const outcomePath = state.binding.outcomePathSha256;
  same(await query(`BEGIN TRANSACTION READ ONLY; SET LOCAL statement_timeout = '30s';
SELECT count(*)::integer AS exact_owner_count FROM public.production_release_lease_20260717 WHERE singleton = true
AND release_id = '${state.binding.release}' AND release_commit = '${state.binding.releaseCommit}' AND owner_id = '${owner}'::uuid
AND outcome_path_sha256 = '${outcomePath}' AND phase = 'deployment-canary'; COMMIT;`), { exact_owner_count: 1 }, "FINALIZER_LEASE_MISMATCH");
  await stable();
  if (options["check-only"]) return { status: "current_baseline_finalizer_preflight_verified", ...state.binding, remoteWritesPerformed: false };
  // 출력 경로를 바꿔도 같은 apply 시도를 다시 실행할 수 없도록 원래 apply 영수증에 claim을 묶는다.
  const claim = await open(`${options["release-outcome"]}.finalize`, "wx", 0o600);
  try { await claim.writeFile(JSON.stringify({ bindingSha256: state.bindingSha256, receiptOut: options["receipt-out"] })); await claim.sync(); }
  finally { await claim.close(); }
  const handle = await open(options["receipt-out"], "wx", 0o600);
  let dispatched = false;
  const write = async value => { await handle.truncate(0); await handle.write(`${JSON.stringify(value, null, 2)}\n`, 0, "utf8"); await handle.sync(); };
  const receipt = { ...state.binding, bindingSha256: state.bindingSha256, rerunProhibited: true };
  try {
    await write({ ...receipt, status: "prepared", remoteWritesPerformed: false });
    await stable();
    await write({ ...receipt, status: "finalize_dispatched", remoteWritesPerformed: true });
    dispatched = true;
    same(await query(sql), { current_baseline_finalized_count: 1, binding_sha256: state.bindingSha256 }, "FINALIZER_QUERY_RECEIPT_INVALID");
    const done = { ...receipt, status: "current_baseline_finalized", remoteWritesPerformed: true, completedAt: now().toISOString(),
      operatorAction: "Database fence and this exact release lease were atomically removed. External writer controls remain separate." };
    await write(done); return done;
  } catch (error) {
    await write({ ...receipt, status: "finalization_requires_adjudication", remoteWritesPerformed: dispatched,
      errorCode: /^[A-Z0-9_]{1,100}$/.test(error?.code ?? "") ? error.code : "FINALIZATION_FAILED",
      operatorAction: "Do not retry or release another owner. Retain external writer controls and adjudicate the original attempt." }).catch(() => {});
    throw error;
  } finally { await handle.close(); }
}
