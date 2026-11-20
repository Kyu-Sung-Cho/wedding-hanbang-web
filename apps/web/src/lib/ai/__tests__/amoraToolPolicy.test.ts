import { describe, expect, it } from "vitest";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import {
  AMORA_TOOL_POLICY_NAMES,
  selectAmoraPendingProposalTools,
  selectAmoraTools,
} from "@/lib/ai/amoraToolPolicy";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { isMutatingTool } from "@/lib/ai/mutationTools";

function names(userText: string, specialistType: Parameters<typeof selectAmoraTools>[0]["specialistType"] = "general") {
  return selectAmoraTools({
    availableTools: BETA_SAFE_TOOLS,
    userText,
    specialistType,
  }).map((tool) => tool.name);
}

describe("selectAmoraTools", () => {
  it("keeps every configured policy name inside the beta-safe registry", () => {
    const safeNames = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    expect([...AMORA_TOOL_POLICY_NAMES].filter((name) => !safeNames.has(name))).toEqual([]);
  });

  it("keeps a small stable read-only baseline for general conversation", () => {
    const selected = names("요즘 준비가 막막해");
    expect(selected).toEqual([
      "get_budget_summary",
      "get_schedule_summary",
      "get_wedding_info",
      "get_amora_actions",
    ]);
    expect(selected.length).toBeLessThan(BETA_SAFE_TOOLS.length);
  });

  it("adds budget reads without mutations for an informational question", () => {
    const selected = names("스드메 견적 시세가 적당한지 알려줘", "budget_optimizer");
    expect(selected).toEqual(expect.arrayContaining([
      "get_budget_summary",
      "simulate_guest_guarantee",
    ]));
    // 2026-11-16: 시세를 물어도 시세 도구는 붙지 않는다 — 참가격 자료를 쓰지 않는다(D-79).
    expect(selected).not.toContain("get_market_price");
    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("apply_budget_plan");
  });

  it("keeps local-place and vendor discovery outside the focused MVP", () => {
    for (const query of [
      "강남역 근처 상견례 식당 찾아줘",
      "강남 근처 웨딩 스튜디오 찾아줘",
      "서울 근처 결혼식장 찾아줘",
      "근처 결혼 준비 업체 찾아줘",
      "근처 혼주 메이크업 찾아줘",
      "근처 웨딩 촬영 업체 찾아줘",
      "근처 웨딩 사진 업체 찾아줘",
      "근처 본식 업체 찾아줘",
      "근처 예식 업체 찾아줘",
    ]) {
      expect(names(query)).not.toContain("search_nearby_places");
    }
  });

  it("does not expose marketplace or booking tools in the current MVP", () => {
    const safeNames = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    for (const retiredName of [
      "search_vendors",
      "check_vendor_availability",
      "recommend_vendors",
      "get_vendor_detail",
      "get_available_slots",
      "create_booking",
      "get_my_bookings",
      "cancel_booking",
    ]) {
      expect(safeNames.has(retiredName)).toBe(false);
    }

    // `search_nearby_places` 는 2026-08-22 파운더 결정으로 이 목록에서 나왔다.
    // 같은 묶음에 있었지만 성격이 다르다 — 이 도구는 **업체를 찾아주지 않는다.**
    // 안에 울타리가 두 겹 있다: 웨딩업체 질의를 `wedding_vendor_query_blocked` 로
    // 막고, 네이버 결과에서도 웨딩업체를 걸러낸다. 남는 것은 상견례 식당 같은
    // 일반 장소뿐이고 예약·결제 경로가 없다. 자세한 계약은
    // `tools/__tests__/placeSearchAvailability.test.ts` 가 고정한다.
    expect(safeNames.has("search_nearby_places")).toBe(true);
  });

  it("unlocks only matching mutations when write intent is explicit", () => {
    const selected = names("총 예산을 4천만원으로 변경해줘", "budget_optimizer");
    expect(selected).toContain("update_budget");
    expect(selected).not.toContain("update_category_budget");
    expect(selected).not.toContain("apply_budget_plan");
    expect(selected).not.toContain("add_custom_category");
    expect(selected).not.toContain("add_schedule_event");
    expect(selected).not.toContain("update_venue");
  });

  it("routes schedule cancellation and restoration to distinct soft-state tools", () => {
    const cancellation = names("드레스 피팅 일정을 취소해줘");
    expect(cancellation).toContain("cancel_schedule_event");
    expect(cancellation).not.toContain("restore_schedule_event");
    expect(cancellation).not.toContain("update_schedule_event");
    expect(cancellation).not.toContain("delete_schedule_event");

    const restoration = names("취소한 드레스 피팅 일정을 다시 살려줘");
    expect(restoration).toContain("restore_schedule_event");
    expect(restoration).toContain("get_schedule_events");
    expect(restoration).not.toContain("cancel_schedule_event");
    expect(restoration).not.toContain("delete_schedule_event");

    for (const shorthand of [
      "아까 취소한 드레스 피팅 다시 살려줘",
      "상견례 취소한 거 되돌려줘",
    ]) {
      const selected = names(shorthand);
      expect(selected).toContain("restore_schedule_event");
      expect(selected).toContain("get_schedule_events");
      expect(selected).not.toContain("cancel_schedule_event");
    }
  });

  it.each([
    "취소한 드레스 피팅 다시 살려주면 어떨까?",
    "친구가 취소한 드레스 피팅 다시 살려줬대",
    "취소한 건 아니야, 드레스 피팅 다시 살려줘",
  ])("does not turn hypothetical, third-party, or negated restore wording into a mutation: %s", (text) => {
    expect(names(text)).not.toContain("restore_schedule_event");
  });

  it.each([
    ["예산은 3천만 원이야", "update_budget"],
    ["드레스 예산은 250만 원이야", "update_category_budget"],
    ["드레스에 250만 원 썼어", "update_category_budget"],
    ["내년 5월 5일에 결혼해", "update_wedding_date"],
    ["토요일에 상견례야", "add_schedule_event"],
    ["예식장 계약했어", "update_task_status"],
  ])("treats a concrete first-person declaration as an executable %s intent", (text, toolName) => {
    expect(names(text)).toContain(toolName);
  });

  it.each([
    "친구는 예산이 3천만 원이래",
    "예산을 3천만 원으로 하면 어떨까?",
    "토요일에 상견례를 하면 좋을까?",
    "내년 5월 5일 결혼식은 어때?",
  ])("does not turn third-party or hypothetical language into a mutation: %s", (text) => {
    const selected = names(text);
    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("update_wedding_date");
    expect(selected).not.toContain("add_schedule_event");
    expect(selected).not.toContain("update_task_status");
  });

  it("does not treat read-oriented check or help wording as mutation consent", () => {
    for (const text of [
      "내 예산 체크해줘",
      "드레스 견적 비교해줘",
      "일정 좀 정리해줘",
      "체크리스트 보여줘",
    ]) {
      const selected = names(text, "general");
      expect(selected).not.toContain("update_budget");
      expect(selected).not.toContain("update_category_budget");
      expect(selected).not.toContain("add_schedule_event");
      expect(selected).not.toContain("toggle_checklist_item");
    }
  });

  it("exposes only the requested budget mutation family", () => {
    expect(names("드레스 예산을 250만원으로 변경해줘")).toContain("update_category_budget");
    expect(names("드레스 예산을 250만원으로 변경해줘")).not.toContain("update_budget");

    expect(names("이 예산 배분 계획을 그대로 적용해줘")).toContain("apply_budget_plan");
    expect(names("이 예산 배분 계획을 그대로 적용해줘")).not.toContain("update_budget");

    expect(names("포토부스 예산 카테고리를 추가해줘")).toContain("add_custom_category");
    expect(names("포토부스 예산 카테고리를 추가해줘")).not.toContain("apply_budget_plan");
  });

  it("routes document review to quote tools without contract review or destructive booking tools", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "이 파일 검토해줘",
      specialistType: "general",
      attachmentKind: "document",
    }).map((tool) => tool.name);
    // 견적서를 같이 보는 경로는 유지한다.
    expect(selected).toContain("analyze_quote");
    // 2026-11-16: 견적서를 올려도 시세 도구는 함께 붙지 않는다(참가격 자료를 쓰지 않는다, D-79).
    expect(selected).not.toContain("get_market_price");
    // 계약 개입 금지(2026-08-18): 문서를 올려도 계약 검토로 넘어가지 않는다.
    expect(selected).not.toContain("analyze_contract_readiness");
    expect(selected).not.toContain("create_booking");
    expect(selected).not.toContain("cancel_booking");
    expect(selected).not.toContain("delete_schedule_event");
  });

  it("scopes pending proposals to the current domain instead of exposing every mutation", () => {
    const budget = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "예산을 어떻게 나누면 좋을까?",
      specialistType: "budget_optimizer",
    }).map((tool) => tool.name);
    expect(budget).toEqual(expect.arrayContaining([
      "update_budget",
      "update_category_budget",
      "apply_budget_plan",
    ]));
    expect(budget).not.toContain("add_schedule_event");
    expect(budget).not.toContain("update_venue");

    const general = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "요즘 준비가 막막해",
      specialistType: "general",
    });
    expect(general).toEqual([]);
  });

  it("does not authorize a mutation from assistant prose and a generic approval", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 그렇게 해줘",
      specialistType: "general",
      routingContext: [{
        role: "assistant",
        content: "총 예산을 4천만원으로 변경해드릴까요?",
      }],
    }).map((tool) => tool.name);

    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("add_schedule_event");
  });

  it("does not turn a generic approval into a write from unrelated context", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 해줘",
      specialistType: "general",
      routingContext: [{
        role: "assistant",
        content: "현재 예산은 4천만원이고 다음 일정은 드레스 투어예요.",
      }],
    }).map((tool) => tool.name);

    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("add_schedule_event");
    expect(selected).not.toContain("update_venue");
  });

  it("does not let a specialist read hint authorize a generic write", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 해줘",
      specialistType: "budget_optimizer",
    }).map((tool) => tool.name);

    expect(selected).toContain("get_budget_summary");
    expect(selected).not.toContain("update_budget");
    expect(selected).not.toContain("apply_budget_plan");
  });

  it("does not inherit an old proposal when it is not the immediate previous turn", () => {
    const selected = selectAmoraTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "응, 그렇게 해줘",
      specialistType: "general",
      routingContext: [
        { role: "assistant", content: "예산을 4천만원으로 바꿔드릴까요?" },
        { role: "user", content: "그런데 오늘 날씨는 어때?" },
      ],
    }).map((tool) => tool.name);

    expect(selected).not.toContain("update_budget");
  });
});

