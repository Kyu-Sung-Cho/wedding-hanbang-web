import { describe, expect, it } from "vitest";

import {
  summarizeCardOnlyToolResults,
  AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS,
  AMORA_W3_PRIOR_USER_MAX_CHARS,
  buildAmoraBoundedContinuity,
  buildAmoraBoundedW3Continuity,
  canAttemptAmoraBoundedContinuity,
  hasExplicitAmoraW3ContinuityReference,
  isAmoraCardConfirmationMessage,
  selectAmoraBoundedContinuityWindow,
  type AmoraBoundedContinuityRow,
} from "@/lib/ai/amoraBoundedContinuity";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { selectAmoraTrustedHistoryRows } from "@/lib/ai/amoraTrustedHistory";

const CURRENT_ID = "30000000-0000-4000-8000-000000000003";
const ASSISTANT_ID = "30000000-0000-4000-8000-000000000002";
const PRIOR_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const SEGMENT_ID = "60000000-0000-4000-8000-000000000001";

function rows(): AmoraBoundedContinuityRow[] {
  return [
    {
      id: CURRENT_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: "그게 너무 속상해",
      metadata: null,
      visibility: "shared",
      segment_id: SEGMENT_ID,
    },
    {
      id: ASSISTANT_ID,
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: "예식장 계약 조건을 다시 확인해볼 수 있어요.",
      metadata: { in_reply_to_user_message_id: PRIOR_ID },
      visibility: "shared",
      segment_id: SEGMENT_ID,
    },
    {
      id: PRIOR_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: "예식장 계약 때문에 파트너와 의견이 달라요",
      metadata: null,
      visibility: "shared",
      segment_id: SEGMENT_ID,
    },
  ];
}

function build(overrides: Partial<Parameters<
  typeof buildAmoraBoundedW3Continuity
>[0]> = {}) {
  return buildAmoraBoundedW3Continuity({
    newestFirstRows: rows(),
    currentMessageId: CURRENT_ID,
    currentUserText: "그게 너무 속상해",
    requesterUserId: USER_ID,
    visibility: "shared",
    segmentId: SEGMENT_ID,
    ...overrides,
  });
}

