import { describe, expect, it } from "vitest";

import { assessAmoraSafetyText } from "@/lib/ai/amoraCrisisClassifier";
import { selectAmoraTrustedHistoryRows } from "@/lib/ai/amoraTrustedHistory";
import { buildCanonicalQuoteAnalysisMessage } from "@/lib/ai/quoteAnalysisSelection";
import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";

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

describe("selectAmoraTrustedHistoryRows", () => {
  it("projects a prior valid quote machine row to its strict human header", () => {
    const priorId = "30000000-0000-4000-8000-000000000001";
    const assistantId = "20000000-0000-4000-8000-000000000001";
    const itemIds = getQuoteCheckItems("dress", "seoul").map((item) => item.id);
    const machineContext = buildCanonicalQuoteAnalysisMessage({
      category: "dress",
      region: "seoul",
      quotePriceManwon: 300,
      vendorName: "테스트",
      includedItemIds: [],
      notNeededItemIds: [],
      unknownItemIds: itemIds,
    });
    const rows = [
      userRow(priorId, machineContext),
      assistantRow(assistantId, priorId),
      userRow(CURRENT_ID, "우리 결혼 예산을 다시 정리해줘"),
    ];

    const selected = selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    });

    expect(selected.map((row) => row.id)).toEqual([priorId, assistantId, CURRENT_ID]);
    expect(selected[0]?.content).toBe(machineContext.split("\n")[0]);
    expect(JSON.stringify(selected)).not.toContain("[quote_analysis_v2]");
    expect(JSON.stringify(selected)).not.toContain('"version":2');
    expect(rows[0]?.content).toBe(machineContext);
  });

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
    ["W4 out-of-scope user", { userContent: "삼성전자 주식을 분석해줘" }],
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
    ["assistant marked W4", {
      assistantMetadata: { question_scope: "W4_out_of_scope" },
    }],
    ["assistant marked W5", {
      assistantMetadata: { question_scope: "W5_safety_override" },
    }],
    ["assistant missing question scope", {
      assistantMetadata: { question_scope: undefined },
    }],
    ["assistant not memory eligible", {
      assistantMetadata: { memory_eligible: false },
    }],
    ["assistant with malformed memory eligibility", {
      assistantMetadata: { memory_eligible: "true" },
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
    const priorId = "30000000-0000-4000-8000-000000000021";
    const baseMetadata = {
      in_reply_to_user_message_id: priorId,
      question_scope: "W0_wedding_core",
      memory_eligible: true,
    };
    const rows = [
      userRow(
        priorId,
        mutation.userContent ?? "웨딩 스튜디오 두 곳을 비교해줘",
        mutation.user,
      ),
      assistantRow("20000000-0000-4000-8000-000000000021", priorId, {
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

    expect(selectAmoraTrustedHistoryRows({
      oldestFirstRows: rows,
      currentUserMessageId: CURRENT_ID,
      visibility: "shared",
    }).map((row) => row.id)).toEqual([CURRENT_ID]);
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
