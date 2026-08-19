import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { resolvePinnedWindowsProductionToolchain } from "./production-windows-toolchain.mjs";
import {
  SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS,
  validateSuccessorReleaseContract,
} from "./supabase-successor-release-contract.mjs";
import {
  validateSuccessorRehearsalProducerProvenance,
} from "./vendor-disclosure-successor-rehearsal-producer.mjs";

export const SUCCESSOR_READ_ONLY_POSTCHECK_KIND =
  "successor-read-only-postcheck-result-v1";
export const SUCCESSOR_FEATURE_OFF_VERIFICATION_KIND =
  "successor-feature-off-rollback-rehearsal-v1";
export const SUCCESSOR_FORWARD_FIX_REHEARSAL_KIND =
  "successor-forward-fix-rollback-rehearsal-v1";

const APPROVED_STAGING_CONTRACT_FILE =
  "supabase/release-contracts/vendor-disclosure-hosted-staging-v2-20260718.json";
const APPROVED_RELEASE = "vendor-disclosure-v2-20260718";
const APPROVED_PRODUCTION_REF = "slrtobkksjmxgzatjyqb";
const APPROVED_STAGING_REF = "rgxdizztidbgwnsbadml";
const APPROVED_PUBLIC_VIEW_SHA256 = Object.freeze({
  v_public_vendors: "cf755f85d7081bf4ac510846dc65dccf17939f4f7c822f6abab9fb2ea6f50c9d",
  v_public_prices: "c3558fd930d2ff1037a752b2a97a2d5c61544a7221f978796d594d1240b3e3bc",
  v_public_price_options: "9c3f97742cff0b8584d66e38d002ba16fa9092e17ef1c72b60dd6b07a066d5b7",
  v_public_agency_packages: "65ce43519c109caf64f279332106994fc15947aa9d11a850633157fd15676e22",
});

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_RAW_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_RUNTIME_RECEIPT_BYTES = 64 * 1024;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MIGRATION = /^\d{14}$/;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SAFE_FILE = /^[a-z0-9][a-z0-9_.-]{2,160}\.json$/;
const SAFE_CHECK_ID = /^[a-z][a-z0-9-]{2,63}$/;
const REMOTE_REF = /^origin\/([A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?)$/;
const CANONICAL_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PROBE_SCOPE =
  "neutral-space-message-refs-notes-mediation-criterion-first-use-receipt-binding-and-booking-provenance";

const PROBE_SCENARIOS = Object.freeze({
  neutralPreparationSpace: Object.freeze({
    scenario: "neutral_preparation_space_two_account_v1",
    syntheticUserCount: 2,
    checks: Object.freeze([
      "ownerCreate", "ownerReplay", "preJoinProfileIsolation",
      "preJoinCoupleIsolation", "authenticatedServerJoinDenied", "serverJoin",
      "postJoinMutualProfileRead", "postJoinCoupleRead", "cleanup",
    ]),
    residue: Object.freeze(["profiles", "couples"]),
  }),
  preparationTopicMessageRefs: Object.freeze({
    scenario: "preparation_topic_message_refs_three_account_v1",
    syntheticUserCount: 3,
    checks: Object.freeze([
      "ownerSpace", "partnerJoin", "outsiderSpace", "authenticatedRpcDenied",
      "authenticatedTableDenied", "authenticatedNotesRpcDenied",
      "sharedConcurrentReplay", "privateSave", "ownerList", "partnerListPrivacy",
      "outsiderIsolation", "ownerNotesSearch", "partnerNotesPrivacy",
      "outsiderNotesIsolation", "sharedResolve", "privateResolve",
      "partnerPrivateDenied", "removeAndStaleRevision", "cleanup",
    ]),
    residue: Object.freeze(["profiles", "couples", "chatMessages", "messageRefs"]),
  }),
  mediationPrivateDraft: Object.freeze({
    scenario: "mediation_private_draft_two_account_v1",
    syntheticUserCount: 2,
    checks: Object.freeze([
      "ownerSpace", "partnerJoin", "privateBeforeShare", "directSharedInsertDenied",
      "authenticatedShareDenied", "wrongActorShareDenied", "canonicalShare",
      "exactReplay", "sharedVisibleToCouple", "cleanup",
    ]),
    residue: Object.freeze(["profiles", "couples", "chatMessages", "messageRefs"]),
  }),
  criterionActionContext: Object.freeze({
    scenario: "criterion_action_context_two_account_v1",
    syntheticUserCount: 2,
    providerEvidence: "synthetic_fixture_no_live_provider_call",
    checks: Object.freeze([
      "ownerSpace", "partnerJoin", "firstCriterionConfirmed", "directInjectionDenied",
      "currentContextSealed", "criterionTextNotCopied", "exactReplay",
      "contextImmutable", "changedCriterionConfirmed",
      "staleContextOmittedWithoutUndoingAction", "cleanup",
    ]),
    residue: Object.freeze([
      "profiles", "couples", "journeys", "chatMessages", "chatClaims", "actions",
      "executions", "applicationClaims", "criterionProposals",
      "criterionAcceptances", "decisions", "providerReceipts",
    ]),
  }),
  firstUseDeterministicAction: Object.freeze({
    scenario: "first_use_deterministic_action_two_account_v1",
    syntheticUserCount: 2,
    providerEvidence: "synthetic_private_source_receipt_no_live_provider_call",
    checks: Object.freeze([
      "ownerSpace", "partnerJoin", "privateSourceOwnerVisible",
      "privateSourcePartnerHidden", "authenticatedFinalizerDenied", "promotionCreated",
      "deterministicProposal", "proposalExactReplay", "sharedProposalVisible",
      "bindingProjection", "bindingAuthenticatedDenied", "bindingAnonDenied",
      "bindingServiceTableDenied", "bindingWrongCoupleDenied",
      "bindingWrongRecipientDenied", "bindingStaleEpochDenied",
      "deterministicApplication", "applicationExactReplay", "sharedReceiptVisible",
      "privateContentNotShared", "actionPersisted", "providerBoundary", "cleanup",
    ]),
    residue: Object.freeze([
      "profiles", "couples", "journeys", "chatMessages", "chatClaims", "promotions",
      "proposalBindings", "actions", "executions", "applicationClaims",
      "providerReceipts",
    ]),
  }),
  bookingOutcomeProvenance: Object.freeze({
    scenario: "booking_outcome_provenance_solo_v1",
    syntheticUserCount: 1,
    checks: Object.freeze([
      "ownerSpace", "fixtureCreated", "authenticatedCompletionDenied",
      "outcomeRecorded", "actorBound", "timestampsCanonical", "intentSuperseded",
      "exactReplay", "sharedDecisionVisible", "noAuthorizationResidue", "cleanup",
    ]),
    residue: Object.freeze([
      "profiles", "couples", "journeys", "vendors", "timeslots", "bookings",
      "reviews", "decisions", "intentAuthorizations", "outcomeAuthorizations",
      "projectionJobs",
    ]),
  }),
});

const FORWARD_FIX_CHECKS = Object.freeze([
  "exactFeatureOffReceiptConsumed",
  "migrationRollbackNotAttempted",
  "forwardFixProcedureValidated",
  "writeFencesRetained",
  "productionUntouched",
]);

function forwardFixPlanSha256(rollback) {
  return canonicalJsonSha256({
    version: 1,
    strategy: rollback.strategy,
    migrationRollback: rollback.migrationRollback,
    rehearsalMode: "isolated-staging-forward-fix-rehearsal",
    featureOffReceiptFileName: rollback.featureOffReceiptFileName,
    requiredChecks: FORWARD_FIX_CHECKS,
  });
}

export class SuccessorHostedStagingEvidenceError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "SuccessorHostedStagingEvidenceError";
    this.code = code;
  }
}

