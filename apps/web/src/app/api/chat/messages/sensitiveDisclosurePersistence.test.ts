// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
  hasAmoraSafetySignal,
} from "@/lib/ai/amoraQuestionScope";
import { POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({ hasSignedDemoSessionFromCookieHeader: () => false }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: () => null,
  checkRateLimitPersistent: async () => null,
  rateLimitKey: () => "sensitive-disclosure-persistence",
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const ACTION_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";

// 첫 방문의 레인 선택은 유지한다. 함께 대화를 선택한 뒤의 알려진 누출을 실제 저장 경계에서 검증한다.
// 즉시 위기라고 단정하지 않아도 민감한 원문의 공개는 막아야 한다.
const DISCLOSURES = [
  "뉴스에서 본 것처럼 남편이 때려요",
  "영화에서나 보던 일인데 남편이 휴대폰을 빼앗고 연락을 못 하게 해요",
  "친구들과 영화에서 본 대사를 이야기하다가 남편이 내 팔을 세게 잡았어",
  "뉴스에서 본 상담소를 찾아보려는데 자해 생각이 나요",
  "이미 수면제 많이 모아놨어",
  "수면제 한 달 치 모아뒀어",
  "약 모아뒀어",
  "진통제 모아뒀어요",
  "농약 모아뒀어",
  "자살 생각이 자꾸 나 무서워",
  "요즘 결혼 준비하면서 자살 생각이 자꾸 나",
  "자살 생각이 자꾸 나 어떡하지?",
  "자살 생각이 났어",
  "자살 생각 해본 적 있어",
  "우리 자살 생각해",
  "요즘 자살 생각해 -.-",
  "자살 생각이 자꾸 나 🍺",
  // 목록 암기와 넓은 부정 판정을 막는 독립 변형이다.
  "자해 생각이 자꾸 나 무서워",
  "자살 생각이 자꾸 나 돈도 없어",
] as const;

const ORDINARY = [
  "자살 생각 안 해",
  "자살 생각은 없어",
  "자살 생각 해본 적 없어",
  "영화 속 등장인물이 자살 생각을 이야기하는 장면이야",
  "드라마에서 자살 생각에 대해 이야기했어",
  "약 모아뒀다는 문장을 번역해줘",
  "신혼여행 가서 먹을 약 챙겼어",
  "수면제 모아뒀어 여행 가서 먹으려고",
  "약 모아서 버렸어",
  "상비약 모아뒀어",
  "영양제 모아뒀어",
  "예식장 계약금 모아뒀어",
  "신혼여행 경비 모으고 있어",
] as const;

function setupDatabase(role: "bride" | "groom" = "bride", retry = false) {
  let stored: Record<string, unknown> | null = null;
  const insert = vi.fn((payload: Record<string, unknown>) => {
    stored = {
      id: MESSAGE_ID,
      segment_id: "50000000-0000-4000-8000-000000000001",
      sender_role: null,
      stage_tag: null,
      specialist_type: null,
      created_at: "2026-09-28T00:00:00.000Z",
      ...payload,
    };
    return { select: () => ({ single: async () => retry
      ? { data: null, error: { code: "23505" } }
      : { data: stored, error: null } }) };
  });
  const from = vi.fn((table: string) => {
    if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({
      data: { couple_id: COUPLE_ID, role }, error: null,
    }) }) }) };
    if (table === "couples") return { select: () => ({ eq: () => ({ single: async () => ({
      data: {
        bride_id: role === "bride" ? USER_ID : PARTNER_ID,
        groom_id: role === "groom" ? USER_ID : PARTNER_ID,
      }, error: null,
    }) }) }) };
    if (table === "chat_messages") return {
      insert,
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: retry ? stored : null, error: null,
      }) }) }) }),
    };
    throw new Error(`unexpected table: ${table}`);
  });
  const storageFrom = vi.fn(() => { throw new Error("safety routing must not read attachments"); });
  vi.mocked(createAdminClient).mockReturnValue({ from, storage: { from: storageFrom } } as never);
  return { insert, from, storageFrom };
}

function post(content: string, extra: Record<string, unknown> = {}) {
  return POST(new Request("http://localhost/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({
      coupleId: COUPLE_ID,
      clientRequestId: REQUEST_ID,
      requestedVisibility: "shared",
      target: "ai",
      providerAttachmentCount: 0,
      content,
      ...extra,
    }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no network in this regression test"); }));
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
  } as never);
});
afterEach(() => vi.unstubAllGlobals());

