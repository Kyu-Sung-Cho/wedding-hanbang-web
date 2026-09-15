// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET } from "./route";

function request(secret = "cron-secret") {
  return new Request("https://example.test/api/cron/ai-log-retention", {
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe("GET /api/cron/ai-log-retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    delete process.env.AI_LOG_RETENTION_CRON_ENABLED;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.AI_LOG_RETENTION_CRON_ENABLED;
  });

  it("is a successful no-op without constructing a service client when the kill switch is missing", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: false,
      status: "disabled",
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("rejects missing or incorrect cron authentication before evaluating the kill switch", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");

    const incorrect = await GET(request("wrong-secret"));
    expect(incorrect.status).toBe(401);

    vi.stubEnv("CRON_SECRET", "");
    const missing = await GET(request());
    expect(missing.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("treats every value other than exact lowercase true as disabled", async () => {
    for (const value of ["false", "TRUE", " true ", "1"]) {
      vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", value);
      const response = await GET(request());

      expect(response.status, value).toBe(200);
      await expect(response.json(), value).resolves.toMatchObject({
        ok: true,
        enabled: false,
        status: "disabled",
      });
    }

    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  // 2026-09-02 — 이 작업이 파기 **두 가지**를 한다.
  //
  // 관리자 접속기록 파기를 새 크론으로 만들지 않고 여기 얹었다. 같은 날
  // `apps/web/vercel.json` 에서 스케줄 6개가 통째로 사라져 탈퇴 처리와 로그
  // 파기가 멈춘 일이 있었고, 파기끼리는 한 작업에 두는 편이 잃기 어렵다.
  //
  // 그래서 "한 번만" 이 아니라 **각각 정확히 한 번씩** 을 고정한다. 기간도 함께
  // 본다 — 개인정보 처리방침이 두 기간을 사용자에게 약속하고 있다(90일 · 1년).
  it("사용 설정이 켜졌을 때만, 두 파기 RPC 를 각각 한 번씩 정확한 기간으로 부른다", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 7, error: null })
      .mockResolvedValueOnce({ data: 2, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: true,
      status: "completed",
      redacted: 7,
      purgedAdminAccess: 2,
    });
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenNthCalledWith(1, "redact_old_ai_interactions", {
      p_retention: "90 days",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "purge_admin_access_log", {
      p_retention: "365 days",
    });
  });

  // 2026-09-16 — 웨딩코드 답 보태기(보낸 날부터 60일)도 같은 작업에서 지운다.
  // 보태기를 받지 않는 동안에는 부르지 않는다: 테이블이 운영에 있다고 확정할 수 없다.
  it("웨딩코드 보태기를 받는 동안에만 세 번째로 만료분을 지운다", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "true");
    vi.stubEnv("WEDDING_CODE_RESEARCH_RECEIPT_SECRET", "test-secret-that-is-at-least-thirty-two-chars");
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 7, error: null })
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: 4, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      enabled: true,
      status: "completed",
      redacted: 7,
      purgedAdminAccess: 2,
      purgedWeddingCodeResearch: 4,
    });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(3, "purge_expired_wedding_code_research_contributions");

    rpc.mockReset();
    rpc
      .mockResolvedValueOnce({ data: 7, error: null })
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "research table private detail" } });
    const failed = await GET(request());
    const body = await failed.json();
    expect(failed.status).toBe(500);
    expect(body).toEqual({ error: "WeddingCode research retention failed", redacted: 7, purgedAdminAccess: 2 });

    vi.stubEnv("WEDDING_CODE_RESEARCH_CONTRIBUTION_ENABLED", "false");
    rpc.mockReset();
    rpc
      .mockResolvedValueOnce({ data: 1, error: null })
      .mockResolvedValueOnce({ data: 1, error: null });
    const closed = await GET(request());
    expect(await closed.json()).not.toHaveProperty("purgedWeddingCodeResearch");
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("관리자 기록 파기가 실패하면 500 이지만 앞선 파기 결과는 잃지 않는다", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 7, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.redacted).toBe(7);
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("contains service-client and RPC exceptions without exposing secrets or database details", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    mocks.createAdminClient.mockImplementationOnce(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY=private-service-key");
    });

    const clientFailure = await GET(request());
    const clientBody = JSON.stringify(await clientFailure.json());

    expect(clientFailure.status).toBe(500);
    expect(clientBody).toBe('{"error":"AI log retention failed"}');
    expect(clientBody).not.toContain("private-service-key");

    mocks.createAdminClient.mockReturnValueOnce({
      rpc: vi.fn().mockRejectedValue(
        new Error("relation private.ai_interactions_log does not exist"),
      ),
    });

    const rpcFailure = await GET(request());
    const rpcBody = JSON.stringify(await rpcFailure.json());

    expect(rpcFailure.status).toBe(500);
    expect(rpcBody).toBe('{"error":"AI log retention failed"}');
    expect(rpcBody).not.toContain("ai_interactions_log");
  });

  it("returns a generic 500 for a database error or malformed count", async () => {
    vi.stubEnv("AI_LOG_RETENTION_CRON_ENABLED", "true");
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: "database private detail" },
      })
      .mockResolvedValueOnce({ data: -1, error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });

    for (const forbiddenDetail of ["private detail", "-1"]) {
      const response = await GET(request());
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(500);
      expect(body).toBe('{"error":"AI log retention failed"}');
      expect(body).not.toContain(forbiddenDetail);
    }
  });

  it("registers exactly one daily low-traffic Vercel schedule", () => {
    const config = JSON.parse(readFileSync(
      resolve(process.cwd(), "vercel.json"),
      "utf8",
    )) as { crons: Array<{ path: string; schedule: string }> };

    expect(config.crons.filter(
      (entry) => entry.path === "/api/cron/ai-log-retention",
    )).toEqual([{
      path: "/api/cron/ai-log-retention",
      schedule: "30 18 * * *",
    }]);
  });
});