describe("한국어 복합 금액 표기", () => {
  // 결혼 예산은 "3천5백만원"·"1억5천만원"처럼 단위를 겹쳐 말하는 쪽이 더 흔하다.
  // 숫자 하나에 단위 하나만 받던 시절 "총예산 4천2백만원으로 바꿔줘"가 확정
  // 발화로 인식되지 않아, 아모라가 "예산을 수정할 수 없다"고 답했다
  // (2026-07-25 실계정 전체 여정 E2E에서 발견).
  it.each([
    "우리 총예산 4천2백만원으로 바꿔줘",
    "예산 3천5백만원이야",
    "예산 1억5천만원으로 정했어",
    "총예산 4천만원이야",
    "예산 3500만원이야",
  ])("확정 발화로 인식해 예산 확인 카드를 낼 수 있다: %s", (userText) => {
    const tools = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText,
      specialistType: "general",
    }).map((tool) => tool.name);
    expect(tools).toContain("update_budget");
  });

  it("금액이 없는 예산 잡담까지 확인 카드를 내지는 않는다", () => {
    const tools = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText: "예산 얘기는 나중에 하자",
      specialistType: "general",
    }).map((tool) => tool.name);
    expect(tools).not.toContain("update_schedule_event");
  });

  it.each([
    "스튜디오 3백2십만원 결제했어",
    "예식장 1억2천만원으로 정했어",
  ])("카테고리 금액도 복합 표기를 받는다: %s", (userText) => {
    const tools = selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText,
      specialistType: "general",
    }).map((tool) => tool.name);
    expect(tools).toContain("update_category_budget");
  });
});

