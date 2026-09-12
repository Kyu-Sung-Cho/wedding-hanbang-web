import { describe, expect, it } from "vitest";

import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { selectAmoraTrustedHistoryRows, type AmoraTrustedHistoryRow } from "@/lib/ai/amoraTrustedHistory";

const CURRENT_ID = "30000000-0000-4000-8000-000000000003";

type RejectedHistoryMutation = {
  userContent?: string;
  user?: Record<string, unknown>;
  assistant?: Record<string, unknown>;
  assistantMetadata?: Record<string, unknown> | null;
};

function userRow(
  id: string,
  content: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    sender_id: "00000000-0000-4000-8000-000000000001",
    sender_type: "bride",
    role: "user",
    content,
    metadata: null,
    visibility: "shared",
    ...overrides,
  };
}

function assistantRow(
  id: string,
  userMessageId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    sender_id: null,
    sender_type: "ai",
    role: "assistant",
    content: "서버가 생성한 안전한 답변",
    metadata: {
      in_reply_to_user_message_id: userMessageId,
      question_scope: "W0_wedding_core",
      memory_eligible: true,
    },
    visibility: "shared",
    ...overrides,
  };
}

const MUTATED_PRIOR_ID = "30000000-0000-4000-8000-000000000021";
const MUTATED_ASSISTANT_ID = "20000000-0000-4000-8000-000000000021";

/**
 * 한 쌍 + 현재 행을 만들되 한 군데만 바꾼다. 아래 두 표(거절/허용)가 **같은 입력
 * 생성기**를 쓰므로, 어느 쪽으로 옮겨도 비교 대상이 달라지지 않는다.
 */
function mutatedHistoryRows(mutation: RejectedHistoryMutation) {
  const baseMetadata = {
    in_reply_to_user_message_id: MUTATED_PRIOR_ID,
    question_scope: "W0_wedding_core",
    memory_eligible: true,
  };
  return [
    userRow(
      MUTATED_PRIOR_ID,
      mutation.userContent ?? "웨딩 스튜디오 두 곳을 비교해줘",
      mutation.user,
    ),
    assistantRow(MUTATED_ASSISTANT_ID, MUTATED_PRIOR_ID, {
      ...mutation.assistant,
      metadata: mutation.assistantMetadata === null
        ? null
        : {
            ...baseMetadata,
            ...mutation.assistantMetadata,
          },
    }),
    userRow(CURRENT_ID, "우리 결혼 예산을 다시 정리해줘"),
  ];
}

