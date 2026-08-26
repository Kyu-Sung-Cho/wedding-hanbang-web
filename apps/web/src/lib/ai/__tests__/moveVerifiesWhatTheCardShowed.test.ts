import { describe, expect, it } from "vitest";

import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";

/**
 * 카드에 보여 준 것과 실제로 바꾸는 것이 같아야 한다.
 *
 * ## 왜 필요한가
 *
 * 옮기기 카드는 이제 "대상 일정: 웨딩 사진 촬영 / 현재 날짜: 2026년 9월 3일" 을
 * 보여 준다. 그 값은 모델이 프롬프트의 `### 등록된 일정` 을 읽고 채운 것이라,
 * 그 사이 일정이 바뀌었거나 모델이 딴 줄을 집었으면 **사용자가 본 것과 다른 것을
 * 바꾸게 된다.** 형제 도구(cancel·restore)는 이미 이 대조를 한다.
 *
 * ## 왜 제목은 느슨한가
 *
 * 프롬프트는 제목을 `promptData` 로 trim + 300자 절단해서 싣는다. 정확 일치를
 * 요구하면 **긴 제목의 일정은 영구히 못 옮긴다** — 형제 도구가 이미 지고 있는
 * 위험이라 여기서는 되풀이하지 않는다. 잘린 앞부분이면 같은 일정으로 본다.
 * 날짜는 잘리지 않으므로 정확히 본다.
 *
 * ## 이 파일이 왜 생겼나
 *
 * 대조 코드를 붙여 놓고 변형 검사를 돌렸더니 **지워도 아무 검사도 안 깨졌다.**
 * 검사 없는 가드는 세지 않는다.
 */

const EVENT_ID = "evt_photo_shoot";

function context(event: Record<string, unknown>): ToolExecutionContext {
  return {
    coupleId: "22222222-2222-4222-8222-222222222222",
    actorProfileId: "11111111-1111-4111-8111-111111111111",
    requestKey: "chat:11111111-1111-4111-8111-111111111111:33333333-3333-4333-8333-333333333333",
    requestAttemptCount: 1,
    pendingActionId: "44444444-4444-4444-8444-444444444444",
    weddingContext: {
      weddingDate: "2027-03-20",
      budget: 30_000_000,
      venue: null,
      progress: {
        __events: [event],
      } as unknown as ToolExecutionContext["weddingContext"]["progress"],
    },
  } as ToolExecutionContext;
}

function storedEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: EVENT_ID,
    date: "2026-09-03",
    time: "10:00",
    title: "웨딩 사진 촬영",
    memo: "촬영 메모",
    status: "planned",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * **위치 인자다.** 객체로 넘기면 `as never` 캐스트에 가려져 타입체크를 통과하고
 * 런타임에 "Unsupported tool input value" 로 죽는다 — 실제로 그렇게 한 번 썼다.
 */
const move = (input: Record<string, unknown>, event = storedEvent()) =>
  buildAmoraAtomicToolOperation(
    "update_schedule_event",
    { event_id: EVENT_ID, date: "2026-09-05", ...input },
    context(event),
  );

const ok = (r: { result?: { success?: boolean } }) => r?.result?.success === true;
/** `noOpFailure` 는 사유를 `toolOutput.error` 에 담는다(`reason` 이 아니다). */
const reason = (r: { result?: { toolOutput?: unknown } }) =>
  (r?.result?.toolOutput as { error?: string } | undefined)?.error;

describe("측정기가 살아 있다", () => {
  it("대조값을 안 실으면 예전처럼 그냥 옮긴다", () => {
    const result = move({});
    expect(ok(result), "선택 필드인데 없다고 막혔다").toBe(true);
  });

  it("맞는 대조값이면 옮긴다", () => {
    const result = move({ expected_title: "웨딩 사진 촬영", expected_date: "2026-09-03" });
    expect(ok(result), "맞는 값인데 막혔다").toBe(true);
  });
});

describe("카드에 보여 준 것과 다르면 바꾸지 않는다", () => {
  it("현재 날짜가 다르면 막는다 — 그 사이 일정이 옮겨진 경우", () => {
    const result = move(
      { expected_date: "2026-09-03" },
      storedEvent({ date: "2026-09-10" }),
    );
    expect(ok(result), "다른 날짜인데 그냥 바꿨다").toBe(false);
    expect(reason(result)).toBe("schedule_target_changed");
  });

  it("대상 제목이 아예 다르면 막는다 — 모델이 딴 줄을 집은 경우", () => {
    const result = move({ expected_title: "드레스 피팅" });
    expect(ok(result), "다른 일정인데 그냥 바꿨다").toBe(false);
    expect(reason(result)).toBe("schedule_target_changed");
  });

  it("막을 때 사용자에게 무엇을 하라고 말한다", () => {
    const result = move({ expected_date: "2026-01-01" }) as {
      result?: { displayMessage?: string };
    };
    expect(result.result?.displayMessage ?? "", "막고서 아무 말도 안 한다")
      .toMatch(/다시 확인/u);
  });
});

describe("제목은 잘려도 같은 일정으로 본다", () => {
  it("프롬프트가 자른 앞부분이면 통과한다 — 아니면 긴 제목은 영구히 못 옮긴다", () => {
    const long = `${"가".repeat(400)} 촬영`;
    const truncated = long.slice(0, 300);
    const result = move({ expected_title: truncated }, storedEvent({ title: long }));
    expect(ok(result), "잘린 제목 때문에 막혔다 — 긴 제목은 영영 못 옮긴다").toBe(true);
  });

  it("앞뒤 공백은 무시한다", () => {
    const result = move({ expected_title: "  웨딩 사진 촬영  " });
    expect(ok(result)).toBe(true);
  });
});
