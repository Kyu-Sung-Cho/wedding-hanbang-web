// @vitest-environment node

/**
 * 평가에서 공유 레인에 남은 아홉 문장이 이제 어디로 가는가 (2026-09-26).
 *
 * 아모라 대화의 기본 레인은 '함께(공유)'다. `POST /api/chat/messages` 가 판정이 `continue` 인
 * 메시지를 요청한 레인에 저장하고, 저장하는 순간 배우자가 읽는다. 평가(origin/main 9f724ebc9)는
 * 아래 아홉 문장을 전부 공유 레인에 저장했다.
 *
 *  - 자해 넷 → 이제 `local_safety_hold`(원문을 저장하지 않고 고정 위기 안내).
 *  - 폭력·통제 다섯 → 이제 `private_safety_route` 이상(나만 레인에 저장, 안전 안내).
 *
 * 세 수준에서 잰다.
 *  1. 전달 계획 — 서버와 같은 호출(`externalSafetySignal: hasAmoraSafetySignal(…)`)과 앱 사전 판정
 *     (호출자 신호 없음). 앱은 서버 응답 전에 이 판정으로 탭을 고른다.
 *  2. 서버 `hasAmoraSafetySignal` — 서버가 전달 계획에 넘기는 신호.
 *  3. 실제 라우트 — Supabase 만 가짜로 두고 `planAmoraCrisisDelivery` 와 범위 분류는 진짜로 돌려,
 *     응답과 insert 된 레인을 본다(라우트 테스트 `route.test.ts` 는 전달 계획을 가짜로 둔다).
 *  4. 나만 레인 요청 — 실제 라우트 응답을 설치된 앱의 응답 검증기(앱 소스에서 뽑음)에 넣는다.
 *
 * **이 파일이 초록이라는 것은 "평가 아홉 문장과 그 꼴은 옮긴다" 는 뜻이다.** 처음 보는 봉인
 * 코퍼스(위험 143행, 2026-09-27)에서 이 변경이 레인을 옮긴 위험 행은 0 이었고, 서버 기준 101행이
 * 여전히 공유 레인에 저장된다. 도움 요청 꼬리·물음표·이유 한 마디가 붙으면 닫힌 어휘 밖이다.
 * 공유 레인 문제 자체는 레인 기본값(`"shared"` 초기값) 결정 없이는 닫히지 않는다.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClientFromRequest } from "@/lib/supabase/server";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import { planAmoraCrisisDelivery } from "@hanbang/shared/amora-crisis-delivery";
import { POST } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClientFromRequest: vi.fn() }));
vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => false),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: vi.fn(() => null),
  checkRateLimitPersistent: vi.fn(async () => null),
  rateLimitKey: vi.fn(() => "shared-lane-eval-nine"),
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";
const GROOM_ID = "00000000-0000-4000-8000-000000000002";
const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";

const SELF_HARM = [
  "자살 생각이 자꾸 나",
  "요즘 자살 생각해",
  "수면제 모아뒀어",
  "오늘 죽으려고",
] as const;
const VIOLENCE = [
  "남편이 때려요",
  "밀쳐서 멍들었어",
  "술 먹으면 때려요",
  "파혼하면 죽인대",
  "친구 못 만나게 해",
] as const;
/** 대조군 — 평범한 결혼 대화는 여전히 공유 레인에 저장된다. */
const ORDINARY = ["예식장 비교 기준을 정리해줘", "청첩장 문구 확인했어요"] as const;

function mockAuthentication() {
  vi.mocked(createClientFromRequest).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } } }),
    },
  } as never);
}

/**
 * 신부 한 명·연결된 신랑. insert 는 받은 행을 그대로 돌려준다(DB 가 하는 일).
 * `retry: true` 면 같은 요청이 이미 저장된 재시도다 — insert 는 중복 키로 실패하고, 대조 조회가
 * 앞서 저장된 같은 행을 돌려준다(라우트의 `reused: true` 갈래).
 */
