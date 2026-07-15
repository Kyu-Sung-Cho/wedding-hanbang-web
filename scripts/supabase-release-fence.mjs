import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const manifestPath = join(
  repoRoot,
  "supabase",
  "release-manifests",
  "amora-openai-20260714.json"
);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const args = new Set(process.argv.slice(2));

function fail(message) {
  console.error(`SUPABASE_RELEASE_FENCE_BLOCKED: ${message}`);
  process.exit(1);
}

function sha256(path) {
  // Git may materialize text files with CRLF on Windows and LF on Linux.
  // Hash canonical UTF-8 text so the release fence detects content changes
  // without rejecting an otherwise identical checkout on another OS.
  const canonicalText = readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
  return createHash("sha256").update(canonicalText, "utf8").digest("hex");
}

function filesFor(section) {
  return manifest[section].map((entry) => entry.file);
}

function verifyHashPinnedArtifact(entry, label) {
  const path = join(repoRoot, entry.file);
  if (!existsSync(path)) fail(`${label} missing: ${entry.file}`);
  const actual = sha256(path);
  if (actual !== entry.sha256) {
    fail(`${label} hash mismatch for ${entry.file}; expected ${entry.sha256}, received ${actual}`);
  }
}

function verifyStaticManifest() {
  const declared = [
    ...manifest.historicalReconciliation,
    ...manifest.expandMigrations,
  ];
  const declaredNames = new Set(declared.map((entry) => entry.file));
  const migrationDir = join(repoRoot, "supabase", "migrations");

  for (const entry of declared) {
    const path = join(migrationDir, entry.file);
    if (!existsSync(path)) fail(`manifest file missing: ${entry.file}`);
    const actual = sha256(path);
    if (actual !== entry.sha256) {
      fail(`hash mismatch for ${entry.file}; expected ${entry.sha256}, received ${actual}`);
    }
  }

  const releaseEraFiles = readdirSync(migrationDir)
    .filter((name) => /^\d{14}_.+\.sql$/.test(name))
    .filter((name) => name.slice(0, 14) >= manifest.migrationFloor);
  const unexpected = releaseEraFiles.filter((name) => !declaredNames.has(name));
  const missing = [...declaredNames].filter((name) => !releaseEraFiles.includes(name));
  if (unexpected.length || missing.length) {
    fail(`release-era migration set drifted; unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}`);
  }

  verifyHashPinnedArtifact(
    manifest.historicalEffectAudit,
    "historical effect audit"
  );
  for (const entry of manifest.manualPlatformOperations) {
    verifyHashPinnedArtifact(entry, "manual platform operation");
  }
  for (const entry of manifest.requiredDocuments) {
    verifyHashPinnedArtifact(entry, "required release document");
  }

  console.log(`Static release manifest verified (${declared.length} migrations, ${manifest.manualPlatformOperations.length} platform operations, ${manifest.requiredDocuments.length} required documents).`);
}

function parsePending(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[•*]\s+([^\s]+\.sql)\s*$/)?.[1] ?? null)
    .filter(Boolean);
}

function assertExact(actual, expected, label) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const unexpected = actual.filter((file) => !expectedSet.has(file));
  const missing = expected.filter((file) => !actualSet.has(file));
  if (actual.length !== actualSet.size) fail(`${label}: duplicate pending migration names`);
  if (unexpected.length || missing.length) {
    fail(`${label}: pending set mismatch; unexpected=${unexpected.join(",") || "none"}; missing=${missing.join(",") || "none"}`);
  }
}

function verifyRemotePending() {
  const expectedMode = process.argv.find((arg) => arg.startsWith("--expect="))?.split("=")[1];
  if (!expectedMode || !["before-reconcile", "expand-only", "clean"].includes(expectedMode)) {
    fail("--remote requires --expect=before-reconcile|expand-only|clean");
  }

  const linkedRefPath = join(repoRoot, "supabase", ".temp", "project-ref");
  if (!existsSync(linkedRefPath)) fail("Supabase project is not linked");
  const linkedRef = readFileSync(linkedRefPath, "utf8").trim();
  const expectedRef = process.argv.find((arg) => arg.startsWith("--project-ref="))?.split("=")[1]
    ?? manifest.projectRef;
  if (linkedRef !== expectedRef) {
    fail(`linked project mismatch; expected ${expectedRef}, received ${linkedRef}`);
  }

  const supabaseCli = join(repoRoot, "node_modules", "supabase", "dist", "supabase.js");
  if (!existsSync(supabaseCli)) fail("Supabase CLI is not installed; run pnpm install --frozen-lockfile");
  const result = spawnSync(
    process.execPath,
    [supabaseCli, "db", "push", "--linked", "--dry-run"],
    { cwd: repoRoot, encoding: "utf8", shell: false }
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error) fail(`Supabase CLI could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`Supabase dry-run failed\n${output}`);
  const pending = parsePending(output);
  const expected = expectedMode === "before-reconcile"
    ? [...filesFor("historicalReconciliation"), ...filesFor("expandMigrations")]
    : expectedMode === "expand-only"
      ? filesFor("expandMigrations")
      : [];
  assertExact(pending, expected, expectedMode);
  console.log(`Remote pending set verified for ${linkedRef}: ${expectedMode} (${pending.length} migrations).`);
}

verifyStaticManifest();

if (args.has("--refuse-direct-push")) {
  fail("direct push/history-repair entry points are disabled; follow docs/operations/AMORA_PRODUCTION_RELEASE.md");
}
if (args.has("--remote")) verifyRemotePending();