function fail(code, message = code) {
  throw new SuccessorHostedStagingEvidenceError(code, message);
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort())
      === JSON.stringify([...expected].sort());
}

function exactArray(value, expected) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function exactRecord(value, expected) {
  return exactKeys(value, Object.keys(expected))
    && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalTextSha256(value) {
  return sha256(value.replace(/\r\n?/g, "\n"));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

function canonicalJsonSha256(value) {
  return sha256(`${canonicalJson(value)}\n`);
}

function textListSha256(values) {
  return sha256(`${values.join("\n")}\n`);
}

function instant(value, code) {
  if (!CANONICAL_INSTANT.test(value ?? "")) fail(code);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail(code);
  return milliseconds;
}

function sameFile(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

async function readBoundedRegularFile(path, maximumBytes, code) {
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile() || before.isSymbolicLink()
      || before.size < 2 || before.size > maximumBytes) {
    fail(code);
  }
  let handle;
  try {
    handle = await open(path, "r");
    const opened = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    if (!opened.isFile() || !linked?.isFile() || linked.isSymbolicLink()
        || !sameFile(before, opened) || !sameFile(opened, linked)) {
      fail(code);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const linkedAfter = await lstat(path).catch(() => null);
    if (!linkedAfter?.isFile() || linkedAfter.isSymbolicLink()
        || !sameFile(opened, after) || !sameFile(after, linkedAfter)
        || bytes.length !== after.size) {
      fail(code);
    }
    return bytes;
  } catch (error) {
    if (error instanceof SuccessorHostedStagingEvidenceError) throw error;
    fail(code);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readBoundedJson(path, code, maximumBytes = MAX_INPUT_BYTES) {
  const bytes = await readBoundedRegularFile(path, maximumBytes, code);
  try {
    return { bytes, value: JSON.parse(bytes.toString("utf8")) };
  } catch {
    fail(code);
  }
}

function containsSecretMaterial(value) {
  let invalid = false;
  const visit = (candidate) => {
    if (invalid || candidate === null || candidate === undefined) return;
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (typeof candidate === "object") {
      for (const [key, nested] of Object.entries(candidate)) {
        if (key !== "containsSecrets"
            && /(?:password|service[_-]?role|api[_-]?key|access[_-]?token|refresh[_-]?token|management[_-]?token|client[_-]?secret)/i.test(key)) {
          invalid = true;
          return;
        }
        visit(nested);
      }
      return;
    }
    if (typeof candidate === "string"
        && /(?:postgres(?:ql)?:\/\/|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}|\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{12,}|SUPABASE_SERVICE_ROLE_KEY)/i.test(candidate)) {
      invalid = true;
    }
  };
  visit(value);
  return invalid;
}

async function assertExternalDirectory(repoRoot, path, code) {
  if (!isAbsolute(path) || inside(repoRoot, path)) fail(code);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) fail(code);
  const [canonicalRepo, canonicalPath] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(path).catch(() => null),
  ]);
  if (!canonicalRepo || !canonicalPath || inside(canonicalRepo, canonicalPath)) fail(code);
  return canonicalPath;
}

async function canonicalExternalFile(repoRoot, path, code) {
  if (!isAbsolute(path) || inside(repoRoot, path)) fail(code);
  const metadata = await lstat(path).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) fail(code);
  const [canonicalRepo, canonicalPath] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(path).catch(() => null),
  ]);
  if (!canonicalRepo || !canonicalPath || inside(canonicalRepo, canonicalPath)) fail(code);
  return canonicalPath;
}

async function createExclusiveDurableFile({ path, text, io, created }) {
  let handle;
  let failure;
  try {
    handle = await io.open(path, "wx", 0o600);
    created.push(path);
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle?.close();
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}

/**
 * Create a raw/structured evidence pair without overwriting either path.
 * POSIX opens the parent before creation and fsyncs it after create or cleanup.
 * Node cannot portably fsync directory handles on Windows, so file fsync plus
 * exclusive creation is the strongest portable contract there.
 */
export async function writeDurableExclusiveEvidencePair({
  rawPath,
  rawText,
  receiptPath,
  receiptText,
  platform = process.platform,
  io = { open, unlink },
}) {
  if (typeof io?.open !== "function" || typeof io?.unlink !== "function"
      || typeof rawText !== "string" || rawText.length < 1
      || typeof receiptText !== "string" || receiptText.length < 1
      || rawPath === receiptPath || dirname(rawPath) !== dirname(receiptPath)) {
    throw new TypeError("invalid durable evidence write contract");
  }
  const created = [];
  let parentHandle;
  let failure;
  let cleanupPerformed = false;
  const recordFailure = (error, message) => {
    failure = failure
      ? new AggregateError([failure, error], message)
      : error;
  };
  const cleanupCreated = async (syncHandle) => {
    if (cleanupPerformed) return;
    cleanupPerformed = true;
    for (const path of [...created].reverse()) {
      try {
        await io.unlink(path);
      } catch (cleanupError) {
        recordFailure(cleanupError, "durable evidence cleanup failed");
      }
    }
    if (syncHandle) {
      try {
        await syncHandle.sync();
      } catch (cleanupSyncError) {
        recordFailure(cleanupSyncError, "durable parent cleanup sync failed");
      }
    }
  };
  try {
    if (platform !== "win32") parentHandle = await io.open(dirname(rawPath), "r");
    await createExclusiveDurableFile({ path: rawPath, text: rawText, io, created });
    await createExclusiveDurableFile({ path: receiptPath, text: receiptText, io, created });
    await parentHandle?.sync();
  } catch (error) {
    failure = error;
    await cleanupCreated(parentHandle);
  }
  try {
    await parentHandle?.close();
  } catch (closeError) {
    recordFailure(closeError, "durable parent close failed");
    if (!cleanupPerformed) {
      await cleanupCreated(null);
      if (platform !== "win32") {
        let cleanupParent;
        try {
          cleanupParent = await io.open(dirname(rawPath), "r");
          await cleanupParent.sync();
        } catch (cleanupSyncError) {
          recordFailure(cleanupSyncError, "durable parent cleanup sync failed");
        } finally {
          try {
            await cleanupParent?.close();
          } catch (cleanupCloseError) {
            recordFailure(cleanupCloseError, "durable cleanup parent close failed");
          }
        }
      }
    }
  }
  if (failure) throw failure;
}

async function defaultRunCommand(command, args, { cwd, timeoutMs = 30_000 } = {}) {
  return await new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ ...result, timedOut });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length <= MAX_INPUT_BYTES) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length + chunk.length <= MAX_INPUT_BYTES) stderr += chunk;
    });
    child.on("error", (error) => finish({ status: null, stdout, stderr, error }));
    child.on("close", (status) => finish({ status, stdout, stderr }));
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
  });
}

async function requireCommand(runCommand, command, args, cwd, code) {
  const result = await runCommand(command, args, { cwd });
  if (result?.status !== 0 || result.timedOut === true) fail(code);
  return String(result.stdout ?? "");
}

