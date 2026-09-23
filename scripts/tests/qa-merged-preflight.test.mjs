import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildQaMergedSummary } from "../lib/qa-merged-summary.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * `qa:merged`의 값은 전부 **전제 확인**에 있다.
 *
 * 낡은 main이나 더러운 작업 트리를 검사하고 초록불을 받으면, 그 초록불은 origin/main에 대한
 * 것이 아니다. 그런 초록불은 없는 것보다 나쁘다 — 사람이 그걸 믿고 배포한다.
 *
 * 그래서 이 테스트는 **막아야 할 상황에서 정말로 막는지**를 본다. 전제를 통과하는 경우는
 * `--preflight-only`로 확인한다(실제 검사는 12분 걸리므로 여기서 돌리지 않는다).
 */

/** qa:merged가 돌 수 있는 최소 저장소를 만든다. 원격은 로컬 bare 저장소로 흉내낸다. */
function makeSandbox() {
  const root = mkdtempSync(path.join(tmpdir(), "qa-merged-"));
  const work = path.join(root, "work");
  const origin = path.join(root, "origin.git");

  execFileSync("git", ["init", "--bare", "-q", origin]);
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  const git = (...args) => execFileSync("git", args, { cwd: work, encoding: "utf8" });
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");

  // 스크립트와 그 의존 모듈만 복사한다.
  for (const relative of [
    "scripts/qa-merged.mjs",
    "scripts/verify-local.mjs",
    "scripts/lib/local-qa-environment.mjs",
    "scripts/lib/qa-merged-summary.mjs",
    "scripts/lib/synthetic-supabase-environment.mjs",
  ]) {
    const target = path.join(work, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(repoRoot, relative), target);
  }
  writeFileSync(path.join(work, "marker.txt"), "one\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  git("remote", "add", "origin", origin);
  git("push", "-q", "origin", "main");

  return { work, git };
}

function run(work, args) {
  const result = spawnSync(process.execPath, ["scripts/qa-merged.mjs", ...args], {
    cwd: work,
    encoding: "utf8",
  });
  return { code: result.status, out: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

test("전제가 맞으면 통과한다", () => {
  const { work } = makeSandbox();
  const { code, out } = run(work, ["--preflight-only"]);
  assert.equal(code, 0, out);
  assert.match(out, /검사 대상 확정: main @ [0-9a-f]{8}/);
});

test("커밋 안 된 변경이 있으면 막는다", () => {
  const { work } = makeSandbox();
  writeFileSync(path.join(work, "marker.txt"), "dirty\n");
  const { code, out } = run(work, ["--preflight-only"]);
  assert.equal(code, 1, out);
  assert.match(out, /커밋되지 않은 변경/);
  assert.doesNotMatch(out, /검사 대상 확정/, "막았으면 대상을 확정했다고 말해선 안 된다");
});

test("추적되지 않은 파일도 출시 후보를 바꾸므로 막는다", () => {
  const { work } = makeSandbox();
  writeFileSync(path.join(work, "untracked-release-input.sql"), "select 1;\n");
  const { code, out } = run(work, ["--preflight-only"]);
  assert.equal(code, 1, out);
  assert.match(out, /커밋되지 않은 변경/);
  assert.doesNotMatch(out, /검사 대상 확정/, "untracked 입력을 무시하고 대상을 확정해선 안 된다");
});

test("--allow-unclean 을 주면 더러운 트리에서도 진행한다", () => {
  const { work } = makeSandbox();
  writeFileSync(path.join(work, "marker.txt"), "dirty\n");
  const { code, out } = run(work, ["--preflight-only", "--allow-unclean"]);
  assert.equal(code, 0, out);
});

test("main이 아니면 막는다", () => {
  const { work, git } = makeSandbox();
  git("checkout", "-q", "-b", "feature/x");
  const { code, out } = run(work, ["--preflight-only"]);
  assert.equal(code, 1, out);
  assert.match(out, /현재 브랜치가 "feature\/x"다/);
});

/**
 * 이게 이 명령의 핵심 가드다. 머지된 결과를 검사한다고 하면서 실제로는 **머지 전 main**을
 * 검사하면, 통과했다는 말이 거짓이 된다.
 */
test("origin/main보다 뒤처져 있으면 막고, 몇 개 뒤처졌는지 말한다", () => {
  const { work, git } = makeSandbox();
  writeFileSync(path.join(work, "marker.txt"), "two\n");
  git("add", "-A");
  git("commit", "-q", "-m", "second");
  writeFileSync(path.join(work, "marker.txt"), "three\n");
  git("add", "-A");
  git("commit", "-q", "-m", "third");
  git("push", "-q", "origin", "main");
  // 원격은 3커밋, 로컬 main은 1커밋으로 되돌린다.
  git("reset", "-q", "--hard", "HEAD~2");

  const { code, out } = run(work, ["--preflight-only"]);
  assert.equal(code, 1, out);
  assert.match(out, /HEAD가 origin\/main과 다르다/);
  assert.match(out, /뒤처짐 2/, "몇 개 뒤처졌는지 안 알려주면 사용자가 뭘 해야 할지 모른다");
});

test("origin/main보다 앞서 있어도 막는다 — 푸시 안 된 커밋은 main이 아니다", () => {
  const { work, git } = makeSandbox();
  writeFileSync(path.join(work, "marker.txt"), "local only\n");
  git("add", "-A");
  git("commit", "-q", "-m", "unpushed");

  const { code, out } = run(work, ["--preflight-only"]);
  assert.equal(code, 1, out);
  assert.match(out, /앞섬 1/);
});

test("연구 락이 남아 있으면 막고 지울 경로를 알려준다", () => {
  const { work } = makeSandbox();
  mkdirSync(path.join(work, "apps", "web"), { recursive: true });
  writeFileSync(path.join(work, "apps", "web", ".wedding-code-research.lock"), "pid\n");
  // 락은 청소 단계에서 본다 — preflight-only는 그 앞에서 끝나므로 전체 실행으로 확인한다.
  const { code, out } = run(work, [
    "--no-fetch",
    "--skip-build",
    "--allow-unclean",
  ]);
  assert.equal(code, 1, out);
  assert.match(out, /연구 락이 남아 있어/);
  assert.match(out, /\.wedding-code-research\.lock/);
});

test("--no-fetch 는 원격 조회 없이도 동작한다", () => {
  const { work } = makeSandbox();
  const { code, out } = run(work, ["--preflight-only", "--no-fetch"]);
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /원격 조회 중/);
});

/**
 * 검사 목록을 복사하면 두 곳이 조용히 어긋난다. qa:merged가 qa:local보다 적게 검사하면서
 * 초록불을 주는 것이 이 파일에서 막으려는 상황이다.
 */
test("qa:merged가 qa:local의 검사 목록을 그대로 쓴다", async () => {
  const verify = await import(
    new URL("../verify-local.mjs", import.meta.url).href
  );
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(path.join(repoRoot, "scripts", "qa-merged.mjs"), "utf8"),
  );

  assert.ok(Array.isArray(verify.checks) && verify.checks.length >= 11);
  assert.match(
    source,
    /import \{ checks, runCheck \} from "\.\/verify-local\.mjs"/,
    "목록을 import하지 않고 복사하면 두 곳이 어긋난다",
  );
  for (const check of verify.checks) {
    assert.ok(check.kind, `${check.name}: kind가 없으면 qa:merged가 순서를 못 정한다`);
    assert.ok(
      ["typecheck", "lint", "test", "build", "check"].includes(check.kind),
      `${check.name}: 모르는 kind "${check.kind}"는 정렬에서 맨 뒤로 밀린다`,
    );
  }
});

test("공유 QA 목록은 CI와 같은 후속 준비 스타일 계약을 실제 검사하고 배포 인가로 표시하지 않는다", async () => {
  const { checks } = await import("../verify-local.mjs");
  const fences = checks.filter(check => check.name === "supabase release fence");
  assert.equal(fences.length, 1);
  assert.deepEqual(fences[0].args, ["pnpm", "supabase:release:fence", "--wedding-code-pair-session"]);
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.scripts["supabase:release:fence"], "node ./scripts/supabase-release-fence.mjs");
  const result = spawnSync(process.execPath, ["scripts/supabase-release-fence.mjs", ...fences[0].args.slice(2)], {
    cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 30_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /WeddingCode pair session contract verified \(238 exact SQL files;/);
  assert.match(result.stdout, /runtime evidence not verified; deployment not authorized; no remote writes/);
});

/** 저장소 수준 검사를 빼먹으면 배포 펜스·인계 계약·훅 배선이 검사되지 않는다. */
test("저장소 수준 검사를 포함하고, 테스트를 두 번 돌리지 않는다", () => {
  const pkg = JSON.parse(
    execFileSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('package.json','utf8'))"], {
      cwd: repoRoot,
      encoding: "utf8",
    }),
  );
  assert.ok(pkg.scripts["test:repo"], "test:repo가 없으면 qa:merged가 부를 대상이 없다");
  assert.equal(pkg.scripts.test, "pnpm test:repo && turbo run test");
  assert.doesNotMatch(
    pkg.scripts["test:repo"],
    /turbo run test/,
    "test:repo에 turbo run test가 들어가면 web·mobile 테스트가 두 번 돈다",
  );
  assert.match(pkg.scripts["qa:merged"], /qa-merged\.mjs/);
});

