import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

/**
 * 모바일 일정 화면이 "상대가 거절함" 을 "다시 시도해 주세요" 로 뭉갰다.
 *
 * `/api/journey` 는 거절할 때 사람이 읽을 문장과 **기계가 읽을 코드**를 함께
 * 준다. 그런데 일정 화면은 `PLAN_CHANGE_STALE` 과 `PLAN_CHANGE_ACTIVE_REQUEST`
 * 둘만 알아보고 나머지를 전부 `failed` 로 떨어뜨렸다. 그 결과 사용자가 보는
 * 문장이 이랬다.
 *
 *     "체크 상태를 저장하지 못했어요. 다시 시도해주세요."
 *
 * **상대가 거절했으면 다시 눌러도 결과가 같다.** 사용자는 같은 버튼을 반복해서
 * 누르게 된다.
 *
 * 같은 앱의 **예산 화면은 이미 네 코드를 다 다루고 있었다**
 * (`app/budget/index.tsx`). 화면마다 품질이 갈려 있었던 것이다.
 *
 * 문구는 지어내지 않고 웹의 표(`apps/web/src/lib/journey/planChangeError.ts` 의
 * `PLAN_CHANGE_MESSAGES`)와 같은 것을 쓴다 — 두 화면이 같은 상황에 다른 말을
 * 하면 사용자는 무엇이 일어났는지 모른다.
 */

const source = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../app/schedule/index.tsx",
  ),
  "utf8",
);

test("서버가 준 거절 코드를 알아본다", () => {
  assert.match(source, /payload\.code === "PLAN_CHANGE_REJECTED"/);
  assert.match(source, /new ScheduleMutationError\("rejected"\)/);
});

test("충돌도 낡은 화면으로 다룬다 — 다시 눌러도 같기 때문", () => {
  assert.match(source, /payload\.code === "PLAN_CHANGE_CONFLICT"/);
});

test("거절은 웹과 같은 문장으로 알린다", () => {
  assert.match(source, /파트너가 이 변경을 거절했어요/);
  assert.match(source, /최신 화면을 다시 확인해 주세요/);
  // 문구를 한 곳에 모아 세 자리가 같은 말을 하게 한다.
  assert.match(source, /function showScheduleRejectedAlert\(\)/);
});

test("거절을 '다시 시도' 로 뭉개지 않는다", () => {
  // 거절 분기가 기본 문구보다 **먼저** 와야 한다. 뒤에 있으면 도달하지 않는다.
  const rejectedAt = source.indexOf('error.code === "rejected"');
  const fallbackAt = source.indexOf("체크 상태를 저장하지 못했어요");
  assert.ok(rejectedAt > 0, "거절 분기가 있어야 한다");
  assert.ok(fallbackAt > 0, "기본 문구가 있어야 한다");
  assert.ok(rejectedAt < fallbackAt, "거절 분기가 기본 문구보다 앞에 와야 한다");
});

test("세 실패 지점 모두에 붙어 있다", () => {
  // 체크리스트 저장·체크리스트 상태·일정 폼 — 셋 다 같은 거절을 만날 수 있다.
  // 함수 **정의**도 같은 문자열을 담고 있으니 호출만 센다.
  const calls = source.match(
    new RegExp("(?<!function )showScheduleRejectedAlert\\(\\)", "g"),
  ) ?? [];
  assert.equal(calls.length, 3);
});

test("모르는 코드는 기존 문구로 떨어진다", () => {
  // 아는 코드일 때만 문장을 만든다. 서버 오류 원문이 화면에 새면 안 된다.
  assert.match(source, /Alert\.alert\("오류", "체크 상태를 저장하지 못했어요/);
});