describe("Amora bounded W3 continuity", () => {
  it.each([
    "왜?",
    "첫 번째가 좋아",
    "아까 말한 거 다시 설명해줘",
    "그걸로 해줘",
    "응, 그렇게 해줘",
    "아까 거",
    "방금 말한 것",
    "그거",
    "아까 말한 거 다시 설명해주세요",
    "그거 다시 정리해주세요",
    "첫 번째가 좋아요",
    "두 번째가 나아요",
    "2번으로 할게요",
    "왜 그렇게 생각해요?",
    "왜 그게 더 좋아요?",
    "무슨 뜻이에요?",
    "왜 그렇게 추천했어요?",
    "왜 그걸 추천했어요?",
    "두 번째로 할래요",
    "좀 더 자세히 설명해주세요",
    // 2026-08-29 에 부정 목록에서 옮겨 왔다.
    //
    // 예전 계약은 "되짚는 **단서**가 있어야 문맥을 준다" 였고, 그 틀에서 이 문장은
    // 단서로 치기엔 너무 헐거웠다. 지금 계약은 "다른 분야를 말하지 않는 한 대화
    // 안에 있다" 이다 — 운영 실측에서 결혼 대화 도중 끊긴 38건 중 35건이 진짜
    // 결혼 대화였고, 되짚는 표현은 그중 소수에만 있었다.
    //
    // 결혼 대화 도중의 "이유를 알려줘" 는 직전 것을 묻는 말이다. 문맥을 주는 것이
    // 맞고, 줘도 도구는 0개다.
    "이유를 알려줘",
  ])("allows an exact-row lookup candidate for %s without granting authority", (text) => {
    expect(canAttemptAmoraBoundedContinuity(text)).toBe(true);
  });

  it.each([
    "그래서 오늘 저녁 메뉴 추천해줘",
    "그거 말고 오늘 날씨 알려줘",
    "그래서 역사에 대해 알려줘",
    "영어 문법 다시 설명해줘",
    "날씨를 설명해줘",
    "회사 계획 정리해줘",
    "역사 설명해줘",
    "아까 날씨 다시 설명해줘",
    "그래서 오늘 뭐 먹을까?",
    "그거 오늘 뭐 먹을까?",
  ])("does not use a loose reference to pull wedding context into %s", (text) => {
    expect(canAttemptAmoraBoundedContinuity(text)).toBe(false);
  });

  it("does not open linked context for a long message that merely contains a reference", () => {
    const text = `그거 때문에 ${"마음이 ".repeat(100)}힘들어`;
    expect(canAttemptAmoraBoundedContinuity(text)).toBe(false);
  });

  it("returns the linked wedding exchange with context-only capabilities", () => {
    const candidate = rows();
    candidate[0] = { ...candidate[0]!, content: "왜?" };

    expect(buildAmoraBoundedContinuity({
      newestFirstRows: candidate,
      currentMessageId: CURRENT_ID,
      currentUserText: "왜?",
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    })).toEqual({
      mode: "linked_context_only",
      capabilities: "none",
      messages: [
        { role: "user", content: "예식장 계약 때문에 파트너와 의견이 달라요" },
        { role: "assistant", content: "예식장 계약 조건을 다시 확인해볼 수 있어요." },
        { role: "user", content: "왜?" },
      ],
    });
  });

  it.each([
    "그것도 마음에 걸려",
    "그거 때문에 힘들어",
    "그게 너무 속상해",
    "그걸 다시 말하기 싫어",
    "그 일은 아직 힘들어",
    "그 문제 때문에 지쳤어",
    "그 얘기가 계속 생각나",
    "그 말이 서운해",
    "아까 너무 당황했어",
    "방금 마음이 복잡해졌어",
    "앞에서 말한 게 속상해",
    "그래서 힘들어",
    "그 때문에 마음이 무거워",
  ])("recognizes the explicit reference marker in %s", (text) => {
    expect(hasExplicitAmoraW3ContinuityReference(text)).toBe(true);
    expect(canAttemptAmoraBoundedContinuity(text)).toBe(true);
  });

  it.each(["그 사람 때문에 힘들어", "요즘 힘들어", "일 때문에 지쳤어"])(
    "does not treat %s as a bounded reference",
    (text) => {
      expect(hasExplicitAmoraW3ContinuityReference(text)).toBe(false);
    },
  );

  it.each([
    "그거 말고 오늘 너무 힘들어",
    "그거랑 상관없이 오늘 너무 힘들어",
    "아까 얘기 말고 지금 회사 때문에 힘들어",
    "그래서 회사 일이 힘들어",
    "그래서 오늘 힘들어",
    "그거는 됐고 오늘 너무 힘들어",
    "그 얘기는 여기까지. 오늘 회사가 너무 힘들어",
    "그거는 나중에 하고 지금 회사 일이 힘들어",
    "아까 건 됐고, 오늘 회사 때문에 힘들어",
    "그 일은 끝났고 요즘 직장이 힘들어",
    "그거는 괜찮고 다른 일 때문에 힘들어",
    "그거랑은 무관하게 오늘 너무 힘들어",
    "그 얘기와 관계없이 오늘 너무 힘들어",
    "그거 때문은 아니지만 오늘 회사가 힘들어",
    "그거는 됐어. 오늘 뭐 먹을지 생각 중이야",
  ])("respects an explicit topic break in %s", (text) => {
    expect(hasExplicitAmoraW3ContinuityReference(text)).toBe(false);
    expect(canAttemptAmoraBoundedContinuity(text)).toBe(false);
  });

  it("returns only the linked prior exchange and current user turn", () => {
    expect(build()).toEqual([
      { role: "user", content: "예식장 계약 때문에 파트너와 의견이 달라요" },
      { role: "assistant", content: "예식장 계약 조건을 다시 확인해볼 수 있어요." },
      { role: "user", content: "그게 너무 속상해" },
    ]);
  });

  it("also accepts a wedding-adjacent W1 prior turn", () => {
    const candidate = rows();
    candidate[2] = {
      ...candidate[2]!,
      content: "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어",
    };
    expect(build({ newestFirstRows: candidate })?.[0]).toEqual({
      role: "user",
      content: "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어",
    });
  });

  it("bounds both stored messages while preserving the current turn", () => {
    const candidate = rows();
    candidate[1]!.content = "답".repeat(2_000);
    candidate[2]!.content = `예식장 ${"계약".repeat(1_000)}`;
    const result = build({ newestFirstRows: candidate });

    expect(Array.from(result?.[0]?.content ?? "")).toHaveLength(
      AMORA_W3_PRIOR_USER_MAX_CHARS,
    );
    expect(Array.from(result?.[1]?.content ?? "")).toHaveLength(
      AMORA_W3_PRIOR_ASSISTANT_MAX_CHARS,
    );
    expect(result?.[2]?.content).toBe("그게 너무 속상해");
  });

  it.each([
    ["missing row", (value: AmoraBoundedContinuityRow[]) => value.slice(0, 2)],
    ["wrong current id", (value: AmoraBoundedContinuityRow[]) => {
      value[0] = { ...value[0]!, id: "30000000-0000-4000-8000-000000000099" };
      return value;
    }],
    ["wrong prior actor", (value: AmoraBoundedContinuityRow[]) => {
      value[2] = { ...value[2]!, sender_id: "10000000-0000-4000-8000-000000000099" };
      return value;
    }],
    ["assistant carrying a user sender id", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = { ...value[1]!, sender_id: USER_ID };
      return value;
    }],
    ["mixed visibility", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = { ...value[1]!, visibility: "bride_private" };
      return value;
    }],
    ["mixed conversation segment", (value: AmoraBoundedContinuityRow[]) => {
      value[2] = {
        ...value[2]!,
        segment_id: "60000000-0000-4000-8000-000000000099",
      };
      return value;
    }],
    ["partner-target row", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = { ...value[1]!, metadata: { target: "partner" } };
      return value;
    }],
    ["missing reply binding", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = { ...value[1]!, metadata: null };
      return value;
    }],
    ["wrong reply binding", (value: AmoraBoundedContinuityRow[]) => {
      value[1] = {
        ...value[1]!,
        metadata: { in_reply_to_user_message_id: CURRENT_ID },
      };
      return value;
    }],
  ])("rejects %s", (_label, mutate) => {
    expect(build({ newestFirstRows: mutate(rows()) })).toBeNull();
  });

  it.each([
    "예식장 계약금 환불을 법적으로 판단해줘",
    "요즘 너무 힘들어",
    "파이썬 코드를 작성해줘",
  ])("rejects unsafe or unrelated prior scope: %s", (content) => {
    const candidate = rows();
    candidate[2] = { ...candidate[2]!, content };
    expect(build({ newestFirstRows: candidate })).toBeNull();
  });

  it.each([
    "그거 때문에 죽고 싶어",
    "그거 법적으로 판단해줘",
    "그걸로 삼성전자 주식 사줘",
  ])("keeps the current safety or domain boundary authoritative: %s", (content) => {
    const candidate = rows();
    candidate[0] = { ...candidate[0]!, content };
    expect(canAttemptAmoraBoundedContinuity(content)).toBe(false);
    expect(buildAmoraBoundedContinuity({
      newestFirstRows: candidate,
      currentMessageId: CURRENT_ID,
      currentUserText: content,
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    })).toBeNull();
  });

  it("rejects a current turn without an explicit reference", () => {
    const candidate = rows();
    candidate[0] = { ...candidate[0]!, content: "오늘 너무 속상해" };
    expect(build({
      newestFirstRows: candidate,
      currentUserText: "오늘 너무 속상해",
    })).toBeNull();
  });

  it("keeps the legacy W3 wrapper limited to W3 even for a W4-low reference", () => {
    const candidate = rows();
    candidate[0] = { ...candidate[0]!, content: "아까 말한 거 다시 설명해줘" };
    expect(build({
      newestFirstRows: candidate,
      currentUserText: "아까 말한 거 다시 설명해줘",
    })).toBeNull();
  });
});