/**
 * **마감일을 말하면 확인 카드가 통째로 사라졌다.** (2026-09-04)
 *
 * `NON_EXECUTABLE_RESTORE`(되묻기·가정 판정)에 경계 없는 `일까` 가 있어서
 * `25일까지`·`금요일까지`·`말일까지`·`내일까지` 의 **`일까`** 에 부분일치했다.
 * 그러면 `selectAmoraPendingProposalTools` 가 빈 배열을 돌려주고, 카드 계약문이
 * 프롬프트에 아예 안 실린다. 모델이 이력에서 배운 표식을 그래도 내면 이번엔
 * `allowedTools` 가 비어 있어 표식이 버려진다(`pending_action_dropped`).
 *
 * 실측(스테이징, 수정 전): 아래 12문장 전부 제안 도구 0개. 마감일만 뺀 대조군
 * ("예식장 잔금 이체 할 일에 저장해줘")은 11개였다 — 마감일 한 조각 차이였다.
 *
 * 대명사 부분일치가 위기 판정을 부르던 것과 같은 병이다. 어휘로 여는 쪽이
 * 아니라 **닫는 쪽**이라 손해가 조용히 한 방향으로만 간다.
 */
describe("마감일 문장은 되묻기가 아니다", () => {
  const DEADLINE_TODOS = [
    "9월 25일까지 혼주 한복 예약하는 거 할 일로 넣어줘",
    "9월 28일까지 답례품 고르는 거 할 일로 추가해줘",
    "다음 주 금요일까지 청첩장 문구 정하는 거 할 일로 등록해줘",
    "10일까지 스튜디오 계약금 보내는 거 할 일에 추가해줘",
    "말일까지 예식장 잔금 이체하는 거 할 일로 저장해줘",
    "12월 31일까지 신혼여행 항공권 예약하는 거 할 일로 추가해줘",
    "이번 달 20일까지 예단 준비하는 거 할 일로 넣어줘",
    "3일까지 부케 주문하는 거 할 일에 등록해줘",
    "내일까지 하객 명단 정리하는 거 할 일로 추가해줘",
    "다음 달 1일까지 폐백 음식 정하는 거 할 일로 추가해줘",
    "10월 5일까지 드레스 피팅 예약하는 거 할 일로 넣어줘",
    "수요일까지 사회자 확정하는 거 할 일로 등록해줘",
  ];

  /**
   * 반대 방향. 이 목록이 없으면 위 검사는 "`일까` 를 통째로 지워도 초록"이다 —
   * 그러면 진짜 되묻기가 전부 확인 카드를 받는다.
   */
  const STILL_NOT_EXECUTABLE = [
    "할까 말까 고민이야",
    "이걸 지울까?",
    "언제가 좋을까",
    "지금 예산이 적당한 금액일까?",
    "이 예식장이 우리한테 맞는 곳일까?",
    "스드메 300만원이면 적정 가격일까?",
    "이 날짜로 하면 어떨까?",
    "혼주 한복은 대여가 나을까 구매가 나을까?",
    "예단은 생략해도 괜찮을까요?",
    "신혼여행 예산 얼마가 적당할까?",
    "드레스는 언제 정하는 게 좋을까요?",
  ];

  function proposals(userText: string): string[] {
    return selectAmoraPendingProposalTools({
      availableTools: BETA_SAFE_TOOLS,
      userText,
      specialistType: "general",
      // 라우터가 키워드로 고르지 않은 턴 = 관문이 그대로 켜지는 쪽. 운영에서
      // 이 문장들이 실제로 밟는 경로다.
      specialistMatchedByKeyword: false,
    }).map((tool) => tool.name);
  }

  it.each(DEADLINE_TODOS)("마감일이 붙어도 할 일 카드를 낼 수 있다: %s", (userText) => {
    expect(proposals(userText)).toContain("add_amora_action");
  });

  it.each(STILL_NOT_EXECUTABLE)("되묻기·가정은 그대로 막힌다: %s", (userText) => {
    expect(proposals(userText)).toEqual([]);
  });

  it("`일까지` 만 예외다 — 문장 끝의 `일까` 는 여전히 되묻기다", () => {
    expect(proposals("이 정도면 충분한 일까?")).toEqual([]);
    expect(proposals("9월 25일까지 답례품 고르는 거 할 일로 추가해줘")).not.toEqual([]);
  });
});

