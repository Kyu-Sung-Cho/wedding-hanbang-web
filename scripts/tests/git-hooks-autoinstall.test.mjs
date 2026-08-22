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

/**
 * 훅이 **켜져 있는 것**과 훅이 **무언가를 하는 것**은 다르다.
 *
 * 위 검사들은 `core.hooksPath` 가 `.githooks` 를 가리키는지만 본다. 그래서
 * `.githooks/pre-push` 를 `#!/bin/sh` + `exit 0` 껍데기로 바꿔도 **4/4 통과했다**
 * (2026-08-22 샌드박스에서 실제로 재현). 이 저장소의 CI 는 꺼져 있어 pre-push 가
 * 유일한 안전망인데, 그 안전망이 빈 껍데기가 되는 것을 아무도 못 봤다.
 *
 * 주석이 아니라 **실제 명령줄**을 본다. 처음 판은 파일 전체에서 "test" 를 찾았는데
 * 훅의 주석과 echo 문구에도 그 낱말이 있어서, `turbo run typecheck lint` 로 줄여도
 * 통과했다. 세는 자리를 틀리면 아무것도 못 지킨다.
 */
test("pre-push 훅이 빈 껍데기가 아니다", () => {
  const hook = readFileSync(path.join(repoRoot, ".githooks", "pre-push"), "utf8");

  assert.ok(
    hook.length > 300,
    `pre-push 훅이 ${hook.length}자뿐이다. 껍데기로 바뀐 것 같다.`,
  );

  const lines = hook
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  const runner = lines.find((line) => line.includes("turbo run"));
  assert.ok(runner, "pre-push 훅이 turbo 를 부르지 않는다. CI 가 꺼져 있어 이게 유일한 안전망이다.");

  const afterRun = runner.split("turbo run")[1] || "";
  const tasks = afterRun.split("--")[0].trim().split(/[ \t]+/u);
  for (const task of ["typecheck", "lint", "test"]) {
    assert.ok(
      tasks.includes(task),
      `pre-push 훅이 ${task} 를 안 돌린다 (도는 것: ${tasks.join(", ") || "없음"}).`,
    );
  }

  assert.ok(
    lines.some((line) => line === "exit 1"),
    "pre-push 훅에 실패 시 푸시를 막는 문장이 없다. 검사를 돌리기만 하고 결과를 버리는 셈이다.",
  );
});
