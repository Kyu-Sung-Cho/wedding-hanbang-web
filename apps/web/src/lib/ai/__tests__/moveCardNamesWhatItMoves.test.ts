import { describe, expect, it } from "vitest";

import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS, WEDDING_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";

/**
 * 옮기기 카드가 "무엇을 어디서" 옮기는지 말하지 못했다.
 *
 * ## 운영에서 본 것 (2026-08-26)
 *
 *     다음 변경을 적용할까요?
 *     - 변경: 일정 변경
 *     - 날짜: 2027년 6월 20일
 *     - 시간: "14:00"
 *     - 제목: "드레스 피팅"
 *
 * 어느 일정을 어느 날짜에서 옮기는지가 없다. 본문에 설명을 붙일 수도 없다 —
 * `extractAmoraPendingAction` 이 표식을 찾으면 `cleanText: marker.confirmation` 으로
 * 본문을 통째로 갈아치운다. 운영 실측으로 카드가 붙은 AI 메시지 **37건 전부**가
 * 서버 정형 문구뿐이고 사람 문장이 하나도 없었다.
 *
 * 그래서 정보는 **카드 안에** 들어가야 하고, 그 자리는 이미 설계돼 있었다 —
 * `FIELD_LABELS` 에 `expected_title: "대상 일정"`, `expected_date: "현재 날짜"` 가
 * 있고 형제 도구(`cancel_schedule_event`·`restore_schedule_event`)는 그 둘을
 * **필수**로 받는다. `update_schedule_event` 만 빠져 있었다.
 *
 * ## 왜 선택 필드인가
 *
 * 형제처럼 필수로 만들면 모델이 하나만 빠뜨려도 ajv 가 표식을 **조용히 통째로**
 * 버려 카드가 0건이 된다. 이 저장소가 실제로 겪은 실패 모양이 그것이다.
 * 채우면 보이고 안 채우면 예전과 같게 둔다.
 *
 * ## DB 관문도 함께 열어야 한다
 *
 * 도구 스키마만 고치면 운영에서 조용히 죽는다 — 트리거
 * `capture_amora_shared_schedule_delta` 가 승인된 입력 키를 정확히 6개로 잠근다.
 * 그건 `20260827090000_move_card_can_name_what_it_moves.sql` 이 열고,
 * `amoraSharedScheduleDecisionReceiptMigration.test.ts` 가 실제 트리거를 돌려
 * 확인한다(마이그레이션을 빼면 22023 으로 죽는 것까지 봤다).
 */

const marker = (input: Record<string, unknown>) =>
  `[pending_action]${JSON.stringify({ tool: "update_schedule_event", input })}[/pending_action]`;

