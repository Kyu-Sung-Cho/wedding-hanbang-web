/**
 * 2026-09-04 소비자 실측에서 나온 빈 곳들.
 *
 * 새 스테이징 커플(이력 0)로 자연 발화 40문장을 실제 모델에 돌렸다. 16문장이 범위
 * 밖(W4)으로 떨어져 도구 0·커플 문맥 0이 됐고, 그중 하나에서 아모라가 "식당을 직접
 * 검색할 수는 없어요" 라고 있는 기능을 부정했다. 여기 고정하는 계약은 셋이다.
 *
 * 1. 결혼 준비를 가리키는 명사 몇 개가 맨 마지막 관문(장기 기억 OFF)에 더해졌다.
 *    일반 표현("일주일 남았", "밥값")은 넣지 않았다 — 그 실측은 `amoraQuestionScope.ts`
 *    의 주석에 있다.
 * 2. 낮은 확신의 W4 턴에도 **커플 문맥을 읽지 않는** 조회 도구(장소 검색·시세)는 열린다.
 *    커플 데이터를 읽거나 바꾸는 도구는 그대로 0개다.
 * 3. 장소 검색어에서 동행·분위기 수식어를 걷어 0건을 줄인다.
 */
import { describe, expect, it } from "vitest";

import {
  AMORA_CONTEXT_FREE_READ_TOOL_NAMES,
  buildAmoraQuestionScopeInstruction,
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { generalizePlaceQuery } from "@/lib/ai/tools/placeSearchTools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { getMarketPriceContext } from "@/constants/marketPrices";
import {
  extractAmoraPendingAction,
  UNKNOWN_SCHEDULE_EVENT_NOTICE,
} from "@/lib/ai/amoraPendingAction";

const READ_TOOLS = BETA_SAFE_TOOLS.filter((tool) => !isMutatingTool(tool.name));

const baseContext = {
  weddingDate: null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "민이",
  scheduleEvents: [],
  chatSummaries: [],
  bookings: [],
};

describe("결혼 준비 명사가 맨 마지막 관문에서 W0 이 된다 (2026-09-04 실측 문장)", () => {
  it.each([
    "다음 주 토요일에 양가 부모님 처음 뵙는데, 강남 쪽에 조용한 한정식집 좀 찾아줘.",
    "그럼 계약금은 보통 얼마 걸어? 나중에 취소하면 다 날리는 거야?",
    "잔금이 생각보다 커서 놀랐어. 보통 언제 다 내?",
    "헬퍼비 따로 내야 해?",
    "사회 봐주는 친구한테 얼마 챙겨줘야 해? 노래해 주는 애도 두 명이야.",
    "구청 가서 신고하는 거 기한 있어? 미루면 불이익 있어?",
    "이제 신고하러 가려는데 뭐 챙겨가야 돼? 증인은 꼭 같이 가야 해?",
  ])("%s", (userText) => {
    const classification = classifyAmoraQuestionScope({ userText });
    expect(classification.scope).toBe("W0_wedding_core");
    // 결혼 낱말이 없는 발화는 커플이 함께 보는 기억에 남기지 않는다(관문 계약).
    expect(classification.allowsLongTermMemory).toBe(false);
  });

  it("리허설·피팅은 일정 그 자체다 — 날짜·동사와 함께면 정본 일정 변경", () => {
    const classification = classifyAmoraQuestionScope({
      userText: "11월 20일에 잡아둔 리허설 시간을 오전 10시로 바꿔줘.",
    });
    expect(classification.scope).toBe("W0_wedding_core");
  });

  it("저장한 일정을 가장 짧은 말로 꺼낼 수 있다", () => {
    for (const userText of ["우리 다음 일정 뭐야?", "이번 달 일정 뭐 있어?", "일정 얼마나 남았어?"]) {
      expect(classifyAmoraQuestionScope({ userText }).scope, userText).toBe("W0_wedding_core");
    }
  });

  it("같은 명사라도 결혼 밖 힌트가 있으면 열리지 않는다", () => {
    for (const userText of [
      "전세 계약금 얼마 걸어야 해?",
      "자동차 잔금은 언제 내?",
      "회사 워크숍 리허설 시간을 오전 10시로 바꿔줘",
      "공연 리허설 언제야?",
      "매매 계약금 돌려받을 수 있어?",
    ]) {
      expect(classifyAmoraQuestionScope({ userText }).scope, userText).not.toBe("W0_wedding_core");
    }
  });

  it("`양가감정`·`양가적` 은 결혼 명사가 아니다", () => {
    for (const userText of ["요즘 양가감정이 들어서 힘들어", "양가적인 마음이야"]) {
      expect(classifyAmoraQuestionScope({ userText }).scope, userText).not.toBe("W0_wedding_core");
    }
  });

  it("범죄 신고는 안전 축이 먼저 받는다 — 혼인신고 생략형이 그것을 덮지 않는다", () => {
    const classification = classifyAmoraQuestionScope({
      userText: "남편이 저를 때려서 경찰에 신고하려는데 증인이 필요해?",
    });
    expect(["W2_high_risk_adjacent", "W5_safety_override"]).toContain(classification.scope);
  });
});

describe("낮은 확신의 W4 턴에는 커플 문맥 없는 조회 도구만 남는다", () => {
  it("장소 검색·시세 조회는 남고 커플 데이터 도구는 0개", () => {
    const classification = classifyAmoraQuestionScope({
      userText: "부모님 모시고 밥 먹을 데 어디가 좋아? 강남이야.",
    });
    expect(classification).toMatchObject({
      scope: "W4_out_of_scope",
      confidence: "low",
      needsClarification: true,
    });
    const remaining = filterAmoraToolsByQuestionScope(READ_TOOLS, classification)
      .map((tool) => tool.name);
    expect(remaining).toContain("search_nearby_places");
    expect(remaining.every((name) => AMORA_CONTEXT_FREE_READ_TOOL_NAMES.has(name))).toBe(true);
    expect(remaining).not.toContain("get_wedding_info");
    expect(remaining).not.toContain("get_budget_summary");
  });

  it("높은 확신의 W4(결혼 밖이 분명)·W2·W3·W5 는 여전히 0개", () => {
    for (const userText of [
      // `파이썬` 은 목록에 없어 낮은 확신 W4 다(그 이유는 amoraQuestionScope.ts 주석). 여기서는
      // 높은 확신의 결혼 밖 과업을 잰다.
      "Python으로 피보나치 짜줘",
      "삼성전자 주식 지금 사도 돼?",
      "회사 일정 추가해줘",
      "그냥 오늘 너무 힘들어",
      "남편이 저를 때렸어요",
    ]) {
      const classification = classifyAmoraQuestionScope({ userText });
      expect(classification.scope, userText).not.toBe("W0_wedding_core");
      expect(filterAmoraToolsByQuestionScope(READ_TOOLS, classification), userText).toEqual([]);
    }
  });

  it("변경 도구는 어느 W4 에서도 남지 않는다", () => {
    const classification = classifyAmoraQuestionScope({ userText: "이거 어떻게 하면 돼?" });
    const remaining = filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, classification);
    expect(remaining.some((tool) => isMutatingTool(tool.name))).toBe(false);
  });

  it("도구가 실제로 열렸을 때만 '써도 된다' 고 말하고, 안 열리면 예전 문장 그대로", () => {
    const classification = classifyAmoraQuestionScope({ userText: "이거 어떻게 하면 돼?" });
    const withTools = buildAmoraQuestionScopeInstruction(classification, {
      contextFreeToolNames: ["search_nearby_places"],
    });
    expect(withTools).toContain("search_nearby_places");
    expect(withTools).toContain("할 수 없다");
    expect(withTools).not.toContain("- 도구 실행과 장기 기억 저장은 하지 마세요.");

    const withoutTools = buildAmoraQuestionScopeInstruction(classification);
    expect(withoutTools).toContain("- 도구 실행과 장기 기억 저장은 하지 마세요.");
    expect(withoutTools).not.toContain("search_nearby_places");

    // 커플 문맥 도구 이름은 넘겨도 걸러진다 — 계약 밖 도구를 "써도 된다" 고 말하지 않는다.
    const filtered = buildAmoraQuestionScopeInstruction(classification, {
      contextFreeToolNames: ["get_wedding_info"],
    });
    expect(filtered).not.toContain("get_wedding_info");
  });

  it("연결 문맥 모드는 조회 도구 둘만 허용하고 나머지는 여전히 예외", () => {
    const questionScope = classifyAmoraQuestionScope({ userText: "이거 어떻게 하면 돼?" });
    const prompt = buildAmoraSystemPrompt(baseContext, {
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: ["search_nearby_places", "get_market_price"],
      questionScope,
      linkedContextMode: "linked_context_only",
    });
    expect(prompt).toContain("context_mode: linked_context_only");
    expect(prompt).toContain("capabilities: search_nearby_places, get_market_price");
    expect(prompt).not.toContain("capabilities: none");
    expect(prompt).toContain("위 조회 도구 밖의 도구·저장·실행·변경 제안을 만들지 마세요");

    expect(() => buildAmoraSystemPrompt(baseContext, {
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: ["search_nearby_places", "get_wedding_info"],
      questionScope,
      linkedContextMode: "linked_context_only",
    })).toThrow("cannot include tools or an action contract");

    const none = buildAmoraSystemPrompt(baseContext, {
      requestKind: "chat",
      persistenceMode: "durable",
      enabledToolNames: [],
      questionScope,
      linkedContextMode: "linked_context_only",
    });
    expect(none).toContain("capabilities: none");
  });
});

