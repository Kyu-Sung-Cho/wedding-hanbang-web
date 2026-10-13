// `scripts/tests` 에 있는 가드가 **전부 실제로 돌고 있는가.**
//
// ## 무엇이 있었나
//
// 2026-08-22 실측: `scripts/tests` 에 29개가 있는데 `test:repo` 는 27개만 돌고 있었다.
// 빠진 둘은 껍데기가 아니었다 —
//
//   - `amora-release-sql-contract.test.mjs` (498줄): 릴리스 점검 SQL 이 읽기 전용이고
//     fail-closed 인지 본다. 뮤테이션으로 확인: `BEGIN TRANSACTION READ ONLY;` 를
//     `BEGIN;` 으로 바꾸니 6/6 → 5/6. **진짜로 무는 가드인데 아무도 안 불렀다.**
//   - `community-release-readiness.test.mjs` (31줄): 빈 디렉터리로 fail-closed 자가검증까지
//     내장하고 있다.
//
// 가드를 새로 쓰면서 `package.json` 의 긴 한 줄에 파일명을 덧붙이는 것을 잊으면,
// 그 가드는 **초록불도 빨간불도 아닌 채로** 저장소에 눕는다. 아무도 모른다.
//
// ## 왜 목록을 손으로 안 적나
//
// 손으로 적은 목록은 그 자체가 같은 방식으로 썩는다. 디렉터리를 읽어 대조한다.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const testsDir = resolve(repoRoot, "scripts/tests");

/** 일부러 `test:repo` 밖에 두는 파일. 넣을 때는 **왜인지** 여기 적는다. */
const INTENTIONALLY_UNWIRED = new Map([
  // (지금은 없다. 네트워크나 운영 자격증명을 요구하는 검사가 생기면 여기에 적는다.)
]);

function wiredFiles() {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  const script = pkg.scripts?.["test:repo"] ?? "";
  return new Set(
    [...script.matchAll(/scripts\/tests\/([A-Za-z0-9._-]+\.test\.mjs)/g)].map((m) => m[1]),
  );
}

test("측정기가 살아 있다", () => {
  // 어느 쪽이든 0건이면 아래 대조가 조용히 통과한다. 그쪽을 먼저 막는다.
  const onDisk = readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs"));
  assert.ok(onDisk.length > 20, `scripts/tests 에서 ${onDisk.length}개만 찾았습니다`);
  assert.ok(wiredFiles().size > 20, `test:repo 에서 ${wiredFiles().size}개만 찾았습니다`);
});

test("scripts/tests 의 모든 가드가 test:repo 에서 실제로 돈다", () => {
  const onDisk = readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs"));
  const wired = wiredFiles();

  const missing = onDisk.filter((f) => !wired.has(f) && !INTENTIONALLY_UNWIRED.has(f));
  assert.deepEqual(
    missing,
    [],
    `아무도 부르지 않는 가드가 있습니다: ${missing.join(", ")}. `
      + "package.json 의 test:repo 에 넣거나, 일부러 빼는 것이라면 "
      + "이 파일의 INTENTIONALLY_UNWIRED 에 이유와 함께 적으세요.",
  );
});

test("test:repo 가 없는 파일을 부르지 않는다", () => {
  // 반대 방향도 본다. 파일을 지우면서 스크립트를 안 고치면 게이트가 통째로 죽는다.
  const onDisk = new Set(readdirSync(testsDir).filter((f) => f.endsWith(".test.mjs")));
  const ghosts = [...wiredFiles()].filter((f) => !onDisk.has(f));
  assert.deepEqual(ghosts, [], `test:repo 가 없는 파일을 부릅니다: ${ghosts.join(", ")}`);
});

test("DB 검증의 동시 실행 제한은 파일명 앞의 실제 Node 옵션으로 전달한다", () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
  assert.ok(pkg.scripts["test:repo"].startsWith("pnpm test:ingest && node --test --test-concurrency=2 "));
  assert.ok(pkg.scripts["supabase:release:test"].startsWith("node --test --test-concurrency=2 "));
  for (const name of ["test:repo", "supabase:release:test"]) {
    assert.equal(pkg.scripts[name].match(/--test-concurrency=/g)?.length, 1);
  }
});