async function assertExactPushedCommit({
  repoRoot,
  expectedCommit,
  expectedOrigin,
  remoteRef,
  runCommand,
}) {
  let git = "git";
  if (runCommand === defaultRunCommand) {
    try {
      git = (await resolvePinnedWindowsProductionToolchain()).git;
    } catch {
      fail("SUCCESSOR_HOSTED_STAGING_TOOLCHAIN_INVALID");
    }
  }
  const status = await requireCommand(
    runCommand,
    git,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    repoRoot,
    "SUCCESSOR_HOSTED_STAGING_GIT_STATUS_FAILED",
  );
  if (status.trim()) fail("SUCCESSOR_HOSTED_STAGING_WORKTREE_DIRTY");
  const head = await requireCommand(
    runCommand,
    git,
    ["rev-parse", "HEAD"],
    repoRoot,
    "SUCCESSOR_HOSTED_STAGING_GIT_HEAD_FAILED",
  );
  if (head.trim() !== expectedCommit) fail("SUCCESSOR_HOSTED_STAGING_GIT_HEAD_MISMATCH");
  const origin = await requireCommand(
    runCommand,
    git,
    ["remote", "get-url", "origin"],
    repoRoot,
    "SUCCESSOR_HOSTED_STAGING_GIT_ORIGIN_FAILED",
  );
  if (origin.trim() !== expectedOrigin) fail("SUCCESSOR_HOSTED_STAGING_GIT_ORIGIN_MISMATCH");
  const match = remoteRef.match(REMOTE_REF);
  if (!match || match[1].includes("..") || match[1].includes("//")) {
    fail("SUCCESSOR_HOSTED_STAGING_REMOTE_REF_INVALID");
  }
  const branchRef = `refs/heads/${match[1]}`;
  const remote = await requireCommand(
    runCommand,
    git,
    ["ls-remote", "--exit-code", "origin", branchRef],
    repoRoot,
    "SUCCESSOR_HOSTED_STAGING_REMOTE_REF_FAILED",
  );
  const lines = remote.trim().split(/\r?\n/).filter(Boolean);
  const [remoteCommit, returnedRef] = lines.length === 1
    ? lines[0].trim().split(/\s+/)
    : [];
  if (remoteCommit !== expectedCommit || returnedRef !== branchRef) {
    fail("SUCCESSOR_HOSTED_STAGING_REMOTE_COMMIT_MISMATCH");
  }
}

function validateEvidenceContract(manifest) {
  const value = manifest?.deploymentEvidence?.hostedStaging;
  const expected = SUCCESSOR_RUNTIME_EVIDENCE_REQUIREMENTS.hostedStaging;
  if (!exactKeys(value, [
    "kind", "maximumAgeMinutes", "rawEvidenceFileName", "rawEvidenceSource",
    "receiptFileName", "requiredChecks",
  ])
      || value.kind !== expected.kind
      || value.maximumAgeMinutes !== expected.maximumAgeMinutes
      || value.rawEvidenceSource !== expected.rawEvidenceSource
      || !exactArray(value.requiredChecks, expected.requiredChecks)
      || !SAFE_FILE.test(value.rawEvidenceFileName ?? "")
      || !SAFE_FILE.test(value.receiptFileName ?? "")
      || value.rawEvidenceFileName === value.receiptFileName
      || !value.rawEvidenceFileName.startsWith(`${manifest.release}-`)
      || !value.receiptFileName.startsWith(`${manifest.release}-`)) {
    fail("SUCCESSOR_HOSTED_STAGING_EVIDENCE_CONTRACT_INVALID");
  }
  return value;
}

function validateRollbackContract(value, release) {
  if (!exactKeys(value, [
    "featureOffReceiptFileName", "maximumAgeMinutes", "migrationRollback",
    "requiredChecks", "requiredControls", "strategy", "version",
  ])
      || value.version !== 1
      || value.strategy !== "forward-fix-feature-off"
      || value.migrationRollback !== "prohibited"
      || value.featureOffReceiptFileName !== `${release}-feature-off-rollback.json`
      || value.maximumAgeMinutes !== 30
      || !SAFE_FILE.test(value.featureOffReceiptFileName ?? "")
      || !Array.isArray(value.requiredChecks) || value.requiredChecks.length < 1
      || new Set(value.requiredChecks).size !== value.requiredChecks.length
      || value.requiredChecks.some((name) => !/^[a-z][A-Za-z0-9]{2,63}$/.test(name ?? ""))
      || value.requiredControls === null
      || typeof value.requiredControls !== "object"
      || Array.isArray(value.requiredControls)
      || Object.keys(value.requiredControls).length < 1
      || Object.entries(value.requiredControls).some(
        ([name, setting]) => !/^[A-Z][A-Z0-9_]{2,100}$/.test(name)
          || (setting !== "true" && setting !== "false"),
      )) {
    fail("SUCCESSOR_HOSTED_STAGING_ROLLBACK_CONTRACT_INVALID");
  }
  return value;
}

async function validateReleaseState({ repoRoot, releaseLoader }) {
  let state;
  try {
    state = await releaseLoader({ repoRoot });
  } catch {
    fail("SUCCESSOR_HOSTED_STAGING_RELEASE_CONTRACT_INVALID");
  }
  const { manifest, controllerManifest } = state ?? {};
  const expectedOrigin = controllerManifest?.backupContract?.expectedOrigin;
  if (state?.controllerReady !== true
      || manifest?.status !== "controller_ready"
      || manifest?.release !== controllerManifest?.release
      || manifest?.projectRef !== controllerManifest?.projectRef
      || manifest?.release !== APPROVED_RELEASE
      || manifest?.projectRef !== APPROVED_PRODUCTION_REF
      || !PROJECT_REF.test(manifest?.projectRef ?? "")
      || !MIGRATION.test(manifest?.requiredRemoteHead ?? "")
      || typeof expectedOrigin !== "string" || expectedOrigin.length < 8
      || !Array.isArray(manifest?.expandMigrations) || manifest.expandMigrations.length < 1
      || !Array.isArray(controllerManifest?.preApplyChecks)
      || controllerManifest.preApplyChecks.length < 1
      || !Array.isArray(controllerManifest?.postApplyChecks)
      || controllerManifest.postApplyChecks.length < 1) {
    fail("SUCCESSOR_HOSTED_STAGING_RELEASE_CONTRACT_INVALID");
  }
  return {
    manifest,
    controllerManifest,
    evidence: validateEvidenceContract(manifest),
    rollback: validateRollbackContract(controllerManifest.rollbackContract, manifest.release),
    expectedOrigin,
  };
}

function releaseRuntimeBinding(manifest, controllerManifest) {
  const versions = manifest.expandMigrations.map((entry) => {
    const match = typeof entry?.file === "string"
      ? entry.file.match(/^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/)
      : null;
    return match?.[1] ?? "";
  });
  if (versions.some((version, index) => !MIGRATION.test(version)
      || (index > 0 && version <= versions[index - 1]))
      || new Set(versions).size !== versions.length) {
    fail("SUCCESSOR_HOSTED_STAGING_RELEASE_CONTRACT_INVALID");
  }
  const preApplyCheckIds = controllerManifest.preApplyChecks.map((check) => check?.id);
  const postApplyCheckIds = controllerManifest.postApplyChecks.map((check) => check?.id);
  if (preApplyCheckIds.some((id) => !SAFE_CHECK_ID.test(id ?? ""))
      || new Set(preApplyCheckIds).size !== preApplyCheckIds.length
      || postApplyCheckIds.some((id) => !SAFE_CHECK_ID.test(id ?? ""))
      || new Set(postApplyCheckIds).size !== postApplyCheckIds.length) {
    fail("SUCCESSOR_HOSTED_STAGING_RELEASE_CONTRACT_INVALID");
  }
  return {
    versions,
    expectedMigrationHead: versions.at(-1),
    migrationCount: versions.length,
    migrationVersionsSha256: textListSha256(versions),
    preApplyCheckIds,
    postApplyCheckIds,
    postApplyChecksSha256: textListSha256(postApplyCheckIds),
    rollbackContractSha256: canonicalJsonSha256(controllerManifest.rollbackContract),
  };
}

