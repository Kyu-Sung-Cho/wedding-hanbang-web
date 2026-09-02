import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { diagnoseStoredText, isUnreadableText, readableTextOr } from "@hanbang/shared";
import { getEvents } from "@/utils/scheduleEvents";
import { normalizeAmoraAction } from "@/lib/amora/actions";
import { UNREADABLE_EVENT_TITLE, scheduleEventDisplayTitle } from "@/utils/scheduleEvents";
import type { ScheduleEvent } from "@/types/database.types";

/**
 * 못 읽게 된 제목을 화면이 사용자가 쓴 글인 척 그리지 않는가.
 *
 * ## 왜 되돌리지 않고 물러나는가
 *
 * 2026-09-02에 저장소에 커밋돼 있던 깨진 한글의 코드포인트를 세어 봤다. 물음표는
 * U+FFFD 가 아니라 **ASCII 0x3F** 였다 — 매핑이 없어 대체 문자를 넣은 것이 아니라
 * **원문 바이트를 버리고** 물음표를 찍은 것이다. 운영 실측(2026-08-24,
 * `lib/ai/amoraToolPolicy.ts`)의 `'??? ??? ??'` 도 같다.
 *
 * 원문이 이미 없으므로 어떤 코드도 되돌리지 못한다. 화면이 할 수 있는 일은 하나뿐이다
 * — 잔해를 제목인 척 그리지 않고, 사용자가 그 자리에서 다시 적게 하는 것.
 */

function event(title: string): ScheduleEvent {
  return {
    id: "evt_1",
    date: "2026-10-05",
    title,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  } as ScheduleEvent;
}

describe("읽을 글자가 남지 않은 제목만 물러난다", () => {
  it("잔해는 제목 자리에서 물러난다", () => {
    for (const rubble of ["?? ???", "???", "\ufffd\ufffd \ufffd", "? - ?"]) {
      expect(isUnreadableText(rubble), rubble).toBe(true);
      expect(scheduleEventDisplayTitle(event(rubble))).toBe(UNREADABLE_EVENT_TITLE);
    }
  });

  it("물음표가 붙었다는 이유로 사람이 쓴 제목을 감추지 않는다", () => {
    for (const real of [
      "D-DAY??",
      "왜 두 번 물어봐??",
      "드레스 매장 방문",
      // 절반만 깨진 제목도 감추지 않는다 — 남은 절반이 그 줄이 무엇인지 알려 준다.
      "드레스 ?? 방문",
      "드레스 \ufffd 매장",
    ]) {
      expect(isUnreadableText(real), real).toBe(false);
      expect(scheduleEventDisplayTitle(event(real))).toBe(real);
    }
  });

  it("빈 값과 문자열 아닌 값에 안내문을 만들어 붙이지 않는다", () => {
    expect(isUnreadableText("")).toBe(false);
    expect(isUnreadableText("   ")).toBe(false);
    expect(isUnreadableText(null)).toBe(false);
    expect(readableTextOr("", "대체")).toBe("");
  });
});

/**
 * 라운지만 정직하면 사용자는 같은 일정을 두 화면에서 다르게 본다. 제목을 그리는
 * 자리는 전부 같은 헬퍼를 지나야 한다.
 */
describe("제목을 그리는 자리가 모두 같은 문구로 물러난다", () => {
  const SURFACES = [
    "src/app/(app)/lounge/page.tsx",
    "src/components/app/schedule/ScheduleContent.tsx",
    "src/components/app/schedule/TimelineView.tsx",
    "src/components/app/schedule/CalendarView.tsx",
    "src/components/app/chat/panel/UpcomingTab.tsx",
  ];

  it("일정 제목을 날것으로 그리는 자리가 없다", () => {
    for (const file of SURFACES) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, `${file} 이 제목을 날것으로 그린다`).not.toMatch(/\{evt\.title\}|\{event\.title\}/u);
      expect(source, `${file} 이 표시 헬퍼를 안 쓴다`).toContain("scheduleEventDisplayTitle(");
    }
  });

  it("수정 창은 저장된 원래 값을 연다", () => {
    // 안내문이 입력칸에 미리 들어가면 사용자가 그것을 저장해 버린다. 그러면
    // 원문을 잃은 자리에 우리가 쓴 문장이 사용자 기록으로 남는다. 프리필은
    // 표시 헬퍼를 지나지 않고 저장된 값을 그대로 읽어야 한다.
    const form = readFileSync(
      resolve(process.cwd(), "src/components/app/schedule/EventFormModal.tsx"),
      "utf8",
    );
    expect(form).toContain("setTitle(event.title)");
    expect(form).not.toContain("scheduleEventDisplayTitle");
  });
});