/**
 * "할 일로 넣어줘" 는 `ACTION_ADD_WRITE` 가 몰랐다 — `추가|등록|저장` 만 알아서,
 * 가장 자연스러운 한국어 하나가 도구를 못 열었다(2026-09-04 실측: 같은 문장에서
 * `추가해줘` 는 `add_amora_action` 이 열리고 `넣어줘` 는 안 열렸다).
 */
describe("할 일에 넣어 달라는 말", () => {
  it.each([
    "9월 25일까지 혼주 한복 예약하는 거 할 일로 넣어줘",
    "이번 달 20일까지 예단 준비하는 거 할 일로 넣어줘",
    "청첩장 주문 할 일에 넣어줘",
  ])("행동 쓰기 도구를 연다: %s", (userText) => {
    expect(names(userText)).toContain("add_amora_action");
  });

  // 반례. `넣어` 자체가 방아쇠가 되면 예산·메모 이야기가 할 일 도구를 받는다.
  it.each([
    "메모에 넣어",
    "예산에 넣어",
    "그 얘기는 메모에 넣어줘",
    "이 금액은 예산에 넣어줘",
    "예식장 예산에 500만원 더 넣어줘",
  ])("할 일이 아닌 '넣어'는 열지 않는다: %s", (userText) => {
    expect(names(userText)).not.toContain("add_amora_action");
  });
});

