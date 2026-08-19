import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rm,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildSuccessorFinalizerEvidence,
  buildSuccessorFinalizerRenderOnlyRehearsal,
} from "./vendor-disclosure-successor-finalizer-evidence.mjs";
import {
  validateSuccessorReleaseContract,
} from "./supabase-successor-release-contract.mjs";
import { analyzeReadOnlySqlEnvelope } from "./sql-read-only-envelope.mjs";

const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const UUID_V4 =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CANONICAL_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{16,64}$/;
const DATABASE_SYSTEM_IDENTIFIER = /^\d{10,32}$/;
const REMOTE_REF = /^origin\/[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?$/;
const CANONICAL_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 64 * 1024;
const MAX_WORKER_OUTPUT_BYTES = 1024 * 1024;
const APPROVED_STAGING_CONTRACT_FILE =
  "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json";
const FORWARD_FIX_CHECKS = Object.freeze([
  "exactFeatureOffReceiptConsumed",
  "migrationRollbackNotAttempted",
  "forwardFixProcedureValidated",
  "writeFencesRetained",
  "productionUntouched",
]);
const OUTPUT_SUFFIX = Object.freeze({
  stagingFeatureOff: "feature-off-rollback.json",
  forwardFix: "forward-fix-rehearsal.json",
  ownerLease: "finalizer-owner-lease-rehearsal.json",
  templateContract: "finalizer-template-contract-rehearsal.json",
  canaryFence: "finalizer-canary-rehearsal.json",
  finalizerFeatureOff: "finalizer-feature-off-rehearsal.json",
  finalizerDry: "finalizer-dry-rehearsal.json",
  provenance: "successor-rehearsal-provenance.json",
});
const WORKER_REPORT_KEYS = Object.freeze([
  "completedAt",
  "containsSecrets",
  "databaseScope",
  "deploymentId",
  "facts",
  "kind",
  "networkScope",
  "productionMutationCommandCount",
  "release",
  "releaseCommit",
  "startedAt",
  "workerVersion",
]);
const FORWARD_REPORT_KEYS = Object.freeze([
  "completedAt",
  "containsSecrets",
  "facts",
  "kind",
  "productionMutationCommandCount",
  "rehearsalRunId",
  "startedAt",
  "workerVersion",
]);

export class SuccessorRehearsalProducerError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SuccessorRehearsalProducerError";
    this.code = code;
  }
}

function blocked(code, message = code) {
  throw new SuccessorRehearsalProducerError(code, message);
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...keys].sort());
}

function exactRecord(value, expected) {
  return exactKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, expectedValue]) => (
      value[key] === expectedValue
    ));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJsonSha256(value) {
  return sha256(`${canonicalJson(value)}\n`);
}

function renderOnlyRecoveryAssurancePlaceholderSha256(
  manifest,
  expectedCommit,
) {
  return sha256(`${[
    "successor-render-only-unissued-recovery-assurance-v1",
    manifest.release,
    manifest.projectRef,
    expectedCommit,
    canonicalJsonSha256(manifest.deploymentEvidence.recoveryAssurance),
  ].join("\n")}\n`);
}

function canonicalTextSha256(value) {
  return sha256(value.replace(/\r\n?/g, "\n"));
}

function instant(value, code) {
  if (typeof value !== "string" || !CANONICAL_INSTANT.test(value)) blocked(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)
      || new Date(milliseconds).toISOString() !== value) blocked(code);
  return milliseconds;
}

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value === ""
    || (value !== ".."
      && !value.startsWith(`..${sep}`)
      && !isAbsolute(value));
}

function sameFile(left, right) {
  const inodeMatches = !Number.isSafeInteger(left.ino)
    || left.ino === 0
    || (left.ino === right.ino && left.dev === right.dev);
  return inodeMatches
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function containsSecretMaterial(value) {
  const text = JSON.stringify(value);
  return /(?:postgres(?:ql)?:\/\/|Bearer\s+[A-Za-z0-9._-]{12,}|\bsk-[A-Za-z0-9_-]{12,}|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/i
    .test(text);
}

async function readBoundedRegularFile(path, maximumBytes, code) {
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()
      || before.size < 2 || before.size > maximumBytes) blocked(code);
  const handle = await open(path, "r").catch(() => null);
  if (!handle) blocked(code);
  let opened;
  let bytes;
  try {
    opened = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    if (!opened.isFile() || !linked?.isFile() || linked.isSymbolicLink()
        || !sameFile(before, opened) || !sameFile(opened, linked)) blocked(code);
    bytes = await handle.readFile();
    const after = await handle.stat();
    const linkedAfter = await lstat(path).catch(() => null);
    if (!linkedAfter?.isFile() || linkedAfter.isSymbolicLink()
        || !sameFile(opened, after) || !sameFile(after, linkedAfter)
        || bytes.length !== after.size || bytes.length < 2
        || bytes.length > maximumBytes) blocked(code);
  } finally {
    await handle.close().catch(() => {});
  }
  return bytes;
}

async function readOutsideJson(path, repoRoot, code, maximumBytes = MAX_INPUT_BYTES) {
  if (!isAbsolute(path) || !path.toLowerCase().endsWith(".json")) blocked(code);
  const [repoCanonical, parentCanonical, parentMetadata, before] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(dirname(path)).catch(() => null),
    lstat(dirname(path)).catch(() => null),
    lstat(path).catch(() => null),
  ]);
  if (!repoCanonical || !parentCanonical || !parentMetadata?.isDirectory()
      || parentMetadata.isSymbolicLink() || inside(repoCanonical, parentCanonical)
      || !before?.isFile() || before.isSymbolicLink()) blocked(code);
  const canonicalPath = await realpath(path).catch(() => null);
  if (!canonicalPath || resolve(dirname(canonicalPath)) !== resolve(parentCanonical)) {
    blocked(code);
  }
  const bytes = await readBoundedRegularFile(canonicalPath, maximumBytes, code);
  const [afterPath, after] = await Promise.all([
    realpath(path).catch(() => null),
    lstat(path).catch(() => null),
  ]);
  if (afterPath !== canonicalPath || !after?.isFile() || after.isSymbolicLink()
      || !sameFile(before, after)) blocked(code);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    blocked(code);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || containsSecretMaterial(value)) blocked(code);
  return Object.freeze({ path: canonicalPath, parent: parentCanonical, bytes, value, sha256: sha256(bytes) });
}

async function readPinnedFile(repoRoot, relativePath, code, maximumBytes = MAX_INPUT_BYTES) {
  if (typeof relativePath !== "string" || relativePath.includes("\\")
      || relativePath.includes("//")) blocked(code);
  const path = resolve(repoRoot, relativePath);
  const canonicalRoot = await realpath(repoRoot).catch(() => null);
  if (!canonicalRoot || !inside(canonicalRoot, path)) blocked(code);
  return readBoundedRegularFile(path, maximumBytes, code);
}

async function outputRootOutsideGit(repoRoot, receiptRoot) {
  if (!isAbsolute(receiptRoot)) blocked("REHEARSAL_OUTPUT_ROOT_INVALID");
  const [repoCanonical, rootCanonical, metadata] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(receiptRoot).catch(() => null),
    lstat(receiptRoot).catch(() => null),
  ]);
  if (!repoCanonical || !rootCanonical || !metadata?.isDirectory()
      || metadata.isSymbolicLink() || inside(repoCanonical, rootCanonical)) {
    blocked("REHEARSAL_OUTPUT_ROOT_INVALID");
  }
  return rootCanonical;
}

async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeDurableExclusiveReceiptSet({
  files,
  openFile = open,
  syncParent = syncDirectory,
}) {
  if (!Array.isArray(files) || files.length < 1
      || typeof openFile !== "function" || typeof syncParent !== "function"
      || files.some((entry) => !exactKeys(entry, ["path", "text"])
        || typeof entry.path !== "string" || typeof entry.text !== "string"
        || Buffer.byteLength(entry.text, "utf8") < 2
        || Buffer.byteLength(entry.text, "utf8") > MAX_INPUT_BYTES)
      || new Set(files.map((entry) => resolve(entry.path))).size !== files.length
      || new Set(files.map((entry) => resolve(dirname(entry.path)))).size !== 1) {
    blocked("REHEARSAL_OUTPUT_SET_INVALID");
  }
  const parent = resolve(dirname(files[0].path));
  const created = [];
  let active = null;
  try {
    for (const entry of files) {
      active = { path: entry.path, handle: null };
      const handle = await openFile(entry.path, "wx", 0o600);
      active.handle = handle;
      created.push(active);
      await handle.writeFile(entry.text, "utf8");
      await handle.sync();
      await handle.close();
      active.handle = null;
    }
    await syncParent(parent);
  } catch (error) {
    if (active?.handle) await active.handle.close().catch(() => {});
    for (const entry of [...created].reverse()) {
      await unlink(entry.path).catch(() => {});
    }
    await syncParent(parent).catch(() => {});
    throw error;
  }
}

function validateReadyRelease(state) {
  const { manifest, controllerManifest } = state ?? {};
  if (state?.controllerReady !== true || state?.deploymentBlocked !== false
      || manifest?.status !== "controller_ready"
      || manifest.release !== controllerManifest?.release
      || manifest.projectRef !== controllerManifest?.projectRef
      || !PROJECT_REF.test(manifest.projectRef ?? "")
      || !Array.isArray(manifest.expandMigrations) || manifest.expandMigrations.length < 1) {
    blocked("REHEARSAL_CONTROLLER_NOT_READY");
  }
  const rollback = controllerManifest.rollbackContract;
  const finalization = controllerManifest.finalizationContract;
  const postExpand = controllerManifest.postExpandBackupContract;
  if (!rollback || rollback.strategy !== "forward-fix-feature-off"
      || rollback.migrationRollback !== "prohibited"
      || rollback.featureOffReceiptFileName !== `${manifest.release}-feature-off-rollback.json`
      || rollback.maximumAgeMinutes !== 30
      || !Array.isArray(rollback.requiredChecks)
      || !exactKeys(rollback.requiredControls, Object.keys(rollback.requiredControls ?? {}))
      || Object.keys(rollback.requiredControls).length < 1
      || Object.entries(rollback.requiredControls).some(([name, value]) => (
        !/^[A-Z][A-Z0-9_]{2,100}$/.test(name)
        || (value !== "true" && value !== "false")
      ))
      || !finalization || finalization.version !== 2
      || finalization.requiredLeasePhase !== "deployment-canary"
      || finalization.canaryMaximumAgeMinutes !== 15
      || !Array.isArray(finalization.requiredCanaryChecks)
      || finalization.requiredCanaryChecks.length < 1
      || !postExpand || !SHA256.test(postExpand.expectedTableContractSha256 ?? "")
      || !SHA256.test(postExpand.expectedReleaseMigrationContractSha256 ?? "")) {
    blocked("REHEARSAL_RELEASE_CONTRACT_INVALID");
  }
  return { manifest, controllerManifest, rollback, finalization, postExpand };
}

