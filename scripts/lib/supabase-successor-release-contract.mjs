import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

export const SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/vendor-disclosure-v2-20260718.json";

const PREDECESSOR_MANIFEST_RELATIVE_PATH =
  "supabase/release-manifests/amora-engine-v2-20260716.json";
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELEASE_ID = /^[a-z][a-z0-9-]{2,80}$/;
const SAFE_PROJECT_REF = /^[a-z0-9][a-z0-9-]{3,62}$/;
const MIGRATION_FILE = /^(\d{14})_[a-z0-9][a-z0-9_.-]*\.sql$/;
const DEPLOYMENT_EVIDENCE_KEYS = [
  "backup",
  "finalizer",
  "hostedRestore",
  "hostedStaging",
  "storage",
];
const TOP_LEVEL_KEYS = [
  "deploymentEvidence",
  "expandMigrations",
  "migrationFloor",
  "predecessorManifest",
  "projectRef",
  "release",
  "requiredRemoteHead",
  "status",
];

export class SuccessorReleaseContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SuccessorReleaseContractError";
    this.code = code;
  }
}

function invalid(code, message) {
  throw new SuccessorReleaseContractError(code, message);
}

function canonicalTextSha256(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n?/g, "\n"), "utf8")
    .digest("hex");
}

function inside(parent, child) {
  const path = relative(resolve(parent), resolve(child));
  return path === ""
    || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function readPinnedRegularFile(repoRoot, entry, label, expectedDirectory) {
  if (!entry
      || typeof entry.file !== "string"
      || entry.file.includes("\\")
      || entry.file.includes("//")
      || !SHA256.test(entry.sha256 ?? "")) {
    invalid("PIN_INVALID", `${label} pin is missing or invalid`);
  }
  const path = resolve(repoRoot, entry.file);
  if (!inside(repoRoot, path)
      || (expectedDirectory && dirname(path) !== resolve(expectedDirectory))) {
    invalid("PIN_PATH_INVALID", `${label} path escapes its allowed directory`);
  }
  if (!existsSync(path)) invalid("PIN_MISSING", `${label} is missing: ${entry.file}`);
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    invalid("PIN_FILE_INVALID", `${label} must be a non-symlink regular file`);
  }
  const text = readFileSync(path, "utf8");
  const actual = canonicalTextSha256(text);
  if (actual !== entry.sha256) {
    invalid(
      "PIN_HASH_MISMATCH",
      `${label} hash mismatch for ${entry.file}; expected ${entry.sha256}, received ${actual}`,
    );
  }
  return { path, text };
}

function declaredMigrations(manifest) {
  const sections = [
    manifest?.historicalReconciliation ?? [],
    manifest?.expandMigrations ?? [],
    manifest?.appliedHotfixes ?? [],
  ];
  if (sections.some((section) => !Array.isArray(section))) {
    invalid("PREDECESSOR_MANIFEST_INVALID", "predecessor migration sections are invalid");
  }
  return sections.flat();
}

function verifyMigration(repoRoot, entry, label) {
  const match = typeof entry?.file === "string" ? entry.file.match(MIGRATION_FILE) : null;
  if (!match || basename(entry.file) !== entry.file || !SHA256.test(entry.sha256 ?? "")) {
    invalid("MIGRATION_RECORD_INVALID", `${label} migration record is invalid`);
  }
  const relativePath = `supabase/migrations/${entry.file}`;
  readPinnedRegularFile(
    repoRoot,
    { file: relativePath, sha256: entry.sha256 },
    `${label} migration`,
    join(repoRoot, "supabase", "migrations"),
  );
  return match[1];
}

function verifyPinnedManifestChain({
  repoRoot,
  pin,
  expectedProjectRef,
  visited,
  label,
}) {
  const releaseManifestDir = join(repoRoot, "supabase", "release-manifests");
  const { path, text } = readPinnedRegularFile(
    repoRoot,
    pin,
    label,
    releaseManifestDir,
  );
  if (visited.has(path)) invalid("PREDECESSOR_CYCLE", "release manifest predecessor cycle detected");
  visited.add(path);
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    invalid("PREDECESSOR_MANIFEST_INVALID", `${label} is not valid JSON`);
  }
  if (manifest.projectRef !== expectedProjectRef) {
    invalid("PREDECESSOR_PROJECT_MISMATCH", `${label} project ref does not match successor`);
  }
  const versions = declaredMigrations(manifest).map((entry) =>
    verifyMigration(repoRoot, entry, label));
  if (manifest.predecessorManifest) {
    verifyPinnedManifestChain({
      repoRoot,
      pin: manifest.predecessorManifest,
      expectedProjectRef,
      visited,
      label: `${label} predecessor`,
    });
  }
  return { manifest, versions };
}

