import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock("@/lib/ai/auditedOpenAI", () => ({
  createOpenAIStructuredResponseWithAudit: mocks.provider,
}));

import {
  compileAmoraMemory,
  prepareAmoraMemoryBatch,
  validateAmoraMemoryCompilation,
  type MemoryCompilerMessage,
} from "@/lib/ai/amoraMemoryCompiler";
import {
  prepareTrustedAmoraMemoryBatch,
  selectTrustedAmoraMemoryUserIds,
  type AmoraMemorySourceScopeRow,
} from "@/lib/ai/amoraMemorySourceScope";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const REPLY_ID = "10000000-0000-4000-8000-000000000002";
const NEXT_ID = "10000000-0000-4000-8000-000000000003";
const BRIDE_ID = "20000000-0000-4000-8000-000000000001";
const PREFERENCE = "예식장은 서울 동쪽 지역을 우선 검토하고 싶어.";
const DENIED = `${PREFERENCE} 이 내용은 장기 기억에 넣지 말고 이번 답변에서만 참고해줘.`;

function source(content: string, id = USER_ID): MemoryCompilerMessage {
  return { id, role: "user", content, sourceActorRole: "bride" };
}

function pair(content: string): AmoraMemorySourceScopeRow[] {
  return [{
    id: USER_ID, role: "user", sender_id: BRIDE_ID, sender_type: "bride",
    content, metadata: { target: "ai" }, visibility: "bride_private",
    created_at: "2026-09-11T00:00:00.000Z",
  }, {
    id: REPLY_ID, role: "assistant", sender_id: null, sender_type: "ai",
    content: "서울 동쪽 예식장에 대해 이번 답변에서 이야기할게요.",
    metadata: { in_reply_to_user_message_id: USER_ID, memory_eligible: true, question_scope: "W0_wedding_core" },
    visibility: "bride_private", created_at: "2026-09-11T00:00:01.000Z",
  }];
}

function candidate(id = USER_ID) {
  return { source_message_id: id, memory_key: "venue:preferred_area", kind: "preference",
    category: "venue", title: "선호 지역", value: "서울 동쪽 지역을 우선 검토",
    evidence: "서울 동쪽 지역을 우선 검토", reasoning: "사용자가 직접 말한 지역",
    confidence: 0.95, explicit: true };
}