async function approvedStagingProjectRef(repoRoot, manifest) {
  const bytes = await readPinnedFile(
    repoRoot,
    APPROVED_STAGING_CONTRACT_FILE,
    "REHEARSAL_STAGING_APPROVAL_INVALID",
    MAX_RECEIPT_BYTES,
  );
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    blocked("REHEARSAL_STAGING_APPROVAL_INVALID");
  }
  if (value?.release !== manifest.release
      || value?.productionProjectRef !== manifest.projectRef
      || !PROJECT_REF.test(value?.projectRef ?? "")
      || value.projectRef === manifest.projectRef
      || value?.approved !== true
      || value?.status !== "approved_for_hosted_rls_probe") {
    blocked("REHEARSAL_STAGING_APPROVAL_INVALID");
  }
  return { projectRef: value.projectRef, sha256: sha256(bytes) };
}

function validatePostcheck(input, { manifest, controllerManifest, expectedCommit, stagingRef }) {
  const value = input.value;
  const check = controllerManifest.postApplyChecks?.find(
    (entry) => entry?.id === value?.checkId,
  );
  if (!check || controllerManifest.postApplyChecks.length !== 1
      || value?.receiptVersion !== 1
      || value?.kind !== "successor-read-only-postcheck-result-v1"
      || value?.release !== manifest.release
      || value?.projectRef !== stagingRef
      || value?.productionProjectRef !== manifest.projectRef
      || value?.releaseCommit !== expectedCommit
      || value?.source !== "supabase-management-read-only-query"
      || value?.transactionReadOnly !== true
      || value?.productionMutationAttempted !== false
      || value?.containsSecrets !== false
      || value?.sqlFile !== check.file
      || value?.sqlSha256 !== check.sha256
      || value?.row?.verified !== true
      || !exactKeys(value.row, ["verified", ...Object.keys(check.expectedEvidence ?? {})])
      || !Object.entries(check.expectedEvidence ?? {}).every(
        ([name, expected]) => value.row[name] === expected,
      )) {
    blocked("REHEARSAL_POSTCHECK_INVALID");
  }
  return check;
}

async function validatePostcheckSql(repoRoot, check) {
  const bytes = await readPinnedFile(
    repoRoot,
    check.file,
    "REHEARSAL_POSTCHECK_SQL_INVALID",
  );
  const text = bytes.toString("utf8");
  const analysis = analyzeReadOnlySqlEnvelope(text);
  if (!analysis.ok || canonicalTextSha256(text) !== check.sha256) {
    blocked("REHEARSAL_POSTCHECK_SQL_INVALID");
  }
  return text;
}

async function boundedResponseText(response, code) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RECEIPT_BYTES) blocked(code);
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") < 2
      || Buffer.byteLength(text, "utf8") > MAX_RECEIPT_BYTES) blocked(code);
  return text;
}