/**
 * 대화 말풍선은 물러나지 않는다.
 *
 * 짧은 라벨은 사용자가 다시 적을 수 있어서 물러나는 편이 낫다. 대화는 두 사람이
 * 나눈 기록이고 다시 적을 수 없다 — 일부가 깨졌다고 통째로 안내문으로 바꾸면
 * 남아 있는 정보까지 사라진다.
 */
describe("대화 말풍선은 안내문으로 바꿔치지 않는다", () => {
  it("채팅 스토어가 본문을 갈아끼우지 않는다", () => {
    const store = readFileSync(resolve(process.cwd(), "src/stores/chatStore.ts"), "utf8");
    expect(store).not.toContain("읽지 못한");
    expect(store).not.toContain("isUnreadableText");
    expect(store).not.toContain("readableTextOr");
  });
});

/** UTF-8 바이트를 Latin-1 로 잘못 읽었을 때 실제로 나오는 문자열. */
function misreadAsLatin1(text: string): string {
  let out = "";
  for (const byte of Buffer.from(text, "utf8")) out += String.fromCharCode(byte);
  return out;
}

/**
 * 되돌릴 수 있는 종류는 읽는 자리에서 되돌아온다.
 *
 * QA 가 지목한 두 화면(일정·채팅 기록)이 지나는 길목이 유지되는지 본다. 되돌리기
 * 자체의 정확성은 `packages/shared` 의 표적 검사가 든다.
 */
describe("되돌릴 수 있는 글은 읽는 자리에서 되돌아온다", () => {
  it("일정 제목이 되돌아오고, 깨진 필드 때문에 일정이 사라지지 않는다", () => {
    const cancelledAt = "2026-09-01T00:00:00.000Z";
    const events = getEvents({
      __events: [{
        id: "evt_1",
        date: "2026-10-05",
        title: misreadAsLatin1("드레스 매장 방문"),
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: cancelledAt,
        status: "cancelled",
        cancellation: {
          cancelledAt,
          cancelledByProfileId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
          // 깨진 글자에는 C1 제어문자가 들어간다. 되돌리기가 검증 뒤에 있으면
          // 이 일정은 통째로 탈락해 화면에서 사라진다.
          reason: misreadAsLatin1("매장 사정으로 미룸"),
        },
      }],
    });

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("드레스 매장 방문");
    expect(events[0].cancellation?.reason).toBe("매장 사정으로 미룸");
  });

  it("아모라 기록 제목이 되돌아온다", () => {
    const action = normalizeAmoraAction({
      id: "act_1",
      title: misreadAsLatin1("청첩장 문구 정하기"),
      priority: "medium",
      status: "open",
      source: "chat",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(action.title).toBe("청첩장 문구 정하기");
  });

  it("채팅 기록을 읽는 자리가 되돌리기를 지난다", () => {
    const store = readFileSync(resolve(process.cwd(), "src/stores/chatStore.ts"), "utf8");
    const start = store.indexOf("function dbRowToMessage(");
    const body = store.slice(start, store.indexOf("\nexport function ", start));
    expect(body).toContain("repairMojibake(row.content)");
    expect(body).toContain("repairMojibakeDeep(");
  });

  it("멀쩡한 글은 한 글자도 바뀌지 않는다", () => {
    expect(diagnoseStoredText("드레스 매장 방문").kind).toBe("clean");
    const [event] = getEvents({
      __events: [{
        id: "evt_2",
        date: "2026-10-05",
        title: "드레스 매장 방문",
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    expect(event.title).toBe("드레스 매장 방문");
  });
});