function mockAdmin({ retry = false }: { retry?: boolean } = {}) {
  const profileSingle = vi.fn().mockResolvedValue({
    data: { couple_id: COUPLE_ID, role: "bride" },
    error: null,
  });
  const coupleSingle = vi.fn().mockResolvedValue({
    data: { bride_id: USER_ID, groom_id: GROOM_ID },
    error: null,
  });
  let stored: Record<string, unknown> | null = null;
  const insert = vi.fn((payload: Record<string, unknown>) => {
    stored = {
      id: MESSAGE_ID,
      sender_role: null,
      stage_tag: null,
      specialist_type: null,
      segment_id: "50000000-0000-4000-8000-000000000001",
      created_at: "2026-09-26T00:00:00.000Z",
      ...payload,
    };
    return {
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue(retry
          ? { data: null, error: { code: "23505", message: "duplicate key" } }
          : { data: stored, error: null }),
      })),
    };
  });
  const reconcileMaybeSingle = vi.fn(async () => ({ data: retry ? stored : null, error: null }));
  const messageSelect = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: reconcileMaybeSingle })) })),
  }));
  const from = vi.fn((table: string) => {
    if (table === "profiles") {
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: profileSingle })) })) };
    }
    if (table === "couples") {
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: coupleSingle })) })) };
    }
    if (table === "chat_messages") return { insert, select: messageSelect };
    throw new Error(`unexpected table: ${table}`);
  });
  vi.mocked(createAdminClient).mockReturnValue({ from } as never);
  return { insert };
}

function post(
  content: string,
  requestedVisibility: "shared" | "bride_private" = "shared",
  extra: Record<string, unknown> = {},
) {
  return POST(new Request("http://localhost/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({
      coupleId: COUPLE_ID,
      content,
      clientRequestId: REQUEST_ID,
      requestedVisibility,
      ...extra,
    }),
  }));
}

/**
 * 설치된 앱의 응답 검증기(`parseAiMessageIngestResult`). 앱 소스에서 **그대로** 뽑아 돌린다 —
 * `apps/mobile/src/__tests__/chatStream.test.mjs` 의 `loadAiMessageIngestContract` 와 같은 방법이다.
 * 옮겨 적으면 앱과 갈라진다.
 */
type MobileIngestParser = (
  status: number,
  payload: unknown,
  expected: Record<string, unknown>,
) => Record<string, unknown>;
function loadInstalledAppIngestParser(): MobileIngestParser {
  const sourcePath = resolve(process.cwd(), "..", "..", "apps/mobile/app/(tabs)/chat.tsx");
  const sourceText = readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(
    sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
  );
  const names = new Set([
    "normalizeChatVisibility", "isRecord", "asToolExecutionResult", "asChatMessageMetadata",
    "chatMessageFromRealtimeRow", "parseAiMessageIngestResult", "parseRetryAfterMs",
    "getAiMessageIngestFailureMessage", "getEphemeralSafetyPersistencePresentation",
  ]);
  const declarations = sourceFile.statements
    .filter((statement) => (
      (ts.isClassDeclaration(statement) && statement.name?.text === "AiMessageIngestError")
      || (ts.isFunctionDeclaration(statement) && statement.name && names.has(statement.name.text))
    ))
    .map((statement) => statement.getFullText(sourceFile))
    .join("\n");
  const { outputText } = ts.transpileModule(declarations, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  });
  const loaded = new Function(`${outputText}\nreturn { parseAiMessageIngestResult };`)() as {
    parseAiMessageIngestResult?: MobileIngestParser;
  };
  if (typeof loaded.parseAiMessageIngestResult !== "function") {
    throw new Error("앱 소스에서 parseAiMessageIngestResult 를 찾지 못했다");
  }
  return loaded.parseAiMessageIngestResult;
}