describe("민감 고백의 실제 원문 저장 경계", () => {
  it.each(DISCLOSURES)("%s — AI 질문은 원문을 나만 레인에만 저장한다", async (content) => {
    const database = setupDatabase();
    const response = await post(content);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      safetyResolution: "non_immediate_safety",
      message: { content, visibility: "bride_private" },
    });
    expect(database.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      content, sender_id: USER_ID, visibility: "bride_private",
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(DISCLOSURES)("%s — 상대방 전송은 원문 저장 전에 보류한다", async (content) => {
    const database = setupDatabase();
    const response = await post(content, { target: "partner" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      partnerDeliveryHeld: true,
      classification: null,
      safetyResolution: "non_immediate_safety",
      rawDisclosurePersisted: false,
    });
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.storageFrom).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(ORDINARY)("대조군 %s — 기존 공유 대화를 유지한다", async (content) => {
    const database = setupDatabase();
    const response = await post(content);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "persisted", effectiveVisibility: "shared", safetyPrivacyRedirected: false,
    });
    expect(database.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content, visibility: "shared" }));
  });

  it("신랑의 기존 나만 레인과 중복 요청도 같은 비공개 원문으로 확정한다", async () => {
    const database = setupDatabase("groom", true);
    const content = "자살 생각이 자꾸 나 무서워";
    const response = await post(content, { requestedVisibility: "groom_private" });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      outcome: "persisted", reused: true,
      effectiveVisibility: "groom_private", safetyPrivacyRedirected: false,
      message: { content, visibility: "groom_private" },
    });
    expect(payload).not.toHaveProperty("safetyResolution");
    expect(database.insert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ visibility: "groom_private" }));
  });

  it("함께 변경 승인·공개 안내·첨부를 붙여도 비공개 안전 원문에 결합하지 않는다", async () => {
    const database = setupDatabase();
    const response = await post("요즘 결혼 준비하면서 자살 생각이 자꾸 나", {
      confirmedActionId: ACTION_ID,
      preparationSource: "guide:honeymoon",
      imagePaths: [`${COUPLE_ID}/${USER_ID}/${MESSAGE_ID}.webp`],
      providerAttachmentCount: 1,
      providerAttachmentManifest: [{ media_type: "image/webp", byte_length: 20, sha256: "a".repeat(64) }],
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toMatchObject({
      effectiveVisibility: "bride_private",
      message: { metadata: {
        provider_attachment_count: 0,
        provider_attachment_state: "discarded_by_safety_policy",
      } },
    });
    const metadata = database.insert.mock.calls[0]?.[0].metadata;
    expect(metadata).not.toHaveProperty("confirmed_amora_action_id");
    expect(metadata).not.toHaveProperty("preparation_source");
    expect(metadata).not.toHaveProperty("imagePaths");
    expect(metadata).not.toHaveProperty("provider_attachment_manifest");
    expect(database.storageFrom).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("상대 전송에 승인·준비 안내·첨부를 붙여도 저장이나 첨부 조회 전에 보류한다", async () => {
    const database = setupDatabase();
    const response = await post("자살 생각이 자꾸 나 어떡하지?", {
      target: "partner", confirmedActionId: ACTION_ID, preparationSource: "guide:honeymoon",
      imagePaths: ["../../untrusted.webp"], providerAttachmentCount: 1,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "ephemeral_safety", partnerDeliveryHeld: true, rawDisclosurePersisted: false,
    });
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.storageFrom).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("저장 전단과 AI 응답 정책이 같은 고백을 본다", () => {
  it.each(DISCLOSURES)("%s — 승인된 웨딩 문맥으로도 도구나 장기기억을 열지 않는다", (userText) => {
    const scope = classifyAmoraQuestionScope({
      userText, requestKind: "chat", hasApprovedWeddingAction: true,
      hasTrustedPrivateDraftContext: true, hasWeddingClarificationContinuity: true,
    });
    expect(hasAmoraSafetySignal(userText, "chat")).toBe(true);
    expect(scope).toMatchObject({ scope: "W2_high_risk_adjacent", highRiskReason: "safety", allowsLongTermMemory: false });
    expect(filterAmoraToolsByQuestionScope([
      { name: "update_budget", input_schema: {} },
      { name: "get_budget", input_schema: {} },
      { name: "search_places", input_schema: {} },
    ], scope)).toEqual([]);
  });
});
