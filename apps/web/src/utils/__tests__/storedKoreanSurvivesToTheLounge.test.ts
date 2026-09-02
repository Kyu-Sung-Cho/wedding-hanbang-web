import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { normalizeAmoraAction } from "@/lib/amora/actions";
import { getEvents } from "@/utils/scheduleEvents";

/**
 * 저장된 한글이 라운지까지 살아서 도착하는가.
 *
 * ## 무엇이 보였나
 *
 * 라운지의 다가오는 일정 제목과 아모라 기록 제목이 `?? ???` 로 나왔다. 새로
 * 저장한 한글은 멀쩡했으므로 깨진 것은 읽는 방법이거나 이미 저장된 값이다.
 *
 * 되돌리기는 **읽는 자리 한 곳씩**에 뒀다 — 일정은 `inspectScheduleEvents`,
 * 아모라 기록은 `normalizeAmoraAction`. 두 함수는 라운지·일정 화면·채팅 옆판·
 * 앱의 아모라 목록이 전부 지나는 길목이라, 여기서 한 번 고치면 화면마다 따로
 * 고칠 필요가 없다. 이 검사는 그 길목이 유지되는지 본다.
 */

/** UTF-8 바이트를 Latin-1 로 잘못 읽었을 때 실제로 나오는 문자열. */
function misreadAsLatin1(text: string): string {
  let out = "";
  for (const byte of Buffer.from(text, "utf8")) out += String.fromCharCode(byte);
  return out;
}

function eventJson(title: string) {
  return {
    id: "evt_1",
    date: "2026-10-05",
    title,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("저장된 한글이 라운지까지 살아서 도착한다", () => {
  it("일정 제목이 되돌아온다", () => {
    const broken = misreadAsLatin1("드레스 매장 방문");
    expect(broken, "테스트 재료가 실제로 깨지지 않았습니다").not.toBe("드레스 매장 방문");

    const [event] = getEvents({ __events: [eventJson(broken)] });
    expect(event.title).toBe("드레스 매장 방문");
  });

  it("일정 메모도 같이 되돌아온다", () => {
    const [event] = getEvents({
      __events: [{ ...eventJson("본식 스냅 계약"), memo: misreadAsLatin1("계약금 확인") }],
    });
    expect(event.memo).toBe("계약금 확인");
  });

  it("멀쩡한 제목은 한 글자도 바뀌지 않는다", () => {
    const [event] = getEvents({ __events: [eventJson("드레스 매장 방문")] });
    expect(event.title).toBe("드레스 매장 방문");
  });

  it("아모라 기록 제목이 되돌아온다", () => {
    const action = normalizeAmoraAction({
      id: "act_1",
      title: misreadAsLatin1("청첩장 문구 정하기"),
      description: misreadAsLatin1("양가 어른께 보낼 문구"),
      priority: "medium",
      status: "open",
      source: "chat",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    expect(action.title).toBe("청첩장 문구 정하기");
    expect(action.description).toBe("양가 어른께 보낼 문구");
  });

  it("설명이 없는 기록에 빈 설명을 만들어 넣지 않는다", () => {
    const action = normalizeAmoraAction({
      id: "act_2",
      title: "예산 확인",
      priority: "medium",
      status: "open",
      source: "chat",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });

    expect("description" in action).toBe(false);
  });
});

/**
 * 되돌릴 수 없는 잔해는 제목인 척하지 않는다.
 *
 * 한글을 표현 못 하는 문자집합으로 한 번 변환된 값은 원문 바이트가 이미 없어서
 * 어떤 코드도 되돌리지 못한다. 그것을 사용자가 쓴 제목 자리에 그대로 그리는 것은
 * 화면이 사실이 아닌 말을 하는 것이다.
 */
describe("라운지는 잔해를 제목인 척 그리지 않는다", () => {
  const LOUNGE = readFileSync(
    resolve(process.cwd(), "src/app/(app)/lounge/page.tsx"),
    "utf8",
  );

  it("제목을 그리는 자리가 displayTitle 을 지난다", () => {
    expect(LOUNGE).toContain("function displayTitle(");
    // 다가오는 일정 패널과 아모라 기록·일정 우선순위 카드 셋.
    expect(LOUNGE).not.toContain("{event.title}");
    expect(LOUNGE).not.toContain("title: action.title,");
    expect(LOUNGE).not.toContain("title: events[0].title,");
    expect([...LOUNGE.matchAll(/displayTitle\(/gu)].length).toBeGreaterThanOrEqual(4);
  });
});
