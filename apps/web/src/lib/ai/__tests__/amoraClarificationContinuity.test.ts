import { describe, expect, it } from "vitest";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import {
  AMORA_CLARIFICATION_ANSWER_MAX_CHARS,
  isAmoraClarificationAnswerShaped,
  resolveAmoraWeddingClarificationContinuity,
  type AmoraClarificationContinuityRow,
} from "@/lib/ai/amoraClarificationContinuity";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

const PRIOR_ID = "11111111-1111-4111-8111-111111111111";
const ASSISTANT_ID = "22222222-2222-4222-8222-222222222222";
const CURRENT_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

type Row = AmoraClarificationContinuityRow;

type RowOverrides = {
  priorUserText?: string;
  assistantText?: string;
  currentText: string;
  assistantScope?: string;
  visibility?: string;
  priorVisibility?: string;
  inReplyTo?: string;
  assistantSenderId?: string | null;
  assistantTarget?: string;
  assistantPendingAction?: unknown;
};

function buildRows(overrides: RowOverrides): Row[] {
  const visibility = overrides.visibility ?? "shared";
  return [
    {
      id: PRIOR_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: overrides.priorUserText
        ?? "10월 17일 오후 2시에 드레스 투어 일정 넣어줘",
      metadata: null,
      visibility: overrides.priorVisibility ?? visibility,
    },
    {
      id: ASSISTANT_ID,
      sender_id: overrides.assistantSenderId === undefined
        ? null
        : overrides.assistantSenderId,
      sender_type: "ai",
      role: "assistant",
      content: overrides.assistantText
        ?? "2026년 10월 17일 오후 2시로 넣을까요, 2027년 10월 17일 오후 2시로 넣을까요?",
      metadata: {
        in_reply_to_user_message_id: overrides.inReplyTo ?? PRIOR_ID,
        question_scope: overrides.assistantScope ?? "W0_wedding_core",
        memory_eligible: true,
        ...(overrides.assistantTarget
          ? { target: overrides.assistantTarget }
          : {}),
        ...(overrides.assistantPendingAction !== undefined
          ? { pending_amora_action: overrides.assistantPendingAction }
          : {}),
      },
      visibility,
    },
    {
      id: CURRENT_ID,
      sender_id: USER_ID,
      sender_type: "bride",
      role: "user",
      content: overrides.currentText,
      metadata: null,
      visibility,
    },
  ];
}

function resolve(overrides: RowOverrides) {
  return resolveAmoraWeddingClarificationContinuity({
    rawOldestFirstRows: buildRows(overrides),
    requesterUserId: USER_ID,
    currentUserMessageId: CURRENT_ID,
    currentUserText: overrides.currentText,
  });
}

/** 임의의 행 배열을 그대로 넘긴다(사이에 낀 턴을 만들 때 쓴다). */
function resolveRaw(rows: Row[], currentText: string, currentId = CURRENT_ID) {
  return resolveAmoraWeddingClarificationContinuity({
    rawOldestFirstRows: rows,
    requesterUserId: USER_ID,
    currentUserMessageId: currentId,
    currentUserText: currentText,
  });
}

const MID_USER_ID = "55555555-5555-4555-8555-555555555555";
function userRow(id: string, content: string, senderId = USER_ID): Row {
  return {
    id,
    sender_id: senderId,
    sender_type: "bride",
    role: "user",
    content,
    metadata: null,
    visibility: "shared",
  };
}
function aiRow(id: string, content: string, replyTo: string, scope: string): Row {
  return {
    id,
    sender_id: null,
    sender_type: "ai",
    role: "assistant",
    content,
    metadata: {
      in_reply_to_user_message_id: replyTo,
      question_scope: scope,
      memory_eligible: scope === "W0_wedding_core",
    },
    visibility: "shared",
  };
}

