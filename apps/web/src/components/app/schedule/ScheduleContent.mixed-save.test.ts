// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 일정 저장과 체크 저장은 **따로** 나가야 한다.
 *
 * `__events`가 바뀐 저장은 아모라 수동 일정 공정성 검사를 타는데, 그 검사는 같은 저장에
 * `__events` 밖의 변경이 섞여 있으면 통째로 막는다 —
 * `amoraManualScheduleFairnessMigration.test.ts`의 "일정과 체크리스트를 한 번에 저장할 수 없다"가
 * 실제 SQL로 그것을 확인한다. 그래서 여기서는 클라이언트가 그 계약을 지키는지 본다.
 *
 * 2026-08-19 이전에는 한 번에 보내서 날짜를 넣은 체크가 100% 실패했고, 오류 배너가 모달
 * 뒤에 깔려 화면상 아무 일도 안 일어난 것처럼 보였다.
 */
const source = readFileSync(
  resolve(process.cwd(), "src/components/app/schedule/ScheduleContent.tsx"),
  "utf8",
);

function handlerBody(): string {
  const start = source.indexOf("const completeChecklistWithSchedule");
  expect(start, "핸들러를 찾지 못했다 — 이름이 바뀌었으면 이 테스트도 같이 고쳐라").toBeGreaterThan(-1);
  const end = source.indexOf("const handleToggleChecklistItem", start);
  return source.slice(start, end > start ? end : start + 3000);
}

describe("일정 저장과 체크 저장은 따로 나간다", () => {
  it("한 핸들러 안에서 saveJourney를 두 번 부른다", () => {
    const body = handlerBody();
    const calls = body.match(/await saveJourney\(/g) ?? [];
    expect(calls.length, "저장이 한 번이면 일정과 체크가 한 패치에 섞인다").toBe(2);
  });

  it("두 번째 저장은 최신 progress에서 다시 만든다", () => {
    // 첫 저장이 반영되면 스토어의 progress가 이미 바뀐다. 낡은 값으로 두 번째 패치를
    // 만들면 방금 넣은 일정을 되돌리는 변경이 섞여 같은 이유로 거절당한다.
    const body = handlerBody();
    expect(body).toContain("useAuthStore.getState().journey?.progress");
  });

  it("저장 실패를 창 안에서 보여준다", () => {
    // 오류 배너는 모달 오버레이 뒤에 그려진다. 창 안에도 자리를 둬야 사용자가 본다.
    expect(source).toContain("saveError={journeyError}");
    expect(source).toContain("scheduleMutationBlockReason ?? saveError");
    // 실패해도 창을 닫지 않아야 다시 시도할 수 있다.
    const body = handlerBody();
    const close = body.indexOf("setPendingChecklistSchedule(null)");
    const cat = body.indexOf("} catch");
    expect(close, "성공 자리에서 창을 닫아야 한다").toBeGreaterThan(-1);
    expect(cat, "실패를 삼키는 catch가 있어야 한다").toBeGreaterThan(close);
  });
});