describe("도구 선택·검색어 (안전 판정과 무관한 자리)", () => {
  it("보증 인원 걱정에 보증 인원 계산기가 붙는다", () => {
    const selected = selectAmoraTools({
      availableTools: READ_TOOLS,
      userText: "보증인원 못 채우면 어떻게 돼? 노쇼 많이 나면 어떡하지?",
      specialistType: "general",
    } as never) as { name: string }[];
    expect(selected.map((tool) => tool.name)).toContain("simulate_guest_guarantee");
  });

  it("동행·분위기 수식어는 네이버로 가지 않는다", () => {
    expect(generalizePlaceQuery("삼성동 어른 카페")).toBe("삼성동 카페");
    expect(generalizePlaceQuery("강남 부모님 모시고 갈만한 한정식")).toBe("강남 한정식");
    // 이미 지역+종류뿐이면 더 줄일 것이 없다.
    expect(generalizePlaceQuery("삼성동 카페")).toBeNull();
  });

  it("시세 자료가 있는 항목이 넷뿐이라는 것을 아모라가 안다", () => {
    const context = getMarketPriceContext();
    expect(context).toContain("넷뿐");
    expect(context).toContain("한복");
  });
});

describe("지어낸 일정 id 는 카드가 되지 않는다 (2026-09-04 스테이징 Q10)", () => {
  const scheduleTools = BETA_SAFE_TOOLS.filter((tool) => tool.name === "update_schedule_event");
  const marker = (eventId: string) =>
    `리허설 시간을 옮길게요. [pending_action]{"tool":"update_schedule_event","input":{"event_id":"${eventId}","expected_title":"드레스 입어보기","expected_date":"2026-10-03","time":"14:00"}}[/pending_action]`;

  it("저장된 id 면 카드가 난다", () => {
    const result = extractAmoraPendingAction({
      text: marker("evt_real_1"),
      allowedTools: scheduleTools,
      now: Date.now(),
      createActionId: () => "11111111-1111-4111-8111-111111111111",
      knownScheduleEventIds: new Set(["evt_real_1"]),
    });
    expect(result.pendingAction?.tool).toBe("update_schedule_event");
    expect(result.dropReason).toBeUndefined();
  });

  it("목록에 없는 id 면 카드 대신 새 일정으로 말하라는 안내가 남는다", () => {
    const result = extractAmoraPendingAction({
      text: marker("evt_dress_tour_20261003"),
      allowedTools: scheduleTools,
      now: Date.now(),
      createActionId: () => "11111111-1111-4111-8111-111111111111",
      knownScheduleEventIds: new Set(["evt_real_1"]),
    });
    expect(result.pendingAction).toBeNull();
    expect(result.dropReason).toBe("unknown_schedule_event");
    expect(result.hadPendingActionTag).toBe(true);
    expect(result.cleanText).toContain(UNKNOWN_SCHEDULE_EVENT_NOTICE);
    expect(result.cleanText).not.toContain("[pending_action]");
  });

  it("목록을 안 넘기면(다른 호출자) 예전처럼 검증만 한다", () => {
    const result = extractAmoraPendingAction({
      text: marker("evt_anything"),
      allowedTools: scheduleTools,
      now: Date.now(),
      createActionId: () => "11111111-1111-4111-8111-111111111111",
    });
    expect(result.pendingAction?.tool).toBe("update_schedule_event");
  });
});

describe("할 일 카드의 링크 (2026-09-04 스테이징 Q16)", () => {
  const todoTools = BETA_SAFE_TOOLS.filter((tool) => tool.name === "add_amora_action");
  const run = (input: Record<string, unknown>) => extractAmoraPendingAction({
    text: `[pending_action]{"tool":"add_amora_action","input":${JSON.stringify(input)}}[/pending_action]`,
    allowedTools: todoTools,
    now: Date.now(),
    createActionId: () => "11111111-1111-4111-8111-111111111111",
  });

  it("카테고리가 있으면 모델이 고른 링크를 카드에 싣지 않는다", () => {
    const result = run({ title: "양가 어머님 한복 맞추기", category_key: "hanbok", href: "/wedding/community/quote-check" });
    expect(result.pendingAction?.tool).toBe("add_amora_action");
    expect(result.pendingAction?.input.href).toBeUndefined();
    expect(result.cleanText).not.toContain("quote-check");
  });

  it("카테고리가 없으면 모델의 링크를 그대로 받는다", () => {
    const result = run({ title: "견적 비교하기", href: "/wedding/community/quote-check" });
    expect(result.pendingAction?.input.href).toBe("/wedding/community/quote-check");
  });
});