describe("selectAmoraTrustedHistoryRows", () => {
  it("keeps the current bound user row and one server-proven W0 exchange", () => {
    const priorId = "30000000-0000-4000-8000-000000000001";
    const assistantId = "20000000-0000-4000-8000-000000000001";
    const rows = [
      userRow(priorId, "웨딩 스튜디오 두 곳을 비교해줘"),
      assistantRow(assistantId, priorId),
      userRow(CURRENT_ID, "우리 결혼 예산을 다시 정리해줘"),
    ];

    expect(assessAmoraSafetyText(String(rows[0]?.content))).toMatchObject({
      resolution: "inconclusive",
      events: [],
    });

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([priorId, assistantId, CURRENT_ID]);
  });

  it("keeps a server-proven W1 exchange inside the requester's private lane", () => {
    const priorId = "30000000-0000-4000-8000-000000000011";
    const assistantId = "20000000-0000-4000-8000-000000000011";
    const privateVisibility = "bride_private";
    const rows = [
      userRow(
        priorId,
        "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어",
        { visibility: privateVisibility },
      ),
      assistantRow(assistantId, priorId, {
        visibility: privateVisibility,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W1_wedding_adjacent",
          memory_eligible: true,
        },
      }),
      userRow(CURRENT_ID, "신혼집 준비를 이어서 정리해줘", {
        visibility: privateVisibility,
      }),
    ];

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: privateVisibility,
    }).map((row) => row.id)).toEqual([priorId, assistantId, CURRENT_ID]);
  });

  it.each([
    ["partner-target user", {
      user: { metadata: { target: "partner" } },
    }],
    ["user with malformed metadata", { user: { metadata: [] } }],
    ["non-immediate W2 user", {
      userContent: "작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해",
    }],
    ["immediate W5 user", {
      userContent: "신랑이 지금 칼을 들고 나를 죽이겠다고 해",
    }],
    ["legal W2 user", {
      userContent: "웨딩 계약이 법적으로 유효한지 판단해줘",
    }],
    ["W3 social-care user", { userContent: "오늘 너무 속상해" }],
    // 2026-09-03: `W4 out-of-scope user` 항목을 아래 "이제 허용" 표로 옮겼다.
    // 지운 것이 아니라 기대값을 바꾼 것이고, 이유는 그 표의 주석에 있다.
    ["legacy assistant without provenance", { assistantMetadata: null }],
    ["non-AI assistant sender", { assistant: { sender_type: "bride" } }],
    ["non-assistant AI role", { assistant: { role: "user" } }],
    ["assistant with a sender id", {
      assistant: { sender_id: "00000000-0000-4000-8000-000000000002" },
    }],
    ["assistant linked to another user", {
      assistantMetadata: { in_reply_to_user_message_id: CURRENT_ID },
    }],
    ["assistant missing its reply link", {
      assistantMetadata: { in_reply_to_user_message_id: undefined },
    }],
    ["assistant marked W2", {
      assistantMetadata: { question_scope: "W2_high_risk_adjacent" },
    }],
    ["assistant marked W3", {
      assistantMetadata: { question_scope: "W3_social_care" },
    }],
    // 2026-09-03: `assistant marked W4` · `assistant not memory eligible` ·
    // `assistant with malformed memory eligibility` 세 항목도 아래 "이제 허용"
    // 표로 옮겼다. W2·W3·W5 는 여기 그대로 남는다.
    ["assistant marked W5", {
      assistantMetadata: { question_scope: "W5_safety_override" },
    }],
    ["assistant missing question scope", {
      assistantMetadata: { question_scope: undefined },
    }],
    ["partner-target assistant", {
      assistantMetadata: { target: "partner" },
    }],
    ["cross-visibility assistant", {
      assistant: { visibility: "bride_private" },
    }],
  ])("fails closed for %s while preserving only the current bound row", (
    _label: string,
    mutation: RejectedHistoryMutation,
  ) => {
    const rows = mutatedHistoryRows(mutation);
    const unanswered = userRow("30000000-0000-4000-8000-000000000099", "우리 결혼식 식순도 정리하고 싶어");
    for (const oldestFirstRows of [rows, [rows[0], unanswered, rows[1], rows[2]]]) {
      expect(selectAmoraTrustedHistoryRows({
        oldestFirstRows,
        currentUserMessageId: CURRENT_ID,
        visibility: "shared",
      }).map((row) => row.id)).toEqual([CURRENT_ID]);
    }
  });

  /**
   * 2026-09-03 에 열린 것들. 넷 다 예전에는 위 "fails closed" 표에 있었고,
   * 기대값만 바뀌었다.
   *
   * 왜 바꿨나: 스테이징 실측에서 결혼 낱말이 없는 턴 — 신랑의 하객 수 주장,
   * "생각이 완전히 바뀌었어. 제주에서 가족 20명만", "이유는 어머니가 장거리
   * 이동이 어려워서야" — 이 그 턴 이후 모든 이력에서 영구히 빠졌고, 두 턴 뒤
   * "둘의 의견을 중재해줘" 에서 아모라가 신랑 의견을 한 줄도 못 본 채 절충안
   * 0개를 냈다. 앞의 셋은 `W4_out_of_scope` 라서, 넷째("생각이 완전히
   * 바뀌었어")는 W0 인데 `memory_eligible=false` 로 저장돼서 빠졌다.
   *
   * `memory_eligible` 은 **장기 기억 적재 자격**이지 "같은 대화에서 다시
   * 보여줘도 되는가" 가 아니다. 두 질문을 겹쳐 쓴 것이 결함이었다.
   */
  it.each([
    ["W4 out-of-scope user", { userContent: "삼성전자 주식을 분석해줘" }],
    ["assistant marked W4", {
      assistantMetadata: { question_scope: "W4_out_of_scope" },
    }],
    ["assistant not memory eligible", {
      assistantMetadata: { memory_eligible: false },
    }],
    ["assistant with malformed memory eligibility", {
      assistantMetadata: { memory_eligible: "true" },
    }],
  ])("now carries %s into history", (
    _label: string,
    mutation: RejectedHistoryMutation,
  ) => {
    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: mutatedHistoryRows(mutation),
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([
      MUTATED_PRIOR_ID,
      MUTATED_ASSISTANT_ID,
      CURRENT_ID,
    ]);
  });

  it("drops an exchange whose linked user id is duplicated", () => {
    const priorId = "30000000-0000-4000-8000-000000000041";
    const rows = [
      userRow(priorId, "웨딩 스튜디오 두 곳을 비교해줘"),
      assistantRow("20000000-0000-4000-8000-000000000041", priorId),
      userRow(priorId, "결혼식 식순을 다시 확인해줘"),
      userRow(CURRENT_ID, "우리 결혼 예산을 다시 정리해줘"),
    ];

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([CURRENT_ID]);
  });
});