export async function runReadOnlyStagingPostcheckObservation({
  stagingProjectRef,
  productionProjectRef,
  sqlText,
  sqlSha256,
  expectedRow,
  environment = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
}) {
  const token = environment.SUPABASE_ACCESS_TOKEN;
  if (!PROJECT_REF.test(stagingProjectRef ?? "")
      || !PROJECT_REF.test(productionProjectRef ?? "")
      || stagingProjectRef === productionProjectRef
      || typeof token !== "string" || token.length < 20
      || typeof fetchImpl !== "function"
      || analyzeReadOnlySqlEnvelope(sqlText).ok !== true
      || canonicalTextSha256(sqlText) !== sqlSha256
      || !expectedRow || typeof expectedRow !== "object" || Array.isArray(expectedRow)) {
    blocked("REHEARSAL_STAGING_POSTCHECK_OBSERVATION_INVALID");
  }
  const started = now();
  const requestBody = JSON.stringify({ query: sqlText });
  let response;
  try {
    response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${stagingProjectRef}/database/query/read-only`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
  } catch {
    blocked("REHEARSAL_STAGING_POSTCHECK_OBSERVATION_INVALID");
  }
  const bodyText = await boundedResponseText(
    response,
    "REHEARSAL_STAGING_POSTCHECK_OBSERVATION_INVALID",
  );
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    blocked("REHEARSAL_STAGING_POSTCHECK_OBSERVATION_INVALID");
  }
  const row = Array.isArray(body) && body.length === 1 ? body[0] : null;
  const completed = now();
  if (response.status !== 201 || !exactRecord(row, expectedRow)
      || containsSecretMaterial(body)
      || !(started instanceof Date) || !(completed instanceof Date)
      || completed.getTime() < started.getTime()) {
    blocked("REHEARSAL_STAGING_POSTCHECK_OBSERVATION_INVALID");
  }
  return Object.freeze({
    observationVersion: 1,
    kind: "successor-staging-read-only-postcheck-http-observation-v1",
    projectRef: stagingProjectRef,
    productionProjectRef,
    transactionReadOnly: true,
    sqlSha256,
    request: {
      method: "POST",
      path: `/v1/projects/${stagingProjectRef}/database/query/read-only`,
      bodySha256: sha256(requestBody),
    },
    response: {
      status: response.status,
      bodyText,
      bodySha256: sha256(bodyText),
      row,
    },
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    productionMutationCommandCount: 0,
    containsSecrets: false,
  });
}

function validateProbeIdentity(input, { manifest, expectedCommit, stagingRef }) {
  const value = input.value;
  if (value?.kind !== "amora-successor-hosted-staging-probe"
      || value?.projectRef !== stagingRef
      || value?.gitCommit !== expectedCommit
      || value?.projectRef === manifest.projectRef) {
    blocked("REHEARSAL_PROBE_INVALID");
  }
}

function deriveFeatureChecks(row, worker) {
  const facts = worker.facts;
  const checks = {
    databaseWriteFenceHeld:
      facts.database.appWriteSqlstate === "25006"
      && facts.canary.databaseFenceStatus === 503,
    storageWriteFenceHeld:
      facts.database.storageWriteSqlstate === "25006"
      && facts.canary.storageUploadStatus === 403,
    authSignupDisabled: facts.canary.signupStatus === 403,
    webWriteFenceEnabled:
      facts.canary.webFenceStatus === 503
      && facts.canary.webFenceError === "production_write_fence_enabled"
      && facts.canary.cacheControl === "no-store",
    chatPartnerRecipientBoundaryHeld:
      row.chat_partner_recipient_select_policy_count === 1
      && row.chat_partner_recipient_trigger_count === 1,
    conversationSegmentScopeBoundaryHeld:
      row.conversation_segment_scope_fk_count === 2
      && row.conversation_segment_rls_policy_count === 1
      && row.conversation_segment_rpc_acl_count === 1
      && row.conversation_segment_active_index_count === 3,
  };
  if (Object.values(checks).some((value) => value !== true)) {
    blocked("REHEARSAL_FEATURE_FACTS_FAILED");
  }
  return checks;
}

function validateWorkerReport(report, context) {
  if (!exactKeys(report, WORKER_REPORT_KEYS)
      || report.workerVersion !== 1
      || report.kind !== "successor-local-isolated-rehearsal-observation-v1"
      || report.release !== context.manifest.release
      || report.releaseCommit !== context.expectedCommit
      || report.networkScope !== "loopback-only"
      || report.databaseScope !== "ephemeral-pglite"
      || report.productionMutationCommandCount !== 0
      || report.containsSecrets !== false
      || !DEPLOYMENT_ID.test(report.deploymentId ?? "")
      || containsSecretMaterial(report)) {
    blocked("REHEARSAL_WORKER_REPORT_INVALID");
  }
  const startedAt = instant(report.startedAt, "REHEARSAL_WORKER_REPORT_INVALID");
  const completedAt = instant(report.completedAt, "REHEARSAL_WORKER_REPORT_INVALID");
  const expectedDuration = context.observationWindowSeconds * 1_000;
  if (completedAt < startedAt || completedAt - startedAt < expectedDuration
      || completedAt - startedAt > expectedDuration + 60_000) {
    blocked("REHEARSAL_WORKER_REPORT_INVALID");
  }
  const facts = report.facts;
  if (!exactKeys(facts, ["canary", "database", "featureOff", "repositoryTest"])
      || !exactKeys(facts.database, [
        "appWriteSqlstate", "duplicateLeaseSqlstate", "leaseOwnerId",
        "leasePhase", "leaseRowCount", "ownerObservationTransactionMode",
        "storageWriteSqlstate", "systemIdentifier",
      ])
      || !DATABASE_SYSTEM_IDENTIFIER.test(facts.database.systemIdentifier ?? "")
      || !UUID_V4.test(facts.database.leaseOwnerId ?? "")
      || facts.database.leasePhase !== context.finalization.requiredLeasePhase
      || facts.database.leaseRowCount !== 1
      || facts.database.duplicateLeaseSqlstate !== "23505"
      || facts.database.appWriteSqlstate !== "25006"
      || facts.database.storageWriteSqlstate !== "25006"
      || facts.database.ownerObservationTransactionMode !== "read-only"
      || !exactKeys(facts.featureOff, ["observedControls"])
      || !exactRecord(facts.featureOff.observedControls, context.rollback.requiredControls)
      || !exactKeys(facts.repositoryTest, [
        "command", "durationMs", "exitCode", "runnerSha256", "stderrSha256",
        "stdoutSha256", "testFileSha256",
      ])
      || facts.repositoryTest.command
        !== "node:vitest:production-build-fence"
      || facts.repositoryTest.exitCode !== 0
      || !Number.isSafeInteger(facts.repositoryTest.durationMs)
      || facts.repositoryTest.durationMs < 0
      || facts.repositoryTest.durationMs > 60_000
      || ["runnerSha256", "stderrSha256", "stdoutSha256", "testFileSha256"]
        .some((name) => !SHA256.test(facts.repositoryTest[name] ?? ""))) {
    blocked("REHEARSAL_WORKER_REPORT_INVALID");
  }
  const canary = facts.canary;
  if (!exactKeys(canary, [
    "authenticatedReadStatus", "cacheControl", "consoleErrorCount",
    "databaseFenceStatus", "deployedCommitHeader", "externalRequestCount",
    "loginStatus", "logoutStatus", "maximumLatencyMs", "pageErrorCount",
    "publicReadStatus", "requestFailedCount", "serverErrorCount", "signupStatus",
    "storageUploadStatus", "unexpected5xxCount", "webFenceError",
    "webFenceStatus", "loopbackOriginSha256",
  ])
      || canary.publicReadStatus !== 200
      || canary.authenticatedReadStatus !== 200
      || canary.loginStatus !== 204 || canary.logoutStatus !== 204
      || canary.signupStatus !== 403 || canary.storageUploadStatus !== 403
      || canary.webFenceStatus !== 503 || canary.databaseFenceStatus !== 503
      || canary.deployedCommitHeader !== context.expectedCommit
      || canary.webFenceError !== "production_write_fence_enabled"
      || canary.cacheControl !== "no-store"
      || canary.consoleErrorCount !== 0 || canary.pageErrorCount !== 0
      || canary.requestFailedCount !== 0 || canary.unexpected5xxCount !== 0
      || canary.serverErrorCount !== 0 || canary.externalRequestCount !== 0
      || !Number.isSafeInteger(canary.maximumLatencyMs)
      || canary.maximumLatencyMs < 0 || canary.maximumLatencyMs > 5_000
      || !SHA256.test(canary.loopbackOriginSha256 ?? "")) {
    blocked("REHEARSAL_WORKER_REPORT_INVALID");
  }
  return { startedAt, completedAt };
}

function deriveCanaryChecks(requiredChecks, worker, expectedCommit) {
  const canary = worker.facts.canary;
  const database = worker.facts.database;
  const candidates = {
    authenticatedReadPassed: canary.authenticatedReadStatus === 200,
    browserConsoleClean: canary.consoleErrorCount === 0
      && canary.pageErrorCount === 0 && canary.requestFailedCount === 0,
    databaseFenceStillVerified: database.appWriteSqlstate === "25006"
      && canary.databaseFenceStatus === 503,
    deployedCommitMatched: canary.deployedCommitHeader === expectedCommit,
    deploymentReady: canary.publicReadStatus === 200,
    latencyWithinBaseline: canary.maximumLatencyMs <= 5_000,
    loginLogoutPassed: canary.loginStatus === 204 && canary.logoutStatus === 204,
    noUnexpected5xx: canary.unexpected5xxCount === 0,
    publicReadPassed: canary.publicReadStatus === 200,
    serverErrorsWithinBaseline: canary.serverErrorCount === 0,
    signupStillDisabled: canary.signupStatus === 403,
    storageHelperClosed: canary.storageUploadStatus === 403,
    webWriteFenceStillEnabled: canary.webFenceStatus === 503
      && canary.webFenceError === "production_write_fence_enabled"
      && worker.facts.repositoryTest.exitCode === 0,
  };
  if (!exactKeys(candidates, requiredChecks)
      || requiredChecks.some((name) => candidates[name] !== true)) {
    blocked("REHEARSAL_CANARY_FACTS_FAILED");
  }
  return candidates;
}

async function validateRepositoryTestProvenance(report, repoRoot) {
  const [testFile, runner] = await Promise.all([
    readPinnedFile(
      repoRoot,
      "apps/web/src/lib/price/productionBuildFence.test.ts",
      "REHEARSAL_REPOSITORY_TEST_INVALID",
    ),
    readPinnedFile(
      repoRoot,
      "apps/web/node_modules/vitest/vitest.mjs",
      "REHEARSAL_REPOSITORY_TEST_INVALID",
      MAX_RECEIPT_BYTES,
    ),
  ]);
  if (report.facts.repositoryTest.testFileSha256 !== sha256(testFile)
      || report.facts.repositoryTest.runnerSha256 !== sha256(runner)) {
    blocked("REHEARSAL_REPOSITORY_TEST_INVALID");
  }
}

function validateForwardReport(report, { featureSha256, planSha256, featureChecks }) {
  if (!exactKeys(report, FORWARD_REPORT_KEYS)
      || report.workerVersion !== 1
      || report.kind !== "successor-forward-fix-local-rehearsal-observation-v1"
      || !UUID_V4.test(report.rehearsalRunId ?? "")
      || report.productionMutationCommandCount !== 0
      || report.containsSecrets !== false
      || containsSecretMaterial(report)
      || !exactKeys(report.facts, [
        "falseCheckCount", "featureReceiptSha256", "migrationRollbackCommandCount",
        "observedControlMismatchCount", "planSha256", "remoteEndpointCount",
      ])
      || report.facts.featureReceiptSha256 !== featureSha256
      || report.facts.planSha256 !== planSha256
      || report.facts.falseCheckCount !== 0
      || report.facts.observedControlMismatchCount !== 0
      || report.facts.migrationRollbackCommandCount !== 0
      || report.facts.remoteEndpointCount !== 0
      || Object.values(featureChecks).some((value) => value !== true)) {
    blocked("REHEARSAL_FORWARD_REPORT_INVALID");
  }
  const startedAt = instant(report.startedAt, "REHEARSAL_FORWARD_REPORT_INVALID");
  const completedAt = instant(report.completedAt, "REHEARSAL_FORWARD_REPORT_INVALID");
  if (completedAt < startedAt) blocked("REHEARSAL_FORWARD_REPORT_INVALID");
  return { startedAt, completedAt };
}

function deriveForwardChecks({
  report,
  worker,
  featureChecks,
  featureSha256,
  planSha256,
}) {
  const checks = {
    exactFeatureOffReceiptConsumed:
      report.facts.featureReceiptSha256 === featureSha256,
    migrationRollbackNotAttempted:
      report.facts.migrationRollbackCommandCount === 0,
    forwardFixProcedureValidated:
      report.facts.planSha256 === planSha256
      && report.facts.observedControlMismatchCount === 0
      && report.facts.falseCheckCount === 0
      && report.facts.remoteEndpointCount === 0,
    writeFencesRetained:
      featureChecks.databaseWriteFenceHeld === true
      && featureChecks.storageWriteFenceHeld === true
      && featureChecks.webWriteFenceEnabled === true,
    productionUntouched:
      report.productionMutationCommandCount === 0
      && worker.productionMutationCommandCount === 0
      && worker.networkScope === "loopback-only",
  };
  if (!exactKeys(checks, FORWARD_FIX_CHECKS)
      || FORWARD_FIX_CHECKS.some((name) => checks[name] !== true)) {
    blocked("REHEARSAL_FORWARD_FACTS_FAILED");
  }
  return checks;
}

function forwardFixPlan(rollback) {
  return {
    version: 1,
    strategy: rollback.strategy,
    migrationRollback: rollback.migrationRollback,
    rehearsalMode: "isolated-staging-forward-fix-rehearsal",
    featureOffReceiptFileName: rollback.featureOffReceiptFileName,
    requiredChecks: [...FORWARD_FIX_CHECKS],
  };
}

function exactJsonValue(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function validateCommandProvenance({
  command,
  request,
  response,
  mode,
  repoRoot,
  observationWindowSeconds,
}) {
  const keys = [
    "command", "completedAt", "executableSha256", "exitCode", "librarySha256",
    "scriptSha256", "startedAt", "stderrSha256", "stdinSha256", "stdoutSha256",
  ];
  if (!exactKeys(command, keys)
      || command.command !== `node:${mode}`
      || command.exitCode !== 0
      || command.stderrSha256 !== sha256("")
      || command.stdinSha256 !== sha256(jsonText({
        ...request,
        observationWindowSeconds,
      }))
      || command.stdoutSha256 !== sha256(`${JSON.stringify(response)}\n`)) {
    blocked("REHEARSAL_PROVENANCE_COMMAND_INVALID");
  }
  const startedAt = instant(command.startedAt, "REHEARSAL_PROVENANCE_COMMAND_INVALID");
  const completedAt = instant(command.completedAt, "REHEARSAL_PROVENANCE_COMMAND_INVALID");
  if (completedAt < startedAt) blocked("REHEARSAL_PROVENANCE_COMMAND_INVALID");
  const [scriptBytes, libraryBytes, nodeSha] = await Promise.all([
    readPinnedFile(
      repoRoot,
      "scripts/vendor-disclosure-successor-rehearsal-producer.mjs",
      "REHEARSAL_PROVENANCE_COMMAND_INVALID",
    ),
    readPinnedFile(
      repoRoot,
      "scripts/lib/vendor-disclosure-successor-rehearsal-producer.mjs",
      "REHEARSAL_PROVENANCE_COMMAND_INVALID",
    ),
    executableSha256(),
  ]);
  if (command.scriptSha256 !== sha256(scriptBytes)
      || command.librarySha256 !== sha256(libraryBytes)
      || command.executableSha256 !== nodeSha) {
    blocked("REHEARSAL_PROVENANCE_COMMAND_INVALID");
  }
}

async function validateStagingPostcheckProvenance({
  value,
  repoRoot,
  postcheckValue,
  manifest,
  controllerManifest,
  stagingProjectRef,
}) {
  if (!exactKeys(value, [
    "completedAt", "containsSecrets", "kind", "observationVersion",
    "productionMutationCommandCount", "productionProjectRef", "projectRef",
    "request", "response", "sqlSha256", "startedAt", "transactionReadOnly",
  ])
      || value.observationVersion !== 1
      || value.kind !== "successor-staging-read-only-postcheck-http-observation-v1"
      || value.projectRef !== stagingProjectRef
      || value.productionProjectRef !== manifest.projectRef
      || value.transactionReadOnly !== true
      || value.productionMutationCommandCount !== 0
      || value.containsSecrets !== false
      || containsSecretMaterial(value)) {
    blocked("REHEARSAL_PROVENANCE_POSTCHECK_INVALID");
  }
  const startedAt = instant(value.startedAt, "REHEARSAL_PROVENANCE_POSTCHECK_INVALID");
  const completedAt = instant(value.completedAt, "REHEARSAL_PROVENANCE_POSTCHECK_INVALID");
  const check = controllerManifest.postApplyChecks?.find(
    (entry) => entry?.id === postcheckValue.checkId,
  );
  if (!check || completedAt < startedAt
      || value.sqlSha256 !== check.sha256
      || !exactKeys(value.request, ["bodySha256", "method", "path"])
      || value.request.method !== "POST"
      || value.request.path !== `/v1/projects/${stagingProjectRef}/database/query/read-only`
      || !exactKeys(value.response, ["bodySha256", "bodyText", "row", "status"])
      || value.response.status !== 201
      || value.response.bodySha256 !== sha256(value.response.bodyText)
      || !exactRecord(value.response.row, postcheckValue.row)
      || !exactRecord(value.response.row, {
        verified: true,
        ...check.expectedEvidence,
      })) {
    blocked("REHEARSAL_PROVENANCE_POSTCHECK_INVALID");
  }
  let body;
  try {
    body = JSON.parse(value.response.bodyText);
  } catch {
    blocked("REHEARSAL_PROVENANCE_POSTCHECK_INVALID");
  }
  if (!Array.isArray(body) || body.length !== 1
      || !exactRecord(body[0], value.response.row)) {
    blocked("REHEARSAL_PROVENANCE_POSTCHECK_INVALID");
  }
  const sqlBytes = await readPinnedFile(
    repoRoot,
    check.file,
    "REHEARSAL_PROVENANCE_POSTCHECK_INVALID",
  );
  const sqlText = sqlBytes.toString("utf8");
  const requestBody = JSON.stringify({ query: sqlText });
  if (analyzeReadOnlySqlEnvelope(sqlText).ok !== true
      || canonicalTextSha256(sqlText) !== check.sha256
      || value.request.bodySha256 !== sha256(requestBody)) {
    blocked("REHEARSAL_PROVENANCE_POSTCHECK_INVALID");
  }
}

export async function validateSuccessorRehearsalProducerProvenance({
  repoRoot,
  provenanceValue,
  provenanceBytes,
  featureOffValue,
  featureOffBytes,
  forwardFixValue,
  forwardFixBytes,
  probeBytes,
  postcheckValue,
  postcheckBytes,
  manifest,
  controllerManifest,
  expectedCommit,
  stagingProjectRef,
  approvedStagingContractSha256,
}) {
  const context = validateReadyRelease({
    controllerReady: true,
    deploymentBlocked: false,
    manifest,
    controllerManifest,
  });
  const value = provenanceValue;
  if (!Buffer.isBuffer(provenanceBytes)
      || !Buffer.isBuffer(featureOffBytes)
      || !Buffer.isBuffer(forwardFixBytes)
      || !Buffer.isBuffer(probeBytes)
      || !Buffer.isBuffer(postcheckBytes)
      || !PROJECT_REF.test(stagingProjectRef ?? "")
      || !SHA256.test(approvedStagingContractSha256 ?? "")
      || !exactKeys(value, [
        "artifacts", "capturedAt", "commands", "consumerValidation",
        "containsSecrets", "git", "inputs", "kind", "observations",
        "productionProjectRef", "provenanceVersion", "release", "releaseCommit",
        "requests", "scope", "stagingPostcheck", "stagingProjectRef",
      ])
      || value.provenanceVersion !== 1
      || value.kind !== "successor-rehearsal-receipt-producer-provenance-v1"
      || value.release !== manifest.release
      || value.productionProjectRef !== manifest.projectRef
      || value.stagingProjectRef !== stagingProjectRef
      || value.releaseCommit !== expectedCommit
      || value.containsSecrets !== false
      || containsSecretMaterial(value)) {
    blocked("REHEARSAL_PROVENANCE_INVALID");
  }
  const capturedAt = instant(value.capturedAt, "REHEARSAL_PROVENANCE_INVALID");
  if (!exactKeys(value.git, [
    "actualCommit", "remoteCommit", "remoteRef", "upstreamCommit", "worktreeClean",
  ])
      || value.git.actualCommit !== expectedCommit
      || value.git.upstreamCommit !== expectedCommit
      || value.git.remoteCommit !== expectedCommit
      || value.git.worktreeClean !== true
      || !REMOTE_REF.test(value.git.remoteRef ?? "")) {
    blocked("REHEARSAL_PROVENANCE_INVALID");
  }
  if (!exactKeys(value.inputs, [
    "approvedStagingContractSha256", "finalizerTemplateSha256",
    "postExpandBackupReceiptSha256", "recoveryAssuranceContractSha256",
    "renderOnlyRecoveryAssurancePlaceholderSha256",
    "postcheckReceiptSha256", "probeReceiptSha256",
  ])
      || value.inputs.approvedStagingContractSha256
        !== approvedStagingContractSha256
      || value.inputs.probeReceiptSha256 !== sha256(probeBytes)
      || value.inputs.postcheckReceiptSha256 !== sha256(postcheckBytes)
      || value.inputs.recoveryAssuranceContractSha256
        !== canonicalJsonSha256(manifest.deploymentEvidence.recoveryAssurance)
      || value.inputs.renderOnlyRecoveryAssurancePlaceholderSha256
        !== renderOnlyRecoveryAssurancePlaceholderSha256(
          manifest,
          expectedCommit,
        )
      || Object.values(value.inputs).some((digest) => !SHA256.test(digest ?? ""))) {
    blocked("REHEARSAL_PROVENANCE_INPUT_INVALID");
  }
  if (!exactKeys(value.requests, ["forwardFix", "isolated"])
      || !exactKeys(value.observations, ["forwardFix", "isolated"])
      || !exactKeys(value.commands, ["forwardFix", "isolated"])) {
    blocked("REHEARSAL_PROVENANCE_INVALID");
  }
  const isolatedRequest = value.requests.isolated;
  if (!exactKeys(isolatedRequest, [
    "leasePhase", "productionProjectRef", "release", "releaseCommit",
    "requiredControlNames", "stagingProjectRef",
  ])
      || isolatedRequest.release !== manifest.release
      || isolatedRequest.productionProjectRef !== manifest.projectRef
      || isolatedRequest.stagingProjectRef !== stagingProjectRef
      || isolatedRequest.releaseCommit !== expectedCommit
      || isolatedRequest.leasePhase !== context.finalization.requiredLeasePhase
      || !Array.isArray(isolatedRequest.requiredControlNames)
      || !exactJsonValue(
        isolatedRequest.requiredControlNames,
        Object.keys(context.rollback.requiredControls).sort(),
      )) {
    blocked("REHEARSAL_PROVENANCE_REQUEST_INVALID");
  }
  const worker = value.observations.isolated;
  await validateStagingPostcheckProvenance({
    value: value.stagingPostcheck,
    repoRoot,
    postcheckValue,
    manifest,
    controllerManifest,
    stagingProjectRef,
  });
  validateWorkerReport(worker, {
    ...context,
    expectedCommit,
    observationWindowSeconds: 300,
  });
  await validateRepositoryTestProvenance(worker, repoRoot);
  const featureChecks = deriveFeatureChecks(postcheckValue.row, worker);
  if (!exactKeys(featureChecks, context.rollback.requiredChecks)) {
    blocked("REHEARSAL_PROVENANCE_FEATURE_INVALID");
  }
  const expectedFeature = {
    receiptVersion: 1,
    kind: "successor-feature-off-rollback-rehearsal-v1",
    release: manifest.release,
    releaseCommit: expectedCommit,
    receiptFileName: context.rollback.featureOffReceiptFileName,
    strategy: context.rollback.strategy,
    migrationRollback: context.rollback.migrationRollback,
    receiptMaximumAgeMinutes: context.rollback.maximumAgeMinutes,
    requiredControls: { ...context.rollback.requiredControls },
    observedControls: { ...worker.facts.featureOff.observedControls },
    checks: featureChecks,
    environment: "isolated-non-production-rehearsal",
    source: "feature-off-rollback-rehearsal",
    verifiedAt: worker.completedAt,
    productionMutationAttempted: false,
    containsSecrets: false,
    projectRef: stagingProjectRef,
  };
  if (!exactJsonValue(featureOffValue, expectedFeature)) {
    blocked("REHEARSAL_PROVENANCE_FEATURE_INVALID");
  }
  const featureSha = sha256(featureOffBytes);
  const plan = forwardFixPlan(context.rollback);
  const planSha = canonicalJsonSha256(plan);
  const forwardRequest = value.requests.forwardFix;
  if (!exactKeys(forwardRequest, [
    "expectedChecks", "expectedControls", "expectedFeatureSha256",
    "expectedPlanSha256", "featureReceiptText", "plan",
  ])
      || forwardRequest.featureReceiptText !== featureOffBytes.toString("utf8")
      || forwardRequest.expectedFeatureSha256 !== featureSha
      || forwardRequest.expectedPlanSha256 !== planSha
      || !exactJsonValue(forwardRequest.plan, plan)
      || !exactJsonValue(forwardRequest.expectedControls, context.rollback.requiredControls)
      || !exactJsonValue(forwardRequest.expectedChecks, context.rollback.requiredChecks)) {
    blocked("REHEARSAL_PROVENANCE_REQUEST_INVALID");
  }
  const forwardReport = value.observations.forwardFix;
  const forwardTimes = validateForwardReport(forwardReport, {
    featureSha256: featureSha,
    planSha256: planSha,
    featureChecks,
  });
  if (forwardTimes.startedAt < Date.parse(worker.completedAt)
      || capturedAt !== forwardTimes.completedAt) {
    blocked("REHEARSAL_PROVENANCE_FORWARD_INVALID");
  }
  const expectedForward = {
    receiptVersion: 1,
    kind: "successor-forward-fix-rollback-rehearsal-v1",
    release: manifest.release,
    projectRef: stagingProjectRef,
    productionProjectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    strategy: context.rollback.strategy,
    migrationRollback: context.rollback.migrationRollback,
    featureOffReceiptFileName: context.rollback.featureOffReceiptFileName,
    featureOffReceiptSha256: featureSha,
    rehearsalRunId: forwardReport.rehearsalRunId,
    rehearsalMode: "isolated-staging-forward-fix-rehearsal",
    rehearsalPlanSha256: planSha,
    outcome: "passed",
    checks: deriveForwardChecks({
      report: forwardReport,
      worker,
      featureChecks,
      featureSha256: featureSha,
      planSha256: planSha,
    }),
    startedAt: forwardReport.startedAt,
    completedAt: forwardReport.completedAt,
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  if (!exactJsonValue(forwardFixValue, expectedForward)) {
    blocked("REHEARSAL_PROVENANCE_FORWARD_INVALID");
  }
  if (!exactKeys(value.artifacts, [
    "canaryFenceReceiptSha256", "finalizerDryRehearsalSha256",
    "finalizerFeatureOffReceiptSha256", "forwardFixReceiptSha256",
    "ownerLeaseReceiptSha256", "stagingFeatureOffReceiptSha256",
    "templateContractReceiptSha256",
  ])
      || value.artifacts.stagingFeatureOffReceiptSha256 !== featureSha
      || value.artifacts.forwardFixReceiptSha256 !== sha256(forwardFixBytes)
      || Object.values(value.artifacts).some((digest) => !SHA256.test(digest ?? ""))) {
    blocked("REHEARSAL_PROVENANCE_ARTIFACT_INVALID");
  }
  if (!exactKeys(value.consumerValidation, [
    "finalizerRawEvidenceSha256", "finalizerReceiptSha256",
  ])
      || Object.values(value.consumerValidation).some(
        (digest) => !SHA256.test(digest ?? ""),
      )) {
    blocked("REHEARSAL_PROVENANCE_INVALID");
  }
  if (!exactKeys(value.scope, [
    "databaseScope", "doesNotProve", "environment", "migrationRollbackCommandCount",
    "networkScope", "productionMutationCommandCount", "proves",
  ])
      || value.scope.environment !== "isolated-non-production-rehearsal"
      || value.scope.networkScope !== "loopback-only"
      || value.scope.databaseScope !== "ephemeral-pglite"
      || value.scope.productionMutationCommandCount !== 0
      || value.scope.migrationRollbackCommandCount !== 0
      || !Array.isArray(value.scope.proves) || value.scope.proves.length < 1
      || !Array.isArray(value.scope.doesNotProve)
      || !value.scope.doesNotProve.includes("Production database mutation or migration rollback")) {
    blocked("REHEARSAL_PROVENANCE_SCOPE_INVALID");
  }
  await Promise.all([
    validateCommandProvenance({
      command: value.commands.isolated,
      request: isolatedRequest,
      response: worker,
      mode: "isolated",
      repoRoot,
      observationWindowSeconds: 300,
    }),
    validateCommandProvenance({
      command: value.commands.forwardFix,
      request: forwardRequest,
      response: forwardReport,
      mode: "forward-fix",
      repoRoot,
      observationWindowSeconds: 300,
    }),
  ]);
  return Object.freeze({
    sha256: sha256(provenanceBytes),
    isolatedStdoutSha256: value.commands.isolated.stdoutSha256,
    forwardFixStdoutSha256: value.commands.forwardFix.stdoutSha256,
    productionMutationCommandCount: 0,
    migrationRollbackCommandCount: 0,
  });
}

function extractBackupBinding(input, { manifest, expectedCommit }) {
  const value = input.value;
  const upper = typeof value.BackupSetId === "string";
  const binding = upper ? {
    backupSetId: value.BackupSetId,
    backupManifestSha256: value.ManifestSha256,
    liveSchemaContractSha256: value.LiveSchemaContractSha256,
    logicalDataContractSha256: value.LogicalDataContractSha256,
    release: value.Release ?? manifest.release,
    projectRef: value.ProjectRef ?? manifest.projectRef,
    releaseCommit: value.GitCommit,
    containsSecrets: value.ContainsSecrets ?? false,
  } : {
    backupSetId: value.backupSetId,
    backupManifestSha256: value.backupManifestSha256,
    liveSchemaContractSha256: value.liveSchemaContractSha256,
    logicalDataContractSha256: value.logicalDataContractSha256,
    release: value.release,
    projectRef: value.projectRef,
    releaseCommit: value.releaseCommit,
    containsSecrets: value.containsSecrets,
  };
  const normalizeDigest = (digest) => (
    typeof digest === "string" && /^(?:[a-f0-9]{64}|[A-F0-9]{64})$/.test(digest)
      ? digest.toLowerCase()
      : ""
  );
  binding.backupManifestSha256 = normalizeDigest(binding.backupManifestSha256);
  binding.liveSchemaContractSha256 = normalizeDigest(binding.liveSchemaContractSha256);
  binding.logicalDataContractSha256 = normalizeDigest(binding.logicalDataContractSha256);
  if (!CANONICAL_UUID.test(binding.backupSetId ?? "")
      || !SHA256.test(binding.backupManifestSha256)
      || !SHA256.test(binding.liveSchemaContractSha256)
      || !SHA256.test(binding.logicalDataContractSha256)
      || binding.release !== manifest.release
      || binding.projectRef !== manifest.projectRef
      || binding.releaseCommit !== expectedCommit
      || binding.containsSecrets !== false) {
    blocked("REHEARSAL_POST_EXPAND_BACKUP_INVALID");
  }
  return binding;
}

function executionSucceeded(execution, kind) {
  if (!execution || execution.exitCode !== 0 || execution.signal !== null
      || execution.timedOut !== false || execution.outputTruncated !== false
      || typeof execution.stdout !== "string" || execution.stdout.length < 2
      || Buffer.byteLength(execution.stdout, "utf8") > MAX_WORKER_OUTPUT_BYTES
      || execution.stderr !== ""
      || !SHA256.test(execution.executableSha256 ?? "")
      || !SHA256.test(execution.scriptSha256 ?? "")
      || !SHA256.test(execution.librarySha256 ?? "")) {
    blocked(kind);
  }
  let report;
  try {
    report = JSON.parse(execution.stdout);
  } catch {
    blocked(kind);
  }
  if (execution.stdout !== `${JSON.stringify(report)}\n`) blocked(kind);
  return report;
}

async function spawnBounded(command, args, options) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;
    let timer;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePromise(value);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout + chunk, "utf8") <= MAX_WORKER_OUTPUT_BYTES) {
        stdout += chunk;
      } else outputTruncated = true;
    });
    child.stderr.on("data", (chunk) => {
      if (Buffer.byteLength(stderr + chunk, "utf8") <= MAX_WORKER_OUTPUT_BYTES) {
        stderr += chunk;
      } else outputTruncated = true;
    });
    child.on("error", () => finish({
      exitCode: null, signal: null, stdout, stderr, outputTruncated, timedOut,
    }));
    child.on("close", (exitCode, signal) => finish({
      exitCode, signal, stdout, stderr, outputTruncated, timedOut,
    }));
    child.stdin.end(options.stdin);
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMs);
  });
}

async function executableSha256() {
  return sha256(await readBoundedRegularFile(
    process.execPath,
    256 * 1024 * 1024,
    "REHEARSAL_NODE_BINARY_INVALID",
  ));
}

export async function runSuccessorRehearsalWorkerCommand({
  repoRoot,
  mode,
  input,
  controls = {},
  observationWindowSeconds = 300,
}) {
  const scriptPath = resolve(repoRoot, "scripts/vendor-disclosure-successor-rehearsal-producer.mjs");
  const libraryPath = resolve(repoRoot, "scripts/lib/vendor-disclosure-successor-rehearsal-producer.mjs");
  const [scriptBytes, libraryBytes, nodeSha256] = await Promise.all([
    readBoundedRegularFile(scriptPath, MAX_INPUT_BYTES, "REHEARSAL_WORKER_SCRIPT_INVALID"),
    readBoundedRegularFile(libraryPath, MAX_INPUT_BYTES, "REHEARSAL_WORKER_SCRIPT_INVALID"),
    executableSha256(),
  ]);
  const stdin = jsonText({ ...input, observationWindowSeconds });
  const startedAt = new Date().toISOString();
  const result = await spawnBounded(process.execPath, [
    scriptPath,
    `--internal-worker=${mode}`,
  ], {
    cwd: repoRoot,
    env: { ...process.env, ...controls },
    stdin,
    timeoutMs: mode === "isolated" ? (observationWindowSeconds + 90) * 1_000 : 30_000,
  });
  return Object.freeze({
    ...result,
    startedAt,
    completedAt: new Date().toISOString(),
    executableSha256: nodeSha256,
    scriptSha256: sha256(scriptBytes),
    librarySha256: sha256(libraryBytes),
    stdinSha256: sha256(stdin),
    command: `node:${mode}`,
  });
}

async function defaultHostedConsumerValidator({
  repoRoot,
  receiptRoot,
  expectedCommit,
  remoteRef,
  probeReceiptPath,
  postcheckReceiptPath,
  stagingFeatureOffText,
  forwardFixText,
  provenanceText,
  rollbackFileName,
  now,
}) {
  const { emitVendorDisclosureSuccessorHostedStagingEvidence } = await import(
    "./vendor-disclosure-successor-hosted-staging-evidence.mjs"
  );
  const temporaryRoot = await mkdtemp(join(receiptRoot, ".hosted-consumer-"));
  const inputRoot = join(temporaryRoot, "inputs");
  const outputRoot = join(temporaryRoot, "outputs");
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([
    mkdir(inputRoot), mkdir(outputRoot),
  ]));
  const featurePath = join(inputRoot, rollbackFileName);
  const forwardPath = join(inputRoot, "forward-fix-rehearsal.json");
  const provenancePath = join(inputRoot, "successor-rehearsal-provenance.json");
  try {
    await writeDurableExclusiveReceiptSet({ files: [
      { path: featurePath, text: stagingFeatureOffText },
      { path: forwardPath, text: forwardFixText },
      { path: provenancePath, text: provenanceText },
    ] });
    const result = await emitVendorDisclosureSuccessorHostedStagingEvidence({
      repoRoot,
      receiptRoot: outputRoot,
      expectedCommit,
      remoteRef,
      probeReceiptPath,
      postcheckReceiptPath,
      featureOffReceiptPath: featurePath,
      rollbackRehearsalReceiptPath: forwardPath,
      rehearsalProvenancePath: provenancePath,
      now,
    });
    return {
      rawEvidenceSha256: result.rawEvidenceSha256,
      receiptSha256: result.receiptSha256,
    };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function receiptFiles(receiptRoot, release) {
  return Object.fromEntries(Object.entries(OUTPUT_SUFFIX).map(
    ([name, suffix]) => [name, join(receiptRoot, `${release}-${suffix}`)],
  ));
}

export async function produceSuccessorRehearsalReceipts({
  repoRoot,
  receiptRoot,
  expectedCommit,
  remoteRef,
  probeReceiptPath,
  postcheckReceiptPath,
  postExpandBackupReceiptPath,
  now = () => new Date(),
  observationWindowSeconds = 300,
  releaseLoader = validateSuccessorReleaseContract,
  inspectGitCandidate,
  runWorker = runSuccessorRehearsalWorkerCommand,
  runReadOnlyPostcheck = runReadOnlyStagingPostcheckObservation,
  validateHostedConsumer = defaultHostedConsumerValidator,
  durableWriter = writeDurableExclusiveReceiptSet,
  environment = process.env,
  fetchImpl = globalThis.fetch,
}) {
  const root = resolve(repoRoot ?? "");
  if (!COMMIT.test(expectedCommit ?? "") || !REMOTE_REF.test(remoteRef ?? "")
      || remoteRef.includes("..") || remoteRef.includes("//")
      || !Number.isSafeInteger(observationWindowSeconds)
      || observationWindowSeconds !== 300
      || typeof releaseLoader !== "function" || typeof inspectGitCandidate !== "function"
      || typeof runWorker !== "function" || typeof validateHostedConsumer !== "function"
      || typeof runReadOnlyPostcheck !== "function"
      || typeof durableWriter !== "function"
      || ![probeReceiptPath, postcheckReceiptPath, postExpandBackupReceiptPath].every(
        (path) => typeof path === "string" && isAbsolute(path),
      )) {
    blocked("REHEARSAL_ARGUMENT_INVALID");
  }
  const captured = now();
  const nowMs = captured instanceof Date ? captured.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) blocked("REHEARSAL_CLOCK_INVALID");
  const context = validateReadyRelease(await releaseLoader({ repoRoot: root }));
  const staging = await approvedStagingProjectRef(root, context.manifest);
  const outputRoot = await outputRootOutsideGit(root, receiptRoot);
  const outputs = receiptFiles(outputRoot, context.manifest.release);
  if ((await Promise.all(Object.values(outputs).map(
    (path) => lstat(path).catch(() => null),
  ))).some(Boolean)) blocked("REHEARSAL_OUTPUT_COLLISION");

  const [gitState, probe, postcheck, backupInput, templateBytes] =
    await Promise.all([
      inspectGitCandidate({ repoRoot: root, expectedCommit, remoteRef }),
      readOutsideJson(probeReceiptPath, root, "REHEARSAL_PROBE_INVALID"),
      readOutsideJson(postcheckReceiptPath, root, "REHEARSAL_POSTCHECK_INVALID"),
      readOutsideJson(
        postExpandBackupReceiptPath,
        root,
        "REHEARSAL_POST_EXPAND_BACKUP_INVALID",
      ),
      readPinnedFile(
        root,
        context.finalization.operation.file,
        "REHEARSAL_FINALIZER_TEMPLATE_INVALID",
        MAX_RECEIPT_BYTES,
      ),
    ]);
  if (gitState?.actualCommit !== expectedCommit || gitState?.upstreamCommit !== expectedCommit
      || gitState?.remoteCommit !== expectedCommit || gitState?.worktreeClean !== true) {
    blocked("REHEARSAL_RELEASE_COMMIT_NOT_PUSHED");
  }
  validateProbeIdentity(probe, {
    manifest: context.manifest, expectedCommit, stagingRef: staging.projectRef,
  });
  const postcheckContract = validatePostcheck(postcheck, {
    manifest: context.manifest,
    controllerManifest: context.controllerManifest,
    expectedCommit,
    stagingRef: staging.projectRef,
  });
  const postcheckSqlText = await validatePostcheckSql(root, postcheckContract);
  const stagingPostcheck = await runReadOnlyPostcheck({
    stagingProjectRef: staging.projectRef,
    productionProjectRef: context.manifest.projectRef,
    sqlText: postcheckSqlText,
    sqlSha256: postcheckContract.sha256,
    expectedRow: postcheck.value.row,
    environment,
    fetchImpl,
    now,
  });
  await validateStagingPostcheckProvenance({
    value: stagingPostcheck,
    repoRoot: root,
    postcheckValue: postcheck.value,
    manifest: context.manifest,
    controllerManifest: context.controllerManifest,
    stagingProjectRef: staging.projectRef,
  });
  const backup = extractBackupBinding(backupInput, {
    manifest: context.manifest, expectedCommit,
  });
  const recoveryAssuranceContractSha256 = canonicalJsonSha256(
    context.manifest.deploymentEvidence.recoveryAssurance,
  );
  const recoveryAssurancePlaceholderSha256 =
    renderOnlyRecoveryAssurancePlaceholderSha256(
      context.manifest,
      expectedCommit,
    );

  const isolatedWorkerInput = {
    release: context.manifest.release,
    productionProjectRef: context.manifest.projectRef,
    stagingProjectRef: staging.projectRef,
    releaseCommit: expectedCommit,
    leasePhase: context.finalization.requiredLeasePhase,
    requiredControlNames: Object.keys(context.rollback.requiredControls).sort(),
  };
  const isolatedExecution = await runWorker({
    repoRoot: root,
    mode: "isolated",
    controls: context.rollback.requiredControls,
    observationWindowSeconds,
    input: isolatedWorkerInput,
  });
  const worker = executionSucceeded(
    isolatedExecution,
    "REHEARSAL_ISOLATED_COMMAND_FAILED",
  );
  validateWorkerReport(worker, {
    ...context, expectedCommit, observationWindowSeconds,
  });
  await validateRepositoryTestProvenance(worker, root);
  const featureChecks = deriveFeatureChecks(postcheck.value.row, worker);
  if (!exactKeys(featureChecks, context.rollback.requiredChecks)) {
    blocked("REHEARSAL_FEATURE_CHECK_CONTRACT_DRIFT");
  }
  const verifiedAt = worker.completedAt;
  const featureBase = {
    receiptVersion: 1,
    kind: "successor-feature-off-rollback-rehearsal-v1",
    release: context.manifest.release,
    releaseCommit: expectedCommit,
    receiptFileName: context.rollback.featureOffReceiptFileName,
    strategy: context.rollback.strategy,
    migrationRollback: context.rollback.migrationRollback,
    receiptMaximumAgeMinutes: context.rollback.maximumAgeMinutes,
    requiredControls: { ...context.rollback.requiredControls },
    observedControls: { ...worker.facts.featureOff.observedControls },
    checks: featureChecks,
    environment: "isolated-non-production-rehearsal",
    source: "feature-off-rollback-rehearsal",
    verifiedAt,
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  const stagingFeatureOff = {
    ...featureBase,
    projectRef: staging.projectRef,
  };
  const finalizerFeatureOff = {
    ...featureBase,
    projectRef: context.manifest.projectRef,
  };
  const stagingFeatureOffText = jsonText(stagingFeatureOff);
  const stagingFeatureSha256 = sha256(stagingFeatureOffText);
  const plan = forwardFixPlan(context.rollback);
  const planSha256 = canonicalJsonSha256(plan);
  const forwardWorkerInput = {
    featureReceiptText: stagingFeatureOffText,
    plan,
    expectedFeatureSha256: stagingFeatureSha256,
    expectedPlanSha256: planSha256,
    expectedControls: context.rollback.requiredControls,
    expectedChecks: context.rollback.requiredChecks,
  };
  const forwardExecution = await runWorker({
    repoRoot: root,
    mode: "forward-fix",
    controls: {},
    observationWindowSeconds,
    input: forwardWorkerInput,
  });
  const forwardReport = executionSucceeded(
    forwardExecution,
    "REHEARSAL_FORWARD_COMMAND_FAILED",
  );
  const forwardTimes = validateForwardReport(forwardReport, {
    featureSha256: stagingFeatureSha256,
    planSha256,
    featureChecks,
  });
  if (forwardTimes.startedAt < Date.parse(verifiedAt)) {
    blocked("REHEARSAL_FORWARD_REPORT_INVALID");
  }
  const forwardFix = {
    receiptVersion: 1,
    kind: "successor-forward-fix-rollback-rehearsal-v1",
    release: context.manifest.release,
    projectRef: staging.projectRef,
    productionProjectRef: context.manifest.projectRef,
    releaseCommit: expectedCommit,
    strategy: context.rollback.strategy,
    migrationRollback: context.rollback.migrationRollback,
    featureOffReceiptFileName: context.rollback.featureOffReceiptFileName,
    featureOffReceiptSha256: stagingFeatureSha256,
    rehearsalRunId: forwardReport.rehearsalRunId,
    rehearsalMode: "isolated-staging-forward-fix-rehearsal",
    rehearsalPlanSha256: planSha256,
    outcome: "passed",
    checks: deriveForwardChecks({
      report: forwardReport,
      worker,
      featureChecks,
      featureSha256: stagingFeatureSha256,
      planSha256,
    }),
    startedAt: forwardReport.startedAt,
    completedAt: forwardReport.completedAt,
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  const forwardFixText = jsonText(forwardFix);

  const ownerLease = {
    receiptVersion: 1,
    kind: "successor-exact-owner-lease-rehearsal-v1",
    release: context.manifest.release,
    projectRef: context.manifest.projectRef,
    releaseCommit: expectedCommit,
    databaseSystemIdentifier: worker.facts.database.systemIdentifier,
    leaseOwnerId: worker.facts.database.leaseOwnerId,
    leasePhase: worker.facts.database.leasePhase,
    leaseCount: worker.facts.database.leaseRowCount,
    environment: "isolated-non-production-rehearsal",
    source: "read-only-postgres-observation",
    transactionReadOnly:
      worker.facts.database.ownerObservationTransactionMode === "read-only",
    productionMutationAttempted: false,
    observedAt: verifiedAt,
    containsSecrets: false,
  };
  const canaryChecks = deriveCanaryChecks(
    context.finalization.requiredCanaryChecks,
    worker,
    expectedCommit,
  );
  const canaryFence = {
    receiptVersion: 1,
    kind: "successor-write-fenced-canary-rehearsal-v1",
    release: context.manifest.release,
    projectRef: context.manifest.projectRef,
    releaseCommit: expectedCommit,
    deploymentId: worker.deploymentId,
    environment: "isolated-non-production-rehearsal",
    source: "bounded-canary-rehearsal",
    observationWindowSeconds,
    checks: canaryChecks,
    verifiedAt,
    expiresAt: new Date(
      Date.parse(verifiedAt) + context.finalization.canaryMaximumAgeMinutes * 60_000,
    ).toISOString(),
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  const ownerLeaseText = jsonText(ownerLease);
  const canaryFenceText = jsonText(canaryFence);
  const finalizerFeatureOffText = jsonText(finalizerFeatureOff);
  const inputDigests = {
    ownerLeaseReceiptSha256: sha256(ownerLeaseText),
    canaryFenceReceiptSha256: sha256(canaryFenceText),
    featureOffReceiptSha256: sha256(finalizerFeatureOffText),
  };

  const renderEvidence = {
    projectRef: context.manifest.projectRef,
    databaseSystemIdentifier: ownerLease.databaseSystemIdentifier,
    release: context.manifest.release,
    releaseCommit: expectedCommit,
    leaseOwnerId: ownerLease.leaseOwnerId,
    outcomePathSha256: sha256(resolve(outputs.provenance)),
    outcomeReceiptSha256: sha256(forwardExecution.stdout),
    deploymentId: canaryFence.deploymentId,
    deploymentUrlSha256: worker.facts.canary.loopbackOriginSha256,
    deploymentReceiptSha256: sha256(isolatedExecution.stdout),
    canaryReceiptSha256: inputDigests.canaryFenceReceiptSha256,
    canaryVerifiedAt: canaryFence.verifiedAt,
    canaryExpiresAt: canaryFence.expiresAt,
    postExpandBackupReceiptSha256: backupInput.sha256,
    postExpandBackupReverificationSha256: sha256(isolatedExecution.stdout),
    recoveryAssuranceReceiptSha256:
      recoveryAssurancePlaceholderSha256,
    postExpandBackupSetId: backup.backupSetId,
    postExpandBackupManifestSha256: backup.backupManifestSha256,
    postExpandTableContractSha256:
      context.postExpand.expectedTableContractSha256,
    postExpandMigrationContractSha256:
      context.postExpand.expectedReleaseMigrationContractSha256,
    postExpandLiveSchemaContractSha256: backup.liveSchemaContractSha256,
    postExpandLogicalDataContractSha256: backup.logicalDataContractSha256,
  };
  const templateContract = {
    receiptVersion: 1,
    kind: "successor-finalizer-template-contract-rehearsal-v1",
    release: context.manifest.release,
    projectRef: context.manifest.projectRef,
    releaseCommit: expectedCommit,
    finalizationContractVersion: context.finalization.version,
    operationId: context.finalization.operation.id,
    operationFile: context.finalization.operation.file,
    operationSha256: context.finalization.operation.sha256,
    successorTableContractSha256:
      context.postExpand.expectedTableContractSha256,
    successorMigrationContractSha256:
      context.postExpand.expectedReleaseMigrationContractSha256,
    renderEvidence,
    verifiedAt,
    productionMutationAttempted: false,
    containsSecrets: false,
  };
  const templateContractText = jsonText(templateContract);
  inputDigests.templateContractReceiptSha256 = sha256(templateContractText);
  const templateText = templateBytes.toString("utf8");
  const finalizerDry = buildSuccessorFinalizerRenderOnlyRehearsal({
    manifest: context.manifest,
    controllerManifest: context.controllerManifest,
    expectedCommit,
    templateText,
    ownerLeaseReceipt: ownerLease,
    templateContractReceipt: templateContract,
    canaryFenceReceipt: canaryFence,
    featureOffReceipt: finalizerFeatureOff,
    inputDigests,
    now: () => new Date(verifiedAt),
  });
  const finalizerDryText = jsonText(finalizerDry);
  const finalizerEvidence = buildSuccessorFinalizerEvidence({
    manifest: context.manifest,
    controllerManifest: context.controllerManifest,
    expectedCommit,
    templateText,
    ownerLeaseReceipt: ownerLease,
    templateContractReceipt: templateContract,
    canaryFenceReceipt: canaryFence,
    featureOffReceipt: finalizerFeatureOff,
    finalizerDryRehearsal: finalizerDry,
    inputDigests: {
      ...inputDigests,
      finalizerDryRehearsalSha256: sha256(finalizerDryText),
    },
    gitState,
    now: () => new Date(verifiedAt),
  });
  const provenance = {
    provenanceVersion: 1,
    kind: "successor-rehearsal-receipt-producer-provenance-v1",
    release: context.manifest.release,
    productionProjectRef: context.manifest.projectRef,
    stagingProjectRef: staging.projectRef,
    releaseCommit: expectedCommit,
    capturedAt: forwardReport.completedAt,
    git: {
      actualCommit: gitState.actualCommit,
      upstreamCommit: gitState.upstreamCommit,
      remoteCommit: gitState.remoteCommit,
      remoteRef,
      worktreeClean: gitState.worktreeClean,
    },
    commands: {
      isolated: {
        command: isolatedExecution.command,
        executableSha256: isolatedExecution.executableSha256,
        scriptSha256: isolatedExecution.scriptSha256,
        librarySha256: isolatedExecution.librarySha256,
        stdinSha256: isolatedExecution.stdinSha256,
        exitCode: isolatedExecution.exitCode,
        stdoutSha256: sha256(isolatedExecution.stdout),
        stderrSha256: sha256(isolatedExecution.stderr),
        startedAt: isolatedExecution.startedAt,
        completedAt: isolatedExecution.completedAt,
      },
      forwardFix: {
        command: forwardExecution.command,
        executableSha256: forwardExecution.executableSha256,
        scriptSha256: forwardExecution.scriptSha256,
        librarySha256: forwardExecution.librarySha256,
        stdinSha256: forwardExecution.stdinSha256,
        exitCode: forwardExecution.exitCode,
        stdoutSha256: sha256(forwardExecution.stdout),
        stderrSha256: sha256(forwardExecution.stderr),
        startedAt: forwardExecution.startedAt,
        completedAt: forwardExecution.completedAt,
      },
    },
    requests: {
      isolated: isolatedWorkerInput,
      forwardFix: forwardWorkerInput,
    },
    inputs: {
      approvedStagingContractSha256: staging.sha256,
      probeReceiptSha256: probe.sha256,
      postcheckReceiptSha256: postcheck.sha256,
      postExpandBackupReceiptSha256: backupInput.sha256,
      recoveryAssuranceContractSha256,
      renderOnlyRecoveryAssurancePlaceholderSha256:
        recoveryAssurancePlaceholderSha256,
      finalizerTemplateSha256: canonicalTextSha256(templateText),
    },
    observations: {
      isolated: worker,
      forwardFix: forwardReport,
    },
    stagingPostcheck,
    artifacts: {
      stagingFeatureOffReceiptSha256: sha256(stagingFeatureOffText),
      forwardFixReceiptSha256: sha256(forwardFixText),
      ownerLeaseReceiptSha256: sha256(ownerLeaseText),
      templateContractReceiptSha256: sha256(templateContractText),
      canaryFenceReceiptSha256: sha256(canaryFenceText),
      finalizerFeatureOffReceiptSha256: sha256(finalizerFeatureOffText),
      finalizerDryRehearsalSha256: sha256(finalizerDryText),
    },
    consumerValidation: {
      finalizerRawEvidenceSha256: sha256(finalizerEvidence.rawText),
      finalizerReceiptSha256: sha256(jsonText(finalizerEvidence.receipt)),
    },
    scope: {
      environment: "isolated-non-production-rehearsal",
      networkScope: "loopback-only",
      databaseScope: "ephemeral-pglite",
      productionMutationCommandCount: 0,
      migrationRollbackCommandCount: 0,
      proves: [
        "current hosted-staging receipt schemas accept the staged feature-off and forward-fix receipts",
        "current finalizer receipt schemas accept exact-owner, canary, template, feature-off and render-only receipts",
        "the isolated worker held configured feature flags and write fences for the required 300-second window",
      ],
      doesNotProve: [
        "an issued recovery-assurance receipt or a hosted restore rehearsal",
        "Production finalizer SQL execution",
        "Production database mutation or migration rollback",
        "Production Vercel canary behavior",
        "Production feature-off control values",
      ],
    },
    containsSecrets: false,
  };
  if (containsSecretMaterial(provenance)) blocked("REHEARSAL_SECRET_MATERIAL_REJECTED");

  const provenanceText = jsonText(provenance);
  const hostedConsumer = await validateHostedConsumer({
    repoRoot: root,
    receiptRoot: outputRoot,
    expectedCommit,
    remoteRef,
    probeReceiptPath: probe.path,
    postcheckReceiptPath: postcheck.path,
    stagingFeatureOffText,
    forwardFixText,
    provenanceText,
    rollbackFileName: context.rollback.featureOffReceiptFileName,
    now: () => new Date(forwardReport.completedAt),
  });
  if (!SHA256.test(hostedConsumer?.rawEvidenceSha256 ?? "")
      || !SHA256.test(hostedConsumer?.receiptSha256 ?? "")) {
    blocked("REHEARSAL_HOSTED_CONSUMER_REJECTED");
  }

  const texts = {
    stagingFeatureOff: stagingFeatureOffText,
    forwardFix: forwardFixText,
    ownerLease: ownerLeaseText,
    templateContract: templateContractText,
    canaryFence: canaryFenceText,
    finalizerFeatureOff: finalizerFeatureOffText,
    finalizerDry: finalizerDryText,
    provenance: provenanceText,
  };
  if (Object.entries(texts).some(([name, text]) => (
    Buffer.byteLength(text, "utf8") > (name === "provenance"
      ? MAX_INPUT_BYTES
      : MAX_RECEIPT_BYTES)
  ))) blocked("REHEARSAL_OUTPUT_SET_INVALID");
  const [outputCanonicalBeforeWrite, outputMetadataBeforeWrite] = await Promise.all([
    realpath(receiptRoot).catch(() => null),
    lstat(receiptRoot).catch(() => null),
  ]);
  if (outputCanonicalBeforeWrite !== outputRoot
      || !outputMetadataBeforeWrite?.isDirectory()
      || outputMetadataBeforeWrite.isSymbolicLink()) {
    blocked("REHEARSAL_OUTPUT_ROOT_INVALID");
  }
  await durableWriter({
    files: Object.keys(OUTPUT_SUFFIX).map((name) => ({
      path: outputs[name], text: texts[name],
    })),
  });
  return Object.freeze({
    status: "successor_rehearsal_receipts_emitted",
    release: context.manifest.release,
    releaseCommit: expectedCommit,
    paths: Object.freeze({ ...outputs }),
    sha256: Object.freeze(Object.fromEntries(
      Object.entries(texts).map(([name, text]) => [name, sha256(text)]),
    )),
    containsSecrets: false,
  });
}

function sqlstate(error) {
  return typeof error?.code === "string" ? error.code : "";
}

async function closeServer(server) {
  await new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function listenLoopback(server) {
  return new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectPromise);
      resolvePromise(server.address());
    });
  });
}

function respond(response, status, body = "", headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

export async function runLocalIsolatedRehearsalWorker({
  repoRoot,
  input,
  environment = process.env,
  now = () => new Date(),
  sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  browserExecutable,
}) {
  const requiredNames = input?.requiredControlNames;
  if (!Array.isArray(requiredNames) || requiredNames.length < 1
      || requiredNames.some((name) => !/^[A-Z][A-Z0-9_]{2,100}$/.test(name))
      || new Set(requiredNames).size !== requiredNames.length
      || !Number.isSafeInteger(input?.observationWindowSeconds)
      || input.observationWindowSeconds < 0
      || !COMMIT.test(input?.releaseCommit ?? "")) {
    blocked("REHEARSAL_WORKER_INPUT_INVALID");
  }
  const startedAt = now();
  const startedAtMs = startedAt instanceof Date ? startedAt.getTime() : Number.NaN;
  if (!Number.isFinite(startedAtMs)) blocked("REHEARSAL_WORKER_CLOCK_INVALID");
  const pgliteUrl = pathToFileURL(resolve(
    repoRoot,
    "apps/web/node_modules/@electric-sql/pglite/dist/index.js",
  )).href;
  const [{ PGlite }, { chromium }] = await Promise.all([
    import(pgliteUrl),
    import("playwright-core"),
  ]);
  const repositoryTestPath = resolve(
    repoRoot,
    "apps/web/src/lib/price/productionBuildFence.test.ts",
  );
  const vitestRunnerPath = resolve(
    repoRoot,
    "apps/web/node_modules/vitest/vitest.mjs",
  );
  const [repositoryTestBytes, vitestRunnerBytes] = await Promise.all([
    readBoundedRegularFile(
      repositoryTestPath,
      MAX_INPUT_BYTES,
      "REHEARSAL_REPOSITORY_TEST_INVALID",
    ),
    readBoundedRegularFile(
      vitestRunnerPath,
      MAX_RECEIPT_BYTES,
      "REHEARSAL_REPOSITORY_TEST_INVALID",
    ),
  ]);
  const repositoryTestStarted = Date.now();
  const repositoryTestExecution = await spawnBounded(
    process.execPath,
    [
      vitestRunnerPath,
      "run",
      "src/lib/price/productionBuildFence.test.ts",
      "--reporter=dot",
      "--testNamePattern=allows a controller-ready fixture when the owner signs the exact release manifest",
    ],
    {
      cwd: resolve(repoRoot, "apps/web"),
      env: environment,
      stdin: "",
      timeoutMs: 60_000,
    },
  );
  const repositoryTestDurationMs = Date.now() - repositoryTestStarted;
  if (repositoryTestExecution.exitCode !== 0
      || repositoryTestExecution.signal !== null
      || repositoryTestExecution.timedOut !== false
      || repositoryTestExecution.outputTruncated !== false
      || containsSecretMaterial({
        stdout: repositoryTestExecution.stdout,
        stderr: repositoryTestExecution.stderr,
      })) {
    blocked("REHEARSAL_REPOSITORY_TEST_FAILED");
  }
  const repositoryTest = {
    command: "node:vitest:production-build-fence",
    exitCode: repositoryTestExecution.exitCode,
    stdoutSha256: sha256(repositoryTestExecution.stdout),
    stderrSha256: sha256(repositoryTestExecution.stderr),
    testFileSha256: sha256(repositoryTestBytes),
    runnerSha256: sha256(vitestRunnerBytes),
    durationMs: repositoryTestDurationMs,
  };
  const db = new PGlite();
  let browser;
  let server;
  try {
    await db.waitReady;
    const leaseOwnerId = randomUUID();
    await db.exec("CREATE TABLE rehearsal_lease (phase text PRIMARY KEY, owner_id uuid NOT NULL)");
    await db.query(
      "INSERT INTO rehearsal_lease (phase, owner_id) VALUES ($1, $2)",
      [input.leasePhase, leaseOwnerId],
    );
    let duplicateLeaseSqlstate = "";
    try {
      await db.query(
        "INSERT INTO rehearsal_lease (phase, owner_id) VALUES ($1, $2)",
        [input.leasePhase, randomUUID()],
      );
    } catch (error) {
      duplicateLeaseSqlstate = sqlstate(error);
    }
    await db.exec("BEGIN TRANSACTION READ ONLY");
    let leaseObservation;
    let system;
    try {
      leaseObservation = await db.query(
        "SELECT phase, owner_id::text AS owner_id, count(*)::int AS lease_count FROM rehearsal_lease GROUP BY phase, owner_id",
      );
      system = await db.query(
        "SELECT system_identifier::text AS system_identifier FROM pg_control_system()",
      );
      await db.exec("COMMIT");
    } catch (error) {
      await db.exec("ROLLBACK").catch(() => {});
      throw error;
    }
    let appWriteSqlstate = "";
    await db.exec("BEGIN TRANSACTION READ ONLY");
    try {
      await db.exec("INSERT INTO rehearsal_lease (phase, owner_id) VALUES ('app-write', gen_random_uuid())");
    } catch (error) {
      appWriteSqlstate = sqlstate(error);
    } finally {
      await db.exec("ROLLBACK");
    }
    let storageWriteSqlstate = "";
    await db.exec("BEGIN TRANSACTION READ ONLY");
    try {
      await db.exec("CREATE TABLE storage_write_attempt (id int)");
    } catch (error) {
      storageWriteSqlstate = sqlstate(error);
    } finally {
      await db.exec("ROLLBACK");
    }

    const sessionToken = randomBytes(24).toString("hex");
    const serverErrors = [];
    server = createServer((request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        const headers = { "x-release-commit": input.releaseCommit };
        if (request.method === "GET" && requestUrl.pathname === "/") {
          response.writeHead(200, {
            ...headers,
            "content-type": "text/html; charset=utf-8",
          });
          response.end("<!doctype html><title>successor rehearsal</title><main>ready</main>");
        } else if (request.method === "POST" && requestUrl.pathname === "/login") {
          respond(response, 204, "", {
            ...headers,
            "set-cookie": `rehearsal_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
          });
        } else if (request.method === "POST" && requestUrl.pathname === "/logout") {
          respond(response, 204, "", {
            ...headers,
            "set-cookie": "rehearsal_session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/",
          });
        } else if (request.method === "GET" && requestUrl.pathname === "/private") {
          const authenticated = request.headers.cookie
            ?.split(/;\s*/).includes(`rehearsal_session=${sessionToken}`) === true;
          respond(response, authenticated ? 200 : 401, JSON.stringify({ scope: "private" }), headers);
        } else if (request.method === "POST" && requestUrl.pathname === "/signup") {
          respond(response, 403, JSON.stringify({ error: "signup_disabled" }), headers);
        } else if (request.method === "POST" && requestUrl.pathname === "/storage-upload") {
          respond(response, 403, JSON.stringify({ error: "storage_write_fence_enabled" }), headers);
        } else if (request.method === "POST"
            && (requestUrl.pathname === "/write" || requestUrl.pathname === "/database-write")) {
          respond(response, 503, JSON.stringify({ error: "production_write_fence_enabled" }), {
            ...headers,
            "cache-control": "no-store",
          });
        } else {
          respond(response, 404, JSON.stringify({ error: "not_found" }), headers);
        }
      } catch (error) {
        serverErrors.push(String(error?.name ?? "server-error"));
        respond(response, 500, JSON.stringify({ error: "server_error" }));
      }
    });
    const address = await listenLoopback(server);
    const origin = `http://127.0.0.1:${address.port}`;
    const executablePath = browserExecutable
      ?? (process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : undefined);
    browser = await chromium.launch({ executablePath, headless: true });
    const browserContext = await browser.newContext();
    const page = await browserContext.newPage();
    let consoleErrorCount = 0;
    let pageErrorCount = 0;
    let requestFailedCount = 0;
    let externalRequestCount = 0;
    const responseStatuses = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrorCount += 1;
    });
    page.on("pageerror", () => { pageErrorCount += 1; });
    page.on("requestfailed", () => { requestFailedCount += 1; });
    page.on("request", (request) => {
      if (!request.url().startsWith(origin)) externalRequestCount += 1;
    });
    page.on("response", (response) => responseStatuses.push({
      url: response.url(), status: response.status(),
    }));
    const latencies = [];
    const timed = async (operation) => {
      const before = Date.now();
      const result = await operation();
      latencies.push(Date.now() - before);
      return result;
    };
    const publicResponse = await timed(() => page.goto(origin, { waitUntil: "domcontentloaded" }));
    const publicReadStatus = publicResponse.status();
    const deployedCommitHeader = publicResponse.headers()["x-release-commit"] ?? "";
    const browserFacts = await page.evaluate(async () => {
      const request = async (path, options) => {
        const response = await fetch(path, options);
        let body = {};
        try { body = await response.json(); } catch {}
        return {
          status: response.status,
          error: typeof body.error === "string" ? body.error : "",
          cacheControl: response.headers.get("cache-control") ?? "",
        };
      };
      const login = await request("/login", { method: "POST" });
      const privateRead = await request("/private");
      const signup = await request("/signup", { method: "POST" });
      const storage = await request("/storage-upload", { method: "POST" });
      const webFence = await request("/write", { method: "POST" });
      const databaseFence = await request("/database-write", { method: "POST" });
      const logout = await request("/logout", { method: "POST" });
      return { login, privateRead, signup, storage, webFence, databaseFence, logout };
    });
    const targetCompletedAtMs = startedAtMs + input.observationWindowSeconds * 1_000;
    while (now().getTime() < targetCompletedAtMs) {
      const remaining = targetCompletedAtMs - now().getTime();
      await sleep(Math.min(30_000, Math.max(1, remaining)));
      if (now().getTime() < targetCompletedAtMs) {
        const response = await timed(() => page.reload({ waitUntil: "domcontentloaded" }));
        if (response.status() !== 200) responseStatuses.push({ url: origin, status: response.status() });
      }
    }
    const completedAt = new Date(Math.max(now().getTime(), targetCompletedAtMs));
    const unexpected5xxCount = responseStatuses.filter(({ url, status }) => (
      status >= 500 && !url.endsWith("/write") && !url.endsWith("/database-write")
    )).length;
    const observedControls = Object.fromEntries(requiredNames.map(
      (name) => [name, String(environment[name] ?? "")],
    ));
    return {
      workerVersion: 1,
      kind: "successor-local-isolated-rehearsal-observation-v1",
      release: input.release,
      releaseCommit: input.releaseCommit,
      deploymentId: `dpl_${randomBytes(18).toString("hex")}`,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      networkScope: "loopback-only",
      databaseScope: "ephemeral-pglite",
      productionMutationCommandCount: 0,
      facts: {
        repositoryTest,
        database: {
          systemIdentifier: system.rows[0].system_identifier,
          leaseOwnerId: leaseObservation.rows[0].owner_id,
          leasePhase: leaseObservation.rows[0].phase,
          leaseRowCount: leaseObservation.rows[0].lease_count,
          ownerObservationTransactionMode: "read-only",
          duplicateLeaseSqlstate,
          appWriteSqlstate,
          storageWriteSqlstate,
        },
        featureOff: { observedControls },
        canary: {
          publicReadStatus,
          authenticatedReadStatus: browserFacts.privateRead.status,
          loginStatus: browserFacts.login.status,
          logoutStatus: browserFacts.logout.status,
          signupStatus: browserFacts.signup.status,
          storageUploadStatus: browserFacts.storage.status,
          webFenceStatus: browserFacts.webFence.status,
          databaseFenceStatus: browserFacts.databaseFence.status,
          deployedCommitHeader,
          webFenceError: browserFacts.webFence.error,
          cacheControl: browserFacts.webFence.cacheControl,
          consoleErrorCount,
          pageErrorCount,
          requestFailedCount,
          unexpected5xxCount,
          serverErrorCount: serverErrors.length,
          maximumLatencyMs: Math.max(...latencies),
          externalRequestCount,
          loopbackOriginSha256: sha256(origin),
        },
      },
      containsSecrets: false,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (server) await closeServer(server).catch(() => {});
    await db.close().catch(() => {});
  }
}

