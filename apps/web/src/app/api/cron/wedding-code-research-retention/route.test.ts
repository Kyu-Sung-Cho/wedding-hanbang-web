// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), logError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/utils/log", () => ({ log: { error: mocks.logError, warn: vi.fn(), info: vi.fn() } }));

import { GET } from "./route";

const SECRET = "test-secret-that-is-at-least-thirty-two-chars";

function request(secret = "cron-secret") {
  return new Request("https://example.test/api/cron/wedding-code-research-retention", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

/**
 * 60일 약속은 새 답을 받는지와 무관하게 지켜져야 한다. 2026-09-16 적대 검토에서
 * AI 로그 파기 스위치 뒤에 묶여 있던 것이 잡혀 따로 뺐다.
 */
describe("GET /api/cron/wedding-code-research-retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", SECRET);
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "false");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("인증이 틀리면 아무것도 만들지 않는다", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request())).status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("수집이 닫혀 있고 AI 로그 파기가 꺼져 있어도, 비밀값이 있으면 매일 지운다", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 3, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, enabled: true, status: "completed", purged: 3 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("purge_expired_wedding_code_research_contributions");
  });

  it("비밀값이 없으면 저장소가 없는 것으로 보고 클라이언트도 만들지 않는다", async () => {
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", "");
    const response = await GET(request());
    await expect(response.json()).resolves.toEqual({ ok: true, enabled: false, status: "disabled" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["PGRST202", "42883"])("DB 레인 적용 전(함수 없음 %s)이면 실패가 아니라 미적용으로 답한다", async (code) => {
    mocks.createAdminClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message: "function missing" } }) });
    const response = await GET(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, enabled: true, status: "not_applied" });
  });

  it("DB 오류·이상한 개수·예외는 원문 없이 500 으로 알린다", async () => {
    for (const outcome of [
      { data: null, error: { code: "57014", message: "private database detail" } },
      { data: -1, error: null },
      { data: "3", error: null },
    ]) {
      mocks.createAdminClient.mockReturnValueOnce({ rpc: vi.fn().mockResolvedValue(outcome) });
      const response = await GET(request());
      expect(response.status).toBe(500);
      const body = JSON.stringify(await response.json());
      expect(body).toBe('{"error":"WeddingCode research retention failed"}');
      expect(body).not.toContain("private database detail");
    }
    mocks.createAdminClient.mockImplementationOnce(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY=private"); });
    const thrown = await GET(request());
    expect(thrown.status).toBe(500);
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("private");
  });

  it("매일 한 번 도는 Vercel 스케줄이 등록돼 있다", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    expect(config.crons.filter((entry) => entry.path === "/api/cron/wedding-code-research-retention")).toEqual([
      { path: "/api/cron/wedding-code-research-retention", schedule: "45 18 * * *" },
    ]);
  });
});
