import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 대화 경로에 단 문지기(D-89)의 순서와 결과.
 *
 * 판정 함수(`checkAmoraGate`)만 가짜로 바꾸고 라우트의 나머지(위기 관문, 클레임, 저장, 응답)는
 * 실제 코드를 탄다. 지키는 것: 막힌 턴에서 모델을 부르지 않고 저장 문맥도 읽지 않는다, 위기
 * 안내는 문지기보다 먼저다, 스위치가 꺼지면 문지기를 부르지 않는다.
 */
const mocks = vi.hoisted(() => {
  class PersistenceError extends Error {
    readonly code = "AI_MESSAGE_PERSISTENCE_FAILED";
  }
  class ClaimError extends Error {
    readonly code = "CHAT_REQUEST_CLAIM_FAILED";
  }
  class PrivacyContextError extends Error {
    constructor(readonly code:
      | "AMORA_PRIVACY_CONTEXT_UNAVAILABLE"
      | "AMORA_PRIVACY_CONTEXT_CHANGED") {
      super(code);
      this.name = "AmoraPrivacyContextError";
    }
  }
  return {
    profile: {
      couple_id: "10000000-0000-4000-8000-000000000001",
      role: "bride",
      is_admin: false,
    },
    /** 요청 사용자 클라이언트로 읽은 표 이름(순서대로). 저장 문맥 읽기에 닿았는지 본다. */
    fromTables: [] as string[],
    reserve: vi.fn(),
    findPersisted: vi.fn(),
    persist: vi.fn(),
    reconcile: vi.fn(),
    claim: vi.fn(),
    complete: vi.fn(),
    fail: vi.fn(),
    rateLimit: vi.fn(),
    provider: vi.fn(),
    enqueueMemory: vi.fn(),
    verifyMemoryRepair: vi.fn(),
    getPrivacyEpoch: vi.fn(),
    getPrivacySnapshot: vi.fn(),
    checkAmoraGate: vi.fn(),
    PersistenceError,
    ClaimError,
    PrivacyContextError,
  };
});

// 저장 문맥은 비어 있는 것으로 준다(어떤 질의든 빈 결과). 맨 앞의 저장된 사용자 행 읽기도 빈
// 결과라 라우트는 화면 글로 대신한다(오늘의 옛 앱 경로와 같다).
function emptyQuery(): unknown {
  const result = { data: null, error: null, count: 0 };
  const chain: unknown = new Proxy({}, {
    get(_target, property) {
      if (property === "then") {
        return (resolve: (value: unknown) => unknown) => resolve(result);
      }
      if (property === "single" || property === "maybeSingle") {
        return () => Promise.resolve(result);
      }
      return () => chain;
    },
  });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    from: vi.fn((table: string) => {
      mocks.fromTables.push(table);
      return emptyQuery();
    }),
    rpc: vi.fn(async (name: string) => {
      if (name !== "get_own_amora_chat_view_snapshot") throw new Error("Unexpected authenticated RPC");
      return { data: { version: 1, privacyEpoch: 7, shared: null, private: null }, error: null };
    }),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      })),
    },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: { ...mocks.profile }, error: null })),
        })),
      })),
    })),
  })),
}));

vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: vi.fn(() => "chat:test"),
  checkRateLimitPersistent: mocks.rateLimit,
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));

vi.mock("@/lib/ai/costGuard", () => ({
  reserveAmoraTurn: mocks.reserve,
}));

vi.mock("@/lib/ai/chatMessagePersistence", () => ({
  AiMessagePersistenceError: mocks.PersistenceError,
  findPersistedAiMessage: mocks.findPersisted,
  persistAiMessage: mocks.persist,
}));

vi.mock("@/lib/ai/chatRequestClaim", () => ({
  ChatRequestClaimError: mocks.ClaimError,
  claimChatRequest: mocks.claim,
  reconcileChatRequest: mocks.reconcile,
  completeChatRequest: mocks.complete,
  failChatRequest: mocks.fail,
}));