/** 앱이 AI 에게 보낼 때 함께 넘기는 기대값(`chat.tsx` 의 `AiMessageIngestExpected`). */
const appExpected = (text: string) => ({
  coupleId: COUPLE_ID,
  userId: USER_ID,
  senderType: "bride",
  text,
  clientRequestId: REQUEST_ID,
  target: "ai",
  providerAttachmentCount: 0,
});

const serverPlan = (text: string) => planAmoraCrisisDelivery({
  userText: text,
  requestedVisibility: "shared",
  target: "ai",
  senderRole: "bride",
  externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
});
const mobilePlan = (text: string) => planAmoraCrisisDelivery({
  userText: text,
  requestedVisibility: "shared",
  target: "ai",
  senderRole: "bride",
});

describe("평가 아홉 문장 — 전달 계획과 서버 신호", () => {
  it.each(SELF_HARM)("자해: %s → 원문 저장 없이 고정 위기 안내(서버·앱 모두)", (text) => {
    expect(hasAmoraSafetySignal(text, "chat")).toBe(true);
    for (const plan of [serverPlan(text), mobilePlan(text)]) {
      expect(plan).toEqual(expect.objectContaining({
        disposition: "local_safety_hold",
        safetyResolution: "immediate_crisis",
        effectiveVisibility: "bride_private",
        safetyPrivacyRedirected: true,
        classification: { kind: "self_harm" },
      }));
    }
  });

  it.each(VIOLENCE)("폭력·통제: %s → 나만 레인(서버·앱 모두), 상대에게는 보류", (text) => {
    expect(hasAmoraSafetySignal(text, "chat")).toBe(true);
    for (const plan of [serverPlan(text), mobilePlan(text)]) {
      expect(["private_safety_route", "local_safety_hold"]).toContain(plan.disposition);
      expect(plan.effectiveVisibility).toBe("bride_private");
      expect(plan.safetyPrivacyRedirected).toBe(true);
    }
    const toPartner = planAmoraCrisisDelivery({
      userText: text,
      requestedVisibility: "shared",
      target: "partner",
      senderRole: "bride",
      externalSafetySignal: hasAmoraSafetySignal(text, "chat"),
    });
    expect(toPartner).toEqual(expect.objectContaining({
      disposition: "local_safety_hold",
      partnerDeliveryHeld: true,
    }));
  });

  it.each(ORDINARY)("대조군: %s → 공유 레인 그대로", (text) => {
    expect(hasAmoraSafetySignal(text, "chat")).toBe(false);
    expect(serverPlan(text).disposition).toBe("continue");
    expect(serverPlan(text).effectiveVisibility).toBe("shared");
    expect(mobilePlan(text).disposition).toBe("continue");
  });
});

describe("평가 아홉 문장 — 실제 라우트(POST /api/chat/messages)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthentication();
  });

  it.each(SELF_HARM)("자해: %s → 저장하지 않고 위기 안내만 돌려준다", async (text) => {
    const admin = mockAdmin();
    const response = await post(text);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      outcome: "ephemeral_safety",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      safetyResolution: "immediate_crisis",
      classification: "self_harm",
      rawDisclosurePersisted: false,
    }));
    expect(typeof body.response).toBe("string");
    expect(admin.insert).not.toHaveBeenCalled();
  });

  it.each(VIOLENCE)("폭력·통제: %s → 나만 레인에 저장한다", async (text) => {
    const admin = mockAdmin();
    const response = await post(text);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      outcome: "persisted",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      safetyResolution: "non_immediate_safety",
      message: expect.objectContaining({ visibility: "bride_private", content: text }),
    }));
    expect(admin.insert).toHaveBeenCalledTimes(1);
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      visibility: "bride_private",
      content: text,
    }));
  });

  it.each(ORDINARY)("대조군: %s → 공유 레인에 저장한다", async (text) => {
    const admin = mockAdmin();
    const response = await post(text);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      outcome: "persisted",
      effectiveVisibility: "shared",
      safetyPrivacyRedirected: false,
    }));
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({ visibility: "shared" }));
  });
});

