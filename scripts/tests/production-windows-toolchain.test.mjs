import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProductionToolchainError,
  resolvePinnedWindowsProductionToolchain,
  verifyPinnedExecutableSnapshot,
} from "../lib/production-windows-toolchain.mjs";

test("pinned executable verification hashes the exact opened byte snapshot", async () => {
  const root = await mkdtemp(join(tmpdir(), "hanbang-toolchain-"));
  const path = join(root, "tool.exe");
  const bytes = Buffer.from("fixture trusted executable\n", "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  try {
    await writeFile(path, bytes);
    assert.equal(await verifyPinnedExecutableSnapshot(path, sha256), path);
    await assert.rejects(
      verifyPinnedExecutableSnapshot(path, "0".repeat(64)),
      (error) => error instanceof ProductionToolchainError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production toolchain fails closed on a spoofed Windows root before execution", async () => {
  await assert.rejects(
    resolvePinnedWindowsProductionToolchain({
      platform: "win32",
      environment: { SystemRoot: "C:\\attacker", WINDIR: "C:\\attacker" },
    }),
    (error) => error instanceof ProductionToolchainError
      && error.code === "PRODUCTION_TOOLCHAIN_INVALID",
  );
});

test(
  "the current Windows release host matches both protected executable pins",
  { skip: process.platform !== "win32" },
  async () => {
    const toolchain = await resolvePinnedWindowsProductionToolchain();
    assert.match(toolchain.git, /[\\/]git\.exe$/i);
    assert.match(toolchain.powershell, /[\\/]powershell\.exe$/i);
  },
);