/**
 * **웃음 표기나 회상이 붙으면 요청이 통째로 사라졌다.** (2026-09-14 운영 실측)
 *
 * 두 문장 다 확인 카드가 없었고 아모라는 "반영되지 않았다"·"예산 화면에서 직접
 * 입력해 달라"고 답했다:
 *
 *   "드레스 300만원으로 잡아줘 ㅎㅎ"            → `JOKING` 의 `ㅋㅋ|ㅎㅎ` 에 걸림
 *   "원래 5천이었는데 총예산 6천으로 올려줘"     → `PAST_RECALL` 에 부탁 예외가 없음
 *
 * 둘 다 `isNotOurDecision` 이 참이 되어 `selectAmoraPendingProposalTools` 가 빈
 * 배열을 돌려주고, 카드 계약문이 프롬프트에 아예 안 실린다. ㅋㅋ·ㅎㅎ 는 한국어
 * 채팅에서 어조를 누그러뜨리는 말이지 무르는 말이 아니고, 회상 뒤에 **바꾸는**
 * 부탁이 붙으면 그건 요청이다.
 *
 *   웃음: 웃음 표기를 걷어낸 뒤 부탁 어미가 있으면 요청이다. 전언 갈래의
 *         `REQUEST_TO_AMORA` 는 `줘~`·`줘요`·`줄래` 를 못 봐서(2026-09-14 2차 감사:
 *         "잡아줘~ ㅎㅎ"·"잡아줘요 ㅎㅎ"·"잡아줄래? ㅎㅎ" 가 0개, 웃음만 떼면 4개)
 *         웃음·회상 예외는 그 어미까지 부탁으로 보는 `REQUEST_TO_AMORA_RELAXED` 를
 *         쓴다. 전언 갈래는 그대로다(`ownDecisionIsNotHearsay` 가 그 계약을 고정).
 *   회상: 부탁 어미만으로는 모자란다. 1차 수정은 어떤 부탁이든 회상을 풀어
 *         "작년에 예식장 알아봤었는데 그때 견적 다시 보여줘" 에 제안 도구 12개가
 *         열렸다 — 옛 값을 떠올리며 **읽어** 달라는 말이다. 문장 끝이 변경 동사 +
 *         부탁 어미(`CHANGE_REQUEST_TO_AMORA`)일 때만 회상을 푼다.
 *
 * 반대 방향 목록이 없으면 이 검사는 "`ㅋㅋ|ㅎㅎ` 와 `PAST_RECALL` 을 통째로 지워도
 * 초록"이다. `amoraChangeRequestCorpus` 의 NO_OFFER 에 있는 웃음·회상 문장을
 * 그대로 가져와 그 계약을 여기서도 고정한다. 웃음 반례는 전부 **웃음 표기만
 * 걷어내면 열리는** 문장이다 — 전언처럼 다른 가드가 먼저 막는 문장("친구는
 * 드레스에 300만원 썼대 ㅋㅋ")은 웃음 가드를 지워도 초록이라 넣지 않는다.
 */
