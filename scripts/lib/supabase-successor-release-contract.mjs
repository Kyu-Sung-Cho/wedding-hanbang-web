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
const BLOCKED_TOP_LEVEL_KEYS = [
  "deploymentEvidence",
  "expandMigrations",
  "forwardOnlySecurityOperations",
  "migrationFloor",
  "predecessorManifest",
  "projectRef",
  "release",
  "requiredDocuments",
  "requiredRemoteHead",
  "status",
];
// 증거를 고정한 매니페스트만 backupContract를 추가로 갖는다. 차단 상태에서는
// 이 키가 있으면 형태 위반이다 — 증거 없이 백업 계약만 선언하지 못하게 한다.
const PINNED_TOP_LEVEL_KEYS = [...BLOCKED_TOP_LEVEL_KEYS, "backupContract"].sort();
const BLOCKED_STATUS = "deployment_blocked";
const PINNED_STATUS = "evidence_pinned";
// 증거 한 건이 갖춰야 할 필드. 전부 있어야 하고 그 외에는 없어야 한다.
const EVIDENCE_RECORD_KEYS = ["capturedAt", "file", "releaseCommit", "sha256"];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;
// 영수증에 자격증명이 섞여 들어오는 사고를 파일 이름 단계에서 한 번 더 막는다.
const SECRET_LIKE_KEY = /(?:secret|token|password|passwd|credential|apikey|api_key|private)/i;
// 증거는 이 디렉터리 안에만 둔다. 아무 데나 가리키면 무엇이 증거인지 흐려진다.
const EVIDENCE_DIRECTORY = "docs/operations/evidence";
const PIN_KEYS = ["file", "sha256"];
const FORWARD_ONLY_OPERATION_KEYS = [
  "apply",
  "id",
  "inventory",
  "phase",
  "requiredGate",
  "rollbackPolicy",
  "verify",
];
const VERIFY_ARTIFACT_KEYS = ["expectedEvidence", "file", "sha256"];
const REQUIRED_SUCCESSOR_DOCUMENTS = [
  {
    file: "docs/operations/COMMUNITY_PUBLIC_IDENTITY_ROLLOUT_2026-08-03.md",
    label: "community public-identity rollout document",
  },
  {
    file: "docs/operations/CUSTOMER_SURVEY_FREE_TEXT_RETIREMENT_2026-08-03.md",
    label: "customer survey free-text retirement document",
  },
];
const COMMUNITY_IDENTITY_OPERATION_ID =
  "community-public-identity-contract-20260803104500";
const SECURITY_OPERATION_DIRECTORY = "supabase/platform-operations/security";

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

function exactKeys(value, expected) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function validateSuccessorForwardOnlySecurityOperations(repoRoot, manifest) {
  const operations = manifest.forwardOnlySecurityOperations;
  if (!Array.isArray(operations) || operations.length !== 1) {
    invalid(
      "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
      "successor must pin exactly the reviewed community public-identity cutover operation",
    );
  }

  const operation = operations[0];
  if (!exactKeys(operation, FORWARD_ONLY_OPERATION_KEYS)
      || operation.id !== COMMUNITY_IDENTITY_OPERATION_ID
      || operation.phase !== "post-application-deploy"
      || operation.requiredGate !== "minimum-supported-community-client-version-enforced"
      || operation.rollbackPolicy !== "forward-fix-only-no-auth-uuid-regrant"
      || !exactKeys(operation.inventory, PIN_KEYS)
      || !exactKeys(operation.apply, PIN_KEYS)
      || !exactKeys(operation.verify, VERIFY_ARTIFACT_KEYS)
      || !exactKeys(
        operation.verify.expectedEvidence,
        ["community_public_identity_contract_verified"],
      )
      || operation.verify.expectedEvidence.community_public_identity_contract_verified !== 1) {
    invalid(
      "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
      "community public-identity cutover operation contract is invalid",
    );
  }

  const expectedFiles = {
    inventory:
      `${SECURITY_OPERATION_DIRECTORY}/20260803104500_community_public_identity_contract_inventory.sql`,
    apply:
      `${SECURITY_OPERATION_DIRECTORY}/20260803104500_community_public_identity_contract_apply.sql`,
    verify:
      `${SECURITY_OPERATION_DIRECTORY}/20260803104500_community_public_identity_contract_verify.sql`,
  };
  for (const [kind, entry] of Object.entries({
    inventory: operation.inventory,
    apply: operation.apply,
    verify: operation.verify,
  })) {
    if (entry.file !== expectedFiles[kind]) {
      invalid(
        "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
        `${kind} artifact is not the reviewed community public-identity contract file`,
      );
    }
    readPinnedRegularFile(
      repoRoot,
      entry,
      `community public-identity ${kind}`,
      join(repoRoot, ...SECURITY_OPERATION_DIRECTORY.split("/")),
    );
  }
  return operations;
}