describe("Amora explicit per-turn long-term memory refusal", () => {
  it("does not compile a later preference excluded by a durable conversation policy outside the cursor", async () => {
    const later = pair(`${PREFERENCE} 결혼식 장식 취향이야.`).map(row => ({ ...row,
      id: row.role === "user" ? NEXT_ID : REPLY_ID,
      metadata: row.role === "assistant" ? { ...row.metadata, in_reply_to_user_message_id: NEXT_ID } : row.metadata,
    }));
    // 최초 금지 원문은 이미 이전 cursor 밖이다. 서버 정책 조회가 별도 반환한 제외 ID만 전달한다.
    const batch = prepareTrustedAmoraMemoryBatch(later, { brideId: BRIDE_ID, groomId: null }, new Set([NEXT_ID]));
    expect(batch.messages).toHaveLength(2);
    await compileAmoraMemory({ coupleId: BRIDE_ID, visibility: "bride_private", messages: batch.messages, beforeProviderEgress: () => {}, beforeGeneration: () => {} });
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    mocks.provider.mockReset();
    mocks.provider.mockResolvedValue({ data: { summary: null, memories: [] } });
  });

  it.each([
    DENIED,
    `${PREFERENCE} 이 취향은 기억하지 마.`,
    `${PREFERENCE} 장기기억으로 저장하지 말아줘.`,
    `${PREFERENCE} 내 메모리에 남기지 마세요.`,
    `${PREFERENCE} 이 대화는 기억에 저장하지 말고 답변만 해줘.`,
    `${PREFERENCE} 이번 얘기는 기억하지 않았으면 해.`,
    `${PREFERENCE} 기억은 하지 마.`,
    `${PREFERENCE} 기억 안 했으면 좋겠어.`,
    `${PREFERENCE} 이 내용은 이번 대화에서만 참고하고 다음 상담에는 남기지 마.`,
    `${PREFERENCE} 친구가 기억하지 말고 넘어가라고 했어. 하지만 이 취향은 장기 기억에 넣지 마.`,
  ])("keeps the cursor but excludes a direct refusal from compiler evidence: %s", (text) => {
    const batch = prepareAmoraMemoryBatch([source(text)]);
    expect(batch.messages.map(row => row.id)).toEqual([USER_ID]);
    expect(batch.input).toBe("");
  });

  it.each([
    `${PREFERENCE} 내가 말한 선호를 기억 못 해?`,
    `${PREFERENCE} 예식장 이름을 잊어버릴까 걱정돼.`,
    `${PREFERENCE} 다음 상담에서도 기억해줘.`,
    `${PREFERENCE} 지금 기억하고 있는 내 취향이 뭐야?`,
    `${PREFERENCE} 내 개인 할 일에는 저장하지 마.`,
    `${PREFERENCE} 친구가 '기억하지 마'라고 말했어.`,
    `${PREFERENCE} 친구가 기억하지 말고 넘어가라고 했어.`,
    `${PREFERENCE} 기억하지 말고 답변만 해달라고 요청하면 돼?`,
    `${PREFERENCE} 예시 문장: “장기 기억에 넣지 말고 답변만 해줘.” 뜻을 설명해줘.`,
    `${PREFERENCE} 기억하지 말라는 뜻은 아니야.`,
  ])("does not turn a question, worry, quote, task refusal or opt-in into a memory refusal: %s", (text) => {
    expect(prepareAmoraMemoryBatch([source(text)]).input).toContain(text);
  });

  it("rechecks historical eligible metadata and never re-extracts the denied source in a later batch", () => {
    const rows = pair(DENIED);
    expect([...selectTrustedAmoraMemoryUserIds(rows)]).toEqual([]);
    const next = pair("예식장은 부산 지역을 우선 검토하고 싶어.").map(row => ({
      ...row, id: row.role === "user" ? NEXT_ID : "10000000-0000-4000-8000-000000000004",
      created_at: row.role === "user" ? "2026-09-11T00:01:00.000Z" : "2026-09-11T00:01:01.000Z",
      metadata: row.role === "assistant" ? { ...row.metadata, in_reply_to_user_message_id: NEXT_ID } : row.metadata,
    }));
    const batch = prepareTrustedAmoraMemoryBatch([...rows, ...next], { brideId: BRIDE_ID, groomId: null });
    expect(batch.messages).toHaveLength(4);
    expect(batch.blockedByUnresolvedSource).toBe(false);
    expect(batch.input).not.toContain("서울 동쪽");
    expect(batch.input).toContain("부산 지역");
  });

  it("does not strand the cursor on a refused source whose canonical reply is not yet present", () => {
    const batch = prepareTrustedAmoraMemoryBatch(pair(DENIED).slice(0, 1), { brideId: BRIDE_ID, groomId: null });
    expect(batch.messages.map(row => row.id)).toEqual([USER_ID]);
    expect(batch.input).toBe("");
    expect(batch.blockedByUnresolvedSource).toBe(false);
  });

  it("does not call the memory provider for a refused-only batch", async () => {
    const result = await compileAmoraMemory({ coupleId: BRIDE_ID, visibility: "bride_private",
      messages: [source(DENIED)], beforeGeneration: vi.fn(), beforeProviderEgress: vi.fn() });
    expect(result).toEqual({ summary: null, memories: [] });
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a plausible exact-evidence candidate from a refused source at the compiler validation boundary", () => {
    const result = validateAmoraMemoryCompilation({ memories: [candidate()] }, new Map([
      [USER_ID, { content: DENIED, actorRole: "bride" as const }],
    ]));
    expect(result).toEqual({ summary: null, memories: [] });
  });

  it("allows a later explicit opt-in on a newly authored source without reusing the old source", async () => {
    await compileAmoraMemory({ coupleId: BRIDE_ID, visibility: "bride_private",
      messages: [source(DENIED), source(`${PREFERENCE} 이 새 요청은 다음 상담에서도 기억해줘.`, NEXT_ID)],
      beforeGeneration: vi.fn(), beforeProviderEgress: vi.fn() });
    expect(mocks.provider).toHaveBeenCalledOnce();
    const options = mocks.provider.mock.calls[0][0];
    expect(options.input).not.toContain(USER_ID);
    expect(options.input).toContain(NEXT_ID);
    expect(() => options.validate({ memories: [candidate()] })).toThrow("memory source is not a user message in this batch");
    expect(options.validate({ memories: [candidate(NEXT_ID)] }).memories).toHaveLength(1);
  });
});
