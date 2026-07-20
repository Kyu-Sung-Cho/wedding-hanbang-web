import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ArtifactIntegrityError,
  canonicalJsonSha256ExcludingField,
  prepareDeterministicStateArtifactWritePath,
  requireStrictPathHashPair,
  verifyDeterministicStateArtifactPath,
  verifyJsonContentHash,
} from "../artifact-integrity.js";

async function stateFixture(t: test.TestContext): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-artifact-integrity-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state");
  await mkdir(stateDir, { recursive: true });
  return stateDir;
}

function linkCreationUnavailable(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false;
  return ["EACCES", "ENOSYS", "EPERM", "UNKNOWN"].includes(String(error.code));
}

test("a deterministic regular artifact resolves to its verified real path", async (t) => {
  const stateDir = await stateFixture(t);
  const relativePath = path.join("scoring", "overlay.json");
  const artifactPath = path.join(stateDir, relativePath);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, "{}\n", "utf8");

  const verifiedPath = await verifyDeterministicStateArtifactPath({
    stateDir,
    artifactPath,
    expectedRelativePath: relativePath,
  });

  assert.equal(verifiedPath, await realpath(artifactPath));
});

test("an absolute artifact outside state is rejected", async (t) => {
  const stateDir = await stateFixture(t);
  const artifactPath = path.join(path.dirname(stateDir), "outside.json");
  await writeFile(artifactPath, "{}\n", "utf8");

  await assert.rejects(
    verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath,
      expectedRelativePath: path.join("scoring", "overlay.json"),
    }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_path_outside_state",
  );
});

test("an in-state artifact at the wrong deterministic path is rejected", async (t) => {
  const stateDir = await stateFixture(t);
  const artifactPath = path.join(stateDir, "scoring", "substituted.json");
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, "{}\n", "utf8");

  await assert.rejects(
    verifyDeterministicStateArtifactPath({
      stateDir,
      artifactPath,
      expectedRelativePath: path.join("scoring", "overlay.json"),
    }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_path_not_deterministic",
  );
});