function validateDeploymentBlock(manifest) {
  if (manifest.status !== "deployment_blocked") {
    invalid(
      "DEPLOYMENT_STATUS_INVALID",
      "successor status must remain deployment_blocked until hosted evidence is pinned",
    );
  }
  const evidence = manifest.deploymentEvidence;
  const keys = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? Object.keys(evidence).sort()
    : [];
  if (JSON.stringify(keys) !== JSON.stringify(DEPLOYMENT_EVIDENCE_KEYS)
      || keys.some((key) => evidence[key] !== "missing")) {
    invalid(
      "DEPLOYMENT_EVIDENCE_INVALID",
      "deployment-blocked successor must explicitly mark every hosted evidence class missing",
    );
  }
}

export function validateSuccessorReleaseContract({
  repoRoot,
  manifestRelativePath = SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
}) {
  const root = resolve(repoRoot);
  const manifestPath = resolve(root, manifestRelativePath);
  const releaseManifestDir = join(root, "supabase", "release-manifests");
  if (!inside(root, manifestPath) || dirname(manifestPath) !== releaseManifestDir) {
    invalid("MANIFEST_PATH_INVALID", "successor manifest path escapes the release manifest directory");
  }
  const metadata = existsSync(manifestPath) ? lstatSync(manifestPath) : null;
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    invalid("MANIFEST_FILE_INVALID", "successor manifest must be a non-symlink regular file");
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    invalid("MANIFEST_INVALID", "successor manifest is not valid JSON");
  }
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(TOP_LEVEL_KEYS)) {
    invalid("MANIFEST_SHAPE_INVALID", "successor manifest has missing or unexpected top-level fields");
  }
  if (!SAFE_RELEASE_ID.test(manifest.release ?? "")
      || `${manifest.release}.json` !== basename(manifestPath)
      || !SAFE_PROJECT_REF.test(manifest.projectRef ?? "")) {
    invalid("MANIFEST_IDENTITY_INVALID", "successor manifest identity is invalid");
  }
  validateDeploymentBlock(manifest);
  if (!/^\d{14}$/.test(manifest.migrationFloor ?? "")
      || !/^\d{14}$/.test(manifest.requiredRemoteHead ?? "")
      || manifest.requiredRemoteHead >= manifest.migrationFloor) {
    invalid("MIGRATION_BOUNDARY_INVALID", "successor migration floor or required remote head is invalid");
  }
  if (manifest.predecessorManifest?.file !== PREDECESSOR_MANIFEST_RELATIVE_PATH) {
    invalid("PREDECESSOR_PIN_INVALID", "successor must pin the amora-engine-v2 release manifest");
  }
  const predecessor = verifyPinnedManifestChain({
    repoRoot: root,
    pin: manifest.predecessorManifest,
    expectedProjectRef: manifest.projectRef,
    visited: new Set(),
    label: "predecessor release manifest",
  });
  const predecessorHead = [...predecessor.versions].sort().at(-1);
  if (predecessorHead !== manifest.requiredRemoteHead) {
    invalid(
      "REMOTE_HEAD_MISMATCH",
      `required remote head must equal predecessor head ${predecessorHead ?? "none"}`,
    );
  }
  if (!Array.isArray(manifest.expandMigrations) || manifest.expandMigrations.length === 0) {
    invalid("MIGRATION_SET_INVALID", "successor expandMigrations must be non-empty");
  }
  const expectedFiles = [];
  let previousVersion = "";
  for (const entry of manifest.expandMigrations) {
    const version = verifyMigration(root, entry, "successor");
    if (version < manifest.migrationFloor || version <= previousVersion) {
      invalid(
        "MIGRATION_ORDER_INVALID",
        "successor migrations must be strictly ordered from migrationFloor",
      );
    }
    previousVersion = version;
    expectedFiles.push(entry.file);
  }
  const actualFiles = readdirSync(join(root, "supabase", "migrations"))
    .filter((name) => MIGRATION_FILE.test(name))
    .filter((name) => name.slice(0, 14) >= manifest.migrationFloor)
    .sort();
  if (actualFiles.length !== expectedFiles.length
      || actualFiles.some((name, index) => name !== expectedFiles[index])) {
    invalid(
      "MIGRATION_SET_DRIFT",
      `successor migration set or order drifted; expected=${expectedFiles.join(",") || "none"}; received=${actualFiles.join(",") || "none"}`,
    );
  }
  return {
    manifest,
    migrationCount: expectedFiles.length,
    predecessorHead,
  };
}
