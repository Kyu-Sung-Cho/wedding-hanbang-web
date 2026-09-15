import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  rateLimitKey: (prefix: string) => `${prefix}:bucket`,
}));

vi.mock("@/utils/log", () => ({
  log: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));

import {
  WEDDING_CODE_RESEARCH_CONSENT_VERSION,
  WEDDING_CODE_RESEARCH_RECEIPT_PATTERN,
  WEDDING_CODE_RESEARCH_SCENE_VERSION,
} from "@/lib/weddingCode/contribution/contract";
import { POST as deleteContribution } from "./delete/route";
import { POST as contribute } from "./route";

const ORIGIN = "https://hanbang.ai";
const SECRET = "test-secret-that-is-at-least-thirty-two-chars";
const ANSWER_CODE = "ABCD-ABCDABCDABCDABC";

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  sceneVersion: WEDDING_CODE_RESEARCH_SCENE_VERSION,
  answerCode: ANSWER_CODE,
  consentVersion: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
  adultConfirmed: true,
  consented: true,
};

describe("POST /api/wedding-code/research-contribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "true");
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", SECRET);
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["플래그가 꺼져 있으면", { WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED: "false" }],
    ["비밀값이 없으면", { WEDDING_CODE_RESEARCH_RECEIPT_SECRET: "" }],
    ["비밀값이 짧으면", { WEDDING_CODE_RESEARCH_RECEIPT_SECRET: "short" }],
  ])("%s 본문을 읽기 전에 닫혀 있다고 답한다", async (_label, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.checkRateLimitPersistent).not.toHaveBeenCalled();
  });

  it("다른 출처의 요청은 받지 않는다", async () => {
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID, {
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    }));
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["동의 체크를 안 했으면", { ...VALID, consented: false }],
    ["성인 확인을 안 했으면", { ...VALID, adultConfirmed: false }],
    ["동의가 문자열 'true' 면", { ...VALID, consented: "true" }],
    ["예전 문항 판이면", { ...VALID, sceneVersion: "v0.6-scene" }],
    ["동의 문구 판이 다르면", { ...VALID, consentVersion: "wc-research-consent-v0" }],
    ["답 코드 길이가 다르면", { ...VALID, answerCode: "ABCD" }],
    ["모두 건너뛴 코드면", { ...VALID, answerCode: "-".repeat(20) }],
    ["소문자 답이면", { ...VALID, answerCode: ANSWER_CODE.toLowerCase() }],
    ["다른 키가 섞였으면", { ...VALID, email: "someone@example.com" }],
    ["상대 코드를 함께 보내면", { ...VALID, partnerCode: ANSWER_CODE }],
  ])("%s 저장하지 않는다", async (_label, body) => {
    const response = await contribute(post("/api/wedding-code/research-contribution", body));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("JSON 이 아니거나 너무 크면 저장하지 않는다", async () => {
    expect((await contribute(post("/api/wedding-code/research-contribution", "{"))).status).toBe(400);
    const huge = await contribute(post("/api/wedding-code/research-contribution", { ...VALID, pad: "x".repeat(2048) }));
    expect(huge.status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("남용 제한에 걸리면 그 응답을 그대로 돌려준다", async () => {
    mocks.checkRateLimitPersistent.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("동의한 답만 해시와 함께 저장하고 삭제 코드 원문은 응답에서 한 번만 돌려준다", async () => {
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { receipt } = await response.json();
    expect(receipt).toMatch(WEDDING_CODE_RESEARCH_RECEIPT_PATTERN);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = mocks.rpc.mock.calls[0];
    expect(fn).toBe("insert_wedding_code_research_contribution");
    expect(Object.keys(params).sort()).toEqual([
      "p_answer_code", "p_consent_version", "p_deletion_receipt_hash", "p_scene_version",
    ]);
    expect(params).toMatchObject({
      p_scene_version: WEDDING_CODE_RESEARCH_SCENE_VERSION,
      p_answer_code: ANSWER_CODE,
      p_consent_version: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
    });
    expect(params.p_deletion_receipt_hash).toMatch(/^\\x[0-9a-f]{64}$/);
    // 원문 코드는 DB 로 가지 않는다.
    expect(JSON.stringify(params)).not.toContain(receipt.slice("wc_del_".length));

    // 같은 코드로 지우면 같은 해시를 찾는다.
    const deleted = await deleteContribution(post("/api/wedding-code/research-contribution/delete", { receipt }));
    expect(deleted.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("delete_wedding_code_research_contribution", {
      p_deletion_receipt_hash: params.p_deletion_receipt_hash,
    });
  });

  it("매번 다른 삭제 코드를 만든다", async () => {
    const first = await (await contribute(post("/api/wedding-code/research-contribution", VALID))).json();
    const second = await (await contribute(post("/api/wedding-code/research-contribution", VALID))).json();
    expect(first.receipt).not.toBe(second.receipt);
    expect(mocks.rpc.mock.calls[0][1].p_deletion_receipt_hash)
      .not.toBe(mocks.rpc.mock.calls[1][1].p_deletion_receipt_hash);
  });

  it("DB 가 거절하면 삭제 코드를 내주지 않고, 로그에는 오류 코드만 남긴다", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: "22023", message: `answer ${ANSWER_CODE}` } });
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("receipt");
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), { code: "22023" });
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain(ANSWER_CODE);
  });
});

describe("POST /api/wedding-code/research-contribution/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "true");
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", SECRET);
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("모양이 틀린 코드는 DB 에 묻지 않는다", async () => {
    for (const body of [{ receipt: "wc_del_short" }, { receipt: 1 }, { receipt: "x", extra: 1 }, "{"]) {
      const response = await deleteContribution(post("/api/wedding-code/research-contribution/delete", body));
      expect(response.status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("있는 코드든 없는 코드든 같은 응답을 준다", async () => {
    const a = await deleteContribution(post("/api/wedding-code/research-contribution/delete", { receipt: `wc_del_${"A".repeat(43)}` }));
    const b = await deleteContribution(post("/api/wedding-code/research-contribution/delete", { receipt: `wc_del_${"B".repeat(43)}` }));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await a.json()).toEqual(await b.json());
  });

  it("닫혀 있으면 지우기도 받지 않는다", async () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    const response = await deleteContribution(post("/api/wedding-code/research-contribution/delete", { receipt: `wc_del_${"A".repeat(43)}` }));
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
