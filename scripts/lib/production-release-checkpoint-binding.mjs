import { createHash } from "node:crypto";

export const SUCCESSOR_RELEASE_CHECKPOINT_BINDING_VERSION = 1;

const SHA256 = /^[a-f0-9]{64}$/i;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const RELEASE = /^[a-z0-9][a-z0-9.-]{2,127}$/;
const MAX_ORIGINAL_BACKUP_AGE_MS = 30 * 60 * 1000;

function requireSha256(value, name) {
  if (!SHA256.test(value ?? "")) {
    throw new TypeError(`${name} must be one SHA-256 digest`);
  }
  return value.toLowerCase();
}

function requireBoundInstant(value, name, { javascriptCanonical = false } = {}) {
  const milliseconds = Date.parse(value ?? "");
  if (typeof value !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(milliseconds)
      || (javascriptCanonical && new Date(milliseconds).toISOString() !== value)) {
    throw new TypeError(`${name} must be one canonical UTC instant`);
  }
  return milliseconds;
}

export function computeSuccessorReleaseCheckpointBindingSha256(components) {
  if (components?.version !== SUCCESSOR_RELEASE_CHECKPOINT_BINDING_VERSION
      || !RELEASE.test(components.release ?? "")
      || !PROJECT_REF.test(components.projectRef ?? "")
      || !COMMIT.test(components.expectedCommit ?? "")) {
    throw new TypeError("successor checkpoint identity is invalid");
  }
  const sourceCapturedAtMs = requireBoundInstant(
    components.backupSourceCapturedAt,
    "backupSourceCapturedAt",
  );
  const startedAtMs = requireBoundInstant(
    components.startedAt,
    "startedAt",
    { javascriptCanonical: true },
  );
  if (sourceCapturedAtMs > startedAtMs
      || startedAtMs - sourceCapturedAtMs > MAX_ORIGINAL_BACKUP_AGE_MS) {
    throw new RangeError(
      "the original successor backup must have been captured no more than 30 minutes before startedAt",
    );
  }
  const values = {
    outcomeReceiptPathSha256: requireSha256(
      components.outcomeReceiptPathSha256,
      "outcomeReceiptPathSha256",
    ),
    backupReceiptSha256: requireSha256(
      components.backupReceiptSha256,
      "backupReceiptSha256",
    ),
    backupDirectoryPathSha256: requireSha256(
      components.backupDirectoryPathSha256,
      "backupDirectoryPathSha256",
    ),
    backupArtifactSetSha256: requireSha256(
      components.backupArtifactSetSha256,
      "backupArtifactSetSha256",
    ),
    writeFenceEvidenceSha256: requireSha256(
      components.writeFenceEvidenceSha256,
      "writeFenceEvidenceSha256",
    ),
    preApplySuccessorRuntimeEvidenceSetSha256: requireSha256(
      components.preApplySuccessorRuntimeEvidenceSetSha256,
      "preApplySuccessorRuntimeEvidenceSetSha256",
    ),
  };
  const canonical = [
    "hanbang-successor-release-checkpoint-binding-v1",
    `release:${components.release}`,
    `projectRef:${components.projectRef}`,
    `expectedCommit:${components.expectedCommit}`,
    `outcomeReceiptPathSha256:${values.outcomeReceiptPathSha256}`,
    `backupReceiptSha256:${values.backupReceiptSha256}`,
    `backupDirectoryPathSha256:${values.backupDirectoryPathSha256}`,
    `backupArtifactSetSha256:${values.backupArtifactSetSha256}`,
    `backupSourceCapturedAt:${components.backupSourceCapturedAt}`,
    `startedAt:${components.startedAt}`,
    `writeFenceEvidenceSha256:${values.writeFenceEvidenceSha256}`,
    `preApplySuccessorRuntimeEvidenceSetSha256:${values.preApplySuccessorRuntimeEvidenceSetSha256}`,
    "",
  ].join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