describe("카드로만 보여준 도구 결과를 연결 문맥에 한 줄로 되살린다 (2026-09-04)", () => {
  it("장소 검색은 검색어·건수·출처만 말하고 이름은 지어내지 않는다", () => {
    const line = summarizeCardOnlyToolResults([
      { success: true, toolName: "search_nearby_places", toolInput: {},
        toolOutput: { query: "부산 해운대 한정식", places: [], resultCount: 5, displayOnlyPlaceholder: true }, displayMessage: "" },
    ]);
    expect(line).toContain("부산 해운대 한정식");
    expect(line).toContain("5곳");
    expect(line).toContain("광고·제휴 아님");
  });

  it("실패한 결과·모르는 도구·비배열은 아무것도 만들지 않는다", () => {
    expect(summarizeCardOnlyToolResults(null)).toBeNull();
    expect(summarizeCardOnlyToolResults([{ success: false, toolName: "search_nearby_places", toolOutput: { query: "x", resultCount: 3 } }])).toBeNull();
    expect(summarizeCardOnlyToolResults([{ success: true, toolName: "get_budget_summary", toolOutput: {} }])).toBeNull();
  });

  it("직전 답변에 검색 카드가 있었으면 연결 문맥의 assistant 메시지 끝에 요약이 붙는다", () => {
    const current = "방금 찾은 곳들 광고야 일반 검색이야? 수용 인원은 확인된 거야?";
    const withSearch = rows().map((row) => row.id === ASSISTANT_ID
      ? { ...row, content: "부산 해운대 근처 한정식집 후보를 찾아봤어요. 상견례 전에는 룸·주차를 직접 확인해 주세요.",
          metadata: { in_reply_to_user_message_id: PRIOR_ID,
            toolResults: [{ success: true, toolName: "search_nearby_places", toolOutput: { query: "부산 해운대 한정식", resultCount: 5 } }] } }
      : row.id === PRIOR_ID
        ? { ...row, content: "부산 해운대 근처에서 상견례 할 한정식집 3곳 찾아줘" }
        : { ...row, content: current });
    const result = buildAmoraBoundedContinuity({
      newestFirstRows: withSearch, currentMessageId: CURRENT_ID, currentUserText: current,
      requesterUserId: USER_ID, visibility: "shared", segmentId: SEGMENT_ID,
    });
    expect(result).not.toBeNull();
    const assistant = result?.messages.find((m) => m.role === "assistant");
    expect(assistant?.content).toContain("찾아봤어요");
    expect(assistant?.content).toContain("[카드 요약]");
    expect(assistant?.content).toContain("5곳");
    expect(result?.capabilities).toBe("none");
  });
});