describe("trusted history with overlapping completed requests", () => {
  const firstId = "30000000-0000-4000-8000-000000000111";
  const secondId = "30000000-0000-4000-8000-000000000112";
  const firstAnswerId = "20000000-0000-4000-8000-000000000111";
  const secondAnswerId = "20000000-0000-4000-8000-000000000112";
  const first = () => userRow(firstId, "우리 결혼 예산은 3500만 원을 지키고 싶어");
  const second = () => userRow(secondId, "우리 결혼식 하객은 150명을 모시고 싶어", {
    sender_id: "00000000-0000-4000-8000-000000000002", sender_type: "groom",
  });
  const current = () => userRow(CURRENT_ID, "우리 결혼 준비 조건을 요약해줘");
  const select = (rows: AmoraTrustedHistoryRow[]) => selectAmoraTrustedHistoryRows({
    oldestFirstRows: rows, currentUserMessageId: CURRENT_ID, visibility: "shared",
  }).map(row => row.id);

  it.each([false, true])("keeps both verified exchanges in actual database order when reverse completion is %s", reverse => {
    const replies = [assistantRow(firstAnswerId, firstId), assistantRow(secondAnswerId, secondId)];
    if (reverse) replies.reverse();
    const rows = [first(), second(), ...replies, current()];
    expect(select(rows)).toEqual(rows.map(row => row.id));
  });

  it("does not borrow a future answer to complete an earlier question", () => {
    expect(select([first(), second(), assistantRow(secondAnswerId, secondId), current(), assistantRow(firstAnswerId, firstId)]))
      .toEqual([secondId, secondAnswerId, CURRENT_ID]);
  });

  it("does not move an answer before its source or restore a source omitted by a reset/window boundary", () => {
    expect(select([assistantRow(firstAnswerId, firstId), first(), current()])).toEqual([CURRENT_ID]);
    expect(select([assistantRow(firstAnswerId, firstId), current()])).toEqual([CURRENT_ID]);
  });

  it("drops ambiguous multiple answers to one source instead of choosing a convenient one", () => {
    expect(select([first(), assistantRow(firstAnswerId, firstId), assistantRow(secondAnswerId, firstId), current()]))
      .toEqual([CURRENT_ID]);
  });

  it("keeps an unrelated valid pair while refusing an interleaved private pair", () => {
    const privateUser = { ...second(), visibility: "groom_private" };
    const privateAnswer = assistantRow(secondAnswerId, secondId, { visibility: "groom_private" });
    expect(select([first(), privateUser, assistantRow(firstAnswerId, firstId), privateAnswer, current()]))
      .toEqual([firstId, firstAnswerId, CURRENT_ID]);
  });

  it("does not let duplicate answer ids become valid through interleaving", () => {
    expect(select([first(), second(), assistantRow(firstAnswerId, firstId), assistantRow(firstAnswerId, secondId), current()]))
      .toEqual([CURRENT_ID]);
  });
});