test("a file symlink at the deterministic path is rejected", async (t) => {
  const stateDir = await stateFixture(t);
  const targetPath = path.join(stateDir, "targets", "real.json");
  const relativePath = path.join("scoring", "overlay.json");
  const artifactPath = path.join(stateDir, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(targetPath, "{}\n", "utf8");
  try {
    await symlink(targetPath, artifactPath, "file");
  } catch (error) {
    if (linkCreationUnavailable(error)) {
      t.skip(`file symlink creation unavailable: ${String((error as NodeJS.ErrnoException).code)}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    verifyDeterministicStateArtifactPath({ stateDir, artifactPath, expectedRelativePath: relativePath }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_path_reparse_point",
  );
});

test("a directory junction in the deterministic path is rejected", async (t) => {
  const stateDir = await stateFixture(t);
  const targetDirectory = path.join(stateDir, "real-scoring");
  const junctionDirectory = path.join(stateDir, "scoring");
  const relativePath = path.join("scoring", "overlay.json");
  const artifactPath = path.join(stateDir, relativePath);
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(path.join(targetDirectory, "overlay.json"), "{}\n", "utf8");
  try {
    await symlink(
      targetDirectory,
      junctionDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (linkCreationUnavailable(error)) {
      t.skip(`directory junction creation unavailable: ${String((error as NodeJS.ErrnoException).code)}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    verifyDeterministicStateArtifactPath({ stateDir, artifactPath, expectedRelativePath: relativePath }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_path_reparse_point",
  );
});

test("realpath containment rejects a directory junction that escapes state", async (t) => {
  const stateDir = await stateFixture(t);
  const targetDirectory = path.join(path.dirname(stateDir), "outside-scoring");
  const junctionDirectory = path.join(stateDir, "scoring");
  const relativePath = path.join("scoring", "overlay.json");
  const artifactPath = path.join(stateDir, relativePath);
  await mkdir(targetDirectory, { recursive: true });
  await writeFile(path.join(targetDirectory, "overlay.json"), "{}\n", "utf8");
  try {
    await symlink(
      targetDirectory,
      junctionDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (linkCreationUnavailable(error)) {
      t.skip(`directory junction creation unavailable: ${String((error as NodeJS.ErrnoException).code)}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    verifyDeterministicStateArtifactPath({ stateDir, artifactPath, expectedRelativePath: relativePath }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_path_outside_state",
  );
});

test("a directory at the deterministic artifact path is rejected as non-regular", async (t) => {
  const stateDir = await stateFixture(t);
  const relativePath = path.join("scoring", "overlay.json");
  const artifactPath = path.join(stateDir, relativePath);
  await mkdir(artifactPath, { recursive: true });

  await assert.rejects(
    verifyDeterministicStateArtifactPath({ stateDir, artifactPath, expectedRelativePath: relativePath }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_not_regular_file",
  );
});

test("a deterministic write path creates ordinary missing parent directories", async (t) => {
  const stateDir = await stateFixture(t);
  const relativePath = path.join(".cache", "extract", `${"a".repeat(64)}.json`);
  const artifactPath = path.join(stateDir, relativePath);

  const prepared = await prepareDeterministicStateArtifactWritePath({
    stateDir,
    artifactPath,
    expectedRelativePath: relativePath,
  });

  assert.equal(prepared, artifactPath);
  assert.equal(await realpath(path.dirname(artifactPath)), path.dirname(artifactPath));
});

test("a deterministic write path rejects a junction parent before writing", async (t) => {
  const stateDir = await stateFixture(t);
  const outsideDirectory = path.join(path.dirname(stateDir), "outside-cache");
  const cacheDirectory = path.join(stateDir, ".cache");
  const relativePath = path.join(".cache", "extract", `${"a".repeat(64)}.json`);
  await mkdir(outsideDirectory, { recursive: true });
  try {
    await symlink(
      outsideDirectory,
      cacheDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (linkCreationUnavailable(error)) {
      t.skip(`directory junction creation unavailable: ${String((error as NodeJS.ErrnoException).code)}`);
      return;
    }
    throw error;
  }

  await assert.rejects(
    prepareDeterministicStateArtifactWritePath({
      stateDir,
      artifactPath: path.join(stateDir, relativePath),
      expectedRelativePath: relativePath,
    }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_path_reparse_point",
  );
});

test("canonical JSON SHA-256 ignores the designated hash field and object key order", () => {
  const canonicalPayload = "{\"a\":1,\"nested\":{\"a\":true,\"z\":\"last\"}}";
  const expected = createHash("sha256").update(canonicalPayload, "utf8").digest("hex");

  const first = canonicalJsonSha256ExcludingField({
    nested: { z: "last", a: true },
    content_sha256: "a".repeat(64),
    a: 1,
  }, "content_sha256");
  const second = canonicalJsonSha256ExcludingField({
    a: 1,
    content_sha256: "b".repeat(64),
    nested: { a: true, z: "last" },
  }, "content_sha256");

  assert.equal(first, expected);
  assert.equal(second, expected);
});

test("a JSON payload with its canonical content hash verifies", () => {
  const payload: Record<string, unknown> = {
    schema_version: 2,
    data: { prices: [100_000, 200_000] },
    content_sha256: "",
  };
  payload.content_sha256 = canonicalJsonSha256ExcludingField(payload, "content_sha256");

  assert.equal(
    verifyJsonContentHash(payload, "content_sha256"),
    payload.content_sha256,
  );
});

test("content tampering is rejected even when the stored hash keeps a valid shape", () => {
  const payload: Record<string, unknown> = {
    schema_version: 2,
    data: { prices: [100_000, 200_000] },
    content_sha256: "",
  };
  payload.content_sha256 = canonicalJsonSha256ExcludingField(payload, "content_sha256");
  payload.data = { prices: [100_000, 999_999] };

  assert.throws(
    () => verifyJsonContentHash(payload, "content_sha256"),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_content_hash_mismatch",
  );
});

test("a shape-valid but incorrect stored content hash is rejected", () => {
  const payload = {
    schema_version: 2,
    data: { prices: [100_000] },
    content_sha256: "0".repeat(64),
  };

  assert.throws(
    () => verifyJsonContentHash(payload, "content_sha256"),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "artifact_content_hash_mismatch",
  );
});

test("a strict path/hash pair accepts both or neither and rejects partial input", () => {
  assert.equal(requireStrictPathHashPair({ label: "overlay" }), null);

  assert.throws(
    () => requireStrictPathHashPair({ artifactPath: "overlay.json", label: "overlay" }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "path_hash_pair_incomplete",
  );
  assert.throws(
    () => requireStrictPathHashPair({ expectedSha256: "a".repeat(64), label: "overlay" }),
    (error: unknown) => error instanceof ArtifactIntegrityError
      && error.code === "path_hash_pair_incomplete",
  );

  assert.deepEqual(requireStrictPathHashPair({
    artifactPath: "overlay.json",
    expectedSha256: "a".repeat(64),
    label: "overlay",
  }), {
    artifactPath: "overlay.json",
    expectedSha256: "a".repeat(64),
  });
});

test("a strict path/hash pair rejects blank paths and malformed SHA-256 values", () => {
  for (const input of [
    { artifactPath: "", expectedSha256: "a".repeat(64), label: "overlay" },
    { artifactPath: "overlay.json", expectedSha256: "not-a-sha256", label: "overlay" },
  ]) {
    assert.throws(
      () => requireStrictPathHashPair(input),
      (error: unknown) => error instanceof ArtifactIntegrityError
        && error.code === "path_hash_pair_invalid",
    );
  }
});