async function validateApprovedStagingContract(repoRoot, manifest) {
  const path = resolve(repoRoot, APPROVED_STAGING_CONTRACT_FILE);
  if (!inside(repoRoot, path)) fail("SUCCESSOR_HOSTED_STAGING_APPROVAL_INVALID");
  const input = await readBoundedJson(path, "SUCCESSOR_HOSTED_STAGING_APPROVAL_INVALID", 64 * 1024);
  const value = input.value;
  if (!exactKeys(value, [
    "approvalEvidence", "approved", "contractVersion", "kind", "productionProjectRef",
    "projectRef", "publicViewDefinitionSha256", "release", "status",
  ])
      || value.contractVersion !== 1
      || value.kind !== "vendor-disclosure-hosted-staging-v2"
      || value.release !== manifest.release
      || value.productionProjectRef !== manifest.projectRef
      || value.productionProjectRef !== APPROVED_PRODUCTION_REF
      || value.projectRef !== APPROVED_STAGING_REF
      || value.projectRef === value.productionProjectRef
      || value.status !== "approved_for_hosted_rls_probe"
      || value.approved !== true
      || value.approvalEvidence
        !== "codex-thread:user-approved-dedicated-free-staging-2026-07-22"
      || !exactRecord(value.publicViewDefinitionSha256, APPROVED_PUBLIC_VIEW_SHA256)) {
    fail("SUCCESSOR_HOSTED_STAGING_APPROVAL_INVALID");
  }
  return { ...input, path, value };
}

async function expectedHostedLedger(repoRoot, expectedHead) {
  const directory = resolve(repoRoot, "supabase", "migrations");
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => null);
  if (!entries) fail("SUCCESSOR_HOSTED_STAGING_MIGRATION_LEDGER_INVALID");
  const versions = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name.match(/^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/)?.[1] ?? null)
    .filter((version) => version !== null && version <= expectedHead)
    .sort();
  if (versions.length < 1 || versions.at(-1) !== expectedHead
      || new Set(versions).size !== versions.length) {
    fail("SUCCESSOR_HOSTED_STAGING_MIGRATION_LEDGER_INVALID");
  }
  return { count: versions.length, head: expectedHead };
}

function validateScenario(value, contract) {
  const keys = ["checks", "residue", "scenario", "syntheticUserCount"];
  if (contract.providerEvidence !== undefined) keys.push("providerEvidence");
  return exactKeys(value, keys)
    && value.scenario === contract.scenario
    && value.syntheticUserCount === contract.syntheticUserCount
    && (contract.providerEvidence === undefined
      || value.providerEvidence === contract.providerEvidence)
    && exactKeys(value.checks, contract.checks)
    && contract.checks.every((name) => value.checks[name] === true)
    && exactKeys(value.residue, contract.residue)
    && contract.residue.every((name) => value.residue[name] === 0);
}

function validateProbe(value, { expectedCommit, ledger, nowMs, evidence }) {
  if (!exactKeys(value, [
    "completedAt", "gitCommit", "kind", "migrationLedger", "projectRef",
    "receiptVersion", "result", "scope", "startedAt",
  ])
      || value.receiptVersion !== 8
      || value.kind !== "amora-successor-hosted-staging-probe"
      || value.scope !== PROBE_SCOPE
      || value.projectRef !== APPROVED_STAGING_REF
      || value.projectRef === APPROVED_PRODUCTION_REF
      || value.gitCommit !== expectedCommit
      || !exactRecord(value.migrationLedger, ledger)
      || !exactKeys(value.result, [
        ...Object.keys(PROBE_SCENARIOS),
        "preparationActionReceiptBindingContract",
      ])
      || !Object.entries(PROBE_SCENARIOS).every(
        ([name, contract]) => validateScenario(value.result[name], contract),
      )
      || !exactRecord(value.result.preparationActionReceiptBindingContract, {
        preparationActionReceiptBindingReadRpcAclCount: 1,
      })) {
    fail("SUCCESSOR_HOSTED_STAGING_PROBE_INVALID");
  }
  const startedAt = instant(value.startedAt, "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID");
  const completedAt = instant(value.completedAt, "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID");
  const maximumAgeMs = evidence.maximumAgeMinutes * 60_000;
  if (completedAt < startedAt || completedAt > nowMs + 60_000
      || nowMs - completedAt >= maximumAgeMs
      || completedAt - startedAt > maximumAgeMs) {
    fail("SUCCESSOR_HOSTED_STAGING_PROBE_INVALID");
  }
  return { startedAt, completedAt };
}

function stripSqlCommentsAndLiterals(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, "$$");
}

async function validatePostcheck({
  value,
  bytes,
  repoRoot,
  manifest,
  controllerManifest,
  expectedCommit,
  nowMs,
  evidence,
}) {
  if (!exactKeys(value, [
    "checkId", "containsSecrets", "executedAt", "kind", "productionMutationAttempted",
    "productionProjectRef", "projectRef", "receiptVersion", "release",
    "releaseCommit", "row", "source", "sqlFile", "sqlSha256", "transactionReadOnly",
  ])
      || value.receiptVersion !== 1
      || value.kind !== SUCCESSOR_READ_ONLY_POSTCHECK_KIND
      || value.release !== manifest.release
      || value.projectRef !== APPROVED_STAGING_REF
      || value.productionProjectRef !== manifest.projectRef
      || value.projectRef === value.productionProjectRef
      || value.releaseCommit !== expectedCommit
      || value.source !== "supabase-management-read-only-query"
      || value.transactionReadOnly !== true
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false
      || containsSecretMaterial(value)) {
    fail("SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID");
  }
  const check = controllerManifest.postApplyChecks.find((entry) => entry?.id === value.checkId);
  if (!check || controllerManifest.postApplyChecks.length !== 1
      || !exactKeys(check, ["expectedEvidence", "file", "id", "sha256", "type"])
      || check.type !== "read-only-sql"
      || value.sqlFile !== check.file
      || value.sqlSha256 !== check.sha256
      || typeof check.file !== "string" || check.file.includes("\\")
      || !SHA256.test(check.sha256 ?? "")) {
    fail("SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID");
  }
  const sqlPath = resolve(repoRoot, check.file);
  if (!inside(repoRoot, sqlPath)) fail("SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID");
  const sqlBytes = await readBoundedRegularFile(
    sqlPath,
    MAX_INPUT_BYTES,
    "SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID",
  );
  const sqlText = sqlBytes.toString("utf8");
  const executable = stripSqlCommentsAndLiterals(sqlText);
  if (canonicalTextSha256(sqlText) !== check.sha256
      || !/\bBEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i.test(executable)
      || !/\b(?:COMMIT|ROLLBACK)\s*;\s*$/i.test(executable)
      || /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|CALL)\b/i.test(executable)
      || check.expectedEvidence === null
      || typeof check.expectedEvidence !== "object"
      || Array.isArray(check.expectedEvidence)
      || !exactKeys(value.row, ["verified", ...Object.keys(check.expectedEvidence)])
      || value.row.verified !== true
      || !Object.entries(check.expectedEvidence).every(
        ([name, expected]) => value.row[name] === expected,
      )) {
    fail("SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID");
  }
  const executedAt = instant(value.executedAt, "SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID");
  if (executedAt > nowMs + 60_000
      || nowMs - executedAt >= evidence.maximumAgeMinutes * 60_000) {
    fail("SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID");
  }
  return { executedAt, sqlSha256: check.sha256, receiptSha256: sha256(bytes) };
}

