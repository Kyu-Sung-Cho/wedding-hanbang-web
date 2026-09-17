import { createHmac } from "node:crypto";

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
  WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT,
  WEDDING_CODE_RESEARCH_RECEIPT_PATTERN,
  createWeddingCodeResearchReceipt,
} from "@/lib/weddingCode/contribution/contract";
import { WEDDING_CODE_V08_VERSION } from "@/constants/weddingCodeV08";
import { WEDDING_CODE_V09_VERSION } from "@/constants/weddingCodeV09";
import { POST as deleteContribution } from "./delete/route";
import { POST as contribute } from "./route";

const ORIGIN = "https://hanbang.ai";
const SECRET = "test-secret-that-is-at-least-thirty-two-chars";
const ANSWER_CODE = "ABCD-ABCDABCDABCDABC";
const RECEIPT = `wc_del_${"K".repeat(43)}`;
const AFTER_EFFECTIVE = Date.parse(WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT) + 60_000;

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
  sceneVersion: WEDDING_CODE_V09_VERSION as string,
  answerCode: ANSWER_CODE,
  consentVersion: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
  adultConfirmed: true,
  consented: true,
  receipt: RECEIPT,
};

const expectedHash = (receipt: string) => `\\x${createHmac("sha256", SECRET).update(receipt).digest("hex")}`;

describe("POST /api/wedding-code/research-contribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AFTER_EFFECTIVE);
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "true");
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", SECRET);
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.rpc.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("처리방침에 고지한 적용일 전에는 플래그가 켜져 있어도 받지 않는다", async () => {
    vi.setSystemTime(Date.parse(WEDDING_CODE_RESEARCH_CONTRIBUTION_EFFECTIVE_AT) - 1);
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
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
    ["삭제 코드가 없으면", { ...VALID, receipt: undefined }],
    ["삭제 코드 모양이 틀리면", { ...VALID, receipt: "wc_del_short" }],
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

  it("동의한 답과 삭제 코드의 서버 비밀 HMAC 만 저장하고, 원문 코드는 DB·응답에 싣지 않는다", async () => {
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("insert_wedding_code_research_contribution", {
      p_scene_version: WEDDING_CODE_V09_VERSION,
      p_answer_code: ANSWER_CODE,
      p_consent_version: WEDDING_CODE_RESEARCH_CONSENT_VERSION,
      p_deletion_receipt_hash: expectedHash(RECEIPT),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(RECEIPT.slice("wc_del_".length));

    const deleted = await deleteContribution(post("/api/wedding-code/research-contribution/delete", { receipt: RECEIPT }));
    expect(deleted.status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("delete_wedding_code_research_contribution", {
      p_deletion_receipt_hash: expectedHash(RECEIPT),
    });
  });

  /**
   * 받는 판이 둘이 된 뒤(v0.8·v0.9) 가장 조용히 틀릴 수 있는 곳: 요청이 어느 판이었든
   * 서버가 상수 하나로 바꿔 저장하면, DB 는 둘 다 받으니 아무 오류 없이 이름표가 섞인다.
   */
  it("옛 판(v0.8) 링크로 푼 답은 v0.8 이름표 그대로 저장한다", async () => {
    const response = await contribute(post("/api/wedding-code/research-contribution", {
      ...VALID,
      sceneVersion: WEDDING_CODE_V08_VERSION,
    }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "insert_wedding_code_research_contribution",
      expect.objectContaining({ p_scene_version: WEDDING_CODE_V08_VERSION }),
    );
  });

  it("응답이 끊겨 같은 삭제 코드로 다시 보내면(고유 제약 23505) 한 번 저장된 것으로 성공 처리한다", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate key" } });
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("DB 가 거절하면(지운 코드 재사용 등) 성공이라 하지 않고, 로그에는 오류 코드만 남긴다", async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: "22023", message: `answer ${ANSWER_CODE} ${RECEIPT}` } });
    const response = await contribute(post("/api/wedding-code/research-contribution", VALID));
    expect(response.status).toBe(503);
    expect(mocks.logError).toHaveBeenCalledWith(expect.any(String), { code: "22023" });
    const logged = JSON.stringify(mocks.logError.mock.calls);
    expect(logged).not.toContain(ANSWER_CODE);
    expect(logged).not.toContain(RECEIPT);
  });

  it("브라우저 삭제 코드 생성기는 계약 모양(32바이트)을 만들고 매번 다르다", () => {
    const first = createWeddingCodeResearchReceipt();
    const second = createWeddingCodeResearchReceipt();
    expect(first).toMatch(WEDDING_CODE_RESEARCH_RECEIPT_PATTERN);
    expect(second).toMatch(WEDDING_CODE_RESEARCH_RECEIPT_PATTERN);
    expect(first).not.toBe(second);
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

  it("새 답 받기를 멈춰도(플래그 끔) 이미 받은 답은 지울 수 있다", async () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    const response = await deleteContribution(post("/api/wedding-code/research-contribution/delete", { receipt: RECEIPT }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("delete_wedding_code_research_contribution", {
      p_deletion_receipt_hash: expectedHash(RECEIPT),
    });
  });

  it("비밀값이 없으면(저장소를 지킬 수 없으면) 지우기도 받지 않는다", async () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", "");
    const response = await deleteContribution(post("/api/wedding-code/research-contribution/delete", { receipt: RECEIPT }));
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
