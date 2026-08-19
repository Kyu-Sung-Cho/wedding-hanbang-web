#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  emitSuccessorFinalizerEvidence,
  emitSuccessorFinalizerRenderOnlyRehearsal,
  SuccessorFinalizerEvidenceError,
} from "./lib/vendor-disclosure-successor-finalizer-evidence.mjs";
import {
  validateSuccessorReleaseContract,
} from "./lib/supabase-successor-release-contract.mjs";

const execFile = promisify(execFileCallback);
const COMMIT = /^[a-f0-9]{40}$/;
const REMOTE_REF = /^origin\/([A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9])?)$/;
const MAX_INPUT_BYTES = 512 * 1024;
const COMMON_ARGUMENTS = Object.freeze([
  "--canary-fence-receipt",
  "--expected-commit",
  "--feature-off-receipt",
  "--mode",
  "--owner-lease-receipt",
  "--remote-ref",
  "--template-contract-receipt",
]);
const MODE_ARGUMENTS = Object.freeze({
  "render-rehearsal": Object.freeze([
    ...COMMON_ARGUMENTS,
    "--dry-rehearsal-out",
  ]),
  "emit-evidence": Object.freeze([
    ...COMMON_ARGUMENTS,
    "--dry-rehearsal-receipt",
    "--raw-out",
    "--receipt-out",
  ]),
});

function blocked(code, message = code) {
  throw new SuccessorFinalizerEvidenceError(code, message);
}

function inside(parent, child) {
  const value = relative(resolve(parent), resolve(child));
  return value === ""
    || (value !== ".."
      && !value.startsWith(`..${sep}`)
      && !isAbsolute(value));
}