function validateFeatureOff({
  value,
  rollback,
  manifest,
  expectedCommit,
  nowMs,
}) {
  if (!exactKeys(value, [
    "checks", "containsSecrets", "environment", "kind", "migrationRollback",
    "observedControls", "productionMutationAttempted", "projectRef", "receiptFileName",
    "receiptMaximumAgeMinutes", "receiptVersion", "release", "releaseCommit",
    "requiredControls", "source", "strategy", "verifiedAt",
  ])
      || value.receiptVersion !== 1
      || value.kind !== SUCCESSOR_FEATURE_OFF_VERIFICATION_KIND
      || value.release !== manifest.release
      || value.projectRef !== APPROVED_STAGING_REF
      || value.releaseCommit !== expectedCommit
      || value.receiptFileName !== rollback.featureOffReceiptFileName
      || value.strategy !== rollback.strategy
      || value.migrationRollback !== rollback.migrationRollback
      || value.receiptMaximumAgeMinutes !== rollback.maximumAgeMinutes
      || !exactRecord(value.requiredControls, rollback.requiredControls)
      || !exactRecord(value.observedControls, rollback.requiredControls)
      || !exactKeys(value.checks, rollback.requiredChecks)
      || rollback.requiredChecks.some((name) => value.checks[name] !== true)
      || value.environment !== "isolated-non-production-rehearsal"
      || value.source !== "feature-off-rollback-rehearsal"
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false
      || containsSecretMaterial(value)) {
    fail("SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID");
  }
  const verifiedAt = instant(value.verifiedAt, "SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID");
  if (verifiedAt > nowMs + 60_000
      || nowMs - verifiedAt >= rollback.maximumAgeMinutes * 60_000) {
    fail("SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID");
  }
  return { verifiedAt };
}

function validateRollbackRehearsal({
  value,
  rollback,
  manifest,
  expectedCommit,
  featureOffSha256,
  featureVerifiedAt,
  nowMs,
  evidence,
}) {
  if (!exactKeys(value, [
    "checks", "completedAt", "containsSecrets", "featureOffReceiptFileName",
    "featureOffReceiptSha256", "kind", "migrationRollback", "outcome",
    "productionMutationAttempted", "productionProjectRef", "projectRef",
    "receiptVersion", "rehearsalMode", "rehearsalPlanSha256", "rehearsalRunId",
    "release", "releaseCommit", "startedAt", "strategy",
  ])
      || value.receiptVersion !== 1
      || value.kind !== SUCCESSOR_FORWARD_FIX_REHEARSAL_KIND
      || value.release !== manifest.release
      || value.projectRef !== APPROVED_STAGING_REF
      || value.productionProjectRef !== manifest.projectRef
      || value.projectRef === value.productionProjectRef
      || value.releaseCommit !== expectedCommit
      || value.strategy !== rollback.strategy
      || value.migrationRollback !== rollback.migrationRollback
      || value.featureOffReceiptFileName !== rollback.featureOffReceiptFileName
      || value.featureOffReceiptSha256 !== featureOffSha256
      || !UUID_V4.test(value.rehearsalRunId ?? "")
      || value.rehearsalMode !== "isolated-staging-forward-fix-rehearsal"
      || value.rehearsalPlanSha256 !== forwardFixPlanSha256(rollback)
      || value.outcome !== "passed"
      || !exactKeys(value.checks, FORWARD_FIX_CHECKS)
      || FORWARD_FIX_CHECKS.some((name) => value.checks[name] !== true)
      || value.productionMutationAttempted !== false
      || value.containsSecrets !== false
      || containsSecretMaterial(value)) {
    fail("SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID");
  }
  const startedAt = instant(
    value.startedAt,
    "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
  );
  const completedAt = instant(
    value.completedAt,
    "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
  );
  if (startedAt < featureVerifiedAt || completedAt < startedAt
      || completedAt > nowMs + 60_000
      || nowMs - completedAt >= evidence.maximumAgeMinutes * 60_000) {
    fail("SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID");
  }
  return { startedAt, completedAt };
}

/**
 * Replay the exact semantic contract of an already-emitted hosted-Staging raw
 * transcript. Hashing the outer JSON is insufficient: every embedded probe,
 * read-only postcheck, feature-off receipt and forward-fix receipt is checked
 * again against the pinned release files and controller contract.
 */
