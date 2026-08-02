// 후속 릴리스 매니페스트의 "증거 고정" 상태 계약.
//
// 게이트를 여는 유일한 문이므로, 여기서 느슨하면 뒤의 55종 차단이 전부 무의미해진다.
// 실제 저장소 파일을 복사해 픽스처를 만들고 매니페스트만 바꿔가며,
// 통과해야 할 것과 막혀야 할 것을 하나씩 확인한다.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH,
  SuccessorReleaseContractError,
  validateSuccessorReleaseContract,
} from "../lib/supabase-successor-release-contract.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const RELEASE_COMMIT = "180e97c554d69b6ce000f897e739bf789e66e1a6";
const OTHER_COMMIT = "0123456789abcdef0123456789abcdef01234567";
// 픽스처가 실제로 써 넣는 증거 본문과 그 해시 — 계약이 파일을 읽어 대조한다.
const EVIDENCE_BODY = '{"verified":true}\n';
const EVIDENCE_SHA = createHash("sha256").update(EVIDENCE_BODY, "utf8").digest("hex");
const SHA = "a".repeat(64);
const roots = [];

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** 실제 저장소를 그대로 복사해, 매니페스트 외의 조건은 전부 유효한 상태로 둔다. */
function fixture(mutate) {
  const root = mkdtempSync(join(tmpdir(), "successor-contract-"));
  roots.push(root);
  cpSync(join(REPO_ROOT, "supabase", "migrations"), join(root, "supabase", "migrations"), { recursive: true });
  cpSync(
    join(REPO_ROOT, "supabase", "release-manifests"),
    join(root, "supabase", "release-manifests"),
    { recursive: true },
  );
  cpSync(
    join(REPO_ROOT, "supabase", "platform-operations", "security"),
    join(root, "supabase", "platform-operations", "security"),
    { recursive: true },
  );
  mkdirSync(join(root, "docs", "operations"), { recursive: true });
  cpSync(
    join(
      REPO_ROOT,
      "docs",
      "operations",
      "COMMUNITY_PUBLIC_IDENTITY_ROLLOUT_2026-08-03.md",
    ),
    join(
      root,
      "docs",
      "operations",
      "COMMUNITY_PUBLIC_IDENTITY_ROLLOUT_2026-08-03.md",
    ),
  );
  const manifestPath = join(root, SUCCESSOR_RELEASE_MANIFEST_RELATIVE_PATH);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const mutated = mutate(manifest) ?? manifest;
  writeFileSync(manifestPath, `${JSON.stringify(mutated, null, 2)}\n`);
  // 고정 상태 증거는 파일이 실제로 있어야 하므로 픽스처가 함께 만든다.
  // 경로가 위험한 케이스는 계약이 파일을 읽기 전에 막아야 하므로 만들지 않는다.
  const evidence = mutated.deploymentEvidence;
  if (evidence && typeof evidence === "object") {
    for (const record of Object.values(evidence)) {
      if (!record || typeof record !== "object" || typeof record.file !== "string") continue;
      if (record.file.includes("..") || record.file.startsWith("/")
        || record.file.includes("//") || record.file.includes("\\")) continue;
      const target = join(root, ...record.file.split("/"));
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, EVIDENCE_BODY);
    }
  }
  return root;
}

function evidenceRecord(overrides = {}) {
  return {
    file: "docs/operations/evidence/backup-receipt.json",
    sha256: EVIDENCE_SHA,
    capturedAt: "2026-07-26T00:31:05Z",
    releaseCommit: RELEASE_COMMIT,
    ...overrides,
  };
}

function pinnedEvidence(overrides = {}) {
  return {
    backup: evidenceRecord({ file: "docs/operations/evidence/backup-receipt.json" }),
    hostedStaging: evidenceRecord({ file: "docs/operations/evidence/hosted-staging.json" }),
    hostedRestore: evidenceRecord({ file: "docs/operations/evidence/hosted-restore.json" }),
    storage: evidenceRecord({ file: "docs/operations/evidence/storage-drain.json" }),
    finalizer: evidenceRecord({ file: "docs/operations/evidence/finalizer.json" }),
    ...overrides,
  };
}

const BACKUP_CONTRACT = { id: "amora-db-current-baseline", version: 1 };

function pin(manifest, { evidence = pinnedEvidence(), backupContract = BACKUP_CONTRACT } = {}) {
  manifest.status = "evidence_pinned";
  manifest.deploymentEvidence = evidence;
  manifest.backupContract = backupContract;
  return manifest;
}