export function runForwardFixRehearsalWorker({ input, now = () => new Date() }) {
  const startedAt = now();
  const featureText = input?.featureReceiptText;
  const plan = input?.plan;
  let feature;
  try {
    feature = JSON.parse(featureText);
  } catch {
    blocked("REHEARSAL_FORWARD_WORKER_INPUT_INVALID");
  }
  const observedControls = feature?.observedControls;
  const checks = feature?.checks;
  const observedControlMismatchCount = Object.entries(input.expectedControls ?? {})
    .filter(([name, expected]) => observedControls?.[name] !== expected).length;
  const falseCheckCount = (input.expectedChecks ?? [])
    .filter((name) => checks?.[name] !== true).length;
  const serializedPlan = canonicalJson(plan);
  const migrationRollbackCommandCount = (
    serializedPlan.match(/\b(?:down|rollback-migration|db\s+reset)\b/gi) ?? []
  ).length;
  const remoteEndpointCount = (serializedPlan.match(/https?:\/\//gi) ?? []).length;
  return {
    workerVersion: 1,
    kind: "successor-forward-fix-local-rehearsal-observation-v1",
    rehearsalRunId: randomUUID(),
    startedAt: startedAt.toISOString(),
    completedAt: now().toISOString(),
    productionMutationCommandCount: 0,
    facts: {
      featureReceiptSha256: sha256(featureText),
      planSha256: canonicalJsonSha256(plan),
      observedControlMismatchCount,
      falseCheckCount,
      migrationRollbackCommandCount,
      remoteEndpointCount,
    },
    containsSecrets: false,
  };
}