export async function validateVendorDisclosureSuccessorHostedStagingEvidenceProvenance({
  repoRoot,
  receipt,
  raw,
  manifest,
  controllerManifest,
  expectedCommit,
  remoteRef,
  now = () => new Date(),
}) {
  const root = resolve(repoRoot);
  const nowValue = now();
  const nowMs = nowValue instanceof Date ? nowValue.getTime() : Number.NaN;
  const evidence = validateEvidenceContract(manifest);
  const rollback = validateRollbackContract(
    controllerManifest?.rollbackContract,
    manifest?.release,
  );
  const binding = releaseRuntimeBinding(manifest, controllerManifest);
  const approval = raw?.approvedStagingContract;
  const migration = raw?.migrationContract;
  const checks = raw?.checkEvidence;
  const ledger = {
    count: migration?.hostedLedgerCount,
    head: binding.expectedMigrationHead,
  };
  if (!Number.isFinite(nowMs)
      || !exactKeys(raw, [
        "approvedStagingContract", "capturedAt", "checkEvidence", "containsSecrets",
        "featureOffVerification", "gitBinding", "kind", "migrationContract",
        "postcheck", "probe", "productionProjectRef", "rawEvidenceVersion",
        "rehearsalProducerProvenance", "release", "releaseCommit",
        "rollbackRehearsal", "stagingProjectRef",
      ])
      || raw.rawEvidenceVersion !== 1
      || raw.kind !== "vendor-disclosure-successor-hosted-staging-raw-v1"
      || raw.release !== manifest?.release
      || raw.productionProjectRef !== manifest?.projectRef
      || raw.stagingProjectRef !== APPROVED_STAGING_REF
      || raw.stagingProjectRef === raw.productionProjectRef
      || raw.releaseCommit !== expectedCommit
      || raw.capturedAt !== receipt?.capturedAt
      || raw.containsSecrets !== false
      || containsSecretMaterial(raw)
      || !exactKeys(raw.gitBinding, ["commit", "origin", "remoteRef"])
      || raw.gitBinding.origin !== controllerManifest?.backupContract?.expectedOrigin
      || raw.gitBinding.remoteRef !== remoteRef
      || raw.gitBinding.commit !== expectedCommit
      || !exactKeys(approval, ["contract", "file", "sha256"])
      || approval.file !== APPROVED_STAGING_CONTRACT_FILE
      || !SHA256.test(approval.sha256 ?? "")
      || !exactKeys(approval.contract, [
        "approvalEvidence", "approved", "contractVersion", "kind",
        "productionProjectRef", "projectRef", "publicViewDefinitionSha256",
        "release", "status",
      ])
      || approval.contract.contractVersion !== 1
      || approval.contract.kind !== "vendor-disclosure-hosted-staging-v2"
      || approval.contract.release !== manifest.release
      || approval.contract.productionProjectRef !== manifest.projectRef
      || approval.contract.projectRef !== APPROVED_STAGING_REF
      || approval.contract.status !== "approved_for_hosted_rls_probe"
      || approval.contract.approved !== true
      || approval.contract.approvalEvidence
        !== "codex-thread:user-approved-dedicated-free-staging-2026-07-22"
      || !exactRecord(
        approval.contract.publicViewDefinitionSha256,
        APPROVED_PUBLIC_VIEW_SHA256,
      )
      || !exactKeys(migration, [
        "expectedMigrationHead", "hostedLedgerCount", "migrationCount",
        "migrationVersionsSha256", "requiredRemoteHead",
      ])
      || migration.expectedMigrationHead !== binding.expectedMigrationHead
      || !Number.isSafeInteger(migration.hostedLedgerCount)
      || migration.hostedLedgerCount < binding.migrationCount
      || migration.migrationCount !== binding.migrationCount
      || migration.migrationVersionsSha256 !== binding.migrationVersionsSha256
      || migration.requiredRemoteHead !== manifest.requiredRemoteHead
      || !exactKeys(checks, evidence.requiredChecks)
      || !exactKeys(checks.exactMigrationSetApplied, [
        "expectedMigrationHead", "migrationCount", "migrationVersionsSha256",
        "probeLedger",
      ])
      || !exactRecord(checks.exactMigrationSetApplied.probeLedger, ledger)
      || checks.exactMigrationSetApplied.expectedMigrationHead
        !== binding.expectedMigrationHead
      || checks.exactMigrationSetApplied.migrationCount !== binding.migrationCount
      || checks.exactMigrationSetApplied.migrationVersionsSha256
        !== binding.migrationVersionsSha256
      || !exactKeys(checks.preconditionsPassed, [
        "approvedStagingContractSha256", "cleanPushedCommit",
        "controllerPreApplyCheckIds", "productionProjectRef", "stagingProjectRef",
      ])
      || checks.preconditionsPassed.approvedStagingContractSha256 !== approval.sha256
      || checks.preconditionsPassed.cleanPushedCommit !== expectedCommit
      || !exactArray(
        checks.preconditionsPassed.controllerPreApplyCheckIds,
        binding.preApplyCheckIds,
      )
      || checks.preconditionsPassed.productionProjectRef !== manifest.projectRef
      || checks.preconditionsPassed.stagingProjectRef !== APPROVED_STAGING_REF
      || !exactKeys(checks.postconditionsPassed, [
        "probeReceiptSha256", "scenarioNames", "zeroResidueVerified",
      ])
      || checks.postconditionsPassed.probeReceiptSha256 !== raw.probe?.sha256
      || !exactArray(
        checks.postconditionsPassed.scenarioNames,
        Object.keys(PROBE_SCENARIOS),
      )
      || checks.postconditionsPassed.zeroResidueVerified !== true
      || !exactKeys(checks.readOnlyPostchecksPassed, [
        "postcheckReceiptSha256", "sqlSha256", "transactionReadOnly",
      ])
      || checks.readOnlyPostchecksPassed.postcheckReceiptSha256
        !== raw.postcheck?.sha256
      || checks.readOnlyPostchecksPassed.sqlSha256 !== raw.postcheck?.sqlSha256
      || checks.readOnlyPostchecksPassed.transactionReadOnly !== true
      || !exactKeys(checks.rollbackRehearsed, [
        "migrationRollback", "rehearsalReceiptSha256", "strategy",
      ])
      || checks.rollbackRehearsed.rehearsalReceiptSha256
        !== raw.rollbackRehearsal?.sha256
      || checks.rollbackRehearsed.strategy !== rollback.strategy
      || checks.rollbackRehearsed.migrationRollback !== rollback.migrationRollback
      || !exactKeys(checks.featureFlagsOffVerified, [
        "featureOffReceiptSha256", "requiredControls",
      ])
      || checks.featureFlagsOffVerified.featureOffReceiptSha256
        !== raw.featureOffVerification?.sha256
      || !exactRecord(
        checks.featureFlagsOffVerified.requiredControls,
        rollback.requiredControls,
      )) {
    fail("SUCCESSOR_HOSTED_STAGING_PROVENANCE_INVALID");
  }

  const approvalPath = resolve(root, approval.file);
  const approvalInput = await readBoundedJson(
    approvalPath,
    "SUCCESSOR_HOSTED_STAGING_PROVENANCE_INVALID",
    64 * 1024,
  );
  if (sha256(approvalInput.bytes) !== approval.sha256
      || canonicalJson(approvalInput.value) !== canonicalJson(approval.contract)) {
    fail("SUCCESSOR_HOSTED_STAGING_PROVENANCE_INVALID");
  }
  for (const wrapper of [raw.probe, raw.featureOffVerification]) {
    if (!exactKeys(wrapper, ["fileName", "receipt", "sha256"])
        || !SAFE_FILE.test(wrapper.fileName ?? "")
        || !SHA256.test(wrapper.sha256 ?? "")) {
      fail("SUCCESSOR_HOSTED_STAGING_PROVENANCE_INVALID");
    }
  }
  if (!exactKeys(raw.postcheck, ["fileName", "receipt", "sha256", "sqlSha256"])
      || !SAFE_FILE.test(raw.postcheck.fileName ?? "")
      || !SHA256.test(raw.postcheck.sha256 ?? "")
      || !SHA256.test(raw.postcheck.sqlSha256 ?? "")
      || !exactKeys(raw.rollbackRehearsal, [
        "completedAt", "fileName", "receipt", "sha256",
      ])
      || !SAFE_FILE.test(raw.rollbackRehearsal.fileName ?? "")
      || !SHA256.test(raw.rollbackRehearsal.sha256 ?? "")
      || !exactKeys(raw.rehearsalProducerProvenance, [
        "fileName", "forwardFixStdoutSha256", "isolatedStdoutSha256",
        "migrationRollbackCommandCount", "productionMutationCommandCount", "sha256",
      ])
      || !SAFE_FILE.test(raw.rehearsalProducerProvenance.fileName ?? "")
      || ![
        raw.rehearsalProducerProvenance.sha256,
        raw.rehearsalProducerProvenance.isolatedStdoutSha256,
        raw.rehearsalProducerProvenance.forwardFixStdoutSha256,
      ].every((value) => SHA256.test(value ?? ""))
      || raw.rehearsalProducerProvenance.productionMutationCommandCount !== 0
      || raw.rehearsalProducerProvenance.migrationRollbackCommandCount !== 0) {
    fail("SUCCESSOR_HOSTED_STAGING_PROVENANCE_INVALID");
  }

  const probe = validateProbe(raw.probe.receipt, {
    expectedCommit,
    ledger,
    nowMs,
    evidence,
  });
  const postcheck = await validatePostcheck({
    value: raw.postcheck.receipt,
    bytes: Buffer.from("semantic-replay", "utf8"),
    repoRoot: root,
    manifest,
    controllerManifest,
    expectedCommit,
    nowMs,
    evidence,
  });
  const feature = validateFeatureOff({
    value: raw.featureOffVerification.receipt,
    rollback,
    manifest,
    expectedCommit,
    nowMs,
  });
  const rehearsal = validateRollbackRehearsal({
    value: raw.rollbackRehearsal.receipt,
    rollback,
    manifest,
    expectedCommit,
    featureOffSha256: raw.featureOffVerification.sha256,
    featureVerifiedAt: feature.verifiedAt,
    nowMs,
    evidence,
  });
  const capturedAt = instant(
    raw.capturedAt,
    "SUCCESSOR_HOSTED_STAGING_PROVENANCE_INVALID",
  );
  if (capturedAt < probe.completedAt
      || capturedAt < postcheck.executedAt
      || capturedAt < feature.verifiedAt
      || capturedAt < rehearsal.completedAt
      || raw.rollbackRehearsal.completedAt
        !== new Date(rehearsal.completedAt).toISOString()) {
    fail("SUCCESSOR_HOSTED_STAGING_PROVENANCE_INVALID");
  }
  return Object.freeze({
    stagingProjectRef: APPROVED_STAGING_REF,
    approvedStagingContractSha256: approval.sha256,
    probeReceiptSha256: raw.probe.sha256,
    postcheckReceiptSha256: raw.postcheck.sha256,
    featureOffReceiptSha256: raw.featureOffVerification.sha256,
    rollbackRehearsalReceiptSha256: raw.rollbackRehearsal.sha256,
  });
}

