import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "../..");
const fenceSource = join(repoRoot, "scripts", "supabase-release-fence.mjs");

function sha256(content) {
  return createHash("sha256").update(content.replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

async function write(root, path, content) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "hanbang-release-fence-"));
  await mkdir(join(root, "scripts"), { recursive: true });
  await cp(fenceSource, join(root, "scripts", "supabase-release-fence.mjs"));

  const historicalAudit = "select 'verified';\n";
  const previousMigration = "select 'previous';\n";
  const currentMigration = "select 'current';\n";
  const currentDocument = "# Current release\n";
  const previousManifest = {
    release: "previous",
    projectRef: "test-project",
    migrationFloor: "20260714000000",
    historicalReconciliation: [
      { file: "20260714000000_previous.sql", sha256: sha256(previousMigration) },
    ],
    expandMigrations: [],
    appliedHotfixes: [],
    historicalEffectAudit: {
      file: "supabase/contract-migrations/historical.sql",
      sha256: sha256(historicalAudit),
    },
    manualPlatformOperations: [],
    requiredDocuments: [],
  };
  const currentManifest = {
    release: "current",
    projectRef: "test-project",
    predecessorManifest: {
      file: "supabase/release-manifests/amora-openai-20260714.json",
      sha256: sha256(`${JSON.stringify(previousManifest, null, 2)}\n`),
    },
    migrationFloor: "20260716000000",
    historicalReconciliation: [],
    expandMigrations: [
      { file: "20260716000000_current.sql", sha256: sha256(currentMigration) },
    ],
    appliedHotfixes: [],
    historicalEffectAudit: {
      file: "supabase/contract-migrations/historical.sql",
      sha256: sha256(historicalAudit),
    },
    manualPlatformOperations: [],
    requiredDocuments: [
      { file: "docs/current.md", sha256: sha256(currentDocument) },
    ],
  };

  await write(root, "supabase/release-manifests/amora-openai-20260714.json", `${JSON.stringify(previousManifest, null, 2)}\n`);
  await write(root, "supabase/release-manifests/amora-engine-v2-20260716.json", `${JSON.stringify(currentManifest, null, 2)}\n`);
  await write(root, "supabase/migrations/20260714000000_previous.sql", previousMigration);
  await write(root, "supabase/migrations/20260716000000_current.sql", currentMigration);
  await write(root, "supabase/contract-migrations/historical.sql", historicalAudit);
  await write(root, "docs/current.md", currentDocument);
  return root;
}

function runFence(root, args = []) {
  return spawnSync(process.execPath, [join(root, "scripts", "supabase-release-fence.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("이전 릴리스의 hash-pinned migration이 변조되면 정적 fence가 차단한다", async () => {
  const root = await createFixture();
  try {
    await write(root, "supabase/migrations/20260714000000_previous.sql", "select 'tampered';\n");
    const result = runFence(root);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /predecessor migration hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("이전 migration과 이전 manifest를 함께 바꿔도 현재 release pin이 차단한다", async () => {
  const root = await createFixture();
  try {
    const predecessorPath = join(
      root,
      "supabase/release-manifests/amora-openai-20260714.json",
    );
    const predecessor = JSON.parse(await readFile(predecessorPath, "utf8"));
    const tamperedMigration = "select 'coordinated-tamper';\n";
    predecessor.historicalReconciliation[0].sha256 = sha256(tamperedMigration);
    await write(root, "supabase/migrations/20260714000000_previous.sql", tamperedMigration);
    await write(
      root,
      "supabase/release-manifests/amora-openai-20260714.json",
      `${JSON.stringify(predecessor, null, 2)}\n`,
    );

    const result = runFence(root);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /predecessor release manifest hash mismatch/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
