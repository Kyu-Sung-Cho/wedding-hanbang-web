import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAFE_BUNDLE_PATH_PATTERN = /^artifacts\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/u;
const FORBIDDEN_SECRET_KEY_PATTERN = /(?:^|_)(?:api_?key|key|token|env|secret|password)(?:$|_)/iu;
const FORBIDDEN_SECRET_VALUE_PATTERN = /(?:\bsk-[A-Za-z0-9_-]{12,}|\bghp_[A-Za-z0-9]{12,}|\bgithub_pat_[A-Za-z0-9_]{12,}|\bservice[_-]?role\b|\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\b(?:OPENAI|SUPABASE)_[A-Z0-9_]+\s*=|process\.env)/iu;
const FORBIDDEN_URL_PATTERN = /(?:https?|file|ftp):\/\/|\bwww\./iu;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const EMBEDDED_WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:^|[=;:\s"'([{])(?:[A-Za-z]:[\\/]|\\\\)/u;
const EMBEDDED_POSIX_ABSOLUTE_PATH_PATTERN = /(?:^|[=;:\s"'([{])\/(?:Users|home|tmp|var|etc|opt|private|mnt|Volumes)\//u;
const EMBEDDED_RELATIVE_TRAVERSAL_PATTERN = /(?:^|[=;:\s"'([{])\.\.[\\/]/u;
const PATH_VALUE_KEY_PATTERN = /(?:^|_)(?:path|paths)$/iu;
const MATERIALIZED_ROLES = new Set<BundleArtifactRole>([
  "source_visual_overlay_v2",
  "canonical_visual_overlay_v3",
  "eileen_visual_transcription_sidecar",
  "may_visual_transcription_sidecar",
]);
const EXPECTED_ROLES = new Set<BundleArtifactRole>([
  "source_object_manifest",
  "manual_pilot_source_money_ground_truth",
  "fixed_eight_adjudication_v3",
  "source_visual_overlay_v2",
  "canonical_visual_overlay_v3",
  "fixed_eight_build_report",
  "eileen_visual_transcription_sidecar",
  "may_visual_transcription_sidecar",
]);
const EXPECTED_SCHEMA_IDS: Record<BundleArtifactRole, string> = {
  source_object_manifest: "vendor-disclosure-source-object-manifest/v1",
  manual_pilot_source_money_ground_truth: "manual-pilot-source-money-ground-truth/v1",
  fixed_eight_adjudication_v3: "fixed-eight-ground-truth-adjudication/v3",
  source_visual_overlay_v2: "fixed-eight-visual-ground-truth-overlay/v2",
  canonical_visual_overlay_v3: "fixed-eight-canonical-visual-overlay/v3",
  fixed_eight_build_report: "fixed-eight-ground-truth-build-report/v1-sanitized",
  eileen_visual_transcription_sidecar: "visual-transcription-sidecar/v1",
  may_visual_transcription_sidecar: "visual-transcription-sidecar/v1",
};

type JsonObject = Record<string, unknown>;
type BundleArtifactRole =
  | "source_object_manifest"
  | "manual_pilot_source_money_ground_truth"
  | "fixed_eight_adjudication_v3"
  | "source_visual_overlay_v2"
  | "canonical_visual_overlay_v3"
  | "fixed_eight_build_report"
  | "eileen_visual_transcription_sidecar"
  | "may_visual_transcription_sidecar";

interface BoundSourceFile {
  path: string;
  ext: string;
  sha256: string;
  bytes: number;
}

interface BoundSourceUnit {
  unit_id: string;
  source_fingerprint: string;
  source_files: BoundSourceFile[];
}

interface SourceObjectManifest extends JsonObject {
  schema_version: 1;
  artifact_kind: "vendor_disclosure_source_object_manifest";
  content_sha256: string;
  ordered_binding_sha256: string;
  unit_count: number;
  source_object_count: number;
  units: BoundSourceUnit[];
}

interface BundleArtifactDescriptor extends JsonObject {
  role: BundleArtifactRole;
  relative_path: string;
  sha256: string;
  bytes: number;
  schema_id: string;
  counts: Record<string, number>;
  materialize: boolean;
  content_sha256?: string;
  unit_id?: string;
  source_fingerprint?: string;
}

interface EvidenceBundleManifest extends JsonObject {
  schema_version: 1;
  artifact_kind: "vendor_disclosure_evidence_bundle_manifest";
  content_sha256: string;
  bundle_name: "vendor-disclosure-v2";
  source_overlay_sha256: string;
  ground_truth_occurrence_count: number;
  artifact_total_bytes: number;
  source_inventory: {
    relative_path: string;
    content_sha256: string;
    ordered_binding_sha256: string;
    unit_count: number;
    source_object_count: number;
  };
  sidecars: Array<{
    role: "eileen_visual_transcription_sidecar" | "may_visual_transcription_sidecar";
    unit_id: string;
    source_fingerprint: string;
    content_sha256: string;
    file_sha256: string;
    bytes: number;
  }>;
  artifacts: BundleArtifactDescriptor[];
}

interface VerifiedArtifactInternal {
  descriptor: BundleArtifactDescriptor;
  json: JsonObject;
  bytes: Buffer;
}

interface VerifiedBundleInternal {
  manifest: EvidenceBundleManifest;
  sourceManifest: SourceObjectManifest;
  artifacts: VerifiedArtifactInternal[];
}

export interface VerifyVendorDisclosureEvidenceBundleOptions {
  bundleDir: string;
  currentScanManifestPath: string;
  /** SHA-256 pinned by a signed Git commit or signed release outside the bundle. */
  expectedBundleContentSha256: string;
}

export interface VerifiedVendorDisclosureEvidenceBundle {
  bundleContentSha256: string;
  sourceUnitCount: number;
  sourceObjectCount: number;
  groundTruthOccurrenceCount: number;
  artifactTotalBytes: number;
  artifacts: Array<{
    role: BundleArtifactRole;
    sha256: string;
    bytes: number;
    materialize: boolean;
  }>;
}

export interface RestoreVendorDisclosureEvidenceBundleOptions
  extends VerifyVendorDisclosureEvidenceBundleOptions {
  stateDir: string;
}

export interface RestoredVendorDisclosureEvidenceBundle {
  bundleContentSha256: string;
  targetDirectory: string;
  materializedArtifacts: Array<{
    role: BundleArtifactRole;
    path: string;
    aliasPath: string;
    sha256: string;
    bytes: number;
  }>;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireString(value, label);
  if (!SHA256_PATTERN.test(digest)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
  return digest;
}

function requireCount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
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
    const record = value as JsonObject;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key], ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalJsonSha256(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJsonValue(value, new WeakSet<object>()), "utf8")
    .digest("hex");
}

export function canonicalJsonSha256ExcludingField(
  payload: Readonly<Record<string, unknown>>,
  hashField: string,
): string {
  if (hashField.length === 0) throw new TypeError("hash field must not be empty");
  return canonicalJsonSha256(Object.fromEntries(
    Object.entries(payload).filter(([key]) => key !== hashField),
  ));
}

function sha256Bytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertSelfHash(payload: JsonObject, label: string): string {
  const expected = requireSha256(payload.content_sha256, `${label}.content_sha256`);
  const actual = canonicalJsonSha256ExcludingField(payload, "content_sha256");
  if (actual !== expected) throw new Error(`${label} canonical content SHA-256 mismatch`);
  return actual;
}

function assertNoForbiddenEvidenceContent(value: unknown, jsonPath = "$", key?: string): void {
  if (key !== undefined && FORBIDDEN_SECRET_KEY_PATTERN.test(key)) {
    throw new Error(`forbidden secret-shaped key at ${jsonPath}`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenEvidenceContent(entry, `${jsonPath}[${index}]`));
    return;
  }
  if (isJsonObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      assertNoForbiddenEvidenceContent(childValue, `${jsonPath}.${childKey}`, childKey);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (FORBIDDEN_URL_PATTERN.test(value)) throw new Error(`forbidden URL at ${jsonPath}`);
  if (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
    || EMBEDDED_WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
    || value.startsWith("/")
    || EMBEDDED_POSIX_ABSOLUTE_PATH_PATTERN.test(value)
  ) {
    throw new Error(`forbidden absolute path at ${jsonPath}`);
  }
  if (
    key !== undefined
    && PATH_VALUE_KEY_PATTERN.test(key)
    && EMBEDDED_RELATIVE_TRAVERSAL_PATTERN.test(value)
  ) {
    throw new Error(`forbidden relative path traversal at ${jsonPath}`);
  }
  if (FORBIDDEN_SECRET_VALUE_PATTERN.test(value)) {
    throw new Error(`forbidden secret-shaped value at ${jsonPath}`);
  }
}

function assertSafeSourceRelativePath(value: string, label: string): void {
  if (
    value.includes("\\")
    || value.includes("\0")
    || value.startsWith("/")
    || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
    || FORBIDDEN_URL_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be a safe source-relative path`);
  }
  const segments = value.split("/");
  if (
    segments.length === 0
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")
    || path.posix.normalize(value) !== value
  ) {
    throw new Error(`${label} must be a safe source-relative path`);
  }
}

function assertSafeBundleRelativePath(value: string, label: string): void {
  if (
    !SAFE_BUNDLE_PATH_PATTERN.test(value)
    || value.includes("\\")
    || value.includes("\0")
    || value.split("/").some((segment) => segment === "." || segment === "..")
    || path.posix.normalize(value) !== value
    || /(?:^|\/)(?:raw|images?|cache|\.cache|\.converted)(?:\/|$)/iu.test(value)
  ) {
    throw new Error(`${label} must be a safe bundle-relative path`);
  }
}

function parseBoundSourceFiles(value: unknown, label: string): BoundSourceFile[] {
  return requireArray(value, label).map((entry, index) => {
    const source = requireObject(entry, `${label}[${index}]`);
    const sourcePath = requireString(source.path, `${label}[${index}].path`);
    assertSafeSourceRelativePath(sourcePath, `${label}[${index}].path`);
    const ext = requireString(source.ext, `${label}[${index}].ext`).toLowerCase();
    if (!/^[a-z0-9]{1,10}$/u.test(ext) || !sourcePath.toLowerCase().endsWith(`.${ext}`)) {
      throw new Error(`${label}[${index}].ext must match the source path extension`);
    }
    return {
      path: sourcePath,
      ext,
      sha256: requireSha256(source.sha256, `${label}[${index}].sha256`),
      bytes: requireCount(source.bytes, `${label}[${index}].bytes`),
    };
  });
}

function parseBoundSourceUnits(value: unknown, label: string): BoundSourceUnit[] {
  const unitIds = new Set<string>();
  return requireArray(value, label).map((entry, index) => {
    const unit = requireObject(entry, `${label}[${index}]`);
    const unitId = requireSha256(unit.unit_id, `${label}[${index}].unit_id`);
    if (unitIds.has(unitId)) throw new Error(`${label} contains duplicate unit_id ${unitId}`);
    unitIds.add(unitId);
    return {
      unit_id: unitId,
      source_fingerprint: requireSha256(
        unit.source_fingerprint,
        `${label}[${index}].source_fingerprint`,
      ),
      source_files: parseBoundSourceFiles(unit.source_files, `${label}[${index}].source_files`),
    };
  });
}

function parseSourceObjectManifest(value: JsonObject): SourceObjectManifest {
  if (value.schema_version !== 1 || value.artifact_kind !== "vendor_disclosure_source_object_manifest") {
    throw new Error("source object manifest schema identity mismatch");
  }
  assertSelfHash(value, "source object manifest");
  const units = parseBoundSourceUnits(value.units, "source object manifest.units");
  const sourceObjectCount = units.reduce((sum, unit) => sum + unit.source_files.length, 0);
  if (requireCount(value.unit_count, "source object manifest.unit_count") !== units.length) {
    throw new Error("source object manifest unit_count mismatch");
  }
  if (
    requireCount(value.source_object_count, "source object manifest.source_object_count")
    !== sourceObjectCount
  ) {
    throw new Error("source object manifest source_object_count mismatch");
  }
  const orderedBindingSha256 = requireSha256(
    value.ordered_binding_sha256,
    "source object manifest.ordered_binding_sha256",
  );
  if (orderedBindingSha256 !== canonicalJsonSha256(units)) {
    throw new Error("source object manifest ordered binding SHA-256 mismatch");
  }
  return value as SourceObjectManifest;
}

function parseArtifactDescriptor(value: unknown, index: number): BundleArtifactDescriptor {
  const artifact = requireObject(value, `bundle manifest.artifacts[${index}]`);
  const role = requireString(artifact.role, `bundle manifest.artifacts[${index}].role`);
  if (!EXPECTED_ROLES.has(role as BundleArtifactRole)) {
    throw new Error(`bundle manifest contains unexpected artifact role: ${role}`);
  }
  const relativePath = requireString(
    artifact.relative_path,
    `bundle manifest.artifacts[${index}].relative_path`,
  );
  assertSafeBundleRelativePath(relativePath, `bundle manifest.artifacts[${index}].relative_path`);
  const counts = requireObject(artifact.counts, `bundle manifest.artifacts[${index}].counts`);
  for (const [countName, count] of Object.entries(counts)) {
    requireCount(count, `bundle manifest.artifacts[${index}].counts.${countName}`);
  }
  const materialize = artifact.materialize;
  if (typeof materialize !== "boolean") {
    throw new Error(`bundle manifest.artifacts[${index}].materialize must be boolean`);
  }
  if (materialize !== MATERIALIZED_ROLES.has(role as BundleArtifactRole)) {
    throw new Error(`bundle manifest materialization policy mismatch for ${role}`);
  }
  const schemaId = requireString(
    artifact.schema_id,
    `bundle manifest.artifacts[${index}].schema_id`,
  );
  if (schemaId !== EXPECTED_SCHEMA_IDS[role as BundleArtifactRole]) {
    throw new Error(`bundle manifest schema_id mismatch for ${role}`);
  }
  return {
    ...artifact,
    role: role as BundleArtifactRole,
    relative_path: relativePath,
    sha256: requireSha256(artifact.sha256, `bundle manifest.artifacts[${index}].sha256`),
    bytes: requireCount(artifact.bytes, `bundle manifest.artifacts[${index}].bytes`),
    schema_id: schemaId,
    counts: counts as Record<string, number>,
    materialize,
  };
}

function parseBundleManifest(value: JsonObject): EvidenceBundleManifest {
  if (
    value.schema_version !== 1
    || value.artifact_kind !== "vendor_disclosure_evidence_bundle_manifest"
    || value.bundle_name !== "vendor-disclosure-v2"
  ) {
    throw new Error("evidence bundle manifest schema identity mismatch");
  }
  assertSelfHash(value, "evidence bundle manifest");
  assertNoForbiddenEvidenceContent(value);
  const descriptors = requireArray(value.artifacts, "bundle manifest.artifacts")
    .map(parseArtifactDescriptor);
  if (descriptors.length !== EXPECTED_ROLES.size) {
    throw new Error("bundle manifest must contain exactly the required seven artifacts");
  }
  const roles = new Set(descriptors.map(({ role }) => role));
  const paths = new Set(descriptors.map(({ relative_path }) => relative_path));
  if (roles.size !== EXPECTED_ROLES.size || paths.size !== descriptors.length) {
    throw new Error("bundle manifest artifact roles and paths must be unique");
  }
  for (const role of EXPECTED_ROLES) {
    if (!roles.has(role)) throw new Error(`bundle manifest is missing artifact role ${role}`);
  }
  const sourceInventory = requireObject(value.source_inventory, "bundle manifest.source_inventory");
  const sourceInventoryPath = requireString(
    sourceInventory.relative_path,
    "bundle manifest.source_inventory.relative_path",
  );
  assertSafeBundleRelativePath(sourceInventoryPath, "bundle manifest.source_inventory.relative_path");
  const sourceDescriptor = descriptors.find(({ role }) => role === "source_object_manifest");
  if (!sourceDescriptor || sourceDescriptor.relative_path !== sourceInventoryPath) {
    throw new Error("bundle source inventory path does not match its artifact descriptor");
  }
  const artifactTotalBytes = descriptors.reduce((sum, artifact) => sum + artifact.bytes, 0);
  if (requireCount(value.artifact_total_bytes, "bundle manifest.artifact_total_bytes") !== artifactTotalBytes) {
    throw new Error("bundle manifest artifact_total_bytes mismatch");
  }
  return {
    ...value,
    content_sha256: requireSha256(value.content_sha256, "bundle manifest.content_sha256"),
    source_overlay_sha256: requireSha256(
      value.source_overlay_sha256,
      "bundle manifest.source_overlay_sha256",
    ),
    ground_truth_occurrence_count: requireCount(
      value.ground_truth_occurrence_count,
      "bundle manifest.ground_truth_occurrence_count",
    ),
    artifact_total_bytes: artifactTotalBytes,
    source_inventory: {
      relative_path: sourceInventoryPath,
      content_sha256: requireSha256(
        sourceInventory.content_sha256,
        "bundle manifest.source_inventory.content_sha256",
      ),
      ordered_binding_sha256: requireSha256(
        sourceInventory.ordered_binding_sha256,
        "bundle manifest.source_inventory.ordered_binding_sha256",
      ),
      unit_count: requireCount(sourceInventory.unit_count, "bundle manifest.source_inventory.unit_count"),
      source_object_count: requireCount(
        sourceInventory.source_object_count,
        "bundle manifest.source_inventory.source_object_count",
      ),
    },
    sidecars: requireArray(value.sidecars, "bundle manifest.sidecars") as EvidenceBundleManifest["sidecars"],
    artifacts: descriptors,
  } as EvidenceBundleManifest;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJsonValue(left, new WeakSet<object>()) === canonicalJsonValue(right, new WeakSet<object>());
}

function assertDescriptorCounts(
  descriptor: BundleArtifactDescriptor,
  expected: Record<string, number>,
): void {
  if (!sameJson(descriptor.counts, expected)) {
    throw new Error(`${descriptor.role} descriptor counts mismatch`);
  }
}

function arrayLength(value: unknown, label: string): number {
  return requireArray(value, label).length;
}

function validateGroundTruth(
  payload: JsonObject,
  descriptor: BundleArtifactDescriptor,
  sourceManifest: SourceObjectManifest,
  expectedOccurrenceCount: number,
): void {
  const units = requireArray(payload.units, "manual ground truth.units");
  const sourcesByUnit = new Map(sourceManifest.units.map((unit) => [unit.unit_id, unit]));
  let occurrenceCount = 0;
  for (const [index, entry] of units.entries()) {
    const unit = requireObject(entry, `manual ground truth.units[${index}]`);
    const unitId = requireSha256(unit.unit_id, `manual ground truth.units[${index}].unit_id`);
    const boundUnit = sourcesByUnit.get(unitId);
    if (!boundUnit) throw new Error(`manual ground truth unit is not present in source inventory: ${unitId}`);
    const sourcePaths = requireArray(unit.source_paths, `manual ground truth.units[${index}].source_paths`)
      .map((sourcePath, sourceIndex) => {
        const relativePath = requireString(
          sourcePath,
          `manual ground truth.units[${index}].source_paths[${sourceIndex}]`,
        );
        assertSafeSourceRelativePath(
          relativePath,
          `manual ground truth.units[${index}].source_paths[${sourceIndex}]`,
        );
        return relativePath;
      });
    if (!sameJson(sourcePaths, boundUnit.source_files.map((source) => source.path))) {
      throw new Error(`manual ground truth source binding mismatch for unit ${unitId}`);
    }
    const candidates = requireArray(unit.candidates, `manual ground truth.units[${index}].candidates`);
    const candidateCount = requireCount(
      unit.candidate_count,
      `manual ground truth.units[${index}].candidate_count`,
    );
    if (candidateCount !== candidates.length) {
      throw new Error(`manual ground truth candidate_count mismatch for unit ${unitId}`);
    }
    occurrenceCount += candidates.length;
  }
  if (occurrenceCount !== expectedOccurrenceCount) {
    throw new Error("manual ground truth occurrence count mismatch");
  }
  assertDescriptorCounts(descriptor, {
    unit_count: units.length,
    occurrence_count: occurrenceCount,
  });
}

function validateAdjudication(payload: JsonObject, descriptor: BundleArtifactDescriptor): void {
  if (payload.schema_version !== 1) throw new Error("adjudication-v3 schema mismatch");
  const decisions = arrayLength(payload.decisions, "adjudication-v3.decisions");
  assertDescriptorCounts(descriptor, { decision_count: decisions });
}

function validateOverlay(
  payload: JsonObject,
  descriptor: BundleArtifactDescriptor,
  manifest: EvidenceBundleManifest,
  sourceManifest: SourceObjectManifest,
): void {
  if (payload.schema_version !== 1 || payload.artifact_kind !== "derived_visual_ground_truth_overlay") {
    throw new Error("canonical visual overlay-v3 schema mismatch");
  }
  const contentSha256 = assertSelfHash(payload, "canonical visual overlay-v3");
  if (descriptor.content_sha256 !== contentSha256) {
    throw new Error("canonical visual overlay-v3 descriptor content SHA-256 mismatch");
  }
  if (payload.source_overlay_sha256 !== manifest.source_overlay_sha256) {
    throw new Error("canonical visual overlay-v3 source overlay SHA-256 mismatch");
  }
  if (payload.source_overlay_relative_path !== "fixed-eight-ground-truth-overlay-v2.json") {
    throw new Error("canonical visual overlay-v3 source overlay relative path mismatch");
  }
  const locatorMigration = requireObject(payload.locator_migration, "overlay-v3.locator_migration");
  const overlay = requireObject(payload.overlay, "overlay-v3.overlay");
  const units = requireArray(overlay.units, "overlay-v3.overlay.units");
  const sourceUnitIds = new Set(sourceManifest.units.map(({ unit_id }) => unit_id));
  for (const [index, entry] of units.entries()) {
    const unit = requireObject(entry, `overlay-v3.overlay.units[${index}]`);
    const unitId = requireSha256(unit.unit_id, `overlay-v3.overlay.units[${index}].unit_id`);
    if (!sourceUnitIds.has(unitId)) throw new Error(`overlay-v3 unit is absent from source inventory: ${unitId}`);
  }
  assertDescriptorCounts(descriptor, {
    unit_count: units.length,
    transformed_locator_count: requireCount(
      locatorMigration.transformed_locator_count,
      "overlay-v3.locator_migration.transformed_locator_count",
    ),
    transformed_unit_count: requireCount(
      locatorMigration.transformed_unit_count,
      "overlay-v3.locator_migration.transformed_unit_count",
    ),
  });
}

function validateSourceOverlay(
  payload: JsonObject,
  descriptor: BundleArtifactDescriptor,
  manifest: EvidenceBundleManifest,
  sourceManifest: SourceObjectManifest,
): void {
  if (payload.schema_version !== 1) throw new Error("source visual overlay-v2 schema mismatch");
  if (descriptor.sha256 !== manifest.source_overlay_sha256) {
    throw new Error("source visual overlay-v2 file SHA-256 mismatch");
  }
  const units = requireArray(payload.units, "source visual overlay-v2.units");
  const sourceUnitIds = new Set(sourceManifest.units.map(({ unit_id }) => unit_id));
  let readableOccurrenceCount = 0;
  let unreadableCellCount = 0;
  for (const [index, entry] of units.entries()) {
    const unit = requireObject(entry, `source visual overlay-v2.units[${index}]`);
    const unitId = requireSha256(unit.unit_id, `source visual overlay-v2.units[${index}].unit_id`);
    if (!sourceUnitIds.has(unitId)) {
      throw new Error(`source visual overlay-v2 unit is absent from source inventory: ${unitId}`);
    }
    readableOccurrenceCount += arrayLength(
      unit.readable_occurrences,
      `source visual overlay-v2.units[${index}].readable_occurrences`,
    );
    unreadableCellCount += arrayLength(
      unit.unreadable_cells,
      `source visual overlay-v2.units[${index}].unreadable_cells`,
    );
  }
  assertDescriptorCounts(descriptor, {
    unit_count: units.length,
    readable_occurrence_count: readableOccurrenceCount,
    unreadable_cell_count: unreadableCellCount,
  });
}

function validateBuildReport(payload: JsonObject, descriptor: BundleArtifactDescriptor): void {
  if (payload.schema_version !== 1) throw new Error("fixed-eight build report schema mismatch");
  const inputs = requireObject(payload.immutable_inputs, "fixed-eight build report.immutable_inputs");
  const outputs = requireObject(payload.outputs, "fixed-eight build report.outputs");
  const pathRecords = [
    requireObject(inputs.base_ground_truth, "fixed-eight build report base_ground_truth"),
    requireObject(inputs.legacy_overlay, "fixed-eight build report legacy_overlay"),
    requireObject(outputs.corrected_overlay, "fixed-eight build report corrected_overlay"),
    requireObject(outputs.adjudication, "fixed-eight build report adjudication"),
  ];
  for (const [index, record] of pathRecords.entries()) {
    const relativePath = requireString(record.path, `fixed-eight build report path[${index}]`);
    assertSafeSourceRelativePath(relativePath, `fixed-eight build report path[${index}]`);
    if (relativePath.includes("/")) {
      throw new Error("fixed-eight build report paths must be secret-stripped file names");
    }
  }
  const gates = requireObject(payload.gate_counts, "fixed-eight build report.gate_counts");
  assertDescriptorCounts(descriptor, {
    effective_text_occurrences: requireCount(
      gates.effective_text_occurrences,
      "fixed-eight build report.gate_counts.effective_text_occurrences",
    ),
    image_readable_occurrences: requireCount(
      gates.image_readable_occurrences,
      "fixed-eight build report.gate_counts.image_readable_occurrences",
    ),
    fixed_eight_readable_occurrences: requireCount(
      gates.fixed_eight_readable_occurrences,
      "fixed-eight build report.gate_counts.fixed_eight_readable_occurrences",
    ),
  });
}

function validateSidecar(
  payload: JsonObject,
  descriptor: BundleArtifactDescriptor,
  manifest: EvidenceBundleManifest,
  sourceManifest: SourceObjectManifest,
  overlay: JsonObject,
): void {
  if (payload.schema_version !== 1 || payload.artifact_kind !== "visual_transcription_sidecar") {
    throw new Error(`${descriptor.role} schema mismatch`);
  }
  const contentSha256 = assertSelfHash(payload, descriptor.role);
  if (descriptor.content_sha256 !== contentSha256) {
    throw new Error(`${descriptor.role} descriptor content SHA-256 mismatch`);
  }
  const unitId = requireSha256(payload.unit_id, `${descriptor.role}.unit_id`);
  const sourceFingerprint = requireSha256(
    payload.source_fingerprint,
    `${descriptor.role}.source_fingerprint`,
  );
  if (descriptor.unit_id !== unitId || descriptor.source_fingerprint !== sourceFingerprint) {
    throw new Error(`${descriptor.role} descriptor source binding mismatch`);
  }
  const sourceUnit = sourceManifest.units.find((unit) => unit.unit_id === unitId);
  if (!sourceUnit || sourceUnit.source_fingerprint !== sourceFingerprint) {
    throw new Error(`${descriptor.role} unit/source fingerprint binding mismatch`);
  }
  const sidecarSources = requireArray(payload.source_files, `${descriptor.role}.source_files`)
    .map((entry, index) => {
      const source = requireObject(entry, `${descriptor.role}.source_files[${index}]`);
      const sourcePath = requireString(source.path, `${descriptor.role}.source_files[${index}].path`);
      assertSafeSourceRelativePath(sourcePath, `${descriptor.role}.source_files[${index}].path`);
      return {
        path: sourcePath,
        sha256: requireSha256(source.sha256, `${descriptor.role}.source_files[${index}].sha256`),
        bytes: requireCount(source.bytes, `${descriptor.role}.source_files[${index}].bytes`),
      };
    });
  if (!sameJson(sidecarSources, sourceUnit.source_files.map(({ path: sourcePath, sha256, bytes }) => ({
    path: sourcePath,
    sha256,
    bytes,
  })))) {
    throw new Error(`${descriptor.role} source path/SHA-256/bytes binding mismatch`);
  }
  const reviewer = requireObject(payload.reviewer, `${descriptor.role}.reviewer`);
  const confirmation = requireObject(reviewer.confirmation, `${descriptor.role}.reviewer.confirmation`);
  if (
    confirmation.overlay_artifact_relative_path !== "fixed-eight-ground-truth-overlay-v3-canonical-visual.json"
    || confirmation.source_ground_truth_sha256 !== manifest.source_overlay_sha256
  ) {
    throw new Error(`${descriptor.role} ground-truth overlay binding mismatch`);
  }
  const locatorMigration = requireObject(
    confirmation.locator_migration,
    `${descriptor.role}.reviewer.confirmation.locator_migration`,
  );
  if (locatorMigration.derived_overlay_content_sha256 !== overlay.content_sha256) {
    throw new Error(`${descriptor.role} canonical overlay content binding mismatch`);
  }
  const fragment = requireObject(payload.fragment, `${descriptor.role}.fragment`);
  assertDescriptorCounts(descriptor, {
    source_file_count: sidecarSources.length,
    evidence_count: arrayLength(payload.evidence, `${descriptor.role}.evidence`),
    record_evidence_count: arrayLength(payload.record_evidence, `${descriptor.role}.record_evidence`),
    coverage_gap_count: arrayLength(payload.coverage_gaps, `${descriptor.role}.coverage_gaps`),
    agency_package_count: arrayLength(fragment.agency_packages, `${descriptor.role}.fragment.agency_packages`),
    partner_vendor_count: arrayLength(fragment.partner_vendors, `${descriptor.role}.fragment.partner_vendors`),
    hall_count: arrayLength(fragment.halls, `${descriptor.role}.fragment.halls`),
    section_count: arrayLength(fragment.sections, `${descriptor.role}.fragment.sections`),
    money_occurrence_count: arrayLength(
      fragment.money_occurrences,
      `${descriptor.role}.fragment.money_occurrences`,
    ),
  });
}

function validateSidecarManifestBindings(
  manifest: EvidenceBundleManifest,
  artifacts: VerifiedArtifactInternal[],
): void {
  if (!Array.isArray(manifest.sidecars) || manifest.sidecars.length !== 2) {
    throw new Error("bundle manifest must bind exactly two final sidecars");
  }
  const sidecarDescriptors = artifacts
    .filter(({ descriptor }) => descriptor.role.endsWith("_visual_transcription_sidecar"));
  for (const descriptorArtifact of sidecarDescriptors) {
    const { descriptor } = descriptorArtifact;
    const binding = manifest.sidecars.find(({ role }) => role === descriptor.role);
    if (!binding) throw new Error(`bundle manifest sidecar binding missing for ${descriptor.role}`);
    if (
      binding.unit_id !== descriptor.unit_id
      || binding.source_fingerprint !== descriptor.source_fingerprint
      || binding.content_sha256 !== descriptor.content_sha256
      || binding.file_sha256 !== descriptor.sha256
      || binding.bytes !== descriptor.bytes
    ) {
      throw new Error(`bundle manifest sidecar content/file binding mismatch for ${descriptor.role}`);
    }
  }
}

function projectCurrentScanManifest(value: unknown): BoundSourceUnit[] {
  const manifest = requireObject(value, "current scan manifest");
  return parseBoundSourceUnits(manifest.units, "current scan manifest.units");
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLocaleLowerCase("en-US") === resolvedRight.toLocaleLowerCase("en-US")
    : resolvedLeft === resolvedRight;
}

async function sha256RegularFile(filePath: string): Promise<{ sha256: string; bytes: number }> {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error("raw source must be a regular non-reparse file");
  }
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("end", resolve);
    stream.once("error", reject);
  });
  return { sha256: hash.digest("hex"), bytes: fileStat.size };
}

async function verifyRawSourceObject(
  rootDir: string,
  rootRealPath: string,
  source: BoundSourceFile,
): Promise<void> {
  const expectedPath = path.resolve(rootDir, ...source.path.split("/"));
  if (!isStrictChild(rootDir, expectedPath)) {
    throw new Error(`raw source path escapes current scan root: ${source.path}`);
  }
  let currentPath = rootDir;
  const segments = path.relative(rootDir, expectedPath).split(path.sep).filter(Boolean);
  for (const [index, segment] of segments.entries()) {
    currentPath = path.join(currentPath, segment);
    let currentStat;
    try {
      currentStat = await lstat(currentPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw new Error(`raw source is missing: ${source.path}`);
      }
      throw error;
    }
    if (currentStat.isSymbolicLink()) {
      throw new Error(`raw source path contains a reparse point: ${source.path}`);
    }
    const isLeaf = index === segments.length - 1;
    if ((!isLeaf && !currentStat.isDirectory()) || (isLeaf && !currentStat.isFile())) {
      throw new Error(`raw source path has an invalid file type: ${source.path}`);
    }
  }
  const sourceRealPath = await realpath(expectedPath);
  if (!isStrictChild(rootRealPath, sourceRealPath) || !samePath(sourceRealPath, expectedPath)) {
    throw new Error(`raw source path resolves through a reparse point: ${source.path}`);
  }
  const digest = await sha256RegularFile(sourceRealPath);
  if (digest.sha256 !== source.sha256 || digest.bytes !== source.bytes) {
    throw new Error(`raw source SHA-256/bytes mismatch: ${source.path}`);
  }
}

async function verifyCurrentRawSources(
  currentScanManifest: JsonObject,
  units: BoundSourceUnit[],
): Promise<void> {
  const configuredRoot = requireString(currentScanManifest.root_dir, "current scan manifest.root_dir");
  if (!path.isAbsolute(configuredRoot)) {
    throw new Error("current scan raw root must be an absolute path");
  }
  const rootDir = path.resolve(configuredRoot);
  let rootStat;
  try {
    rootStat = await lstat(rootDir);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("current scan raw root is missing; metadata-only verification is forbidden");
    }
    throw error;
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("current scan raw root must be a regular non-reparse directory");
  }
  const rootRealPath = await realpath(rootDir);
  if (!samePath(rootRealPath, rootDir)) {
    throw new Error("current scan raw root resolves through a reparse point");
  }
  const sources = units.flatMap(({ source_files }) => source_files);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, sources.length) }, async () => {
    while (cursor < sources.length) {
      const source = sources[cursor++];
      if (!source) return;
      await verifyRawSourceObject(rootDir, rootRealPath, source);
    }
  });
  await Promise.all(workers);
}

function isStrictChild(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

async function readVerifiedBundleFile(bundleDir: string, relativePath: string): Promise<Buffer> {
  const candidate = path.resolve(bundleDir, ...relativePath.split("/"));
  if (!isStrictChild(bundleDir, candidate)) {
    throw new Error("artifact path must remain inside the evidence bundle");
  }
  const [bundleReal, candidateReal, candidateStat] = await Promise.all([
    realpath(bundleDir),
    realpath(candidate),
    lstat(candidate),
  ]);
  if (!isStrictChild(bundleReal, candidateReal) || candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
    throw new Error("bundle artifact must be a regular non-symlink file inside the bundle");
  }
  return readFile(candidateReal);
}

async function verifyBundleInternal(
  options: VerifyVendorDisclosureEvidenceBundleOptions,
): Promise<VerifiedBundleInternal> {
  if (!options.bundleDir?.trim() || !options.currentScanManifestPath?.trim()) {
    throw new Error("bundleDir and currentScanManifestPath are required explicitly");
  }
  if (!options.expectedBundleContentSha256?.trim()) {
    throw new Error("expectedBundleContentSha256 is required from a signed Git commit or release");
  }
  if (!SHA256_PATTERN.test(options.expectedBundleContentSha256)) {
    throw new Error("expectedBundleContentSha256 must be a lowercase SHA-256 digest");
  }
  const bundleDir = path.resolve(options.bundleDir);
  const bundleStat = await lstat(bundleDir);
  if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()) {
    throw new Error("bundleDir must be a regular directory, not a symlink");
  }
  const manifestBytes = await readVerifiedBundleFile(bundleDir, "bundle-manifest.json");
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("evidence bundle manifest is not valid JSON");
  }
  const manifest = parseBundleManifest(requireObject(manifestValue, "evidence bundle manifest"));
  if (!timingSafeEqual(
    Buffer.from(manifest.content_sha256, "hex"),
    Buffer.from(options.expectedBundleContentSha256, "hex"),
  )) {
    throw new Error("signed-release bundle content SHA-256 mismatch");
  }

  const artifacts: VerifiedArtifactInternal[] = [];
  for (const descriptor of manifest.artifacts) {
    const bytes = await readVerifiedBundleFile(bundleDir, descriptor.relative_path);
    if (bytes.length !== descriptor.bytes) {
      throw new Error(`${descriptor.role} artifact byte size mismatch`);
    }
    if (sha256Bytes(bytes) !== descriptor.sha256) {
      throw new Error(`${descriptor.role} artifact SHA-256 mismatch`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error(`${descriptor.role} artifact is not valid JSON`);
    }
    const json = requireObject(parsed, descriptor.role);
    assertNoForbiddenEvidenceContent(json);
    artifacts.push({ descriptor, json, bytes });
  }

  const sourceArtifact = artifacts.find(({ descriptor }) => descriptor.role === "source_object_manifest");
  if (!sourceArtifact) throw new Error("source object manifest artifact is missing");
  const sourceManifest = parseSourceObjectManifest(sourceArtifact.json);
  if (sourceArtifact.descriptor.content_sha256 !== sourceManifest.content_sha256) {
    throw new Error("source object manifest descriptor content SHA-256 mismatch");
  }
  if (
    manifest.source_inventory.content_sha256 !== sourceManifest.content_sha256
    || manifest.source_inventory.ordered_binding_sha256 !== sourceManifest.ordered_binding_sha256
    || manifest.source_inventory.unit_count !== sourceManifest.unit_count
    || manifest.source_inventory.source_object_count !== sourceManifest.source_object_count
  ) {
    throw new Error("bundle source inventory binding mismatch");
  }
  assertDescriptorCounts(sourceArtifact.descriptor, {
    unit_count: sourceManifest.unit_count,
    source_object_count: sourceManifest.source_object_count,
    xlsx_count: sourceManifest.units.flatMap(({ source_files }) => source_files)
      .filter(({ ext }) => ext === "xlsx").length,
    hwp_count: sourceManifest.units.flatMap(({ source_files }) => source_files)
      .filter(({ ext }) => ext === "hwp").length,
    png_count: sourceManifest.units.flatMap(({ source_files }) => source_files)
      .filter(({ ext }) => ext === "png").length,
    pdf_count: sourceManifest.units.flatMap(({ source_files }) => source_files)
      .filter(({ ext }) => ext === "pdf").length,
    docx_count: sourceManifest.units.flatMap(({ source_files }) => source_files)
      .filter(({ ext }) => ext === "docx").length,
  });

  const currentScanValue = JSON.parse(await readFile(path.resolve(options.currentScanManifestPath), "utf8")) as unknown;
  const currentScanManifest = requireObject(currentScanValue, "current scan manifest");
  const currentBindings = projectCurrentScanManifest(currentScanManifest);
  if (canonicalJsonSha256(currentBindings) !== sourceManifest.ordered_binding_sha256) {
    throw new Error("current scan manifest binding hash mismatch");
  }
  await verifyCurrentRawSources(currentScanManifest, currentBindings);

  const groundTruth = artifacts.find(
    ({ descriptor }) => descriptor.role === "manual_pilot_source_money_ground_truth",
  );
  const adjudication = artifacts.find(({ descriptor }) => descriptor.role === "fixed_eight_adjudication_v3");
  const sourceOverlay = artifacts.find(({ descriptor }) => descriptor.role === "source_visual_overlay_v2");
  const overlay = artifacts.find(({ descriptor }) => descriptor.role === "canonical_visual_overlay_v3");
  const buildReport = artifacts.find(({ descriptor }) => descriptor.role === "fixed_eight_build_report");
  if (!groundTruth || !adjudication || !sourceOverlay || !overlay || !buildReport) {
    throw new Error("bundle is missing a required fixed-eight artifact");
  }
  validateGroundTruth(
    groundTruth.json,
    groundTruth.descriptor,
    sourceManifest,
    manifest.ground_truth_occurrence_count,
  );
  validateAdjudication(adjudication.json, adjudication.descriptor);
  validateSourceOverlay(sourceOverlay.json, sourceOverlay.descriptor, manifest, sourceManifest);
  validateOverlay(overlay.json, overlay.descriptor, manifest, sourceManifest);
  validateBuildReport(buildReport.json, buildReport.descriptor);
  for (const sidecar of artifacts.filter(
    ({ descriptor }) => descriptor.role.endsWith("_visual_transcription_sidecar"),
  )) {
    validateSidecar(sidecar.json, sidecar.descriptor, manifest, sourceManifest, overlay.json);
  }
  validateSidecarManifestBindings(manifest, artifacts);
  return { manifest, sourceManifest, artifacts };
}

export async function verifyVendorDisclosureEvidenceBundle(
  options: VerifyVendorDisclosureEvidenceBundleOptions,
): Promise<VerifiedVendorDisclosureEvidenceBundle> {
  const verified = await verifyBundleInternal(options);
  return {
    bundleContentSha256: verified.manifest.content_sha256,
    sourceUnitCount: verified.sourceManifest.unit_count,
    sourceObjectCount: verified.sourceManifest.source_object_count,
    groundTruthOccurrenceCount: verified.manifest.ground_truth_occurrence_count,
    artifactTotalBytes: verified.manifest.artifact_total_bytes,
    artifacts: verified.artifacts.map(({ descriptor }) => ({
      role: descriptor.role,
      sha256: descriptor.sha256,
      bytes: descriptor.bytes,
      materialize: descriptor.materialize,
    })),
  };
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return (await listRelativeFiles(child)).map((relative) => path.join(entry.name, relative));
    }
    return [entry.name];
  }));
  return nested.flat().sort();
}

async function verifyExistingTarget(
  targetDirectory: string,
  artifacts: VerifiedArtifactInternal[],
): Promise<void> {
  const expected = artifacts.map(({ descriptor }) => path.join(
    "objects",
    "sha256",
    `${descriptor.sha256}.json`,
  )).sort();
  const actual = await listRelativeFiles(targetDirectory);
  if (!sameJson(actual, expected)) throw new Error("existing restored bundle has unexpected files");
  for (const artifact of artifacts) {
    const artifactPath = path.join(targetDirectory, "objects", "sha256", `${artifact.descriptor.sha256}.json`);
    const artifactStat = await lstat(artifactPath);
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
      throw new Error("existing restored artifact is not a regular file");
    }
    const bytes = await readFile(artifactPath);
    if (bytes.length !== artifact.descriptor.bytes || sha256Bytes(bytes) !== artifact.descriptor.sha256) {
      throw new Error("existing restored artifact content mismatch");
    }
  }
}

async function assertSafeStateDirectory(stateDir: string): Promise<string> {
  const resolved = path.resolve(stateDir);
  const stateStat = await lstat(resolved);
  if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
    throw new Error("stateDir must already exist as a regular directory, not a symlink");
  }
  return realpath(resolved);
}

async function assertSafeExistingDirectoryPrefix(
  stateReal: string,
  segments: string[],
): Promise<boolean> {
  let current = stateReal;
  for (const segment of segments) {
    const child = path.join(current, segment);
    try {
      const childStat = await lstat(child);
      if (!childStat.isDirectory() || childStat.isSymbolicLink()) {
        throw new Error("restore path must not contain a symlink or non-directory component");
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
    const childReal = await realpath(child);
    if (!isStrictChild(stateReal, childReal)) {
      throw new Error("restore parent must remain inside stateDir");
    }
    current = childReal;
  }
  return true;
}

async function createSafeRestoreParent(
  stateReal: string,
  segments: string[],
  createdDirectories: string[],
): Promise<string> {
  let current = stateReal;
  for (const segment of segments) {
    const child = path.join(current, segment);
    try {
      const childStat = await lstat(child);
      if (!childStat.isDirectory() || childStat.isSymbolicLink()) {
        throw new Error("restore path must not contain a symlink or non-directory component");
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      await mkdir(child);
      createdDirectories.push(child);
      const createdStat = await lstat(child);
      if (!createdStat.isDirectory() || createdStat.isSymbolicLink()) {
        throw new Error("new restore path component is not a regular directory");
      }
    }
    const childReal = await realpath(child);
    if (!isStrictChild(stateReal, childReal)) {
      throw new Error("restore parent must remain inside stateDir");
    }
    current = childReal;
  }
  return current;
}

async function writeAndSync(filePath: string, bytes: Buffer): Promise<void> {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function restoredResult(
  verified: VerifiedBundleInternal,
  targetDirectory: string,
  artifacts: VerifiedArtifactInternal[],
): RestoredVendorDisclosureEvidenceBundle {
  return {
    bundleContentSha256: verified.manifest.content_sha256,
    targetDirectory,
    materializedArtifacts: artifacts.map(({ descriptor }) => ({
      role: descriptor.role,
      path: path.join(targetDirectory, "objects", "sha256", `${descriptor.sha256}.json`),
      aliasPath: runtimeAliasPath(targetDirectory, descriptor),
      sha256: descriptor.sha256,
      bytes: descriptor.bytes,
    })),
  };
}

function runtimeAliasRelativePath(descriptor: BundleArtifactDescriptor): string {
  switch (descriptor.role) {
    case "source_visual_overlay_v2":
      return "fixed-eight-ground-truth-overlay-v2.json";
    case "canonical_visual_overlay_v3":
      return "fixed-eight-ground-truth-overlay-v3-canonical-visual.json";
    case "eileen_visual_transcription_sidecar":
    case "may_visual_transcription_sidecar": {
      const unitId = requireSha256(descriptor.unit_id, `${descriptor.role}.unit_id`);
      const sourceFingerprint = requireSha256(
        descriptor.source_fingerprint,
        `${descriptor.role}.source_fingerprint`,
      );
      return path.join("visual-transcriptions", unitId, `${sourceFingerprint}.json`);
    }
    default:
      throw new Error(`artifact role does not have a runtime alias: ${descriptor.role}`);
  }
}

function runtimeAliasPath(
  targetDirectory: string,
  descriptor: BundleArtifactDescriptor,
): string {
  const stateDir = path.resolve(targetDirectory, "..", "..", "..");
  return path.join(stateDir, runtimeAliasRelativePath(descriptor));
}

async function verifyStateArtifactFile(
  stateReal: string,
  artifactPath: string,
  artifact: VerifiedArtifactInternal,
  label: string,
): Promise<void> {
  if (!isStrictChild(stateReal, artifactPath)) throw new Error(`${label} must remain inside stateDir`);
  const artifactStat = await lstat(artifactPath);
  if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-reparse file`);
  }
  const artifactRealPath = await realpath(artifactPath);
  if (!samePath(artifactRealPath, artifactPath) || !isStrictChild(stateReal, artifactRealPath)) {
    throw new Error(`${label} resolves through a reparse point`);
  }
  const bytes = await readFile(artifactRealPath);
  if (bytes.length !== artifact.descriptor.bytes || sha256Bytes(bytes) !== artifact.descriptor.sha256) {
    throw new Error(`${label} has different bytes; overwrite is forbidden`);
  }
}

async function existingAliasMatchesOrMissing(
  stateReal: string,
  artifact: VerifiedArtifactInternal,
  aliasPath: string,
): Promise<boolean> {
  const parentRelative = path.relative(stateReal, path.dirname(aliasPath));
  const parentSegments = parentRelative.split(path.sep).filter(Boolean);
  if (!(await assertSafeExistingDirectoryPrefix(stateReal, parentSegments))) return false;
  try {
    await verifyStateArtifactFile(stateReal, aliasPath, artifact, "runtime alias");
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function rejectStaleSameHashTemporaryDirectories(
  targetParent: string,
  bundleContentSha256: string,
): Promise<void> {
  try {
    const entries = await readdir(targetParent, { withFileTypes: true });
    const prefix = `.${bundleContentSha256}.`;
    if (entries.some((entry) => entry.name.startsWith(prefix) && entry.name.endsWith(".tmp"))) {
      throw new Error("stale same-hash restore temporary path exists; fail closed without cleanup");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

async function assertDirectoryStillSafe(stateReal: string, directoryPath: string): Promise<void> {
  const directoryStat = await lstat(directoryPath);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("restore parent changed before atomic publication");
  }
  const directoryRealPath = await realpath(directoryPath);
  if (
    !samePath(directoryRealPath, directoryPath)
    || (!samePath(directoryRealPath, stateReal) && !isStrictChild(stateReal, directoryRealPath))
  ) {
    throw new Error("restore parent resolves through a reparse point before atomic publication");
  }
}

async function finalizeReadOnlyAndConsumerRehash(
  stateReal: string,
  artifactPath: string,
  artifact: VerifiedArtifactInternal,
  label: string,
): Promise<void> {
  await verifyStateArtifactFile(stateReal, artifactPath, artifact, label);
  await chmod(artifactPath, 0o444);
  const finalStat = await lstat(artifactPath);
  if (process.platform !== "win32" && (finalStat.mode & 0o222) !== 0) {
    throw new Error(`${label} could not be finalized read-only`);
  }
  // This second verification is deliberately performed through the exact path
  // returned to the consumer, after permissions have been finalized.
  await verifyStateArtifactFile(stateReal, artifactPath, artifact, `${label} consumer rehash`);
}

async function cleanupCreatedState(
  createdAliases: string[],
  temporaryAliasPaths: string[],
  createdTargetDirectory: string | null,
  temporaryDirectory: string | null,
  createdDirectories: string[],
): Promise<void> {
  for (const temporaryAliasPath of temporaryAliasPaths) {
    await chmod(temporaryAliasPath, 0o666).catch(() => undefined);
    await unlink(temporaryAliasPath).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
  for (const aliasPath of [...createdAliases].reverse()) {
    try {
      await chmod(aliasPath, 0o666);
      await unlink(aliasPath);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  if (createdTargetDirectory) {
    const files = await listRelativeFiles(createdTargetDirectory).catch(() => []);
    await Promise.all(files.map(async (relativePath) => {
      const filePath = path.join(createdTargetDirectory, relativePath);
      await chmod(filePath, 0o666).catch(() => undefined);
    }));
    await rm(createdTargetDirectory, { recursive: true, force: true });
  }
  for (const directory of [...createdDirectories].reverse()) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && ["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code as string))) {
        throw error;
      }
    }
  }
}

export async function restoreVendorDisclosureEvidenceBundle(
  options: RestoreVendorDisclosureEvidenceBundleOptions,
): Promise<RestoredVendorDisclosureEvidenceBundle> {
  if (!options.stateDir?.trim()) throw new Error("stateDir is required explicitly");

  // Validate the complete immutable batch and current scan binding before the
  // first mkdir/open/rename under stateDir.
  const verified = await verifyBundleInternal(options);
  const stateReal = await assertSafeStateDirectory(options.stateDir);
  const materialized = verified.artifacts.filter(({ descriptor }) => descriptor.materialize);
  const targetParent = path.join(stateReal, "vendor-disclosure-evidence", "sha256");
  const targetDirectory = path.join(targetParent, verified.manifest.content_sha256);
  const aliases = materialized.map((artifact) => ({
    artifact,
    path: path.join(stateReal, runtimeAliasRelativePath(artifact.descriptor)),
  }));
  await assertSafeExistingDirectoryPrefix(
    stateReal,
    ["vendor-disclosure-evidence", "sha256"],
  );
  await rejectStaleSameHashTemporaryDirectories(targetParent, verified.manifest.content_sha256);
  const existingAliases = new Map<string, boolean>();
  for (const alias of aliases) {
    const aliasParent = path.dirname(alias.path);
    const aliasParentSegments = path.relative(stateReal, aliasParent).split(path.sep).filter(Boolean);
    if (await assertSafeExistingDirectoryPrefix(stateReal, aliasParentSegments)) {
      await rejectStaleSameHashTemporaryDirectories(
        aliasParent,
        verified.manifest.content_sha256,
      );
    }
    existingAliases.set(
      alias.path,
      await existingAliasMatchesOrMissing(stateReal, alias.artifact, alias.path),
    );
  }
  let targetExists = false;
  try {
    const existing = await lstat(targetDirectory);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error("existing restored bundle target is not a regular directory");
    }
    await verifyExistingTarget(targetDirectory, materialized);
    targetExists = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const createdDirectories: string[] = [];
  const createdAliases: string[] = [];
  const temporaryAliasPaths: string[] = [];
  let createdTargetDirectory: string | null = null;
  let temporaryDirectory: string | null = null;
  try {
    const safeTargetParent = await createSafeRestoreParent(
      stateReal,
      ["vendor-disclosure-evidence", "sha256"],
      createdDirectories,
    );
    if (!samePath(safeTargetParent, targetParent)) {
      throw new Error("restore target parent canonical path mismatch");
    }
    await rejectStaleSameHashTemporaryDirectories(targetParent, verified.manifest.content_sha256);
    if (!targetExists) {
      const pendingTemporaryDirectory = path.join(
        targetParent,
        `.${verified.manifest.content_sha256}.${process.pid}.${randomUUID()}.tmp`,
      );
      temporaryDirectory = pendingTemporaryDirectory;
      await mkdir(path.join(pendingTemporaryDirectory, "objects", "sha256"), { recursive: true });
      for (const artifact of materialized) {
        await writeAndSync(
          path.join(pendingTemporaryDirectory, "objects", "sha256", `${artifact.descriptor.sha256}.json`),
          artifact.bytes,
        );
      }
      await assertDirectoryStillSafe(stateReal, targetParent);
      try {
        await rename(pendingTemporaryDirectory, targetDirectory);
        createdTargetDirectory = targetDirectory;
        temporaryDirectory = null;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code as string))) {
          throw error;
        }
        await verifyExistingTarget(targetDirectory, materialized);
        await rm(pendingTemporaryDirectory, { recursive: true, force: true });
        temporaryDirectory = null;
      }
    }
    await verifyExistingTarget(targetDirectory, materialized);
    for (const alias of aliases) {
      if (existingAliases.get(alias.path)) continue;
      const parentSegments = path.relative(stateReal, path.dirname(alias.path)).split(path.sep).filter(Boolean);
      const aliasParent = await createSafeRestoreParent(stateReal, parentSegments, createdDirectories);
      await assertDirectoryStillSafe(stateReal, aliasParent);
      const temporaryAliasPath = path.join(
        aliasParent,
        `.${verified.manifest.content_sha256}.${path.basename(alias.path)}.${process.pid}.${randomUUID()}.tmp`,
      );
      temporaryAliasPaths.push(temporaryAliasPath);
      await writeAndSync(temporaryAliasPath, alias.artifact.bytes);
      await chmod(temporaryAliasPath, 0o444);
      await assertDirectoryStillSafe(stateReal, aliasParent);
      try {
        await link(temporaryAliasPath, alias.path);
        createdAliases.push(alias.path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        await verifyStateArtifactFile(stateReal, alias.path, alias.artifact, "runtime alias race");
      }
      await chmod(temporaryAliasPath, 0o666);
      await unlink(temporaryAliasPath);
      temporaryAliasPaths.splice(temporaryAliasPaths.indexOf(temporaryAliasPath), 1);
    }
    for (const alias of aliases) {
      const objectPath = path.join(
        targetDirectory,
        "objects",
        "sha256",
        `${alias.artifact.descriptor.sha256}.json`,
      );
      await finalizeReadOnlyAndConsumerRehash(
        stateReal,
        objectPath,
        alias.artifact,
        "content-addressed object",
      );
      await finalizeReadOnlyAndConsumerRehash(
        stateReal,
        alias.path,
        alias.artifact,
        "runtime alias",
      );
    }
  } catch (error) {
    await cleanupCreatedState(
      createdAliases,
      temporaryAliasPaths,
      createdTargetDirectory,
      temporaryDirectory,
      createdDirectories,
    );
    throw error;
  }
  return restoredResult(verified, targetDirectory, materialized);
}
