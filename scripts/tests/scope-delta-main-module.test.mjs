/**
 * **scope-delta 는 링크를 거쳐 실행해도 본체를 돈다(2026-09-15 재검사 [10]).**
 *
 * `isMainModule` 이 `pathToFileURL(process.argv[1])` 과 `import.meta.url` 을 그대로 비교했다.
 * Node 는 ESM 진입점의 `import.meta.url` 을 실제 경로(realpath)로 풀지만 `process.argv[1]` 은
 * 주어진 경로를 절대 경로로만 만든다. 그래서 심볼릭 링크·정션을 거친 경로로 실행하면 두 값이
 * 달라 `main()` 을 건너뛰고 측정·출력·`--out` 파일 없이 exit 0 으로 끝났다. 그 조용한 통과가
 * '회귀 없음'처럼 읽힌다.
 *
 * 여기서는 인자 없이 실행한다. 본체가 돌면 사용법 오류(exit 2)로 멈추므로 판정기 파일을 바꿔
 * 끼우는 측정까지 가지 않는다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SCRIPTS_DIR, "scope-delta.mjs");

function runNode(args, cwd = SCRIPTS_DIR) {
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 60_000 });
}

/** scripts 디렉터리를 가리키는 링크(Windows 는 관리자 권한이 필요 없는 정션)를 만든다. */
function withLinkedScriptsDir(fn) {
  const temp = mkdtempSync(join(tmpdir(), "scope-delta-link-"));
  const link = join(temp, "linked-scripts");
  try {
    symlinkSync(SCRIPTS_DIR, link, process.platform === "win32" ? "junction" : "dir");
    return fn(link);
  } finally {
    // 링크만 지운다. `recursive` 로 링크 너머의 실제 scripts 를 지우지 않도록 링크를 먼저 끊는다.
    rmSync(link, { force: true });
    rmSync(temp, { recursive: true, force: true });
  }
}

test("scope-delta: 실제 경로로 실행하면 본체가 돈다(인자 없음 → 사용법 오류)", () => {
  const result = runNode([SCRIPT]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /사용법: node scripts\/scope-delta\.mjs/);
});

test("scope-delta: 링크·정션을 거친 경로로 실행해도 본체를 조용히 건너뛰지 않는다", () => {
  withLinkedScriptsDir((link) => {
    const result = runNode([join(link, "scope-delta.mjs")]);
    assert.equal(result.status, 2, `exit ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stderr, /사용법: node scripts\/scope-delta\.mjs/);
  });
});

test("scope-delta: 다른 진입점이 가져가기만 하면 링크 경로여도 본체를 돌리지 않는다", () => {
  withLinkedScriptsDir((link) => {
    const linkedUrl = pathToFileURL(join(link, "scope-delta.mjs")).href;
    const result = runNode([
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(linkedUrl)}); console.log(typeof m.compareScopeDelta);`,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "function");
    assert.doesNotMatch(result.stderr, /사용법/);
  });
});