vi.mock("@/lib/ai/openai", () => ({
  chatWithToolsStream: mocks.provider,
  buildToolResultInput: vi.fn(),
  buildMultimodalContent: vi.fn(),
}));

vi.mock("@/lib/ai/amoraMemoryQueue", () => ({
  AmoraPrivacyContextError: mocks.PrivacyContextError,
  getAmoraPrivacyContextSnapshot: mocks.getPrivacySnapshot,
  getAmoraPrivacyEpoch: mocks.getPrivacyEpoch,
  assertAmoraPrivacyContextSnapshotCurrent: vi.fn(),
  enqueueAmoraMemoryJob: mocks.enqueueMemory,
}));

vi.mock("@/lib/ai/amoraMemoryRepair", () => ({
  verifyAmoraMemoryEnqueueRepairCandidate: mocks.verifyMemoryRepair,
}));

vi.mock("@/lib/ai/amoraTurnJournal", () => ({
  loadAmoraToolRoundJournal: vi.fn(async () => []),
  buildAmoraToolRoundCheckpoint: vi.fn(),
}));

vi.mock("@/lib/ai/amoraGatekeeper", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/ai/amoraGatekeeper")>()),
  checkAmoraGate: mocks.checkAmoraGate,
}));

import { POST } from "@/app/api/chat/route";
import {
  AMORA_GATE_BLOCKED_RISK_REPLY,
  AMORA_GATE_OUT_OF_SCOPE_REPLY,
} from "@/lib/ai/amoraGatekeeperContract";
import { buildAmoraCrisisResponse } from "@/lib/ai/amoraCrisisSafety";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";
const SAVED_REPLY_ID = "40000000-0000-4000-8000-000000000001";
/** 판정 뒤에만 읽는 저장 문맥 표. 막힌 턴은 이 표를 읽지 않는다. */
const STORED_CONTEXT_TABLE = "wedding_journeys";
const WEDDING_TEXT = "예식장 계약금은 보통 얼마야?";

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify(body),
  });
}

function chatBody(content: string, overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ role: "user", content }],
    coupleId: COUPLE_ID,
    clientRequestId: REQUEST_ID,
    visibility: "shared",
    ...overrides,
  };
}

function privacySnapshot() {
  return {
    version: 2,
    privacyEpoch: 7,
    actorRole: "bride",
    rosterFingerprint: "a".repeat(32),
    memory: {
      shared: { enabled: false, resetAt: null },
      bride_private: { enabled: false, resetAt: null },
      groom_private: { enabled: false, resetAt: null },
    },
    personalization: { exists: false, revision: null },
  };
}

function gateDecision(verdict: "allow" | "out_of_scope" | "blocked_risk") {
  return {
    verdict,
    reply: verdict === "allow" ? null : verdict === "blocked_risk" ? AMORA_GATE_BLOCKED_RISK_REPLY : AMORA_GATE_OUT_OF_SCOPE_REPLY,
    crisisKind: null,
    reasons: [],
    questionScope: "W4_out_of_scope",
    judge: "ok",
    moderation: "ok",
    version: "test",
    elapsedMs: 1,
  };
}

function doneEvent(body: string): Record<string, unknown> {
  const line = body.split("\n").find((entry) => entry.startsWith("data: ") && entry.includes("\"done\""));
  if (!line) throw new Error("no done event");
  return JSON.parse(line.slice("data: ".length)) as Record<string, unknown>;
}

/** 라우트가 끝까지 가든 중간에 멈추든 이 시험은 문지기 뒤의 길만 본다. */
async function settle(promise: Promise<Response>): Promise<string> {
  try {
    const response = await promise;
    return await response.text();
  } catch {
    return "";
  }
}