function expectBlocked(root, code) {
  try {
    validateSuccessorReleaseContract({ repoRoot: root });
  } catch (error) {
    assert.ok(error instanceof SuccessorReleaseContractError, `예상과 다른 오류: ${error}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`통과하면 안 되는데 통과했다 (기대 코드: ${code})`);
}

test("차단 상태 매니페스트는 지금까지처럼 그대로 통과하고 차단으로 판정된다", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  assert.equal(result.deploymentBlocked, true);
  assert.equal(result.releaseCommit, null);
  assert.equal(result.manifest.status, "deployment_blocked");
  assert.equal(result.forwardOnlySecurityOperationCount, 1);
  assert.equal(result.requiredDocumentCount, 1);
});

test("successor pins the deferred public-identity cutover and its rollout gate", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: REPO_ROOT });
  const [operation] = result.manifest.forwardOnlySecurityOperations;
  assert.equal(operation.id, "community-public-identity-contract-20260803104500");
  assert.equal(operation.phase, "post-application-deploy");
  assert.equal(
    operation.requiredGate,
    "minimum-supported-community-client-version-enforced",
  );
  assert.equal(operation.rollbackPolicy, "forward-fix-only-no-auth-uuid-regrant");
});

test("successor rejects operation, evidence, or rollout-document drift", () => {
  expectBlocked(
    fixture((manifest) => {
      manifest.forwardOnlySecurityOperations[0].requiredGate = "skipped";
      return manifest;
    }),
    "FORWARD_ONLY_SECURITY_OPERATIONS_INVALID",
  );
  expectBlocked(
    fixture((manifest) => {
      manifest.forwardOnlySecurityOperations[0].apply.sha256 = "0".repeat(64);
      return manifest;
    }),
    "PIN_HASH_MISMATCH",
  );
  expectBlocked(
    fixture((manifest) => {
      manifest.requiredDocuments[0].sha256 = "0".repeat(64);
      return manifest;
    }),
    "PIN_HASH_MISMATCH",
  );
});

test("증거 5종이 같은 커밋에 묶여 있으면 고정 상태로 통과한다", () => {
  const result = validateSuccessorReleaseContract({ repoRoot: fixture((m) => pin(m)) });
  assert.equal(result.deploymentBlocked, false);
  assert.equal(result.releaseCommit, RELEASE_COMMIT);
});

test("증거가 하나라도 missing이면 고정 상태로 열리지 않는다", () => {
  expectBlocked(
    fixture((m) => pin(m, { evidence: pinnedEvidence({ hostedRestore: "missing" }) })),
    "DEPLOYMENT_EVIDENCE_INVALID",
  );
});

test("증거가 서로 다른 커밋에 묶여 있으면 차단한다", () => {
  expectBlocked(
    fixture((m) => pin(m, {
      evidence: pinnedEvidence({ storage: evidenceRecord({ releaseCommit: OTHER_COMMIT }) }),
    })),
    "DEPLOYMENT_EVIDENCE_COMMIT_DRIFT",
  );
});

test("고정 상태인데 backupContract가 없으면 형태 위반이다", () => {
  expectBlocked(
    fixture((m) => {
      pin(m);
      delete m.backupContract;
      return m;
    }),
    "MANIFEST_SHAPE_INVALID",
  );
});

test("차단 상태에 backupContract만 몰래 넣어 둘 수 없다", () => {
  expectBlocked(
    fixture((m) => {
      m.backupContract = BACKUP_CONTRACT;
      return m;
    }),
    "MANIFEST_SHAPE_INVALID",
  );
});

test("알 수 없는 status는 거부한다", () => {
  expectBlocked(
    fixture((m) => {
      m.status = "ready";
      return m;
    }),
    "DEPLOYMENT_STATUS_INVALID",
  );
});

test("증거 기록의 필드가 모자라거나 남으면 거부한다", () => {
  const withoutField = evidenceRecord();
  delete withoutField.capturedAt;
  expectBlocked(
    fixture((m) => pin(m, { evidence: pinnedEvidence({ backup: withoutField }) })),
    "DEPLOYMENT_EVIDENCE_INVALID",
  );
  expectBlocked(
    fixture((m) => pin(m, {
      evidence: pinnedEvidence({ backup: evidenceRecord({ note: "여분" }) }),
    })),
    "DEPLOYMENT_EVIDENCE_INVALID",
  );
});

test("증거 파일 경로가 위험하면 거부한다", () => {
  for (const file of [
    "../outside/receipt.json",
    "/etc/passwd",
    "docs//receipt.json",
    "docs\\\\windows\\\\receipt.json",
    // 자격증명이 섞였을 법한 이름은 파일 단계에서 먼저 막는다.
    "docs/operations/service-role-secret.json",
  ]) {
    expectBlocked(
      fixture((m) => pin(m, { evidence: pinnedEvidence({ backup: evidenceRecord({ file }) }) })),
      "DEPLOYMENT_EVIDENCE_INVALID",
    );
  }
});

test("해시·시각·커밋 형식이 어긋나면 거부한다", () => {
  for (const overrides of [
    { sha256: "짧은해시" },
    { sha256: "A".repeat(64) },
    { capturedAt: "2026-07-26 00:31:05" },
    { capturedAt: "어제" },
    { releaseCommit: "180e97c5" },
  ]) {
    expectBlocked(
      fixture((m) => pin(m, { evidence: pinnedEvidence({ backup: evidenceRecord(overrides) }) })),
      "DEPLOYMENT_EVIDENCE_INVALID",
    );
  }
});

test("적어 둔 해시와 실제 파일이 다르면 거부한다", () => {
  expectBlocked(
    fixture((m) => pin(m, { evidence: pinnedEvidence({ backup: evidenceRecord({ sha256: SHA }) }) })),
    "PIN_HASH_MISMATCH",
  );
});

test("증거 파일이 지정 디렉터리 밖이면 거부한다", () => {
  expectBlocked(
    fixture((m) => pin(m, {
      evidence: pinnedEvidence({ backup: evidenceRecord({ file: "docs/operations/receipt.json" }) }),
    })),
    "DEPLOYMENT_EVIDENCE_INVALID",
  );
});

test("증거 파일이 아예 없으면 거부한다", () => {
  const root = fixture((m) => pin(m));
  rmSync(join(root, "docs", "operations", "evidence", "backup-receipt.json"), { force: true });
  expectBlocked(root, "PIN_MISSING");
});

test("증거 분류가 5종에서 늘거나 줄면 거부한다", () => {
  const extra = pinnedEvidence();
  extra.extraClass = evidenceRecord();
  expectBlocked(fixture((m) => pin(m, { evidence: extra })), "DEPLOYMENT_EVIDENCE_INVALID");

  const fewer = pinnedEvidence();
  delete fewer.storage;
  expectBlocked(fixture((m) => pin(m, { evidence: fewer })), "DEPLOYMENT_EVIDENCE_INVALID");
});