const extract = (text: string) =>
  extractAmoraPendingAction({
    text,
    allowedTools: BETA_SAFE_TOOLS.filter((t) => isMutatingTool(t.name)),
    now: 1_000,
    // 기존 테스트(amoraConfirmationCopy)와 같은 방식으로 id 를 고정한다.
    createActionId: () => "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  });

describe("측정기가 살아 있다", () => {
  it("표식이 실제로 카드가 된다 — 아니면 아래 검사가 전부 무의미하다", () => {
    const result = extract(marker({ event_id: "evt_1", date: "2026-09-05" }));
    expect(result.pendingAction, "카드가 안 나온다").not.toBeNull();
    expect(result.pendingAction?.tool).toBe("update_schedule_event");
  });

  it("선언 안 된 키는 그 키만 버린다 — 이 관문이 살아 있어야 한다", () => {
    // 2026-09-04 이전에는 표식이 **통째로** 버려졌다. 그 규칙이 스테이징 X7 을
    // 만들었다(모델은 표식을 냈는데 사용자에게는 카드가 없었다). 지금은 키만
    // 버린다 — 지키는 것은 그대로다: 지어낸 값은 카드에도 실행 경로에도 없다.
    const result = extract(marker({ event_id: "evt_1", date: "2026-09-05", vendor_name: "소네" }));
    expect(result.pendingAction?.input, "선언 안 된 키가 통과했다").toEqual({
      event_id: "evt_1",
      date: "2026-09-05",
    });
    expect(result.cleanText).not.toContain("소네");
  });
});

describe("카드가 무엇을 어디서 옮기는지 말한다", () => {
  it("대상 일정과 현재 날짜가 확인문에 찍힌다", () => {
    const result = extract(marker({
      event_id: "evt_abc",
      date: "2026-09-05",
      time: "11:00",
      expected_title: "웨딩 사진 촬영",
      expected_date: "2026-09-03",
    }));

    const confirmation = result.pendingAction?.confirmation ?? "";
    expect(result.pendingAction, "두 필드를 넣자 표식이 버려졌다").not.toBeNull();
    expect(confirmation, "대상 일정이 안 보인다").toContain("대상 일정");
    expect(confirmation).toContain("웨딩 사진 촬영");
    expect(confirmation, "현재 날짜가 안 보인다").toContain("현재 날짜");
    // 두 날짜가 **같은 카드 안에** 있어야 사용자가 무엇이 바뀌는지 안다.
    expect(confirmation).toContain("2026년 9월 3일");
    expect(confirmation).toContain("2026년 9월 5일");
  });

  it("빠뜨려도 예전처럼 동작한다 — 필수로 만들지 않은 이유", () => {
    const result = extract(marker({ event_id: "evt_abc", date: "2026-09-05" }));
    expect(result.pendingAction, "선택 필드인데 없다고 카드가 죽었다").not.toBeNull();
    expect(result.pendingAction?.confirmation ?? "").not.toContain("대상 일정");
  });

  it("event_id 는 여전히 카드에 안 보인다 — 사용자에게 뜻 없는 값이다", () => {
    const result = extract(marker({
      event_id: "evt_abc",
      date: "2026-09-05",
      expected_title: "웨딩 사진 촬영",
      expected_date: "2026-09-03",
    }));
    expect(result.pendingAction?.confirmation ?? "").not.toContain("evt_abc");
  });
});

describe("도구 스키마가 형제와 같은 모양이다", () => {
  const tool = WEDDING_TOOLS.find((t) => t.name === "update_schedule_event");
  const schema = tool?.input_schema as {
    properties: Record<string, { description?: string; pattern?: string }>;
    required: string[];
  };

  it("expected_title·expected_date 를 받는다", () => {
    expect(schema.properties.expected_title, "expected_title 이 없다").toBeDefined();
    expect(schema.properties.expected_date, "expected_date 가 없다").toBeDefined();
  });

  it("둘 다 선택이다 — 필수로 바꾸면 카드가 0건이 될 수 있다", () => {
    expect(schema.required).toEqual(["event_id"]);
  });

  it("expected_date 는 날짜 모양을 강제한다", () => {
    expect(schema.properties.expected_date.pattern).toBe("^\\d{4}-\\d{2}-\\d{2}$");
  });

  it("설명이 '현재' 값이라는 것을 분명히 한다 — 새 날짜와 헷갈리면 카드가 거짓말한다", () => {
    for (const key of ["expected_title", "expected_date"]) {
      expect(schema.properties[key].description ?? "", key).toContain("현재");
    }
  });
});

describe("모델에게 채우라고 말한다", () => {
  it("계약문이 두 필드를 이름으로 지시한다", async () => {
    const { buildAmoraSystemPrompt } = await import("@/lib/ai/amoraPromptComposer");
    const prompt = buildAmoraSystemPrompt(
      {
        weddingDate: "2027-05-15",
        budget: 50_000_000,
        venue: null,
        progress: {},
        preparationStatus: null,
        brideName: "신부",
        groomName: "신랑",
        bookings: [],
        scheduleEvents: [],
        chatSummaries: [],
        pastConflicts: [],
        pastDecisions: [],
        senderName: "신부",
      } as never,
      {
        enabledToolNames: BETA_SAFE_TOOLS.filter((t) => !isMutatingTool(t.name)).map((t) => t.name),
        requestKind: "chat",
        persistenceMode: "durable",
      } as never,
    );
    // 원본이 아니라 **합성된 프롬프트**에 묻는다 — prompts.ts 에는 모델에게 가지
    // 않는 죽은 구간이 있고 거기 썼다가 배포까지 한 적이 있다.
    expect(prompt).toContain("expected_title");
    expect(prompt).toContain("expected_date");
  });
});