/**
 * 실측으로 잡은 결함: `ingest:typecheck`는 루트 `typecheck` 스크립트에만 있어서
 * `verify-local`의 패키지별 tsc로는 `scripts/ingest/**`가 전혀 검사되지 않는다.
 * qa:merged가 이걸 빼면 ingest 코드는 아무 데서도 타입체크되지 않는다.
 */
test("ingest 타입체크가 포함돼 있다", async () => {
  const source = (await import("node:fs")).readFileSync(
    path.join(repoRoot, "scripts", "qa-merged.mjs"),
    "utf8",
  );
  const pkg = JSON.parse(
    (await import("node:fs")).readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  assert.ok(pkg.scripts["ingest:typecheck"], "부를 대상 스크립트가 있어야 한다");

  // 2026-08-19에 소유권이 옮겨졌다. GitHub Actions를 workflow_dispatch 전용으로 내리면서
  // CI에서만 돌던 저장소 수준 검사를 `verify-local`로 가져왔고, 그래서 `qa:local`이
  // 이제 이걸 덮는다. qa:merged는 verify-local의 목록을 그대로 쓰므로 따로 얹지 않는다.
  const verify = (await import("node:fs")).readFileSync(
    path.join(repoRoot, "scripts", "verify-local.mjs"),
    "utf8",
  );
  assert.match(verify, /"ingest:typecheck"/, "ingest 타입체크가 빠지면 그 코드는 아무도 안 본다");
  assert.match(verify, /"test:repo"/, "저장소 스크립트 테스트가 빠지면 배포 펜스가 검사되지 않는다");
  assert.match(verify, /"supabase:release:fence"/, "릴리스 펜스는 어디선가 반드시 돌아야 한다");

  // 두 곳이 같은 검사를 돌리면 qa:merged가 그만큼 느려지고, 목록이 조용히 어긋난다.
  assert.doesNotMatch(
    source,
    /"ingest:typecheck"|"test:repo"/,
    "verify-local이 이미 덮는다 — qa:merged에서 다시 얹지 말 것",
  );
});

/** 빌드가 제일 느리다. 빌드가 앞에 오면 타입 오류 하나를 12분 뒤에 본다. */
test("느린 빌드가 마지막으로 밀린다", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(path.join(repoRoot, "scripts", "qa-merged.mjs"), "utf8");
  // 2026-08-19부터 저장소 검사도 verify-local의 `checks` 안에 있다. 별도 배열을 합치는
  // 대신 그 하나를 정렬하면 되고, 정렬 밖으로 새는 검사가 없어야 한다는 요구는 같다.
  const sortAt = source.indexOf(".sort(");
  const mergeAt = source.indexOf("[...checks]");
  assert.ok(mergeAt >= 0, "verify-local의 검사 목록을 그대로 써야 한다");
  assert.ok(sortAt > mergeAt, "목록을 만든 뒤에 정렬해야 한다");
  assert.doesNotMatch(source, /repositoryChecks/, "정렬 밖에서 도는 별도 검사 배열이 없어야 한다");

  const ORDER = { typecheck: 0, lint: 1, check: 2, test: 3, build: 4 };
  const verify = await import(new URL("../verify-local.mjs", import.meta.url).href);
  const kinds = verify.checks.map((c) => ORDER[c.kind]);
  assert.ok(Math.max(...kinds) === ORDER.build, "빌드 검사가 존재해야 이 정렬이 의미가 있다");
});