/**
 * 2026-09-15 운영 재현: 카드를 확인한 직후의 후속 말은 직전 사용자 발화가 확인 버튼의 고정
 * 문장이라 재판정이 W4 였고, 연결 문맥이 끊겨 아모라가 영수증 한 줄만 보고 답했다.
 * 확인 쌍은 버튼 한 번이라 건너뛰고 그 앞의 요청↔카드 쌍을 닻으로 삼는다. 이 묶음은
 * **라우트가 따라야 할 순서**(원본 행 → 창 선택 → 신뢰 필터 → 빌더)로 잰다 — 순서가
 * 바뀌면 필터가 지운 행이 틈을 만든다.
 */
describe("카드 확인 쌍을 건너뛰어 연결 문맥의 닻을 찾는다", () => {
  const REQUEST_ID = "30000000-0000-4000-8000-000000000011";
  const CARD_ID = "30000000-0000-4000-8000-000000000012";
  const CONFIRM_ID = "30000000-0000-4000-8000-000000000013";
  const RECEIPT_ID = "30000000-0000-4000-8000-000000000014";
  const NOW_ID = "30000000-0000-4000-8000-000000000015";
  const PARTNER_ID = "10000000-0000-4000-8000-000000000002";
  const CONFIRMATION_TEXT = "좋아요. 제안한 변경을 적용해 주세요.";

  const userRow = (
    id: string,
    content: string,
    extra: Partial<AmoraBoundedContinuityRow> = {},
  ): AmoraBoundedContinuityRow => ({
    id,
    sender_id: USER_ID,
    sender_type: "bride",
    role: "user",
    content,
    metadata: null,
    visibility: "shared",
    segment_id: SEGMENT_ID,
    ...extra,
  });
  const amoraRow = (
    id: string,
    content: string,
    replyTo: string,
    metadata: Record<string, unknown> = {},
  ): AmoraBoundedContinuityRow => ({
    id,
    sender_id: null,
    sender_type: "ai",
    role: "assistant",
    content,
    metadata: {
      in_reply_to_user_message_id: replyTo,
      question_scope: "W0_wedding_core",
      ...metadata,
    } as AmoraBoundedContinuityRow["metadata"],
    visibility: "shared",
    segment_id: SEGMENT_ID,
  });

  const ACTION_ID = "50000000-0000-4000-8000-000000000001";
  /** 버튼이 보낸 확인 행에만 라우트·DB 트리거가 남기는 서버 확인 표식. */
  const buttonConfirmationRow = (id: string = CONFIRM_ID, actionId: unknown = ACTION_ID) =>
    userRow(id, CONFIRMATION_TEXT, {
      metadata: { confirmed_amora_action_id: actionId } as AmoraBoundedContinuityRow["metadata"],
    });

  /** DB 순서(최신 먼저) 그대로의 원본 행. */
  function rawRowsAfterConfirmedCard(currentText: string): AmoraBoundedContinuityRow[] {
    return [
      userRow(NOW_ID, currentText),
      amoraRow(RECEIPT_ID, "총예산을 5,000만 원으로 바꿨어요.", CONFIRM_ID),
      buttonConfirmationRow(),
      amoraRow(CARD_ID, "다음 변경을 적용할까요?\n- 총예산: 5,000만 원", REQUEST_ID, {
        pending_amora_action: { actionId: ACTION_ID, tool: "update_budget" },
      }),
      userRow(REQUEST_ID, "총예산 5000만원으로 바꿔줘"),
      userRow("30000000-0000-4000-8000-000000000010", "예식장 투어 일정 알려줘"),
    ];
  }

  /** 라우트가 따라야 할 순서: 원본 창 선택 → 신뢰 필터 → 빌더. */
  function buildLikeRoute(rawNewestFirst: AmoraBoundedContinuityRow[], currentText: string) {
    const window = selectAmoraBoundedContinuityWindow({
      newestFirstRows: rawNewestFirst,
      requesterUserId: USER_ID,
      visibility: "shared",
    });
    const trusted = selectAmoraTrustedHistoryRows({
      oldestFirstRows: [...window].reverse(),
      currentUserMessageId: NOW_ID,
      visibility: "shared",
    }).reverse();
    return buildAmoraBoundedContinuity({
      newestFirstRows: trusted,
      currentMessageId: NOW_ID,
      currentUserText: currentText,
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    });
  }

  it.each(["그럼 이제 얼마 남았어?", "그럼 그건 언제까지 해야 돼?", "적용된 거 맞아?"])(
    "확인 직후의 후속 말이 요청↔카드와 확인↔영수증을 함께 받는다: %s",
    (currentText) => {
      expect(canAttemptAmoraBoundedContinuity(currentText)).toBe(true);
      expect(buildLikeRoute(rawRowsAfterConfirmedCard(currentText), currentText)).toEqual({
        mode: "linked_context_only",
        capabilities: "none",
        messages: [
          { role: "user", content: "총예산 5000만원으로 바꿔줘" },
          { role: "assistant", content: "다음 변경을 적용할까요?\n- 총예산: 5,000만 원" },
          { role: "user", content: CONFIRMATION_TEXT },
          { role: "assistant", content: "총예산을 5,000만 원으로 바꿨어요." },
          { role: "user", content: currentText },
        ],
      });
    },
  );

  it("예전 3행 창(확인 문장이 직전 사용자 발화)으로는 끊겼다 — 고친 결함의 재현", () => {
    const currentText = "그럼 이제 얼마 남았어?";
    expect(buildAmoraBoundedContinuity({
      newestFirstRows: rawRowsAfterConfirmedCard(currentText).slice(0, 3),
      currentMessageId: NOW_ID,
      currentUserText: currentText,
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    })).toBeNull();
  });

  it("명사로 끝낸 계획 질문은 연결 문맥이 아니라 W0 저장 문맥으로 간다", () => {
    expect(classifyAmoraQuestionScope({ userText: "그럼 남은 예산은?" }).scope)
      .toBe("W0_wedding_core");
    expect(canAttemptAmoraBoundedContinuity("그럼 남은 예산은?")).toBe(false);
  });

  it("확인 쌍이 아니면 창은 오늘과 같은 3행이다", () => {
    const raw = rawRowsAfterConfirmedCard("그럼 이제 얼마 남았어?");
    raw[2] = userRow(CONFIRM_ID, "응 그렇게 적용해줘");
    expect(selectAmoraBoundedContinuityWindow({
      newestFirstRows: raw,
      requesterUserId: USER_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([NOW_ID, RECEIPT_ID, CONFIRM_ID]);
    expect(buildLikeRoute(raw, "그럼 이제 얼마 남았어?")).toBeNull();
  });

  it.each<[string, (raw: AmoraBoundedContinuityRow[]) => void]>([
    ["상대가 보낸 확인 문장", (raw) => {
      raw[2] = { ...buttonConfirmationRow(), sender_id: PARTNER_ID, sender_type: "groom" };
    }],
    ["상대에게 보낸 확인 문장", (raw) => {
      raw[2] = userRow(CONFIRM_ID, CONFIRMATION_TEXT, {
        metadata: {
          target: "partner",
          confirmed_amora_action_id: ACTION_ID,
        } as AmoraBoundedContinuityRow["metadata"],
      });
    }],
    ["손으로 덧붙인 확인 문장", (raw) => {
      // 결혼 낱말을 덧붙이면 그 문장 자체가 W0 닻이 되어 오늘 규칙대로 이어진다. 여기서는
      // 건너뛰기만 재므로 낱말 없는 덧붙임을 쓴다.
      raw[2] = userRow(CONFIRM_ID, `${CONFIRMATION_TEXT} 근데 잠깐만요`);
    }],
    ["확인 문장에 묶이지 않은 영수증", (raw) => {
      raw[1] = amoraRow(RECEIPT_ID, "총예산을 5,000만 원으로 바꿨어요.", REQUEST_ID);
    }],
    ["다른 공개 범위의 영수증", (raw) => {
      raw[1] = {
        ...amoraRow(RECEIPT_ID, "총예산을 5,000만 원으로 바꿨어요.", CONFIRM_ID),
        visibility: "bride_private",
      };
    }],
    ["다른 세그먼트의 요청", (raw) => {
      raw[4] = userRow(REQUEST_ID, "총예산 5000만원으로 바꿔줘", {
        segment_id: "60000000-0000-4000-8000-000000000099",
      });
    }],
    ["요청에 묶이지 않은 카드", (raw) => {
      raw[3] = amoraRow(CARD_ID, "다음 변경을 적용할까요?", CONFIRM_ID);
    }],
    ["닻도 확인 문장(확인 두 번 연속)", (raw) => {
      raw[4] = buttonConfirmationRow(REQUEST_ID);
    }],
    // 2026-09-15 리뷰: 버튼을 누르지 않고 말풍선의 고정 문장을 그대로 친 행은 서버 확인
    // 표식이 없다. 문장 모양만 보면 '버튼 확인 기록'으로 위조된다.
    ["서버 확인 표식 없이 손으로 친 고정 문장", (raw) => {
      raw[2] = userRow(CONFIRM_ID, CONFIRMATION_TEXT);
    }],
    ["문자열이 아닌 확인 표식", (raw) => {
      raw[2] = buttonConfirmationRow(CONFIRM_ID, 42);
    }],
    ["다른 카드의 action id 를 가리키는 확인 표식", (raw) => {
      raw[2] = buttonConfirmationRow(CONFIRM_ID, "50000000-0000-4000-8000-000000000999");
    }],
    ["표식이 null 이고 앞 행에도 카드 action id 가 없음(없음끼리 같다고 보지 않는다)", (raw) => {
      raw[2] = buttonConfirmationRow(CONFIRM_ID, null);
      raw[3] = amoraRow(CARD_ID, "다음 변경을 적용할까요?\n- 총예산: 5,000만 원", REQUEST_ID);
    }],
    ["확인 표식은 있는데 앞 행이 카드가 아님", (raw) => {
      raw[3] = amoraRow(CARD_ID, "다음 변경을 적용할까요?\n- 총예산: 5,000만 원", REQUEST_ID);
    }],
    ["카드의 action id 가 문자열이 아님", (raw) => {
      raw[3] = amoraRow(CARD_ID, "다음 변경을 적용할까요?", REQUEST_ID, {
        pending_amora_action: { actionId: 7, tool: "update_budget" },
      });
    }],
  ])("확인 쌍·닻이 어긋나면 잇지 않는다: %s", (_label, mutate) => {
    const raw = rawRowsAfterConfirmedCard("그럼 이제 얼마 남았어?");
    mutate(raw);
    expect(buildLikeRoute(raw, "그럼 이제 얼마 남았어?")).toBeNull();
  });

  it("손으로 친 고정 문장은 창 선택에서 3행으로 남고, 빌더에 5행으로 넘겨도 거부된다", () => {
    const currentText = "적용된 거 맞아?";
    const raw = rawRowsAfterConfirmedCard(currentText);
    raw[2] = userRow(CONFIRM_ID, CONFIRMATION_TEXT);
    expect(selectAmoraBoundedContinuityWindow({
      newestFirstRows: raw,
      requesterUserId: USER_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([NOW_ID, RECEIPT_ID, CONFIRM_ID]);
    expect(buildAmoraBoundedContinuity({
      newestFirstRows: raw.slice(0, 5),
      currentMessageId: NOW_ID,
      currentUserText: currentText,
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    })).toBeNull();
    // 같은 행에 서버 확인 표식만 있으면 이어진다 — 거부 이유가 표식이라는 대조군.
    raw[2] = buttonConfirmationRow();
    expect(buildAmoraBoundedContinuity({
      newestFirstRows: raw.slice(0, 5),
      currentMessageId: NOW_ID,
      currentUserText: currentText,
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    })).not.toBeNull();
  });

  it("확인 버튼은 공유 레인에서만 발급되므로 개인 레인에서는 표식이 있어도 5행을 고르지 않는다", () => {
    const currentText = "적용된 거 맞아?";
    const raw = rawRowsAfterConfirmedCard(currentText)
      .map((row) => ({ ...row, visibility: "bride_private" as const }));
    expect(selectAmoraBoundedContinuityWindow({
      newestFirstRows: raw,
      requesterUserId: USER_ID,
      visibility: "bride_private",
    })).toHaveLength(3);
    expect(buildAmoraBoundedContinuity({
      newestFirstRows: raw.slice(0, 5),
      currentMessageId: NOW_ID,
      currentUserText: currentText,
      requesterUserId: USER_ID,
      visibility: "bride_private",
      segmentId: SEGMENT_ID,
    })).toBeNull();
  });

  it("빌더는 가운데 쌍이 확인 쌍이 아닌 5행을 스스로 줄여 쓰지 않는다", () => {
    const raw = rawRowsAfterConfirmedCard("그럼 이제 얼마 남았어?");
    raw[2] = userRow(CONFIRM_ID, "예식장 계약 조건 다시 알려줘");
    expect(buildAmoraBoundedContinuity({
      newestFirstRows: raw.slice(0, 5),
      currentMessageId: NOW_ID,
      currentUserText: "그럼 이제 얼마 남았어?",
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    })).toBeNull();
  });

  it("확인 쌍 앞의 닻이 안전 고백이면 잇지 않는다", () => {
    const raw = rawRowsAfterConfirmedCard("그럼 이제 얼마 남았어?");
    raw[4] = userRow(REQUEST_ID, "남편이 어제 저를 때렸어요");
    raw[3] = amoraRow(CARD_ID, "지금 안전한 곳에 계신가요?", REQUEST_ID, {
      question_scope: "W2_high_risk_adjacent",
    });
    expect(buildLikeRoute(raw, "그럼 이제 얼마 남았어?")).toBeNull();
  });

  it("확인 쌍이 없으면 필터가 지운 안전 쌍 너머의 결혼 쌍과 잇지 않는다", () => {
    // [현재, 안전 응답, 폭력 고백, 결혼 답, 결혼 요청] 에 필터부터 태우면 [현재, 결혼 답,
    // 결혼 요청] 3행이 되어 인접해 보인다. 창 선택이 먼저라 3행 창에서 한 쌍이 지워져
    // 1행만 남는다.
    const currentText = "그럼 이제 어떻게 해?";
    const raw: AmoraBoundedContinuityRow[] = [
      userRow(NOW_ID, currentText),
      amoraRow(RECEIPT_ID, "지금 안전한 곳에 계신가요?", CONFIRM_ID, {
        question_scope: "W2_high_risk_adjacent",
      }),
      userRow(CONFIRM_ID, "남편이 어제 저를 때렸어요"),
      amoraRow(CARD_ID, "예식장 계약 조건을 다시 확인해볼 수 있어요.", REQUEST_ID),
      userRow(REQUEST_ID, "예식장 계약 조건 알려줘"),
    ];
    expect(canAttemptAmoraBoundedContinuity(currentText)).toBe(true);
    expect(buildLikeRoute(raw, currentText)).toBeNull();
    // 순서를 거꾸로 하면 실제로 이어진다 — 이 테스트가 순서를 재고 있다는 증거.
    const filteredFirst = selectAmoraTrustedHistoryRows({
      oldestFirstRows: [...raw].reverse(),
      currentUserMessageId: NOW_ID,
      visibility: "shared",
    }).reverse();
    expect(buildAmoraBoundedContinuity({
      newestFirstRows: filteredFirst,
      currentMessageId: NOW_ID,
      currentUserText: currentText,
      requesterUserId: USER_ID,
      visibility: "shared",
      segmentId: SEGMENT_ID,
    })).not.toBeNull();
  });

  it.each(["그럼 이제 죽고 싶어", "그럼 남편이 또 때릴까 봐 무서워", "그럼 남은 돈으로 코인 사줘"])(
    "확인 직후라도 현재 발화의 안전·범위 판정이 먼저다: %s",
    (currentText) => {
      expect(canAttemptAmoraBoundedContinuity(currentText)).toBe(false);
      expect(buildLikeRoute(rawRowsAfterConfirmedCard(currentText), currentText)).toBeNull();
    },
  );

  it("확인 문장 판정은 버튼의 고정 문장만 받는다", () => {
    expect(isAmoraCardConfirmationMessage(CONFIRMATION_TEXT)).toBe(true);
    expect(isAmoraCardConfirmationMessage("좋아요 제안한 변경을 적용해 주세요")).toBe(true);
    expect(isAmoraCardConfirmationMessage("응 적용해줘")).toBe(false);
    expect(isAmoraCardConfirmationMessage(`${CONFIRMATION_TEXT} 고마워`)).toBe(false);
    expect(isAmoraCardConfirmationMessage(null)).toBe(false);
  });
});
