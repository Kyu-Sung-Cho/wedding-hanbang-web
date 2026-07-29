// pre-push 게이트를 **자동으로** 켠다. `pnpm install` 때 한 번 돈다.
//
// 왜 필요한가: 이 저장소의 GitHub Actions는 계정 수준에서 막혀 있어 지금까지 한 번도
// 실행된 적이 없다(실측: 전체 이력 91회가 전부 스텝 0개로 1~9초 만에 실패). 즉 푸시되는
// 코드를 검사하는 것은 `.githooks/pre-push` 하나뿐이다.
//
// 그런데 그 훅은 `git config core.hooksPath .githooks`를 각 컴퓨터에서 한 번 실행해야
// 켜진다. 새 컴퓨터에서 그걸 잊으면 **안전망이 조용히 0이 된다** — 아무 경고도 없이
// 그냥 안 켜진 채로 푸시가 된다. 그래서 설치 시점에 자동으로 켠다.
//
// 이미 다른 값으로 설정돼 있으면 덮어쓰지 않는다(의도적으로 바꿔둔 것일 수 있다).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: "pipe" }).trim();
}

try {
  // git 저장소가 아니면(예: tarball 설치) 조용히 넘어간다.
  git(["rev-parse", "--git-dir"]);
} catch {
  process.exit(0);
}

if (!existsSync(path.join(repoRoot, ".githooks", "pre-push"))) {
  process.exit(0);
}

let current = "";
try {
  current = git(["config", "--get", "core.hooksPath"]);
} catch {
  current = "";
}

if (current === ".githooks") {
  process.exit(0);
}

if (current) {
  console.warn(
    `[hooks] core.hooksPath가 이미 "${current}"로 설정돼 있어 건드리지 않는다.`
    + " pre-push 게이트를 쓰려면 `npx pnpm@11.7.0 hooks:install`을 직접 실행할 것.",
  );
  process.exit(0);
}

try {
  git(["config", "core.hooksPath", ".githooks"]);
  console.log("[hooks] pre-push 게이트를 켰다 (core.hooksPath=.githooks).");
} catch (error) {
  // 훅 설치 실패가 설치 전체를 막으면 안 된다. 경고만 남긴다.
  console.warn(`[hooks] pre-push 게이트를 켜지 못했다: ${error.message}`);
}