/**
 * 2026-09-03 스테이징 실측 재현.
 *
 * 신랑이 하객 수를 주장하고, 두 턴 뒤 장소를 바꾸고, 그 이유를 말했다. 셋 다
 * 결혼 낱말이 없어 `classifyAmoraQuestionScope` 가 문장 단위로 W4 를 줬고,
 * 옛 필터가 그 세 쌍을 전부 지워 중재 턴이 신랑 의견을 못 봤다.
 *
 * 각 사례는 **분류기의 실제 판정을 먼저 단언**한다. 분류가 나중에 바뀌면 이
 * 테스트가 "왜 통과하는지" 를 조용히 갈아타지 않고 그 자리에서 깨진다.
 */
describe("selectAmoraTrustedHistoryRows — 2026-09-03 스테이징 회귀", () => {
  const GROOM_HEADCOUNT =
    "나는 친척 관계상 180명은 불러야 한다고 봐, 대신 3500만원은 지키고 싶어";
  const GROOM_PIVOT = "생각이 완전히 바뀌었어. 제주에서 가족 20명만";
  const GROOM_REASON = "이유는 어머니가 장거리 이동이 어려워서야";

  function exchange(
    index: number,
    content: string,
    assistantMetadataOverrides: Record<string, unknown> = {},
  ) {
    const priorId = `30000000-0000-4000-8000-0000000005${String(index).padStart(2, "0")}`;
    const assistantId = `20000000-0000-4000-8000-0000000005${String(index).padStart(2, "0")}`;
    return {
      priorId,
      assistantId,
      rows: [
        userRow(priorId, content),
        assistantRow(assistantId, priorId, {
          metadata: {
            in_reply_to_user_message_id: priorId,
            question_scope: "W0_wedding_core",
            memory_eligible: true,
            ...assistantMetadataOverrides,
          },
        }),
      ],
    };
  }

  it("(a) 결혼 낱말이 없어 W4 로 분류되는 신랑 턴 세 개를 모두 이력에 싣는다", () => {
    for (const text of [GROOM_HEADCOUNT, GROOM_PIVOT, GROOM_REASON]) {
      // 이 세 문장이 정말 범위 밖으로 판정된다는 것이 이 결함의 전제다.
      expect(classifyAmoraQuestionScope({ userText: text }).scope)
        .toBe("W4_out_of_scope");
      // 안전 스크린은 이 문장들을 막지 않는다 — 막던 것은 범위였다.
      expect(assessAmoraSafetyText(text).resolution).toMatch(
        /^(no_safety_signal|inconclusive)$/,
      );
    }

    const first = exchange(1, GROOM_HEADCOUNT, {
      question_scope: "W4_out_of_scope",
      memory_eligible: false,
    });
    const second = exchange(2, GROOM_PIVOT, {
      question_scope: "W4_out_of_scope",
      memory_eligible: false,
    });
    const third = exchange(3, GROOM_REASON, {
      question_scope: "W4_out_of_scope",
      memory_eligible: false,
    });
    const rows = [
      ...first.rows,
      ...second.rows,
      ...third.rows,
      userRow(CURRENT_ID, "둘의 의견을 중재해줘"),
    ];

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([
      first.priorId,
      first.assistantId,
      second.priorId,
      second.assistantId,
      third.priorId,
      third.assistantId,
      CURRENT_ID,
    ]);
  });

  it("(b) memory_eligible=false 로 저장된 W0 쌍을 싣는다", () => {
    const priorId = "30000000-0000-4000-8000-000000000061";
    const assistantId = "20000000-0000-4000-8000-000000000061";
    // "계약" 이 들어간 문장을 처음 골랐다가 W2(법률 인접) 로 판정돼 이 단언이
    // 깨졌다. 사례가 겨냥한 경로(범위는 W0, 막던 것은 memory_eligible)를 실제로
    // 밟는 문장으로 바꿨다.
    const text = "예식장 후보 두 곳을 비교해줘";
    expect(classifyAmoraQuestionScope({ userText: text }).scope)
      .toBe("W0_wedding_core");

    const rows = [
      userRow(priorId, text),
      assistantRow(assistantId, priorId, {
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: false,
        },
      }),
      userRow(CURRENT_ID, "우리 결혼 예산을 다시 정리해줘"),
    ];

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([priorId, assistantId, CURRENT_ID]);
  });

  it.each([
    ["W2_high_risk_adjacent"],
    ["W3_social_care"],
    ["W5_safety_override"],
  ])("(c) 아모라 행이 %s 로 저장된 쌍은 계속 배제한다", (scope: string) => {
    const priorId = "30000000-0000-4000-8000-000000000071";
    const rows = [
      userRow(priorId, "웨딩 스튜디오 두 곳을 비교해줘"),
      assistantRow("20000000-0000-4000-8000-000000000071", priorId, {
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: scope,
          memory_eligible: true,
        },
      }),
      userRow(CURRENT_ID, "우리 결혼 예산을 다시 정리해줘"),
    ];

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([CURRENT_ID]);
  });

  it("(d) 사용자 행에 안전 신호가 있으면 아모라 행이 W0 여도 배제한다", () => {
    const priorId = "30000000-0000-4000-8000-000000000081";
    const violentText = "신랑이 술 마시고 때려서 갈비뼈에 금이 갔어";
    // 이 문장이 안전 스크린에 실제로 걸린다는 것이 이 사례의 전제다.
    const assessment = assessAmoraSafetyText(violentText);
    const blockedBySafety = (
      assessment.resolution !== "no_safety_signal"
      && assessment.resolution !== "inconclusive"
    ) || assessment.events.some((event) =>
      event.context === "disclosure"
      && event.polarity === "affirmed"
      && (event.temporality === "current" || event.temporality === "impending")
    );
    expect(blockedBySafety).toBe(true);

    const rows = [
      userRow(priorId, violentText),
      assistantRow("20000000-0000-4000-8000-000000000081", priorId),
      userRow(CURRENT_ID, "우리 결혼 예산을 다시 정리해줘"),
    ];

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([CURRENT_ID]);
  });

  it("(e) 상대(target: partner) 대상 아모라 행은 W4 를 열어도 배제한다", () => {
    const priorId = "30000000-0000-4000-8000-000000000091";
    const rows = [
      userRow(priorId, GROOM_HEADCOUNT),
      assistantRow("20000000-0000-4000-8000-000000000091", priorId, {
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W4_out_of_scope",
          memory_eligible: true,
          target: "partner",
        },
      }),
      userRow(CURRENT_ID, "둘의 의견을 중재해줘"),
    ];

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([CURRENT_ID]);
  });

  it("(f) 다른 레인(visibility)의 W4 쌍은 배제한다", () => {
    const priorId = "30000000-0000-4000-8000-000000000101";
    const rows = [
      userRow(priorId, GROOM_HEADCOUNT, { visibility: "groom_private" }),
      assistantRow("20000000-0000-4000-8000-000000000101", priorId, {
        visibility: "groom_private",
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W4_out_of_scope",
          memory_eligible: true,
        },
      }),
      userRow(CURRENT_ID, "둘의 의견을 중재해줘", {
        visibility: "bride_private",
      }),
    ];

    // 신부 레인 요청은 신랑 개인 레인 쌍을 못 본다.
    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "bride_private",
    }).map((row) => row.id)).toEqual([CURRENT_ID]);

    // 공유 레인 요청도 개인 레인 쌍을 못 본다.
    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows.map((row) =>
        row.id === CURRENT_ID ? { ...row, visibility: "shared" } : row
      ),
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([CURRENT_ID]);
  });
});
