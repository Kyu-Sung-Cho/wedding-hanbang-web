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

  /**
   * 깨진 글자에는 0x80~0x9F 자리(= C1 제어문자)가 거의 반드시 들어간다. 취소
   * 사유·완료 기준·외부 담당자 이름은 `hasUnsafeDisplayCharacter` 를 지나므로,
   * 되돌리기가 검증 **뒤**에 있으면 그 일정은 통째로 탈락해 화면에서 사라진다.
   * 되돌리기가 검증 앞에 있으면 되살아난다.
   */
  it("취소 사유가 깨진 일정이 목록에서 사라지지 않고 되살아난다", () => {
    const cancelledAt = "2026-09-01T00:00:00.000Z";
    const broken = misreadAsLatin1("매장 사정으로 미룸");
    expect(/[\p{Cc}]/u.test(broken), "재료에 C1 제어문자가 없어 검사가 무의미하다").toBe(true);

    const events = getEvents({
      __events: [{
        ...eventJson("드레스 매장 방문"),
        updatedAt: cancelledAt,
        status: "cancelled",
        cancellation: {
          cancelledAt,
          cancelledByProfileId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
          reason: broken,
        },
      }],
    });

    expect(events).toHaveLength(1);
    expect(events[0].cancellation?.reason).toBe("매장 사정으로 미룸");
  });

  it("외부 담당자 이름이 깨진 일정도 되살아난다", () => {
    const events = getEvents({
      __events: [{
        ...eventJson("드레스 매장 방문"),
        assignee: { kind: "external", label: misreadAsLatin1("김실장") },
      }],
    });

    expect(events).toHaveLength(1);
    const { assignee } = events[0];
    expect(assignee?.kind === "external" && assignee.label).toBe("김실장");
  });

  it("완료 기준이 깨진 일정도 되살아난다", () => {
    const events = getEvents({
      __events: [{
        ...eventJson("드레스 매장 방문"),
        completionCriteria: misreadAsLatin1("계약서 사본을 받으면 완료"),
      }],
    });

    expect(events).toHaveLength(1);
    expect(events[0].completionCriteria).toBe("계약서 사본을 받으면 완료");
  });

  it("되돌려도 검증을 통과하지 못하는 값은 여전히 탈락한다", () => {
    // 되돌리기가 검증을 느슨하게 만들면 안 된다. 진짜 제어문자가 든 값은
    // 되돌릴 수 없으므로 그대로 걸러진다.
    const events = getEvents({
      __events: [{ ...eventJson("드레스 매장 방문"), completionCriteria: "계약서\u0007확인" }],
    });
    expect(events).toHaveLength(0);
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

  it("라운지가 제목을 날것으로 그리지 않는다", () => {
    // 다가오는 일정 패널과 아모라 기록·일정 우선순위 카드 셋.
    expect(LOUNGE).not.toContain("{event.title}");
    expect(LOUNGE).not.toContain("title: action.title,");
    expect(LOUNGE).not.toContain("title: events[0].title,");
    expect(LOUNGE).toContain("scheduleEventDisplayTitle(");
    expect(LOUNGE).toContain("displayTitle(action.title");
  });

  it("일정 화면도 같은 문구로 물러난다", () => {
    // 라운지만 정직하면 사용자는 같은 일정을 두 화면에서 다르게 본다.
    for (const file of [
      "src/components/app/schedule/ScheduleContent.tsx",
      "src/components/app/schedule/TimelineView.tsx",
      "src/components/app/schedule/CalendarView.tsx",
      "src/components/app/chat/panel/UpcomingTab.tsx",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, `${file} 이 제목을 날것으로 그린다`).not.toMatch(/\{evt\.title\}|\{event\.title\}/u);
      expect(source, `${file} 이 표시 헬퍼를 안 쓴다`).toContain("scheduleEventDisplayTitle(");
    }
  });

  it("수정 창은 저장된 원래 값을 연다", () => {
    // 안내문이 입력칸에 미리 들어가면 사용자가 그것을 저장해 버린다.
    const schedule = readFileSync(
      resolve(process.cwd(), "src/components/app/schedule/ScheduleContent.tsx"),
      "utf8",
    );
    expect(schedule).not.toContain("title: scheduleEventDisplayTitle(");
  });
});