function parseArguments(argv) {
  if (argv.length === 1 && argv[0] === "--help") return { help: true };
  const values = {};
  for (const argument of argv) {
    const separator = typeof argument === "string" ? argument.indexOf("=") : -1;
    const name = separator > 2 ? argument.slice(0, separator) : "";
    const value = separator > 2 ? argument.slice(separator + 1) : "";
    if (!name || !value || Object.hasOwn(values, name)) {
      blocked("ARGUMENT_INVALID");
    }
    values[name] = value;
  }
  const mode = values["--mode"];
  const expectedNames = MODE_ARGUMENTS[mode];
  if (!expectedNames
      || Object.keys(values).length !== expectedNames.length
      || expectedNames.some((name) => !Object.hasOwn(values, name))
      || Object.keys(values).some((name) => !expectedNames.includes(name))
      || !COMMIT.test(values["--expected-commit"] ?? "")
      || !REMOTE_REF.test(values["--remote-ref"] ?? "")
      || values["--remote-ref"].includes("..")
      || values["--remote-ref"].includes("//")) {
    blocked("ARGUMENT_INVALID");
  }
  return { help: false, mode, values };
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

async function readBoundedRegularFile(path, maximumBytes, code) {
  const before = await lstat(path).catch(() => null);
  if (!before?.isFile()
      || before.isSymbolicLink()
      || before.size < 2
      || before.size > maximumBytes) {
    blocked(code);
  }
  const handle = await open(path, "r").catch(() => null);
  if (!handle) blocked(code);
  let opened;
  let bytes;
  try {
    opened = await handle.stat();
    const linked = await lstat(path).catch(() => null);
    if (!opened.isFile()
        || !linked?.isFile()
        || linked.isSymbolicLink()
        || !sameFile(before, opened)
        || !sameFile(opened, linked)) {
      blocked(code);
    }
    bytes = await handle.readFile();
    const after = await handle.stat();
    const linkedAfter = await lstat(path).catch(() => null);
    if (!linkedAfter?.isFile()
        || linkedAfter.isSymbolicLink()
        || !sameFile(opened, after)
        || !sameFile(after, linkedAfter)
        || bytes.length !== after.size
        || bytes.length < 2
        || bytes.length > maximumBytes) {
      blocked(code);
    }
  } finally {
    await handle.close().catch(() => {});
  }
  return bytes;
}

async function readBoundedOutsideJson(path, repoRoot, label) {
  if (!isAbsolute(path) || !path.toLowerCase().endsWith(".json")) {
    blocked("INPUT_PATH_INVALID", `${label} must be an absolute private JSON path`);
  }
  const [repoCanonical, parentCanonical, parentMetadata, originalBefore] = await Promise.all([
    realpath(repoRoot).catch(() => null),
    realpath(dirname(path)).catch(() => null),
    lstat(dirname(path)).catch(() => null),
    lstat(path).catch(() => null),
  ]);
  if (!repoCanonical
      || !parentCanonical
      || !parentMetadata?.isDirectory()
      || parentMetadata.isSymbolicLink()
      || !originalBefore?.isFile()
      || originalBefore.isSymbolicLink()
      || originalBefore.size < 2
      || originalBefore.size > MAX_INPUT_BYTES
      || inside(repoCanonical, parentCanonical)) {
    blocked("INPUT_PATH_INVALID", `${label} must be outside Git`);
  }
  const canonicalPath = await realpath(path).catch(() => null);
  if (!canonicalPath || resolve(dirname(canonicalPath)) !== resolve(parentCanonical)) {
    blocked("INPUT_PATH_INVALID", `${label} must resolve inside its private directory`);
  }
  const bytes = await readBoundedRegularFile(
    canonicalPath,
    MAX_INPUT_BYTES,
    "INPUT_RECEIPT_INVALID",
  );
  const [afterCanonical, originalAfter] = await Promise.all([
    realpath(path).catch(() => null),
    lstat(path).catch(() => null),
  ]);
  if (afterCanonical !== canonicalPath
      || !originalAfter?.isFile()
      || originalAfter.isSymbolicLink()
      || !sameFile(originalBefore, originalAfter)) {
    blocked("INPUT_RECEIPT_INVALID");
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    blocked("INPUT_RECEIPT_INVALID", `${label} is not valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    blocked("INPUT_RECEIPT_INVALID", `${label} must be one JSON object`);
  }
  return {
    value,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    parent: parentCanonical,
    path: canonicalPath,
  };
}

async function readPinnedTemplate(repoRoot, controllerManifest) {
  const relativePath = controllerManifest?.finalizationContract?.operation?.file;
  if (typeof relativePath !== "string"
      || relativePath.includes("\\")
      || relativePath.includes("//")) {
    blocked("PINNED_TEMPLATE_INVALID");
  }
  const path = resolve(repoRoot, relativePath);
  const repoCanonical = await realpath(repoRoot).catch(() => null);
  if (!repoCanonical || !inside(repoCanonical, path)) {
    blocked("PINNED_TEMPLATE_INVALID");
  }
  const bytes = await readBoundedRegularFile(
    path,
    64 * 1024,
    "PINNED_TEMPLATE_INVALID",
  );
  return bytes.toString("utf8");
}

async function defaultRunGit(repoRoot, args) {
  try {
    const result = await execFile("git", args, {
      cwd: repoRoot,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 128 * 1024,
      timeout: 30_000,
    });
    return String(result.stdout ?? "");
  } catch {
    blocked("GIT_CANDIDATE_UNAVAILABLE");
  }
}

export async function inspectSuccessorFinalizerGitCandidate({
  repoRoot,
  expectedCommit,
  remoteRef,
  runGit = defaultRunGit,
}) {
  const match = remoteRef.match(REMOTE_REF);
  if (!COMMIT.test(expectedCommit ?? "")
      || !match
      || match[1].includes("..")
      || match[1].includes("//")) {
    blocked("ARGUMENT_INVALID");
  }
  const branchRef = `refs/heads/${match[1]}`;
  const [status, head, upstream, upstreamName, remote] = await Promise.all([
    runGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
    runGit(repoRoot, ["rev-parse", "HEAD"]),
    runGit(repoRoot, ["rev-parse", "--verify", "@{upstream}"]),
    runGit(repoRoot, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]),
    runGit(repoRoot, ["ls-remote", "--exit-code", "origin", branchRef]),
  ]);
  const remoteLines = remote.trim().split(/\r?\n/).filter(Boolean);
  const [remoteCommit, returnedRef] = remoteLines.length === 1
    ? remoteLines[0].trim().split(/\s+/)
    : [];
  const gitState = {
    expectedCommit,
    actualCommit: head.trim(),
    upstreamCommit: upstream.trim(),
    remoteCommit,
    remoteRef,
    worktreeClean: status.length === 0,
  };
  if (gitState.actualCommit !== expectedCommit
      || gitState.upstreamCommit !== expectedCommit
      || gitState.remoteCommit !== expectedCommit
      || upstreamName.trim() !== remoteRef
      || returnedRef !== branchRef
      || gitState.worktreeClean !== true) {
    blocked("FINALIZER_RELEASE_COMMIT_NOT_PUSHED");
  }
  return gitState;
}

function outputParent(path) {
  return realpath(dirname(path)).catch(() => null);
}

async function assertOnePrivateSiblingSet(inputs, outputs) {
  const parents = new Set(inputs.map((input) => resolve(input.parent)));
  for (const path of outputs) {
    if (!isAbsolute(path) || !path.toLowerCase().endsWith(".json")) {
      blocked("INPUT_PATH_INVALID");
    }
    const parent = await outputParent(path);
    if (!parent) blocked("INPUT_PATH_INVALID");
    parents.add(resolve(parent));
  }
  if (parents.size !== 1) {
    blocked("INPUT_PATH_INVALID", "all artifacts must be one private sibling set");
  }
  const paths = [
    ...inputs.map((input) => resolve(input.path)),
    ...outputs.map((path) => resolve(path)),
  ];
  const identities = paths.map(
    (path) => process.platform === "win32" ? path.toLowerCase() : path,
  );
  if (new Set(identities).size !== identities.length) {
    blocked("INPUT_PATH_INVALID", "input and output artifact paths must be distinct");
  }
}

export async function runSuccessorFinalizerEvidenceCli({
  repoRoot: requestedRepoRoot,
  argv = [],
  loadReleaseContract = validateSuccessorReleaseContract,
  inspectGitCandidate = inspectSuccessorFinalizerGitCandidate,
  now = () => new Date(),
} = {}) {
  const parsed = parseArguments(argv);
  if (parsed.help) return { help: true };
  const repoRoot = resolve(requestedRepoRoot ?? resolve(import.meta.dirname, ".."));
  const release = await loadReleaseContract({ repoRoot });
  if (release?.deploymentBlocked !== false
      || release?.controllerReady !== true
      || !release.manifest
      || !release.controllerManifest) {
    blocked("SUCCESSOR_CONTROLLER_NOT_READY");
  }
  const values = parsed.values;
  const expectedCommit = values["--expected-commit"];
  const [owner, template, canary, featureOff, gitState, templateText] =
    await Promise.all([
      readBoundedOutsideJson(
        values["--owner-lease-receipt"], repoRoot, "owner lease receipt",
      ),
      readBoundedOutsideJson(
        values["--template-contract-receipt"], repoRoot, "template contract receipt",
      ),
      readBoundedOutsideJson(
        values["--canary-fence-receipt"], repoRoot, "canary fence receipt",
      ),
      readBoundedOutsideJson(
        values["--feature-off-receipt"], repoRoot, "feature-off receipt",
      ),
      inspectGitCandidate({
        repoRoot,
        expectedCommit,
        remoteRef: values["--remote-ref"],
      }),
      readPinnedTemplate(repoRoot, release.controllerManifest),
    ]);
  const baseInput = {
    manifest: release.manifest,
    controllerManifest: release.controllerManifest,
    expectedCommit,
    templateText,
    ownerLeaseReceipt: owner.value,
    templateContractReceipt: template.value,
    canaryFenceReceipt: canary.value,
    featureOffReceipt: featureOff.value,
    inputDigests: {
      ownerLeaseReceiptSha256: owner.sha256,
      templateContractReceiptSha256: template.sha256,
      canaryFenceReceiptSha256: canary.sha256,
      featureOffReceiptSha256: featureOff.sha256,
    },
    now,
  };
  const commonInputs = [owner, template, canary, featureOff];
  if (parsed.mode === "render-rehearsal") {
    const rehearsalOut = values["--dry-rehearsal-out"];
    await assertOnePrivateSiblingSet(commonInputs, [rehearsalOut]);
    const rehearsal = await emitSuccessorFinalizerRenderOnlyRehearsal({
      repoRoot,
      rehearsalOut,
      ...baseInput,
    });
    return { help: false, mode: parsed.mode, gitState, rehearsal };
  }
  const dry = await readBoundedOutsideJson(
    values["--dry-rehearsal-receipt"],
    repoRoot,
    "finalizer dry rehearsal receipt",
  );
  const rawOut = values["--raw-out"];
  const receiptOut = values["--receipt-out"];
  await assertOnePrivateSiblingSet([...commonInputs, dry], [rawOut, receiptOut]);
  const result = await emitSuccessorFinalizerEvidence({
    repoRoot,
    rawOut,
    receiptOut,
    ...baseInput,
    inputDigests: {
      ...baseInput.inputDigests,
      finalizerDryRehearsalSha256: dry.sha256,
    },
    finalizerDryRehearsal: dry.value,
    gitState,
  });
  return { help: false, mode: parsed.mode, ...result };
}

function usage() {
  return [
    "Render or emit successor Production-finalizer rehearsal evidence.",
    "The rehearsal is render-only: no database query and no Production mutation is performed.",
    "Modes: --mode=render-rehearsal or --mode=emit-evidence",
  ].join("\n");
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    const result = await runSuccessorFinalizerEvidenceCli({
      repoRoot: resolve(import.meta.dirname, ".."),
      argv: process.argv.slice(2),
    });
    process.stdout.write(result.help
      ? `${usage()}\n`
      : result.mode === "render-rehearsal"
        ? "SUCCESSOR_FINALIZER_REHEARSAL_RENDERED\n"
        : "SUCCESSOR_FINALIZER_EVIDENCE_EMITTED\n");
  } catch (error) {
    const code = error instanceof SuccessorFinalizerEvidenceError
      ? error.code
      : "UNEXPECTED";
    process.stderr.write(`SUCCESSOR_FINALIZER_EVIDENCE_BLOCKED [${code}]\n`);
    process.exitCode = 1;
  }
}