// ---------------------------------------------------------------------------
// 안전 회귀가 먼저다. 문맥을 못 보는 분류기는 웨딩 맥락만 잃는 게 아니라 안전
// 맥락도 잃는다. 웨딩 연속성을 열면서 안전 경계가 같이 뚫리면 고친 게 아니다.
// ---------------------------------------------------------------------------
describe("안전: 짧은 확인이 위기·고위험 경계를 넘지 못한다", () => {
  const CRISIS_TEXTS = [
    "그냥 다 그만두고 죽고 싶어",
    "남편이 어제 저를 때렸어요",
    "화나면 저를 밀치고 물건을 던져요",
  ];

  it.each(CRISIS_TEXTS)(
    "위기 발화가 직전 턴이면 짧은 확인은 이어지지 않는다: %s",
    (priorUserText) => {
      expect(resolve({ priorUserText, currentText: "응 넣어줘" })).toBeNull();
      expect(resolve({ priorUserText, currentText: "네" })).toBeNull();
      expect(resolve({ priorUserText, currentText: "그렇게 해줘" })).toBeNull();
    },
  );

  it("현재 발화가 스스로 안전 신호를 들고 오면 게이트 자체가 열리지 않는다", () => {
    for (const text of [
      "응 넣어줘 그리고 남편이 저를 때렸어요",
      "네 그런데 죽고 싶어요",
      "그렇게 해줘 남편이 저를 밀쳤어요",
    ]) {
      expect(isAmoraClarificationAnswerShaped(text), text).toBe(false);
      expect(resolve({ currentText: text }), text).toBeNull();
    }
  });

  it("현재 발화가 고위험 영역을 새로 들고 오면 이어지지 않는다", () => {
    for (const text of [
      "응 넣어줘 그리고 계약금 환불되는지 알려줘",
      "네 그리고 이 약 복용량 알려줘",
      "그렇게 해줘 그리고 삼성전자 주식 어때",
      "응 그리고 대출 상품 추천해줘",
    ]) {
      expect(isAmoraClarificationAnswerShaped(text), text).toBe(false);
      expect(resolve({ currentText: text }), text).toBeNull();
    }
  });

  it("안전 판정된 발화는 W4-low가 아니므로 게이트가 거부한다", () => {
    for (const text of [...CRISIS_TEXTS, "남편이 제 통장을 못 쓰게 해요"]) {
      expect(isAmoraClarificationAnswerShaped(text), text).toBe(false);
    }
  });

  it("아모라의 직전 답 자체가 안전 맥락이면 이어지지 않는다", () => {
    expect(
      resolve({
        assistantText: "지금 폭력 위험이 있다면 112에 연락하실 수 있을까요?",
        currentText: "응 넣어줘",
      }),
    ).toBeNull();
  });

  it("서버가 W0으로 기록하지 않은 턴에는 이어지지 않는다", () => {
    for (const assistantScope of [
      "W1_wedding_adjacent",
      "W2_high_risk_adjacent",
      "W3_social_care",
      "W4_out_of_scope",
      "W5_safety_override",
    ]) {
      expect(
        resolve({ assistantScope, currentText: "응 넣어줘" }),
        assistantScope,
      ).toBeNull();
    }
  });

  it("직전 사용자 발화가 W1(관계 진술)이면 W0으로 올리지 않는다", () => {
    expect(
      resolve({
        priorUserText: "남편은 무관심하고 나만 다 하고 있어",
        assistantText: "어떤 부분이 가장 힘드신지 알려주세요.",
        currentText: "응 넣어줘",
      }),
    ).toBeNull();
  });

  // 분류기 자체가 안전해야 한다. "호출자가 조심하니까 괜찮다"는 것이 바로 이
  // 결함이 생긴 방식이다 — 판정을 한 곳에 몰아두고 그 곳이 문맥을 못 보게 두면
  // 웨딩 맥락과 안전 맥락을 같이 잃는다. 아래는 플래그를 **강제로 켠 채** 현재
  // 발화의 경계가 여전히 이기는지 본다. 연속성 판정을 함수 맨 앞으로 옮기는
  // 변형을 넣으면 이 블록이 빨개진다.
  it.each([
    ["그냥 다 그만두고 죽고 싶어", "W5_safety_override"],
    ["남편이 어제 저를 때렸어요", "W2_high_risk_adjacent"],
    ["응 넣어줘 그리고 임신 중인데 이 약 먹어도 돼?", "W2_high_risk_adjacent"],
    ["응 넣어줘 그리고 계약금 환불되는지 알려줘", "W2_high_risk_adjacent"],
    ["응 그리고 삼성전자 주식 사도 돼?", "W4_out_of_scope"],
    ["응 그리고 버그를 고쳐줘", "W4_out_of_scope"],
    ["응 그리고 코딩 좀 도와줘", "W4_out_of_scope"],
    ["응 회사 일정도 잡아줘", "W4_out_of_scope"],
    ["응 그리고 여행 예산도 잡아줘", "W4_out_of_scope"],
  ] as const)(
    "연속성 플래그가 켜져 있어도 현재 발화의 경계가 이긴다: %s",
    (userText, expectedScope) => {
      const classification = classifyAmoraQuestionScope({
        userText,
        hasWeddingClarificationContinuity: true,
      });
      expect(classification.scope).toBe(expectedScope);
      expect(classification.allowsLongTermMemory).toBe(false);
      expect(
        filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, classification),
      ).toEqual([]);
    },
  );

  // 받아들인 대가를 기록해 둔다. 연속성은 "아무 신호도 못 찾음"을 W0으로 읽는
  // 것이므로, 범위 밖 어휘 목록에 **구멍이 있으면 그 구멍이 커진다**. 전에는
  // 구멍에 빠진 문장이 도구 0개로 안전하게 떨어졌지만 이제는 조회 도구를 받는다.
  // 실제로 `OUT_OF_SCOPE_TASK_PATTERN`은 "버그를 고쳐"는 잡고 "버그 좀 고쳐"는
  // 놓친다(`버그를?\s*(?:고쳐|수정)`에 `좀`이 낄 자리가 없다).
  //
  // 이 대가를 받아들이는 이유는 열리는 것이 **조회와 제안 자격뿐**이기 때문이다.
  // 변경 함수는 W0에서도 도구 목록에 들어가지 않고(route.ts의 `isMutatingTool`
  // 필터), 실제 저장은 여전히 사용자가 확인 카드를 눌러야만 일어난다. 그리고
  // 안전·고위험 판정은 위 블록이 증명하듯 구멍과 무관하게 먼저 이긴다.
  it("범위 밖 어휘가 놓친 문장은 연속성 안에서 W0이 된다(알려진 대가)", () => {
    expect(
      classifyAmoraQuestionScope({ userText: "응 그리고 이 버그 좀 고쳐줘" }).scope,
    ).toBe("W4_out_of_scope");
    expect(
      classifyAmoraQuestionScope({
        userText: "응 그리고 이 버그 좀 고쳐줘",
        hasWeddingClarificationContinuity: true,
      }).scope,
    ).toBe("W0_wedding_core");
  });

  it("중재 요청은 연속성 플래그로 W0이 되지 않는다", () => {
    expect(
      classifyAmoraQuestionScope({
        userText: "응 넣어줘",
        requestKind: "mediation",
        hasWeddingClarificationContinuity: true,
      }).scope,
    ).toBe("W1_wedding_adjacent");
  });
});

