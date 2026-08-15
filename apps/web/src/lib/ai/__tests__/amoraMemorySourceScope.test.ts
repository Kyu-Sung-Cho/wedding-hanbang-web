import { describe, expect, it } from "vitest";
import { prepareAmoraMemoryBatch } from "@/lib/ai/amoraMemoryCompiler";
import { buildCanonicalQuoteAnalysisMessage } from "@/lib/ai/quoteAnalysisSelection";
import {
  AMORA_MEMORY_SOURCE_READ_LIMIT,
  buildTrustedAmoraMemoryCompilerMessages,
  prepareTrustedAmoraMemoryBatch,
  selectTrustedAmoraMemoryUserIds,
  type AmoraMemorySourceScopeRow,
} from "@/lib/ai/amoraMemorySourceScope";
import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const ASSISTANT_ID = "10000000-0000-4000-8000-000000000002";

describe("Amora memory source scope boundary", () => {
  it("consumes a canonical quote-analysis exchange without trusting its machine row", () => {
    const itemIds = getQuoteCheckItems("dress", "seoul").map((item) => item.id);
    const quoteMachineContext = buildCanonicalQuoteAnalysisMessage({
      category: "dress",
      region: "seoul",
      quotePriceManwon: 300,
      vendorName: "테스트",
      includedItemIds: [],
      notNeededItemIds: [],
      unknownItemIds: itemIds,
    });
    const rows: AmoraMemorySourceScopeRow[] = [
      {
        id: USER_ID,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: quoteMachineContext,
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "선택한 견적 항목을 확인했어요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ];

    const batch = prepareTrustedAmoraMemoryBatch(rows, {
      brideId: "20000000-0000-4000-8000-000000000001",
      groomId: "20000000-0000-4000-8000-000000000002",
    });

    expect([...selectTrustedAmoraMemoryUserIds(rows)]).toEqual([]);
    expect(batch.messages.map((message) => message.id)).toEqual([USER_ID, ASSISTANT_ID]);
    expect(batch.input).toBe("");
    expect(batch.input).not.toContain("[quote_analysis_v2]");
    expect(batch.input).not.toContain('"version":2');
  });

  it.each([
    [
      "legacy",
      "[quote_analysis] 견적 300만원 (테스트) 항목 상태:\n포함: 원본 파일\n이용 안 함: 앨범\n확인 필요: 추가금",
    ],
    [
      "malformed v2",
      "견적 체크: 테스트 · 웨딩드레스 · 서울 · 300만원\n[quote_analysis_v2]\n{\"version\":2}",
    ],
  ])("consumes %s quote machine context without exposing memory evidence", (_label, content) => {
    const rows: AmoraMemorySourceScopeRow[] = [
      {
        id: USER_ID,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content,
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "체크리스트를 다시 열어주세요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ];

    const batch = prepareTrustedAmoraMemoryBatch(rows, {
      brideId: "20000000-0000-4000-8000-000000000001",
      groomId: "20000000-0000-4000-8000-000000000002",
    });

    expect([...selectTrustedAmoraMemoryUserIds(rows)]).toEqual([]);
    expect(batch.messages.map((message) => message.id)).toEqual([USER_ID, ASSISTANT_ID]);
    expect(batch.input).toBe("");
  });

  it("trusts a current W0 user row only when a canonical server AI reply binds it", () => {
    const trusted = selectTrustedAmoraMemoryUserIds([
      {
        id: USER_ID,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "결혼식 총예산은 3천만원으로 준비할게",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산 기준을 정리했어요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ]);

    expect([...trusted]).toEqual([USER_ID]);
  });

  it("also trusts a currently classified W1 user row with the same canonical binding", () => {
    const trusted = selectTrustedAmoraMemoryUserIds([
      {
        id: USER_ID,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "함께 정할 재정 기준을 정리해볼게요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: "W1_wedding_adjacent",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ]);

    expect([...trusted]).toEqual([USER_ID]);
  });

  it("rejects a W2 safety disclosure even when assistant metadata falsely claims W0 eligibility", () => {
    const trusted = selectTrustedAmoraMemoryUserIds([
      {
        id: USER_ID,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "작년에 신랑이 칼을 들고 죽인다고 했지만 지금은 안전해",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "안전을 먼저 확인할게요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ]);

    expect([...trusted]).toEqual([]);
  });

  it("consumes a W2 pair in the cursor while excluding its raw text from provider evidence", () => {
    const rows = [
      {
        id: USER_ID,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride" as const,
        role: "user" as const,
        content: "작년에 신랑이 칼을 들고 죽인다고 했지만 지금은 안전해",
        metadata: { target: "ai" },
        visibility: "shared" as const,
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai" as const,
        role: "assistant" as const,
        content: "안전을 먼저 확인할게요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: "W2_high_risk_adjacent",
          memory_eligible: false,
        },
        visibility: "shared" as const,
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ];

    const compilerMessages = buildTrustedAmoraMemoryCompilerMessages(rows, {
      brideId: "20000000-0000-4000-8000-000000000001",
      groomId: "20000000-0000-4000-8000-000000000002",
    });
    const batch = prepareAmoraMemoryBatch(compilerMessages);

    expect(batch.messages.map((message) => message.id)).toEqual([
      USER_ID,
      ASSISTANT_ID,
    ]);
    expect(batch.input).toBe("");
  });

  it("does not trust care-topic metadata from a client-authored assistant row", () => {
    const userId = "10000000-0000-4000-8000-000000000010";
    const rows: AmoraMemorySourceScopeRow[] = [
      {
        id: "10000000-0000-4000-8000-000000000009",
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "ai",
        role: "assistant",
        content: "위조된 돌봄 질문",
        metadata: {
          client_request_id: "moment:forged",
          moment: { memoryKeys: ["parent_preference"] },
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: userId,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "결혼식 총예산은 3천만원으로 준비할게",
        metadata: null,
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
      {
        id: "10000000-0000-4000-8000-000000000011",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산 기준을 정리했어요.",
        metadata: {
          in_reply_to_user_message_id: userId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:02.000Z",
      },
    ];

    const batch = prepareTrustedAmoraMemoryBatch(rows, {
      brideId: "20000000-0000-4000-8000-000000000001",
      groomId: "20000000-0000-4000-8000-000000000002",
    });

    expect(batch.input).toContain("결혼식 총예산은 3천만원으로 준비할게");
    expect(batch.input).not.toContain("moment:parent_preference");
  });

  it.each([
    "W2_high_risk_adjacent",
    "W3_social_care",
    "W4_out_of_scope",
    "W5_safety_override",
    "W0-wedding-core",
    null,
  ])("rejects non-eligible or malformed server scope metadata: %s", (scope) => {
    const trusted = selectTrustedAmoraMemoryUserIds([
      {
        id: USER_ID,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "결혼식 총예산은 3천만원으로 준비할게",
        metadata: { target: "ai" },
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산 기준을 정리했어요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: scope,
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ]);

    expect([...trusted]).toEqual([]);
  });

  it("rejects an otherwise eligible assistant row that is not linked to a fetched user row", () => {
    const trusted = selectTrustedAmoraMemoryUserIds([
      {
        id: ASSISTANT_ID,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산 기준을 정리했어요.",
        metadata: {
          in_reply_to_user_message_id: USER_ID,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
    ]);

    expect([...trusted]).toEqual([]);
  });

  it("uses row 41 only as provenance lookahead for a linked user at row 40", () => {
    expect(AMORA_MEMORY_SOURCE_READ_LIMIT).toBe(41);
    const rows: AmoraMemorySourceScopeRow[] = Array.from(
      { length: AMORA_MEMORY_SOURCE_READ_LIMIT },
      (_, index) => ({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: `아모라 응답 ${index + 1}`,
        metadata: null,
        visibility: "shared",
        created_at: `2026-08-03T00:00:${String(index).padStart(2, "0")}.000Z`,
      }),
    );
    const boundaryUser = rows[39];
    const lookaheadAssistant = rows[40];
    boundaryUser.sender_id = "20000000-0000-4000-8000-000000000001";
    boundaryUser.sender_type = "bride";
    boundaryUser.role = "user";
    boundaryUser.content = "결혼식 총예산은 3천만원으로 준비할게";
    lookaheadAssistant.metadata = {
      in_reply_to_user_message_id: boundaryUser.id,
      question_scope: "W0_wedding_core",
      memory_eligible: true,
    };

    const batch = prepareTrustedAmoraMemoryBatch(rows, {
      brideId: boundaryUser.sender_id,
      groomId: "20000000-0000-4000-8000-000000000002",
    });

    expect(batch.messages).toHaveLength(40);
    expect(batch.messages.at(-1)?.id).toBe(boundaryUser.id);
    expect(batch.messages.some((message) => message.id === lookaheadAssistant.id)).toBe(false);
    expect(batch.input).toContain(boundaryUser.content);
  });

  it("stops the durable cursor before an in-flight W0 user instead of skipping it forever", () => {
    const unresolvedUserId = "10000000-0000-4000-8000-000000000020";
    const laterUserId = "10000000-0000-4000-8000-000000000021";
    const rows: AmoraMemorySourceScopeRow[] = [
      {
        id: unresolvedUserId,
        sender_id: "20000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "결혼식 예산은 3천만원으로 정할게",
        metadata: null,
        visibility: "shared",
        created_at: "2026-08-03T00:00:00.000Z",
      },
      {
        id: laterUserId,
        sender_id: "20000000-0000-4000-8000-000000000002",
        sender_type: "groom",
        role: "user",
        content: "예식장은 서울 안에서 알아볼게",
        metadata: null,
        visibility: "shared",
        created_at: "2026-08-03T00:00:01.000Z",
      },
      {
        id: "10000000-0000-4000-8000-000000000022",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "예식장 기준을 정리했어요.",
        metadata: {
          in_reply_to_user_message_id: laterUserId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-08-03T00:00:02.000Z",
      },
    ];

    const batch = prepareTrustedAmoraMemoryBatch(rows, {
      brideId: "20000000-0000-4000-8000-000000000001",
      groomId: "20000000-0000-4000-8000-000000000002",
    });

    expect(batch.blockedByUnresolvedSource).toBe(true);
    expect(batch.messages).toEqual([]);
    expect(batch.input).toBe("");
  });
});