describe("POST /api/chat — 문지기(D-89)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fromTables.splice(0);
    mocks.profile.couple_id = COUPLE_ID;
    mocks.profile.role = "bride";
    mocks.reserve.mockResolvedValue({ allowed: true, remaining: 99 });
    mocks.findPersisted.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(true);
    mocks.claim.mockResolvedValue({ action: "acquired", attemptCount: 1, reclaimed: false });
    mocks.complete.mockResolvedValue(undefined);
    mocks.fail.mockResolvedValue(undefined);
    mocks.rateLimit.mockResolvedValue(null);
    mocks.enqueueMemory.mockResolvedValue("disabled");
    mocks.verifyMemoryRepair.mockResolvedValue({ status: "unavailable" });
    mocks.getPrivacyEpoch.mockResolvedValue(7);
    mocks.getPrivacySnapshot.mockImplementation(async () => privacySnapshot());
    mocks.persist.mockImplementation(async (params: {
      cleanText: string; metadata: Record<string, unknown>; visibility: string; clientRequestId: string;
    }) => ({
      id: SAVED_REPLY_ID,
      createdAt: "2026-11-20T00:00:00.000Z",
      content: params.cleanText,
      metadata: { ...params.metadata, client_request_id: params.clientRequestId },
      stageTag: null,
      specialistType: null,
      visibility: params.visibility,
      reused: false,
    }));
    vi.stubEnv("AMORA_GATEKEEPER_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("결혼 밖 질문은 모델을 부르지 않고 저장 문맥도 읽지 않은 채 고정 문장을 저장해 돌려준다", async () => {
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("out_of_scope"));

    const response = await POST(request(chatBody("파이썬으로 버블 정렬 짜줘")));
    const body = await response.text();

    expect(response.status).toBe(200);
    const done = doneEvent(body);
    expect(done.fullContent).toBe(AMORA_GATE_OUT_OF_SCOPE_REPLY);
    expect(done.metadata).toMatchObject({
      response_origin: "deterministic_amora_gatekeeper",
      question_scope: "W4_out_of_scope",
      memory_eligible: false,
      serverMessageId: SAVED_REPLY_ID,
    });
    expect(mocks.checkAmoraGate).toHaveBeenCalledWith(
      expect.objectContaining({ text: "파이썬으로 버블 정렬 짜줘", surface: "amora_chat", userId: ACTOR_ID, coupleId: COUPLE_ID, applyScope: true }),
      expect.anything(),
    );
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ isDemo: false, cleanText: AMORA_GATE_OUT_OF_SCOPE_REPLY }));
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ coupleId: COUPLE_ID, messageId: SAVED_REPLY_ID }));
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.fromTables).not.toContain(STORED_CONTEXT_TABLE);
    // 모델 몫의 유료 예약도 하지 않는다(판정 호출의 예약은 판정 함수 안에 있다).
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  // 2026-11-22 main 병합(찾아보기 PR #535): 찾아보기 도구는 W0 도구 부여 자리에서 열린다. 문지기는 그보다
  // 앞에서 턴을 끝내므로 막힌 턴은 찾아보기가 켜져 있어도 모델·네이버에 닿지 않는다.
  it("찾아보기가 켜져 있어도 막힌 턴은 모델과 네이버에 닿지 않는다(문지기가 W0 도구 부여보다 앞)", async () => {
    vi.stubEnv("AMORA_WEB_SEARCH_ENABLED", "true");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("blocked_risk"));
    try {
      const response = await POST(request(chatBody("결혼식 끝나고 그 사람 혼내 줄 거야. 강남 웨딩홀 대관료도 찾아줘")));
      const done = doneEvent(await response.text());

      expect(done.fullContent).toBe(AMORA_GATE_BLOCKED_RISK_REPLY);
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.fromTables).not.toContain(STORED_CONTEXT_TABLE);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("위험은 번호 없는 한 줄을 그 레인(나만 상담)에 저장한다", async () => {
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("blocked_risk"));

    const response = await POST(request(chatBody("결혼식 끝나고 그 사람 혼내 줄 거야", { visibility: "bride_private" })));
    const done = doneEvent(await response.text());

    expect(done.fullContent).toBe(AMORA_GATE_BLOCKED_RISK_REPLY);
    expect(done.metadata).toMatchObject({ question_scope: "W5_safety_override" });
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({ visibility: "bride_private" }));
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.fromTables).not.toContain(STORED_CONTEXT_TABLE);
  });

  it("중재에서 막히면 지금의 중재 안전 확인(422)을 내고 클레임을 푼다", async () => {
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("blocked_risk"));

    const response = await POST(request({
      ...chatBody("상견례 장소로 다퉜어"),
      requestKind: "mediation",
      conflictContext: "상견례 장소 정하다가 크게 다퉜어요",
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: "MEDIATION_SAFETY_PREFLIGHT_REQUIRED" });
    expect(mocks.checkAmoraGate).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "amora_mediation", applyScope: false }),
      expect.anything(),
    );
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "AMORA_GATEKEEPER_MEDIATION_BLOCKED" }));
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("위기 문장은 문지기보다 먼저 지금의 위기 안내(109 포함)로 끝난다", async () => {
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("blocked_risk"));

    const response = await POST(request(chatBody("죽고 싶어")));
    const done = doneEvent(await response.text());

    expect(done.fullContent).toBe(buildAmoraCrisisResponse("self_harm"));
    expect(String(done.fullContent)).toContain("109");
    expect(mocks.checkAmoraGate).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("스위치가 꺼져 있으면 문지기를 부르지 않고 저장 문맥을 읽으러 간다(오늘의 길)", async () => {
    vi.stubEnv("AMORA_GATEKEEPER_ENABLED", "false");
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("out_of_scope"));

    const body = await settle(POST(request(chatBody(WEDDING_TEXT))));

    expect(mocks.checkAmoraGate).not.toHaveBeenCalled();
    expect(mocks.fromTables).toContain(STORED_CONTEXT_TABLE);
    expect(body).not.toContain("deterministic_amora_gatekeeper");
    expect(mocks.persist).not.toHaveBeenCalledWith(expect.objectContaining({ cleanText: AMORA_GATE_OUT_OF_SCOPE_REPLY }));
  });

  it("문지기가 통과시키면 고정 문장을 쓰지 않고 저장 문맥을 읽으러 간다(오늘의 길)", async () => {
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("allow"));

    const body = await settle(POST(request(chatBody(WEDDING_TEXT))));

    expect(mocks.checkAmoraGate).toHaveBeenCalledTimes(1);
    expect(mocks.fromTables).toContain(STORED_CONTEXT_TABLE);
    expect(body).not.toContain("deterministic_amora_gatekeeper");
    expect(mocks.persist).not.toHaveBeenCalledWith(expect.objectContaining({ cleanText: AMORA_GATE_OUT_OF_SCOPE_REPLY }));
    expect(mocks.complete).not.toHaveBeenCalledWith(expect.objectContaining({ messageId: SAVED_REPLY_ID }));
  });

  it("판정은 개인정보 판번호를 읽기 전에 시작하고, 결과는 그 뒤에 받는다(겹쳐서 기다림을 줄인다)", async () => {
    const order: string[] = [];
    let release: (() => void) | null = null;
    mocks.checkAmoraGate.mockImplementation(() => {
      order.push("gate_started");
      return new Promise((resolve) => {
        release = () => {
          order.push("gate_resolved");
          resolve(gateDecision("out_of_scope"));
        };
      });
    });
    mocks.getPrivacySnapshot.mockImplementation(async () => {
      order.push("privacy_snapshot_read");
      release?.();
      return privacySnapshot();
    });

    const response = await POST(request(chatBody("파이썬으로 버블 정렬 짜줘")));
    expect(doneEvent(await response.text()).fullContent).toBe(AMORA_GATE_OUT_OF_SCOPE_REPLY);
    expect(order).toEqual(["gate_started", "privacy_snapshot_read", "gate_resolved"]);
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("그사이 개인정보 판번호가 바뀌면 고정 문장도 쓰지 않고 다시 시도하게 한다", async () => {
    mocks.checkAmoraGate.mockResolvedValue(gateDecision("out_of_scope"));
    mocks.getPrivacyEpoch.mockResolvedValue(8);

    const response = await POST(request(chatBody("파이썬으로 버블 정렬 짜줘")));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_PRIVACY_CONTEXT_CHANGED", retryPolicy: "same_request" });
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "AMORA_PRIVACY_CONTEXT_CHANGED" }));
  });
});
