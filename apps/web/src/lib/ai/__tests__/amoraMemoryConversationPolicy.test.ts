import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasAmoraMemoryConversationOptOut, resolveAmoraMemoryConversationPolicy, resolveAmoraMemoryConversationExclusions } from "@/lib/ai/amoraMemoryConversationPolicy";
import { prepareTrustedAmoraMemoryBatch } from "@/lib/ai/amoraMemorySourceScope";
import { compileAmoraMemory } from "@/lib/ai/amoraMemoryCompiler";
const mocks = vi.hoisted(() => ({ provider: vi.fn() }));
vi.mock("@/lib/ai/auditedOpenAI", () => ({ createOpenAIStructuredResponseWithAudit: mocks.provider }));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { coupleId: id(1), actorId: id(2), actorRole: "bride" as const, visibility: "bride_private" as const, segmentId: id(3) };
const T1 = "나는 웨딩 장식으로 청록색 종이별을 쓰는 소박한 분위기를 좋아해. 내 개인 취향으로 지금 이 대화에서만 참고해줘. 장기 기억에 저장하지 말고, 파트너와 합의한 결정도 아니야. 공동 예산·일정·할 일은 바꾸지 마.";
const MEMORY_ON_T1 = "이번 대화에서만 내 취향을 참고해줘. 이 대화 내용은 장기기억에 저장하지 마.";
function source(content = T1, n = 4) { return { id: id(n), couple_id: scope.coupleId, sender_id: scope.actorId, sender_type: "bride" as const,
  role: "user" as const, visibility: scope.visibility, segment_id: scope.segmentId, content,
  metadata: { client_request_id: id(n + 100) } as Record<string, unknown> | null, created_at: `2026-09-11T00:00:${String(n).padStart(2, "0")}.000Z` }; }
function database(rows = [source()]) {
  const calls: Array<{ write: unknown; eq: Map<string, unknown>; not: boolean; limit: number | null }> = [];
  const state = { failRead: false, failWrite: false, conflict: false, hang: false };
  const from = vi.fn((table: string) => {
    expect(table).toBe("chat_messages");
    const call = { write: null as Record<string, unknown> | null, eq: new Map<string, unknown>(), not: false, limit: null as number | null };
    calls.push(call);
    let signal: AbortSignal | undefined;
    const query = {
      select: () => query, order: () => query,
      abortSignal(value: AbortSignal) { signal = value; return query; },
      update(value: Record<string, unknown>) { call.write = value; return query; },
      eq(key: string, value: unknown) { call.eq.set(key, value); return query; },
      is(key: string, value: null) { call.eq.set(key, value); return query; },
      not(key: string) { expect(key).toBe("metadata->amora_memory_policy"); call.not = true; return query; },
      limit(value: number) { call.limit = value; return query; },
      async maybeSingle() {
        if (state.hang && signal && !signal.aborted) await new Promise<void>(resolve => signal!.addEventListener("abort", () => resolve(), { once: true }));
        if (signal?.aborted) return { data: null, error: { code: "ABORTED" } };
        if ((call.write && state.failWrite) || (!call.write && state.failRead)) return { data: null, error: { code: "SYNTHETIC_FAILURE" } };
        const row = rows.find(candidate => [...call.eq].every(([key, value]) => key === "metadata"
          ? (value === null ? candidate.metadata === null : JSON.stringify(candidate.metadata) === value)
          : (candidate as Record<string, unknown>)[key] === value)
          && (!call.not || (candidate.metadata !== null && "amora_memory_policy" in candidate.metadata)));
        if (call.write && state.conflict) return { data: null, error: null };
        if (row && call.write) Object.assign(row, structuredClone(call.write));
        return { data: row ? structuredClone(row) : null, error: null };
      },
    };
    return query;
  });
  return { admin: { from } as unknown as SupabaseClient, calls, rows, state };
}