/**
 * 피해자가 일부러 '나만' 레인으로 옮겨 말하는 경우(2026-09-27 불변식 검토).
 *
 * 레인은 이미 나만이라 서버가 옮기지 않는다(`safetyPrivacyRedirected: false`). 그런데 설치된 앱의
 * 응답 검증기는 옮기지 않은 persisted 응답에 `safetyResolution` 이 있으면 거부한다. 서버가 그
 * 필드를 실으면 앱은 "전송 결과를 확인하지 못했어요" 를 띄우고 아모라 답을 요청하지 않으며,
 * 재시도(`reused`)도 같은 모양이라 또 거부된다. 누출은 없지만 도움 요청이 답을 못 받는다.
 *
 * 여기서는 **실제 라우트의 응답**을 **앱 소스에서 뽑은 검증기**에 그대로 넣는다. 두 쪽을 따로
 * 고정하면 둘 다 초록인 채로 어긋날 수 있다.
 */
describe("나만 레인에서 보낸 폭력·통제 문장 — 설치된 앱이 서버 응답을 받는다", () => {
  const parseInstalledApp = loadInstalledAppIngestParser();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthentication();
  });

  it("앱 검증기를 정말 불러왔다 — 옮기지 않은 응답에 `safetyResolution` 이 실리면 거부한다", () => {
    const text = VIOLENCE[0];
    const message = {
      id: MESSAGE_ID,
      couple_id: COUPLE_ID,
      sender_id: USER_ID,
      role: "user",
      sender_type: "bride",
      content: text,
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
      created_at: "2026-09-26T00:00:00.000Z",
      visibility: "bride_private",
    };
    const persisted = {
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      message,
    };
    expect(parseInstalledApp(201, persisted, appExpected(text)).effectiveVisibility)
      .toBe("bride_private");
    expect(() => parseInstalledApp(
      201,
      { ...persisted, safetyResolution: "non_immediate_safety" },
      appExpected(text),
    )).toThrow();
  });

  it.each(VIOLENCE)("%s → 나만 레인에 저장하고, 앱이 응답을 받는다(첫 전송)", async (text) => {
    const admin = mockAdmin();
    const response = await post(text, "bride_private", { providerAttachmentCount: 0 });

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      outcome: "persisted",
      reused: false,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
    }));
    expect("safetyResolution" in body).toBe(false);
    expect(admin.insert).toHaveBeenCalledWith(expect.objectContaining({
      visibility: "bride_private",
      content: text,
    }));
    const parsed = parseInstalledApp(201, body, appExpected(text));
    expect(parsed).toEqual(expect.objectContaining({
      outcome: "persisted",
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
      safetyResolution: null,
    }));
  });

  it.each(VIOLENCE)("%s → 재시도(reused)도 앱이 받는다", async (text) => {
    mockAdmin({ retry: true });
    const response = await post(text, "bride_private", { providerAttachmentCount: 0 });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      outcome: "persisted",
      reused: true,
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: false,
    }));
    expect("safetyResolution" in body).toBe(false);
    expect(parseInstalledApp(200, body, appExpected(text)).effectiveVisibility).toBe("bride_private");
  });

  it.each(VIOLENCE)("%s → 공유 레인에서 옮긴 응답은 그대로 `safetyResolution` 을 싣고, 앱이 받는다", async (text) => {
    mockAdmin();
    const response = await post(text, "shared", { providerAttachmentCount: 0 });

    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual(expect.objectContaining({
      effectiveVisibility: "bride_private",
      safetyPrivacyRedirected: true,
      safetyResolution: "non_immediate_safety",
    }));
    expect(parseInstalledApp(201, body, appExpected(text))).toEqual(expect.objectContaining({
      safetyPrivacyRedirected: true,
      safetyResolution: "non_immediate_safety",
    }));
  });
});
