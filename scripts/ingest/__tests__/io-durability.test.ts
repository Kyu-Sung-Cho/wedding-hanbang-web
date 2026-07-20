import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isUnsupportedDirectoryMetadataSyncError,
  mkdirDurably,
  syncDirectoryMetadata,
  unlinkFileDurably,
  writeJsonFile,
} from "../io.js";

test("directory metadata sync ignores only documented Windows unsupported errors", () => {
  for (const code of ["EPERM", "EINVAL", "ENOTSUP", "ENOSYS"]) {
    assert.equal(
      isUnsupportedDirectoryMetadataSyncError(Object.assign(new Error(code), { code }), "win32"),
      true,
    );
    assert.equal(
      isUnsupportedDirectoryMetadataSyncError(Object.assign(new Error(code), { code }), "linux"),
      false,
    );
  }

  assert.equal(
    isUnsupportedDirectoryMetadataSyncError(
      Object.assign(new Error("unexpected I/O failure"), { code: "EIO" }),
      "win32",
    ),
    false,
  );
  assert.equal(isUnsupportedDirectoryMetadataSyncError(new Error("no code"), "win32"), false);
});

test("directory metadata sync attempts the real directory and fails closed for a missing path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-dir-sync-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const outcome = await syncDirectoryMetadata(root);
  assert.ok(outcome === "synced" || (process.platform === "win32" && outcome === "unsupported"));

  await assert.rejects(syncDirectoryMetadata(path.join(root, "missing")), /ENOENT|no such file/iu);
});

test("atomic JSON publication remains readable after file and parent-directory sync", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-json-durable-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "nested", "artifact.json");

  await writeJsonFile(outputPath, { durable: true });

  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), { durable: true });
});

test("durable unlink removes the file before syncing its parent directory", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-unlink-durable-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "paid-call-intent.json");
  await writeFile(filePath, "pending", "utf8");

  await unlinkFileDurably(filePath);

  await assert.rejects(readFile(filePath), /ENOENT|no such file/iu);
  await assert.rejects(unlinkFileDurably(filePath), /ENOENT|no such file/iu);
});

test("durable recursive mkdir publishes every missing directory level", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hanbang-mkdir-durable-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const directoryPath = path.join(root, "one", "two", "three");

  await mkdirDurably(directoryPath);
  await mkdirDurably(directoryPath);

  assert.equal((await stat(directoryPath)).isDirectory(), true);
});
