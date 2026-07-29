import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * 이 저장소의 GitHub Actions는 계정 수준에서 막혀 있어 한 번도 실행된 적이 없다
 * (실측: 전체 이력 91회가 전부 스텝 0개로 1~9초 만에 실패). 따라서 푸시되는 코드를
 * 검사하는 것은 `.githooks/pre-push` 하나뿐이고, 그 훅이 새 컴퓨터에서 자동으로
 * 켜지지 않으면 안전망이 **조용히 0이 된다.**
 */
test("pre-push 게이트가 설치 시 자동으로 켜지도록 배선돼 있다", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts.prepare,
    "node ./scripts/install-git-hooks.mjs",
    "prepare가 빠지면 새 컴퓨터에서 훅이 안 켜지고 아무 경고도 안 난다",
  );
  assert.equal(pkg.scripts["hooks:install"], "git config core.hooksPath .githooks");
});

test("설치 스크립트가 꺼진 저장소에서 훅을 켠다", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "hooks-"));
  execFileSync("git", ["init", "-q"], { cwd: sandbox });
  mkdirSync(path.join(sandbox, ".githooks"), { recursive: true });
  writeFileSync(path.join(sandbox, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n");
  mkdirSync(path.join(sandbox, "scripts"), { recursive: true });
  cpSync(
    path.join(repoRoot, "scripts", "install-git-hooks.mjs"),
    path.join(sandbox, "scripts", "install-git-hooks.mjs"),
  );

  const read = () => {
    try {
      return execFileSync("git", ["config", "--get", "core.hooksPath"], {
        cwd: sandbox,
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  };

  assert.equal(read(), "", "새 저장소는 훅이 꺼져 있어야 전제가 성립한다");
  execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: sandbox });
  assert.equal(read(), ".githooks", "설치 후 훅이 켜져야 한다");

  // 두 번 돌려도 안전해야 한다 — pnpm install은 여러 번 돈다.
  execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: sandbox });
  assert.equal(read(), ".githooks");
});

test("사람이 직접 설정한 hooksPath를 덮어쓰지 않는다", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "hooks-keep-"));
  execFileSync("git", ["init", "-q"], { cwd: sandbox });
  mkdirSync(path.join(sandbox, ".githooks"), { recursive: true });
  writeFileSync(path.join(sandbox, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n");
  mkdirSync(path.join(sandbox, "scripts"), { recursive: true });
  cpSync(
    path.join(repoRoot, "scripts", "install-git-hooks.mjs"),
    path.join(sandbox, "scripts", "install-git-hooks.mjs"),
  );
  execFileSync("git", ["config", "core.hooksPath", ".myhooks"], { cwd: sandbox });

  execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: sandbox });

  const value = execFileSync("git", ["config", "--get", "core.hooksPath"], {
    cwd: sandbox,
    encoding: "utf8",
  }).trim();
  assert.equal(value, ".myhooks", "의도적으로 바꿔둔 설정을 뺏으면 안 된다");
});

test("git 저장소가 아니면 조용히 넘어간다", () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), "hooks-nogit-"));
  mkdirSync(path.join(sandbox, "scripts"), { recursive: true });
  cpSync(
    path.join(repoRoot, "scripts", "install-git-hooks.mjs"),
    path.join(sandbox, "scripts", "install-git-hooks.mjs"),
  );
  // 설치 실패가 pnpm install 전체를 막으면 안 된다.
  execFileSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd: sandbox });
});