export const successorHostedStagingEvidenceTestHooks = Object.freeze({
  APPROVED_PUBLIC_VIEW_SHA256,
  FORWARD_FIX_CHECKS,
  PROBE_SCENARIOS,
  PROBE_SCOPE,
  forwardFixPlanSha256,
});

export async function emitVendorDisclosureSuccessorHostedStagingEvidence({
  repoRoot,
  receiptRoot,
  expectedCommit,
  remoteRef,
  probeReceiptPath,
  postcheckReceiptPath,
  featureOffReceiptPath,
  rollbackRehearsalReceiptPath,
  rehearsalProvenancePath,
  now = () => new Date(),
  runCommand = defaultRunCommand,
  releaseLoader = validateSuccessorReleaseContract,
  durableWriter = writeDurableExclusiveEvidencePair,
  validateRehearsalProvenance = validateSuccessorRehearsalProducerProvenance,
}) {
  if (typeof repoRoot !== "string" || typeof receiptRoot !== "string") {
    fail("SUCCESSOR_HOSTED_STAGING_ARGUMENT_INVALID");
  }
  const root = resolve(repoRoot);
  if (!COMMIT.test(expectedCommit ?? "")
      || typeof remoteRef !== "string"
      || ![probeReceiptPath, postcheckReceiptPath, featureOffReceiptPath,
        rollbackRehearsalReceiptPath, rehearsalProvenancePath].every(
        (path) => typeof path === "string" && isAbsolute(path),
      )
      || new Set([probeReceiptPath, postcheckReceiptPath, featureOffReceiptPath,
        rollbackRehearsalReceiptPath, rehearsalProvenancePath]).size !== 5
      || typeof runCommand !== "function"
      || typeof releaseLoader !== "function"
      || typeof durableWriter !== "function"
      || typeof validateRehearsalProvenance !== "function") {
    fail("SUCCESSOR_HOSTED_STAGING_ARGUMENT_INVALID");
  }
  const capturedAt = now();
  const nowMs = capturedAt instanceof Date ? capturedAt.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) fail("SUCCESSOR_HOSTED_STAGING_CLOCK_INVALID");

  const { manifest, controllerManifest, evidence, rollback, expectedOrigin } =
    await validateReleaseState({ repoRoot: root, releaseLoader });
  const binding = releaseRuntimeBinding(manifest, controllerManifest);
  const approval = await validateApprovedStagingContract(root, manifest);
  const ledger = await expectedHostedLedger(root, binding.expectedMigrationHead);
  const [outputRoot, canonicalProbe, canonicalPostcheck, canonicalFeatureOff,
    canonicalRollbackRehearsal, canonicalRehearsalProvenance] = await Promise.all([
    assertExternalDirectory(root, receiptRoot, "SUCCESSOR_HOSTED_STAGING_OUTPUT_ROOT_INVALID"),
    canonicalExternalFile(root, probeReceiptPath, "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID"),
    canonicalExternalFile(root, postcheckReceiptPath, "SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID"),
    canonicalExternalFile(root, featureOffReceiptPath, "SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID"),
    canonicalExternalFile(
      root,
      rollbackRehearsalReceiptPath,
      "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
    ),
    canonicalExternalFile(
      root,
      rehearsalProvenancePath,
      "SUCCESSOR_HOSTED_STAGING_REHEARSAL_PROVENANCE_INVALID",
    ),
  ]);
  if (basename(canonicalFeatureOff) !== rollback.featureOffReceiptFileName) {
    fail("SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID");
  }
  const rawPath = resolve(outputRoot, evidence.rawEvidenceFileName);
  const receiptPath = resolve(outputRoot, evidence.receiptFileName);
  if (dirname(rawPath) !== outputRoot || dirname(receiptPath) !== outputRoot
      || await lstat(rawPath).catch(() => null)
      || await lstat(receiptPath).catch(() => null)) {
    fail("SUCCESSOR_HOSTED_STAGING_OUTPUT_COLLISION");
  }

  await assertExactPushedCommit({
    repoRoot: root,
    expectedCommit,
    expectedOrigin,
    remoteRef,
    runCommand,
  });
  const [probeInput, postcheckInput, featureOffInput, rollbackInput,
    rehearsalProvenanceInput] = await Promise.all([
    readBoundedJson(canonicalProbe, "SUCCESSOR_HOSTED_STAGING_PROBE_INVALID"),
    readBoundedJson(canonicalPostcheck, "SUCCESSOR_HOSTED_STAGING_POSTCHECK_INVALID"),
    readBoundedJson(canonicalFeatureOff, "SUCCESSOR_HOSTED_STAGING_FEATURE_OFF_INVALID"),
    readBoundedJson(
      canonicalRollbackRehearsal,
      "SUCCESSOR_HOSTED_STAGING_ROLLBACK_REHEARSAL_INVALID",
    ),
    readBoundedJson(
      canonicalRehearsalProvenance,
      "SUCCESSOR_HOSTED_STAGING_REHEARSAL_PROVENANCE_INVALID",
    ),
  ]);
  if ([probeInput, postcheckInput, featureOffInput, rollbackInput,
    rehearsalProvenanceInput]
    .some((input) => containsSecretMaterial(input.value))) {
    fail("SUCCESSOR_HOSTED_STAGING_SECRET_MATERIAL_REJECTED");
  }

  validateProbe(probeInput.value, {
    expectedCommit,
    ledger,
    nowMs,
    evidence,
  });
  const postcheck = await validatePostcheck({
    ...postcheckInput,
    repoRoot: root,
    manifest,
    controllerManifest,
    expectedCommit,
    nowMs,
    evidence,
  });
  const featureOff = validateFeatureOff({
    value: featureOffInput.value,
    rollback,
    manifest,
    expectedCommit,
    nowMs,
  });
  const rollbackRehearsal = validateRollbackRehearsal({
    value: rollbackInput.value,
    rollback,
    manifest,
    expectedCommit,
    featureOffSha256: sha256(featureOffInput.bytes),
    featureVerifiedAt: featureOff.verifiedAt,
    nowMs,
    evidence,
  });
  let rehearsalProvenance;
  try {
    rehearsalProvenance = await validateRehearsalProvenance({
      repoRoot: root,
      provenanceValue: rehearsalProvenanceInput.value,
      provenanceBytes: rehearsalProvenanceInput.bytes,
      featureOffValue: featureOffInput.value,
      featureOffBytes: featureOffInput.bytes,
      forwardFixValue: rollbackInput.value,
      forwardFixBytes: rollbackInput.bytes,
      probeBytes: probeInput.bytes,
      postcheckValue: postcheckInput.value,
      postcheckBytes: postcheckInput.bytes,
      manifest,
      controllerManifest,
      expectedCommit,
      stagingProjectRef: APPROVED_STAGING_REF,
      approvedStagingContractSha256: sha256(approval.bytes),
    });
  } catch {
    fail("SUCCESSOR_HOSTED_STAGING_REHEARSAL_PROVENANCE_INVALID");
  }

  await assertExactPushedCommit({
    repoRoot: root,
    expectedCommit,
    expectedOrigin,
    remoteRef,
    runCommand,
  });
  if (await realpath(receiptRoot).catch(() => null) !== outputRoot
      || (await lstat(receiptRoot).catch(() => null))?.isSymbolicLink()) {
    fail("SUCCESSOR_HOSTED_STAGING_OUTPUT_ROOT_INVALID");
  }

  const capturedAtText = capturedAt.toISOString();
  const raw = {
    rawEvidenceVersion: 1,
    kind: "vendor-disclosure-successor-hosted-staging-raw-v1",
    release: manifest.release,
    productionProjectRef: manifest.projectRef,
    stagingProjectRef: APPROVED_STAGING_REF,
    releaseCommit: expectedCommit,
    capturedAt: capturedAtText,
    approvedStagingContract: {
      file: APPROVED_STAGING_CONTRACT_FILE,
      sha256: sha256(approval.bytes),
      contract: approval.value,
    },
    gitBinding: { origin: expectedOrigin, remoteRef, commit: expectedCommit },
    migrationContract: {
      expectedMigrationHead: binding.expectedMigrationHead,
      migrationCount: binding.migrationCount,
      migrationVersionsSha256: binding.migrationVersionsSha256,
      hostedLedgerCount: ledger.count,
      requiredRemoteHead: manifest.requiredRemoteHead,
    },
    checkEvidence: {
      exactMigrationSetApplied: {
        probeLedger: ledger,
        expectedMigrationHead: binding.expectedMigrationHead,
        migrationCount: binding.migrationCount,
        migrationVersionsSha256: binding.migrationVersionsSha256,
      },
      preconditionsPassed: {
        approvedStagingContractSha256: sha256(approval.bytes),
        stagingProjectRef: APPROVED_STAGING_REF,
        productionProjectRef: manifest.projectRef,
        cleanPushedCommit: expectedCommit,
        controllerPreApplyCheckIds: binding.preApplyCheckIds,
      },
      postconditionsPassed: {
        probeReceiptSha256: sha256(probeInput.bytes),
        scenarioNames: Object.keys(PROBE_SCENARIOS),
        zeroResidueVerified: true,
      },
      readOnlyPostchecksPassed: {
        postcheckReceiptSha256: sha256(postcheckInput.bytes),
        sqlSha256: postcheck.sqlSha256,
        transactionReadOnly: true,
      },
      rollbackRehearsed: {
        rehearsalReceiptSha256: sha256(rollbackInput.bytes),
        strategy: rollback.strategy,
        migrationRollback: rollback.migrationRollback,
      },
      featureFlagsOffVerified: {
        featureOffReceiptSha256: sha256(featureOffInput.bytes),
        requiredControls: rollback.requiredControls,
      },
    },
    probe: {
      fileName: basename(canonicalProbe),
      sha256: sha256(probeInput.bytes),
      receipt: probeInput.value,
    },
    postcheck: {
      fileName: basename(canonicalPostcheck),
      sha256: sha256(postcheckInput.bytes),
      sqlSha256: postcheck.sqlSha256,
      receipt: postcheckInput.value,
    },
    featureOffVerification: {
      fileName: basename(canonicalFeatureOff),
      sha256: sha256(featureOffInput.bytes),
      receipt: featureOffInput.value,
    },
    rollbackRehearsal: {
      fileName: basename(canonicalRollbackRehearsal),
      sha256: sha256(rollbackInput.bytes),
      completedAt: new Date(rollbackRehearsal.completedAt).toISOString(),
      receipt: rollbackInput.value,
    },
    rehearsalProducerProvenance: {
      fileName: basename(canonicalRehearsalProvenance),
      sha256: rehearsalProvenance.sha256,
      isolatedStdoutSha256: rehearsalProvenance.isolatedStdoutSha256,
      forwardFixStdoutSha256: rehearsalProvenance.forwardFixStdoutSha256,
      productionMutationCommandCount:
        rehearsalProvenance.productionMutationCommandCount,
      migrationRollbackCommandCount:
        rehearsalProvenance.migrationRollbackCommandCount,
    },
    containsSecrets: false,
  };
  const rawText = `${JSON.stringify(raw, null, 2)}\n`;
  const receipt = {
    receiptVersion: 1,
    kind: evidence.kind,
    release: manifest.release,
    projectRef: manifest.projectRef,
    releaseCommit: expectedCommit,
    capturedAt: capturedAtText,
    expiresAt: new Date(nowMs + evidence.maximumAgeMinutes * 60_000).toISOString(),
    requiredRemoteHead: manifest.requiredRemoteHead,
    expectedMigrationHead: binding.expectedMigrationHead,
    migrationCount: binding.migrationCount,
    migrationVersionsSha256: binding.migrationVersionsSha256,
    observations: {
      expectedMigrationHead: binding.expectedMigrationHead,
      migrationCount: binding.migrationCount,
      migrationVersionsSha256: binding.migrationVersionsSha256,
      requiredRemoteHead: manifest.requiredRemoteHead,
      rollbackStrategy: rollback.strategy,
    },
    postApplyCheckIds: binding.postApplyCheckIds,
    postApplyChecksSha256: binding.postApplyChecksSha256,
    rollbackContractSha256: binding.rollbackContractSha256,
    checks: Object.fromEntries(evidence.requiredChecks.map((name) => [name, true])),
    rawProvenance: {
      fileName: evidence.rawEvidenceFileName,
      sha256: sha256(rawText),
      capturedAt: capturedAtText,
      source: evidence.rawEvidenceSource,
    },
    containsSecrets: false,
  };
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  if (containsSecretMaterial(raw) || containsSecretMaterial(receipt)
      || Buffer.byteLength(rawText, "utf8") > MAX_RAW_EVIDENCE_BYTES
      || Buffer.byteLength(receiptText, "utf8") > MAX_RUNTIME_RECEIPT_BYTES) {
    fail("SUCCESSOR_HOSTED_STAGING_OUTPUT_INVALID");
  }
  try {
    await durableWriter({ rawPath, rawText, receiptPath, receiptText });
  } catch {
    fail("SUCCESSOR_HOSTED_STAGING_OUTPUT_FAILED");
  }

  return Object.freeze({
    status: "successor_hosted_staging_evidence_emitted",
    release: manifest.release,
    productionProjectRef: manifest.projectRef,
    stagingProjectRef: APPROVED_STAGING_REF,
    releaseCommit: expectedCommit,
    rawEvidencePath: rawPath,
    rawEvidenceSha256: receipt.rawProvenance.sha256,
    receiptPath,
    receiptSha256: sha256(receiptText),
    capturedAt: capturedAtText,
    expiresAt: receipt.expiresAt,
    containsSecrets: false,
  });
}
