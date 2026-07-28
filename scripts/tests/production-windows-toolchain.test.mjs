import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  PINNED_WINDOWS_PRODUCTION_TOOLCHAIN,
  ProductionToolchainError,
  resolvePinnedWindowsProductionToolchain,
  verifyPinnedExecutableSnapshot,
} from "../lib/production-windows-toolchain.mjs";

/** 핀 경로에 파일이 둘 다 있으면 릴리스 호스트 후보다. 바이트 일치는 따로 본다. */
async function isReleaseHostCandidate() {
  const present = await Promise.all(
    [
      PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git.path,
      PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.powershell.path,
    ].map((path) => stat(path).then((entry) => entry.isFile()).catch(() => false)),
  );
  return present.every(Boolean);
}

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

// 핀 상수가 표준 설치 경로를 가리키는지 먼저 본다. 이게 없으면 아래 분기 판정을
// 핀 경로를 존재하지 않는 값으로 바꿔 우회할 수 있다 — "릴리스 호스트가 아니다"
// 쪽으로 조용히 넘어가 버린다.
test("release host pins keep the canonical install paths and hash shape", () => {
  assert.equal(
    PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git.path,
    "C:\\Program Files\\Git\\mingw64\\bin\\git.exe",
  );
  assert.equal(
    PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.powershell.path,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  for (const pinned of [
    PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.git,
    PINNED_WINDOWS_PRODUCTION_TOOLCHAIN.powershell,
  ]) {
    assert.match(pinned.sha256, /^[A-F0-9]{64}$/);
  }
});

/**
 * 호스트에 따라 **양쪽 다 단정한다.**
 *
 * 예전에는 win32면 무조건 "두 핀과 일치해야 한다"고 봤다. 그래서 릴리스 호스트가
 * 아닌 컴퓨터에서는 코드가 멀쩡해도 루트 게이트가 빨간불이었다(2026-07-28 실측:
 * 이 컴퓨터의 git은 `C:\src\flutter\bin\mingw64\bin`에 있어 핀 경로에 없다).
 * 코드 신호와 호스트 신원이 한 판정에 섞여 있어서, 빨간불을 봐도 내가 무엇을
 * 깼는지 알 수 없었다 — 신호가 없는 것과 같다.
 *
 * 그렇다고 건너뛰면 릴리스 fence가 검증되지 않는다. 그래서 갈라서 단정한다.
 * 어느 쪽이든 실패할 수 있는 단정이 남으므로 조용히 통과하지 않는다.
 * fence 자체(`resolvePinnedWindowsProductionToolchain`)는 손대지 않았다 — 이
 * 컴퓨터에서 운영 릴리스는 여전히 거부된다.
 */
test(
  "this Windows host either matches both release pins or is refused a release",
  { skip: process.platform !== "win32" },
  async () => {
    if (await isReleaseHostCandidate()) {
      const toolchain = await resolvePinnedWindowsProductionToolchain();
      assert.match(toolchain.git, /[\\/]git\.exe$/i);
      assert.match(toolchain.powershell, /[\\/]powershell\.exe$/i);
      return;
    }
    // 릴리스 호스트가 아니다. 여기서 정답은 통과가 아니라 **거부**다.
    await assert.rejects(
      resolvePinnedWindowsProductionToolchain(),
      (error) => error instanceof ProductionToolchainError
        && error.code === "PRODUCTION_TOOLCHAIN_INVALID",
      "릴리스 호스트가 아닌데 운영 릴리스 도구 해석이 통과했다",
    );
  },
);
