// @vitest-environment node

/**
 * 릴리스 평가기가 데모 세션을 열 수 있는가 — 그리고 **그 문이 딱 그만큼만 열리는가.**
 *
 * ## 무엇이 있었나
 *
 * 운영 대화 평가가 첫 걸음에서 죽어 있었다.
 *
 *     Error: Demo session failed: 403 {"error":"untrusted_mutation_origin"}
 *
 * `isTrustedMutationRequest` 는 브라우저의 교차 사이트 요청을 막는 장치라, 헤더를 안
 * 붙이는 서버 도구를 거절한다. 가드가 이 경로에 붙은 것이 2026-08-03 이므로 **3주간
 * 운영 평가가 한 번도 못 돌았다.** 초록불도 빨간불도 아닌 채로 누워 있었다.
 *
 * `/api/chat` 은 이미 같은 토큰을 안다. 세션을 **만드는** 경로만 통로가 없었다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";

const SECRET = "x".repeat(64);
const REQUEST_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}));
vi.mock("@/lib/demoSession", () => ({ setDemoCookies: () => true }));
vi.mock("@/lib/previewStub", () => ({ isPreviewStubMode: () => true }));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimit: () => null,
  rateLimitKey: () => "test",
}));

const URL_UNDER_TEST = "https://hanbang.ai/api/demo/start";

async function post(headers: Record<string, string> = {}) {
  const { POST } = await import("../route");
  return POST(new Request(URL_UNDER_TEST, { method: "POST", headers }));
}

beforeEach(() => {
  // 이 파일은 **공개 체험이 켜진 상태**의 동작을 잰다. 기본값은 꺼짐이므로 명시한다.
  vi.stubEnv("NEXT_PUBLIC_DEMO_TRIAL_ENABLED", "true");
  vi.resetModules();
  process.env.AMORA_EVAL_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.AMORA_EVAL_SECRET;
});

describe("릴리스 평가기는 데모 세션을 열 수 있다", () => {
  it("올바른 토큰이면 통과한다", async () => {
    const response = await post({
      "x-amora-eval": createAmoraEvalToken(SECRET, REQUEST_ID),
      "x-amora-eval-request-id": REQUEST_ID,
    });
    expect(response.status).toBe(200);
  });
});

describe("문은 딱 그만큼만 열린다", () => {
  it("헤더가 없으면 예전처럼 막는다", async () => {
    // 이 검사가 없으면 브라우저 교차 사이트 보호가 조용히 사라져도 모른다.
    const response = await post();
    expect(response.status).toBe(403);
  });

  it("토큰이 틀리면 브라우저 검사로 흘려보내지 않고 401 을 낸다", async () => {
    const response = await post({
      "x-amora-eval": "v1.1700000000000.deadbeef",
      "x-amora-eval-request-id": REQUEST_ID,
    });
    expect(response.status).toBe(401);
  });

  it("요청 ID 가 없으면 통과하지 못한다", async () => {
    // 토큰은 요청 ID 하나에 묶인다.
    //
    // 정직하게 적어 둔다: 이 문을 지키는 것은 **HMAC 이지 형식 검사가 아니다.**
    // 변형으로 확인했다 — `CLIENT_REQUEST_ID_RE` 검사를 지워도 7개 전부 통과한다.
    // ID 를 빼면 서명이 `v1:issuedAt:null` 로 계산돼 어차피 맞지 않는다.
    // 형식 검사는 터무니없는 값을 HMAC 앞에서 끊는 값싼 관문이고, `/api/chat` 과
    // 모양을 맞추려고 둔다. 보안 속성을 그것에 기대지 않는다.
    const response = await post({
      "x-amora-eval": createAmoraEvalToken(SECRET, REQUEST_ID),
    });
    expect(response.status).toBe(401);
  });

  it("다른 요청 ID 로 만든 토큰은 통과하지 못한다", async () => {
    const response = await post({
      "x-amora-eval": createAmoraEvalToken(SECRET, "11111111-1111-4111-8111-111111111111"),
      "x-amora-eval-request-id": REQUEST_ID,
    });
    expect(response.status).toBe(401);
  });

  it("만료된 토큰은 통과하지 못한다", async () => {
    // 5분이 지나면 못 쓴다. 옛 요청에서 베껴 와도 소용없다.
    const stale = createAmoraEvalToken(SECRET, REQUEST_ID, Date.now() - 6 * 60 * 1000);
    const response = await post({
      "x-amora-eval": stale,
      "x-amora-eval-request-id": REQUEST_ID,
    });
    expect(response.status).toBe(401);
  });

  it("비밀값이 없는 배포에서는 통과하지 못한다", async () => {
    delete process.env.AMORA_EVAL_SECRET;
    const response = await post({
      "x-amora-eval": createAmoraEvalToken(SECRET, REQUEST_ID),
      "x-amora-eval-request-id": REQUEST_ID,
    });
    expect(response.status).toBe(401);
  });
});