function validateSuccessorRequiredDocuments(repoRoot, manifest) {
  const documents = manifest.requiredDocuments;
  if (!Array.isArray(documents)
      || documents.length !== REQUIRED_SUCCESSOR_DOCUMENTS.length) {
    invalid(
      "REQUIRED_DOCUMENTS_INVALID",
      "successor must pin exactly the reviewed security rollout documents",
    );
  }
  for (const [index, expected] of REQUIRED_SUCCESSOR_DOCUMENTS.entries()) {
    const entry = documents[index];
    if (!exactKeys(entry, PIN_KEYS) || entry.file !== expected.file) {
      invalid(
        "REQUIRED_DOCUMENTS_INVALID",
        `${expected.label} pin is invalid`,
      );
    }
    readPinnedRegularFile(
      repoRoot,
      entry,
      expected.label,
      join(repoRoot, "docs", "operations"),
    );
  }
  return documents;
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

/**
 * 증거 한 건을 검증한다.
 *
 * 증거는 "어느 커밋을 대상으로, 어떤 파일이, 어떤 해시로, 언제" 확보됐는지를
 * 전부 말해야 한다. 하나라도 빠지면 나중에 "그때 뭘 확인했더라"가 되고,
 * 그 상태로 열린 게이트는 게이트가 아니다.
 */
function validateEvidenceRecord(repoRoot, name, record, expectedCommit) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", `${name} evidence must be a pinned record`);
  }
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(EVIDENCE_RECORD_KEYS)) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", `${name} evidence has missing or unexpected fields`);
  }
  if (typeof record.file !== "string"
      || record.file.length === 0
      || record.file.length > 200
      || record.file.includes("\\")
      || record.file.includes("//")
      || record.file.includes("..")
      || isAbsolute(record.file)
      || SECRET_LIKE_KEY.test(record.file)) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", `${name} evidence file path is unsafe`);
  }
  if (!SHA256.test(record.sha256 ?? "")) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", `${name} evidence must pin a sha256`);
  }
  if (!ISO_TIMESTAMP.test(record.capturedAt ?? "")) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", `${name} evidence capture time must be an ISO-8601 UTC instant`);
  }
  // 증거는 반드시 이 릴리스 커밋에 묶인다. 이전 릴리스 영수증 재사용을 막는다.
  if (!COMMIT_SHA.test(record.releaseCommit ?? "")) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", `${name} evidence must pin a release commit`);
  }
  if (expectedCommit && record.releaseCommit !== expectedCommit) {
    invalid(
      "DEPLOYMENT_EVIDENCE_COMMIT_DRIFT",
      `${name} evidence is bound to a different release commit`,
    );
  }
  if (!record.file.startsWith(`${EVIDENCE_DIRECTORY}/`)) {
    invalid("DEPLOYMENT_EVIDENCE_INVALID", `${name} evidence must live under ${EVIDENCE_DIRECTORY}`);
  }
  // 해시만 적어 두고 파일이 없으면 증거가 아니라 증거의 흉내다. 선임 매니페스트와
  // 같은 기준으로 실제 파일을 읽어 대조한다.
  readPinnedRegularFile(
    repoRoot,
    { file: record.file, sha256: record.sha256 },
    `${name} evidence`,
    join(repoRoot, ...EVIDENCE_DIRECTORY.split("/")),
  );
  return record.releaseCommit;
}