/**
 * 실측으로 잡은 거짓 초록불: 첫 판이 「이 결과는 origin/main에 대한 것이 아니다」를 찍고
 * 바로 다음 줄에 「머지된 결과가 깨끗하다」고 단언했다. 사람은 마지막 줄을 읽는다.
 */
test("전제를 우회했으면 깨끗하다고 단언하지 않는다", () => {
  const result = buildQaMergedSummary({
    branch: "main",
    shortHead: "da6243ea",
    dirty: true,
    headMatchesRemote: true,
    flags: new Set(["--no-fetch", "--allow-unclean", "--skip-build"]),
    passedCount: 11,
    failures: [],
    minutes: 0,
  });
  const out = result.lines.join("\n");

  assert.equal(result.exitCode, 0);
  assert.equal(result.guaranteed, false);
  assert.doesNotMatch(
    out,
    /머지된 결과가 깨끗하다/,
    "우회한 실행이 무조건 초록불로 끝나면 경고를 적어둔 의미가 없다",
  );
  assert.match(out, /머지된 main에 대한 보증이 아니다/);
  assert.match(out, /검사 대상이 origin\/main이 아니다/);
  assert.match(out, /원격을 조회하지 않아/);
  assert.match(out, /빌드를 건너뛰어/);
});

test("모든 전제가 충족된 성공만 머지된 결과를 보증한다", () => {
  const result = buildQaMergedSummary({
    branch: "main",
    shortHead: "da6243ea",
    dirty: false,
    headMatchesRemote: true,
    flags: new Set(),
    passedCount: 13,
    failures: [],
    minutes: 12,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.guaranteed, true);
  assert.match(result.lines.join("\n"), /머지된 결과가 깨끗하다/);
});
