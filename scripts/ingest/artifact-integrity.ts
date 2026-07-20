import { createHash, timingSafeEqual } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { mkdirDurably } from "./io.js";

export type ArtifactIntegrityErrorCode =
  | "artifact_path_outside_state"
  | "artifact_path_not_deterministic"
  | "artifact_path_reparse_point"
  | "artifact_not_regular_file"
  | "artifact_content_hash_missing"
  | "artifact_content_hash_invalid"
  | "artifact_content_hash_mismatch"
  | "path_hash_pair_incomplete"
  | "path_hash_pair_invalid";

export class ArtifactIntegrityError extends Error {
  readonly code: ArtifactIntegrityErrorCode;

  constructor(code: ArtifactIntegrityErrorCode, message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
    this.code = code;
  }
}

export interface DeterministicStateArtifactPathOptions {
  stateDir: string;
  artifactPath: string;
  expectedRelativePath: string;
}

function assertDeterministicLexicalPath(
  stateDir: string,
  artifactPath: string,
  expectedRelativePath: string,
): void {
  if (!isStrictChildPath(stateDir, artifactPath)) {
    throw new ArtifactIntegrityError(
      "artifact_path_outside_state",
      "artifact path must be a child of the ingest state directory",
    );
  }
  const expectedPath = path.resolve(stateDir, expectedRelativePath);
  if (!samePath(artifactPath, expectedPath)) {
    throw new ArtifactIntegrityError(
      "artifact_path_not_deterministic",
      "artifact path does not match the deterministic path for this artifact",
    );
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isStrictChildPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function rejectReparsePointsInArtifactPath(
  stateDir: string,
  stateRealPath: string,
  artifactPath: string,
): Promise<void> {
  const relativeSegments = path.relative(stateDir, artifactPath).split(path.sep);
  let currentPath = stateDir;
  let expectedRealPath = stateRealPath;
  for (const segment of ["", ...relativeSegments]) {
    if (segment !== "") {
      currentPath = path.join(currentPath, segment);
      expectedRealPath = path.join(expectedRealPath, segment);
    }
    const currentStat = await lstat(currentPath);
    if (currentStat.isSymbolicLink()) {
      throw new ArtifactIntegrityError(
        "artifact_path_reparse_point",
        "artifact path must not contain a symbolic link, junction, or reparse point",
      );
    }
    const currentRealPath = await realpath(currentPath);
    if (!samePath(expectedRealPath, currentRealPath)) {
      throw new ArtifactIntegrityError(
        "artifact_path_reparse_point",
        "artifact path must not resolve through a symbolic link, junction, or reparse point",
      );
    }
  }
}

export async function verifyDeterministicStateArtifactPath(
  options: DeterministicStateArtifactPathOptions,
): Promise<string> {
  const stateDir = path.resolve(options.stateDir);
  const artifactPath = path.resolve(options.artifactPath);
  assertDeterministicLexicalPath(stateDir, artifactPath, options.expectedRelativePath);
  const [stateRealPath, artifactRealPath] = await Promise.all([
    realpath(stateDir),
    realpath(artifactPath),
  ]);
  if (!isStrictChildPath(stateRealPath, artifactRealPath)) {
    throw new ArtifactIntegrityError(
      "artifact_path_outside_state",
      "artifact real path must remain inside the ingest state directory",
    );
  }
  await rejectReparsePointsInArtifactPath(stateDir, stateRealPath, artifactPath);
  const artifactStat = await lstat(artifactPath);
  if (artifactStat.isSymbolicLink()) {
    throw new ArtifactIntegrityError(
      "artifact_path_reparse_point",
      "artifact path must not be a symbolic link or reparse point",
    );
  }
  if (!artifactStat.isFile()) {
    throw new ArtifactIntegrityError(
      "artifact_not_regular_file",
      "artifact path must identify a regular file",
    );
  }
  return artifactRealPath;
}

/**
 * Creates only missing deterministic parent directories and rejects every
 * symlink/junction/reparse component before a content-addressed artifact write.
 */
export async function prepareDeterministicStateArtifactWritePath(
  options: DeterministicStateArtifactPathOptions,
): Promise<string> {
  const stateDir = path.resolve(options.stateDir);
  const artifactPath = path.resolve(options.artifactPath);
  assertDeterministicLexicalPath(stateDir, artifactPath, options.expectedRelativePath);
  const stateStat = await lstat(stateDir);
  if (stateStat.isSymbolicLink()) {
    throw new ArtifactIntegrityError(
      "artifact_path_reparse_point",
      "ingest state directory must not be a symbolic link, junction, or reparse point",
    );
  }
  if (!stateStat.isDirectory()) {
    throw new ArtifactIntegrityError(
      "artifact_not_regular_file",
      "ingest state path must be a directory",
    );
  }
  const stateRealPath = await realpath(stateDir);
  let currentPath = stateDir;
  let expectedRealPath = stateRealPath;
  const parentRelative = path.relative(stateDir, path.dirname(artifactPath));
  for (const segment of parentRelative.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    expectedRealPath = path.join(expectedRealPath, segment);
    await mkdirDurably(currentPath);
    const currentStat = await lstat(currentPath);
    if (currentStat.isSymbolicLink()) {
      throw new ArtifactIntegrityError(
        "artifact_path_reparse_point",
        "artifact write path must not contain a symbolic link, junction, or reparse point",
      );
    }
    if (!currentStat.isDirectory()) {
      throw new ArtifactIntegrityError(
        "artifact_not_regular_file",
        "artifact write parent must be a directory",
      );
    }
    const currentRealPath = await realpath(currentPath);
    if (!samePath(expectedRealPath, currentRealPath)) {
      throw new ArtifactIntegrityError(
        "artifact_path_reparse_point",
        "artifact write path resolved through a symbolic link, junction, or reparse point",
      );
    }
  }
  return artifactPath;
}

function canonicalJsonValue(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON requires finite numbers");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError(`canonical JSON does not support ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError("canonical JSON does not support circular values");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalJsonValue(entry, ancestors)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON requires plain objects");
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonSha256ExcludingField(
  payload: Readonly<Record<string, unknown>>,
  hashField: string,
): string {
  if (hashField.length === 0) throw new TypeError("hash field must not be empty");
  const payloadWithoutHash = Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== hashField),
  );
  const canonicalJson = canonicalJsonValue(payloadWithoutHash, new WeakSet<object>());
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function verifyJsonContentHash(
  payload: Readonly<Record<string, unknown>>,
  hashField: string,
): string {
  if (!Object.hasOwn(payload, hashField)) {
    throw new ArtifactIntegrityError(
      "artifact_content_hash_missing",
      `artifact content hash field is missing: ${hashField}`,
    );
  }
  const expectedHash = payload[hashField];
  if (typeof expectedHash !== "string" || !SHA256_PATTERN.test(expectedHash)) {
    throw new ArtifactIntegrityError(
      "artifact_content_hash_invalid",
      `artifact content hash must be a lowercase SHA-256 digest: ${hashField}`,
    );
  }
  const actualHash = canonicalJsonSha256ExcludingField(payload, hashField);
  if (!timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(actualHash, "hex"))) {
    throw new ArtifactIntegrityError(
      "artifact_content_hash_mismatch",
      `artifact content hash does not match its canonical payload: ${hashField}`,
    );
  }
  return actualHash;
}

export interface StrictPathHashPairOptions {
  artifactPath?: string | null;
  expectedSha256?: string | null;
  label: string;
}

export interface StrictPathHashPair {
  artifactPath: string;
  expectedSha256: string;
}

export function requireStrictPathHashPair(
  options: StrictPathHashPairOptions,
): StrictPathHashPair | null {
  const artifactPath = options.artifactPath;
  const expectedSha256 = options.expectedSha256;
  if (artifactPath == null && expectedSha256 == null) return null;
  if (artifactPath == null || expectedSha256 == null) {
    throw new ArtifactIntegrityError(
      "path_hash_pair_incomplete",
      `${options.label} path and expected SHA-256 must be provided together`,
    );
  }
  if (
    artifactPath.trim().length === 0
    || artifactPath.includes("\0")
    || !SHA256_PATTERN.test(expectedSha256)
  ) {
    throw new ArtifactIntegrityError(
      "path_hash_pair_invalid",
      `${options.label} path/hash pair must contain a non-empty path and lowercase SHA-256 digest`,
    );
  }
  return {
    artifactPath,
    expectedSha256,
  };
}