/**
 * 매니페스트가 어느 상태인지 판정하고, 그 상태의 규칙을 전부 강제한다.
 *
 *   deployment_blocked — 증거 5종이 전부 "missing"이어야 한다(오늘까지의 유일한 상태).
 *   evidence_pinned    — 증거 5종이 전부 같은 릴리스 커밋에 묶인 기록이어야 하고,
 *                        backupContract가 함께 있어야 한다.
 *
 * 둘 사이 어중간한 상태는 없다. "일부만 증거가 있다"는 곧 "확인 안 된 것이 섞여
 * 있다"이고, 그런 매니페스트로 게이트를 열면 무엇이 검증됐는지 알 수 없게 된다.
 */
function validateDeploymentBlock(repoRoot, manifest) {
  const evidence = manifest.deploymentEvidence;
  const keys = evidence && typeof evidence === "object" && !Array.isArray(evidence)
    ? Object.keys(evidence).sort()
    : [];
  if (JSON.stringify(keys) !== JSON.stringify(DEPLOYMENT_EVIDENCE_KEYS)) {
    invalid(
      "DEPLOYMENT_EVIDENCE_INVALID",
      "successor must list exactly the five hosted evidence classes",
    );
  }

  if (manifest.status === BLOCKED_STATUS) {
    if (keys.some((key) => evidence[key] !== "missing")) {
      invalid(
        "DEPLOYMENT_EVIDENCE_INVALID",
        "deployment-blocked successor must explicitly mark every hosted evidence class missing",
      );
    }
    return { released: false, releaseCommit: null };
  }

  if (manifest.status !== PINNED_STATUS) {
    invalid(
      "DEPLOYMENT_STATUS_INVALID",
      `successor status must be ${BLOCKED_STATUS} or ${PINNED_STATUS}`,
    );
  }

  let releaseCommit = null;
  for (const key of DEPLOYMENT_EVIDENCE_KEYS) {
    if (evidence[key] === "missing") {
      invalid(
        "DEPLOYMENT_EVIDENCE_INVALID",
        `evidence-pinned successor still marks ${key} missing`,
      );
    }
    releaseCommit = validateEvidenceRecord(repoRoot, key, evidence[key], releaseCommit);
  }
  return { released: true, releaseCommit };
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
  // 허용 키는 상태에 따라 다르다 — 차단 상태에서 backupContract만 몰래 넣어 두는
  // 것을 막고, 고정 상태에서 그것이 빠지는 것도 막는다.
  const expectedKeys = manifest.status === PINNED_STATUS
    ? PINNED_TOP_LEVEL_KEYS
    : BLOCKED_TOP_LEVEL_KEYS;
  if (JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(expectedKeys)) {
    invalid("MANIFEST_SHAPE_INVALID", "successor manifest has missing or unexpected top-level fields");
  }
  if (!SAFE_RELEASE_ID.test(manifest.release ?? "")
      || `${manifest.release}.json` !== basename(manifestPath)
      || !SAFE_PROJECT_REF.test(manifest.projectRef ?? "")) {
    invalid("MANIFEST_IDENTITY_INVALID", "successor manifest identity is invalid");
  }
  const deployment = validateDeploymentBlock(root, manifest);
  const forwardOnlySecurityOperations =
    validateSuccessorForwardOnlySecurityOperations(root, manifest);
  const requiredDocuments = validateSuccessorRequiredDocuments(root, manifest);
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
    forwardOnlySecurityOperationCount: forwardOnlySecurityOperations.length,
    requiredDocumentCount: requiredDocuments.length,
    predecessorHead,
    // 컨트롤러는 이 값만 보고 진행 여부를 정한다. 상태 문자열을 각자 해석하면
    // 판정이 두 군데로 갈라진다.
    deploymentBlocked: !deployment.released,
    releaseCommit: deployment.releaseCommit,
  };
}