// ---------------------------------------------------------------------------
// 사이에 낀 턴은 **벽**이어야 한다. 지워진 자리는 구멍이 된다.
//
// 이 블록은 실제로 있었던 결함을 고정한다. 처음에는 이 판정에
// `selectAmoraTrustedHistoryRows`의 결과를 넘겼는데, 그 함수는 "모델에 보여줘도
// 되는가"를 묻는 읽기 필터라 W2·W5 턴을 **목록에서 지운다**. 그래서 폭력 서술이
// 사이에 끼어도 연속성이 끊기지 않고, 오래된 웨딩 쌍이 답변과 붙어 보였다.
// 안전 질문에 답한 "응"이 W0 + 기억 ON + 도구 24/24를 받았다.
// ---------------------------------------------------------------------------
describe("사이에 낀 턴이 연속성을 끊는다", () => {
  const WEDDING_PAIR = [
    userRow("m1", "10월 17일 오후 2시에 드레스 투어 일정 넣어줘"),
    aiRow("m2", "2026년으로 넣을까요, 2027년으로 넣을까요?", "m1", "W0_wedding_core"),
  ];

  it.each([
    ["폭력 서술 + 아모라의 안전 질문", [
      userRow("m3", "남편이 어제 저를 때렸어요"),
      aiRow("m4", "지금 안전한 곳에 계신가요?", "m3", "W2_high_risk_adjacent"),
    ]],
    ["위기 발화(운영에서는 응답이 저장되지 않아 홀로 남는다)", [
      userRow("m3", "그냥 다 그만두고 죽고 싶어"),
    ]],
    ["고위험 영역 질문", [
      userRow("m3", "계약금 환불되는지 알려줘"),
      aiRow("m4", "확인된 사실만 정리해 드릴게요.", "m3", "W2_high_risk_adjacent"),
    ]],
    ["범위 밖 대화", [
      userRow("m3", "삼성전자 주식 사도 돼?"),
      aiRow("m4", "그건 제가 다룰 수 없어요.", "m3", "W4_out_of_scope"),
    ]],
  ])("%s 이 사이에 있으면 이어지지 않는다", (_label, middle) => {
    const rows = [...WEDDING_PAIR, ...middle, userRow("cur", "응")];
    expect(resolveRaw(rows, "응", "cur")).toBeNull();
  });

  it("한 홉만 이어진다 — 승인된 턴이 다음 턴의 근거가 되지 않는다", () => {
    const rows = [
      ...WEDDING_PAIR,
      userRow("m3", "응"),
      aiRow("m4", "2026년으로 넣을게요.", "m3", "W0_wedding_core"),
      userRow("cur", "응"),
    ];
    expect(resolveRaw(rows, "응", "cur")).toBeNull();
  });

  it("상대의 웨딩 요청을 빌려 쓰지 못한다", () => {
    const rows = [
      userRow("m1", "10월 17일 오후 2시에 드레스 투어 일정 넣어줘", MID_USER_ID),
      aiRow("m2", "2026년으로 넣을까요, 2027년으로 넣을까요?", "m1", "W0_wedding_core"),
      userRow("cur", "응"),
    ];
    expect(resolveRaw(rows, "응", "cur")).toBeNull();
  });

  it("사이에 아무것도 없으면 정상적으로 이어진다(대조군)", () => {
    const rows = [...WEDDING_PAIR, userRow("cur", "응")];
    expect(resolveRaw(rows, "응", "cur")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 구조 무결성. 세탁 경로를 하나씩 막았는지.
// ---------------------------------------------------------------------------
describe("구조: 연결이 증명되지 않으면 이어지지 않는다", () => {
  it("아모라 답이 직전 사용자 행에 묶여 있지 않으면 거부한다", () => {
    expect(
      resolve({ inReplyTo: CURRENT_ID, currentText: "응 넣어줘" }),
    ).toBeNull();
  });

  it("아모라 답이 서버가 쓴 것이 아니면 거부한다", () => {
    expect(
      resolve({ assistantSenderId: USER_ID, currentText: "응 넣어줘" }),
    ).toBeNull();
  });

  it("상대에게 보낸 답이면 거부한다", () => {
    expect(
      resolve({ assistantTarget: "partner", currentText: "응 넣어줘" }),
    ).toBeNull();
  });

  it("세 행의 공개 범위가 다르면 거부한다", () => {
    expect(
      resolve({
        visibility: "shared",
        priorVisibility: "bride_private",
        currentText: "응 넣어줘",
      }),
    ).toBeNull();
  });

  it("현재 행이 이번 요청에 묶인 행이 아니면 거부한다", () => {
    expect(
      resolveAmoraWeddingClarificationContinuity({
        rawOldestFirstRows: buildRows({ currentText: "응 넣어줘" }),
        requesterUserId: USER_ID,
        currentUserMessageId: PRIOR_ID,
        currentUserText: "응 넣어줘",
      }),
    ).toBeNull();
  });

  it("저장된 현재 행 본문이 이번 요청 본문과 다르면 거부한다", () => {
    expect(
      resolveAmoraWeddingClarificationContinuity({
        rawOldestFirstRows: buildRows({ currentText: "응 넣어줘" }),
        requesterUserId: USER_ID,
        currentUserMessageId: CURRENT_ID,
        currentUserText: "예산 지워줘",
      }),
    ).toBeNull();
  });

  it("행이 세 개보다 적으면 거부한다", () => {
    expect(
      resolveAmoraWeddingClarificationContinuity({
        rawOldestFirstRows: buildRows({ currentText: "응 넣어줘" }).slice(1),
        requesterUserId: USER_ID,
        currentUserMessageId: CURRENT_ID,
        currentUserText: "응 넣어줘",
      }),
    ).toBeNull();
  });

  // 아모라 쪽 문장의 **어형**은 판정에 쓰지 않는다. 어떤 어미로 되물어도
  // 이어져야 한다 — 목록에 없는 어미 하나가 고리를 되살리는 것이 이 결함의
  // 원래 모습이었다. 실측 두 건과, 정규식을 짰다면 놓쳤을 형태들을 함께 본다.
  it.each([
    "2026년으로 넣을까요, 2027년으로 넣을까요?",
    "이 금액이 사진 촬영만인지 묶음인지 알려주세요.",
    "연도를 알려주시면 바로 넣을게요",
    "둘 중 어느 쪽인지 콕 집어주시면 돼요",
    "아직 연도를 못 정했어요",
    "10월 17일 오후 2시 드레스 투어 일정을 넣었어요.",
  ])("아모라가 어떤 어미로 말했든 이어진다: %s", (assistantText) => {
    expect(resolve({ assistantText, currentText: "응 넣어줘" })).not.toBeNull();
  });

  // 확인 카드가 이미 떠 있으면 산문 "응, 해줘"는 확인이 아니다. 확인은 서버가
  // 발급한 action_id를 실어 보내는 것뿐이고, 그래야 사용자가 보고 누른 것과
  // 서버가 실행하는 것이 같다. 이 관문이 없으면 카드를 우회해 도구가 열린다.
  it("이미 확인 카드를 낸 턴에는 이어지지 않는다", () => {
    expect(
      resolve({
        assistantText: "요청 내용을 확인해볼게요.",
        assistantPendingAction: {
          version: 2,
          actionId: "11111111-1111-4111-8111-111111111111",
          tool: "update_budget",
          input: { total_budget: 40_000_000 },
        },
        currentText: "응 넣어줘",
      }),
    ).toBeNull();
  });

  // 설명·지목·선택형 되짚기는 이미 bounded continuity의 context-only 계약이
  // 맡는다. 한 문장을 두 계약이 다투면 어느 쪽이 이기는지 아무도 모르게 된다.
  // 물음표가 없어 물음표 관문에도 안 걸리는 형태들로 확인한다.
  it.each([
    "그거",
    "아까 말한 거",
    "첫 번째가 좋아",
    "무슨 뜻이야",
  ])("설명·지목형 되짚기는 도구 경로로 넘어오지 않는다: %s", (currentText) => {
    expect(isAmoraClarificationAnswerShaped(currentText), currentText).toBe(false);
    expect(resolve({ currentText }), currentText).toBeNull();
  });

  it("답이 길면 되묻기에 대한 답으로 보지 않는다", () => {
    const long = `사진 촬영만 할게요. ${"그리고 덧붙이자면 ".repeat(40)}`;
    expect(long.length).toBeGreaterThan(AMORA_CLARIFICATION_ANSWER_MAX_CHARS);
    expect(isAmoraClarificationAnswerShaped(long)).toBe(false);
    expect(resolve({ currentText: long })).toBeNull();
  });

  // 아래 다섯은 라운드2 뮤테이션 일제 점검에서 **아무 테스트도 잡지 않던** 관문이다.
  // 지워도 초록불이던 방어선은 방어선이 아니다.
  it("현재 행이 요청자 본인의 것이 아니면 거부한다", () => {
    const rows = buildRows({ currentText: "응 넣어줘" });
    (rows[2] as { sender_id: unknown }).sender_id = MID_USER_ID;
    expect(resolveRaw(rows, "응 넣어줘")).toBeNull();
  });

  it("현재 행이 상대에게 보낸 메시지면 거부한다", () => {
    const rows = buildRows({ currentText: "응 넣어줘" });
    (rows[2] as { metadata: unknown }).metadata = { target: "partner" };
    expect(resolveRaw(rows, "응 넣어줘")).toBeNull();
  });

  it("직전 사용자 행이 상대에게 보낸 메시지면 거부한다", () => {
    const rows = buildRows({ currentText: "응 넣어줘" });
    (rows[0] as { metadata: unknown }).metadata = { target: "partner" };
    expect(resolveRaw(rows, "응 넣어줘")).toBeNull();
  });

  it("현재 행과 아모라 행의 공개 범위가 다르면 거부한다", () => {
    const rows = buildRows({ currentText: "응 넣어줘" });
    (rows[2] as { visibility: unknown }).visibility = "bride_private";
    expect(resolveRaw(rows, "응 넣어줘")).toBeNull();
  });

  // 아모라 행의 id만 현재 행과 같게 둔다. 다른 관문(회신 결속·현재 행 결속)은
  // 그대로 통과하므로 **중복 검사만이** 이 턴을 막을 수 있다.
  it("세 행 중 두 개가 같은 id면 거부한다", () => {
    const rows = buildRows({ currentText: "응 넣어줘" });
    (rows[1] as { id: unknown }).id = CURRENT_ID;
    expect(resolveRaw(rows, "응 넣어줘")).toBeNull();
  });

  it("되묻기가 두 번 연속되면 두 번째 답은 이어지지 않는다(한 홉 경계)", () => {
    expect(
      resolve({ priorUserText: "사진 촬영만", currentText: "응 넣어줘" }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 고쳐야 하는 것. 실제로 재현된 두 대화.
// ---------------------------------------------------------------------------
describe("되묻기 고리에서 빠져나올 수 있다", () => {
  it("사례 A — 일정: 아모라가 연도를 되물은 뒤 짧은 확인이 살아난다", () => {
    for (const currentText of [
      "응 넣어줘",
      "네",
      "그렇게 해줘",
      "2026년으로 넣어줘",
      "2026년 10월 17일로 넣어줘",
      "2026년이요",
      "첫 번째로 해줘",
    ]) {
      const continuity = resolve({ currentText });
      expect(continuity, currentText).not.toBeNull();
      expect(continuity?.priorUserText).toBe(
        "10월 17일 오후 2시에 드레스 투어 일정 넣어줘",
      );

      const classification = classifyAmoraQuestionScope({
        userText: currentText,
        hasWeddingClarificationContinuity: true,
      });
      expect(classification.scope, currentText).toBe("W0_wedding_core");
      expect(
        filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, classification).length,
        currentText,
      ).toBeGreaterThan(0);
    }
  });

  it("사례 B — 예산: 물음표 없이 끝나는 되묻기에도 답할 수 있다", () => {
    const continuity = resolve({
      priorUserText: "스튜디오 예산 300만원으로 잡아줘",
      assistantText:
        "이 금액이 사진 촬영만인지, 드레스·헤어·메이크업까지 포함한 묶음인지 알려주세요.",
      currentText: "사진 촬영만",
    });
    expect(continuity).not.toBeNull();
    expect(continuity?.priorUserText).toBe("스튜디오 예산 300만원으로 잡아줘");
  });

  it("연속성 없이는 같은 발화가 도구 0개로 떨어진다(고리 재현)", () => {
    for (const currentText of ["응 넣어줘", "네", "사진 촬영만"]) {
      const classification = classifyAmoraQuestionScope({ userText: currentText });
      expect(classification.scope, currentText).toBe("W4_out_of_scope");
      expect(
        filterAmoraToolsByQuestionScope(BETA_SAFE_TOOLS, classification),
      ).toEqual([]);
    }
  });
});