describe("웃음 표기·회상이 붙은 요청", () => {
  const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

  /** 운영과 같은 경로 — 범위 필터까지 통과해야 카드가 된다(코퍼스 테스트와 같은 계산). */
  function offersCard(userText: string): boolean {
    const scope = classifyAmoraQuestionScope({ userText });
    return filterAmoraToolsByQuestionScope(
      selectAmoraPendingProposalTools({
        availableTools: PENDING_ACTION_TOOLS,
        userText,
        specialistType: "general",
        attachmentKind: "none",
      }),
      scope,
    ).length > 0;
  }

  function proposals(userText: string): string[] {
    return selectAmoraPendingProposalTools({
      availableTools: PENDING_ACTION_TOOLS,
      userText,
      specialistType: "general",
      specialistMatchedByKeyword: false,
    }).map((tool) => tool.name);
  }

  it.each([
    "드레스 300만원으로 잡아줘 ㅎㅎ",
    "원래 5천이었는데 총예산 6천으로 올려줘",
  ])("운영 문장: 범위 필터까지 통과해 카드를 낼 수 있다: %s", (userText) => {
    expect(offersCard(userText)).toBe(true);
  });

  it.each([
    "드레스 300만원으로 잡아줘 ㅎㅎ",
    "총예산 5천만원으로 바꿔줘 ㅋㅋ",
    "ㅎㅎ 스튜디오 예산 150만원으로 올려줘",
    "메이크업 80만원으로 맞춰줘ㅋㅋ",
    "신혼여행 예산 400만원으로 줄여 주세요 ㅎㅎ",
    "예식장 상담 일정 3월 15일로 추가해줘 ㅋㅋ",
    "상견례 일정 다음주 토요일로 옮겨줘! ㅋㅋㅋ",
    // `줘` 뒤에 `~`·`요`·`ㄹ래` 가 붙은 부탁 — 2026-09-14 2차 감사에서 넷 다 0개였다.
    "드레스 300만원으로 잡아줘~ ㅎㅎ",
    "드레스 300만원으로 잡아줘요 ㅎㅎ",
    "드레스 300만원으로 잡아줄래? ㅎㅎ",
  ])("웃음 표기가 붙어도 부탁이면 요청이다: %s", (userText) => {
    expect(proposals(userText)).not.toEqual([]);
  });

  it.each([
    "원래 5천이었는데 총예산 6천으로 올려줘",
    "작년에 4천만원으로 잡았었는데 총예산 5천만원으로 바꿔줘",
    "예전에 드레스 200이었는데 이제 드레스 300만원으로 잡아줘",
    "처음엔 4월이었는데 결혼식 날짜 10월 17일로 변경해줘",
    "그때는 상견례를 3월에 하기로 했었는데 상견례 일정 4월 12일로 옮겨줘",
    "원래 예단은 안 하려고 했었는데 예단 예산 300만원으로 잡아 주세요",
    "원래 5천이었는데 총예산 6천으로 올려줘 ㅎㅎ",
    "원래 5천이었는데 총예산 6천으로 올려줘~",
    // 변경 동사가 `해줘`·`부탁해` 꼴인 요청도 회상을 푼다 — 좁히면서 잃으면 안 된다.
    "원래 5천이었는데 총예산 6천으로 해줘",
    "원래 5천이었는데 총예산 6천으로 변경 부탁해",
  ])("회상 뒤에 부탁이 붙으면 요청이다: %s", (userText) => {
    expect(proposals(userText)).not.toEqual([]);
  });

  it.each([
    "ㅋㅋㅋ 이럴 바엔 총예산 1억으로 올려서 하와이에서 하자",
    "신혼여행 예산 5억이면 딱인데 ㅋㅋ 로또부터 사야지",
    "예식장 대관 가격이 0.3억이라니 ㅋㅋ 차라리 공원에서 하는게 낫겟다",
    "드레스 예산 1억으로 하자 ㅋㅋ",
    "총예산 3억으로 올리면 되겠네 ㅎㅎ",
    "우리 결혼식 날짜 크리스마스로 하자 ㅋㅋ",
    // 웃음만 떼면 열리는 선언("우리 총예산은 5천만원이야" 는 OFFER) — 웃음 가드가 정한다.
    "총예산 5천만원이야 ㅋㅋ",
    "총예산 5천만원으로 바꿔달라는 건 농담이야",
    "장난이야 총예산 1억으로 올려줘",
  ])("부탁이 없는 웃음과 농담·장난은 그대로 막힌다: %s", (userText) => {
    expect(proposals(userText)).toEqual([]);
  });

  it.each([
    "작년에 예식장 알아봤었어",
    "원래는 드레스 예산 300만원이었어",
    "작년에 잡았던 예산이 4천만원이었는데 지금은 상황이 많이 달라졌어",
    "재작년에 우리 부모님이 예단 비용으로 500만원 하셨었지",
    "예전에 예식장 예약을 4월 10일로 잡았다가 다 엎었었어",
    "우리 처음 만난 날이 2019년 5월 20일인데 그날로 결혼식 날짜 잡고 싶었지 뭐",
    "그때는 총예산 5천만원이었는데 지금 보니 너무 적었어",
    "원래 5천이었는데 총예산 6천으로 올렸었어",
  ])("부탁이 없는 회상은 그대로 막힌다: %s", (userText) => {
    expect(proposals(userText)).toEqual([]);
  });

  /**
   * 2026-09-14 2차 감사. 1차 수정의 회상 예외는 `REQUEST_TO_AMORA` 만 봐서 어떤
   * 부탁이든 회상을 풀었다 — 첫 문장에 제안 도구 12개, 둘째에 4개(수정 전 0개).
   * 옛 값을 떠올리며 **읽어** 달라는 말은 회상이다. 다섯 문장 다 회상 가드가 아니면
   * 열린다(부탁 어미가 있어 웃음·전언 가드는 안 걸린다).
   */
  it.each([
    "작년에 예식장 알아봤었는데 그때 견적 다시 보여줘",
    "예전에 남편이 총예산 4천으로 하자고 했었는데 그거 다시 보여줘",
    "원래 총예산 5천이었는데 지금 얼마로 잡혀 있는지 보여줘",
    "예전에 잡았던 상견례 일정 그대로인지 확인해줘",
    "작년에 예식장 알아봤었는데 그때 견적 다시 보여줘 ㅎㅎ",
  ])("회상 뒤에 붙은 부탁이 읽기면 회상이다: %s", (userText) => {
    expect(proposals(userText)).toEqual([]);
  });
});