describe("durable conversation-only memory denial", () => {
  it.each([T1, MEMORY_ON_T1, "이번 대화에서만 내 취향을 참고해줘. 장기 기억에 저장하지 마.",
    "이 대화 내용은 장기기억에 저장하지 마.", "이번 상담의 내용은 기억하지 마.",
    "이번 대화에서만 참고하고 장기 기억에 저장하지 마.", "이 대화는 기억하지 마."])("recognizes conversation scope: %s", text => {
    expect(hasAmoraMemoryConversationOptOut(text)).toBe(true);
  });
  it.each(["이번 메시지만 기억하지 마.", "이번 답변에서만 참고해줘. 장기 기억에 저장하지 마.",
    "이번 대화에서만 참고하라는 뜻을 기억 못 해?", "이번 대화에서 들은 걸 잊어버릴까 걱정돼.",
    "예시: ‘이번 대화에서만 참고하고 장기 기억에 저장하지 마.’ 뜻을 설명해줘.",
    "친구가 이 대화는 기억하지 말라고 했어.", "개인 할 일에 저장하지 마.", "다음 상담에도 기억해줘."])("does not promote a turn/quote/question to segment policy: %s", text => {
    expect(hasAmoraMemoryConversationOptOut(text)).toBe(false);
  });
  it.each(["이 대화는 다음 상담에도 기억해줘. 이번 메시지만 기억하지 마.",
    "이번 대화에서만 참고한다는 표현이 무슨 뜻이야? 이번 답변은 기억하지 마.",
    "이번 대화에서만 내 취향을 참고해줘. 이번 메시지만 기억하지 마.",
    "이번 대화 내용은 다음 상담에도 기억해줘. 이번 메시지만 기억하지 마.",
    "친구가 이 대화 내용은 장기기억에 저장하지 마 라고 말했어.",
    "친구가 이번 대화에서만 내 취향을 참고해줘 라고 말했어. 장기기억에 저장하지 마.",
    "예시: ‘이번 대화에서만 내 취향을 참고해줘. 이 대화 내용은 장기기억에 저장하지 마.’ 뜻을 설명해줘.",
    "이 대화 내용은 기억하지 마 라고 부탁하면 어떤 뜻이야?"])("does not borrow a positive or descriptive scope from another clause: %s", text => {
    expect(hasAmoraMemoryConversationOptOut(text)).toBe(false);
  });
  it.each([null, { client_request_id: id(99), imagePaths: ["synthetic/file"] }])("persists before a provider can fail, preserving metadata %j", async metadata => {
    const row = source(); row.metadata = metadata;
    const db = database([row]);
    expect(await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope, sources: [structuredClone(row)] })).toBe(true);
    expect(row.metadata).toMatchObject({ ...metadata, amora_memory_policy: { version: 1, scope: "conversation", effect: "deny", actorId: scope.actorId, segmentId: scope.segmentId } });
    const bytes = JSON.stringify(row.metadata);
    expect(bytes).not.toContain("종이별");
    // 이후 provider 오류/중단은 별도 write 없이 남은 정책을 지우지 않는다.
    expect(await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope })).toBe(true);
    expect(JSON.stringify(row.metadata)).toBe(bytes);
    expect(db.calls.filter(call => call.write)).toHaveLength(1);
    expect(db.calls.filter(call => call.not).every(call => call.limit === 1 && call.eq.get("segment_id") === scope.segmentId && call.eq.get("sender_id") === scope.actorId)).toBe(true);
  });
  it.each([T1, MEMORY_ON_T1])("excludes the W0 followup after the deny source is outside the cursor and keeps a new segment separate: %s", async firstText => {
    mocks.provider.mockReset(); mocks.provider.mockResolvedValue({ data: { summary: null, memories: [] } });
    const first = source(firstText); const db = database([first]);
    await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope, sources: [structuredClone(first)] });
    const later = source("나는 무광 종이 장식을 더 좋아해. 결혼식 장식 취향이야.", 6);
    const reply = { ...later, id: id(7), role: "assistant" as const, sender_id: null, sender_type: "ai" as const, content: "참고할게요.",
      metadata: { memory_eligible: true, question_scope: "W0_wedding_core", in_reply_to_user_message_id: later.id }, created_at: "2026-09-11T00:00:07.000Z" };
    const rows = [later, reply];
    const excluded = await resolveAmoraMemoryConversationExclusions({ admin: db.admin, coupleId: scope.coupleId, visibility: scope.visibility,
      couple: { brideId: scope.actorId, groomId: id(9) }, rows });
    expect([...excluded]).toEqual([later.id]);
    const batch = prepareTrustedAmoraMemoryBatch(rows, { brideId: scope.actorId, groomId: id(9) }, excluded);
    expect(batch.messages).toHaveLength(2);
    await compileAmoraMemory({ coupleId: scope.coupleId, visibility: scope.visibility, messages: batch.messages, beforeProviderEgress: () => {}, beforeGeneration: () => {} });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope: { ...scope, segmentId: id(10) } })).toBe(false);
    expect(await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope, sources: [source("앞으로 기억해줘.", 8)] })).toBe(true);
  });
  it("does not propagate to the other actor or shared lane", async () => {
    const db = database(); await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope, sources: [structuredClone(db.rows[0])] });
    expect(await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope: { ...scope, actorId: id(9), actorRole: "groom", visibility: "groom_private" } })).toBe(false);
    expect(await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope: { ...scope, visibility: "shared" } })).toBe(false);
  });
  it("checks every one of 41 scopes and rejects a larger batch without dropping its last denial", async () => {
    const rows = Array.from({ length: 41 }, (_, index) => ({ ...source("결혼식 장식 취향이야.", index + 10), segment_id: id(index + 200) }));
    const last = rows.at(-1)!;
    const oldDenial = { ...source(T1, 4), segment_id: last.segment_id };
    const db = database([oldDenial]);
    await resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope: { ...scope, segmentId: last.segment_id }, sources: [structuredClone(oldDenial)] });
    db.calls.length = 0;
    const input = { admin: db.admin, coupleId: scope.coupleId, visibility: scope.visibility,
      couple: { brideId: scope.actorId, groomId: id(9) }, rows, registerDenials: false };
    expect([...await resolveAmoraMemoryConversationExclusions(input)]).toEqual([last.id]);
    expect(db.calls).toHaveLength(41);
    expect(new Set(db.calls.map(call => call.eq.get("segment_id"))).size).toBe(41);
    db.calls.length = 0;
    await expect(resolveAmoraMemoryConversationExclusions({ ...input, rows: [...rows, source("일반 발화", 55)] })).rejects.toThrow("AMORA_MEMORY_POLICY_UNAVAILABLE");
    expect(db.calls).toHaveLength(0);
  });
  it.each(["failRead", "failWrite", "conflict"] as const)("fails closed on %s without replacing other metadata", async failure => {
    const db = database(); db.state[failure] = true;
    const before = structuredClone(db.rows);
    await expect(resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope, sources: failure === "failRead" ? [] : [structuredClone(db.rows[0])] })).rejects.toThrow("AMORA_MEMORY_POLICY_UNAVAILABLE");
    expect(db.rows).toEqual(before);
  });
  it("rejects a malformed server marker and invalid scope instead of treating either as allow", async () => {
    const db = database(); db.rows[0].metadata = { amora_memory_policy: { effect: "allow" } };
    await expect(resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope })).rejects.toThrow("AMORA_MEMORY_POLICY_UNAVAILABLE");
    await expect(resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope: { ...scope, segmentId: "client-supplied" } })).rejects.toThrow("AMORA_MEMORY_POLICY_UNAVAILABLE");
  });
  it("preserves caller abort and bounds a stalled lookup without treating it as no policy", async () => {
    const db = database(); db.state.hang = true;
    const controller = new AbortController();
    const promise = resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow("AMORA_MEMORY_POLICY_UNAVAILABLE");
    await expect(resolveAmoraMemoryConversationPolicy({ admin: db.admin, scope })).rejects.toThrow("AMORA_MEMORY_POLICY_UNAVAILABLE");
  }, 8_000);
});
