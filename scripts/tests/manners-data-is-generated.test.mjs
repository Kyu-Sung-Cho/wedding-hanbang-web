// `apps/web/src/lib/manners/data.ts` 가 **정말로 `parts.json` 에서 나온 것인가.**
//
// ## 무엇이 있었나
//
// `data.ts` 머리에 "이 파일은 생성물이다. 손으로 고치면 다음 재생성에서 사라진다" 고
// 적혀 있고, 생성기는 `--check` 옵션까지 갖고 있다(`generate.mjs:10`).
//
// **그런데 2026-08-26 실측: 저장소 전역에서 `generate.mjs` 를 부르는 곳이 0건이었다.**
// `package.json` 의 `test:repo` 목록에 없고, `turbo run test` 는 앱 단위라
// `scripts/` 를 타지 않는다. 즉 그 `--check` 는 한 번도 돈 적이 없다.
//
// 손으로 고친 `data.ts` 는 다음 재생성 때 조용히 되돌아간다. 예절 편의 절 제목은
// **앵커 조회 키**이기도 하다(`apps/web/src/lib/etiquette/noteSources.ts`) — 한쪽만
// 어긋나면 체크리스트의 「근거」 링크가 조용히 아무 데도 안 간다.
//
// ## 왜 diff 가 아니라 생성기를 부르나
//
// 직렬화 규칙(따옴표 이스케이프·필드 순서·카테고리 묶음)이 생성기 안에 있다. 그것을
// 여기 옮겨 적으면 두 벌이 되어 같은 방식으로 썩는다. 생성기를 그대로 돌린다.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const GENERATOR = resolve(repoRoot, "scripts/manners/generate.mjs");
const DATA = resolve(repoRoot, "apps/web/src/lib/manners/data.ts");

function runCheck() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [GENERATOR, "--check"], { encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

test("측정기가 살아 있다", () => {
  // `--check` 를 인식조차 못 하면서(옵션이 사라졌거나 이름이 바뀌었거나) 0을 돌려주면
  // 아래 검사가 통째로 무의미해진다. 생성기가 실제로 무엇을 읽는지부터 확인한다.
  const source = readFileSync(GENERATOR, "utf8");
  assert.ok(source.includes("--check"), "생성기에 --check 갈래가 없다");
  assert.ok(readFileSync(DATA, "utf8").length > 50_000, "data.ts 가 너무 작다 — 경로가 낡았다");
});

test("--check 가 실제로 어긋남을 잡는다", () => {
  // 통과만 확인하면 `--check` 가 무조건 0을 돌려줘도 초록불이다. 이 저장소는 그렇게
  // 재현율 0%짜리 가드를 초록불로 넘긴 적이 있다. 어긋난 상태를 만들어 실패를 본다.
  const original = readFileSync(DATA, "utf8");
  try {
    writeFileSync(DATA, `${original}\n// drift\n`, "utf8");
    assert.notEqual(runCheck().code, 0, "data.ts 를 고쳤는데 --check 가 통과했다");
  } finally {
    writeFileSync(DATA, original, "utf8");
  }
  assert.equal(readFileSync(DATA, "utf8"), original, "복원에 실패했다");
});

test("data.ts 가 parts.json 과 일치한다", () => {
  const { code, out } = runCheck();
  assert.equal(
    code,
    0,
    "apps/web/src/lib/manners/data.ts 가 scripts/manners/parts.json 과 어긋납니다. "
      + "data.ts 를 손으로 고치지 말고 parts.json 을 고친 뒤 "
      + "`node scripts/manners/generate.mjs` 를 돌리세요.\n"
      + out,
  );
});
