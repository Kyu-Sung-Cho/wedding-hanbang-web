// @vitest-environment node

/**
 * 비밀번호 재설정 메일에 실린 링크를 **동작**으로 고정한다.
 *
 * 2026-08-22 이전에는 Supabase 의 `action_link` 를 그대로 실었다. 그 링크를 누르면
 * 재설정 화면이 "인증 확인 중"에서 영원히 멈췄다 — 계정을 되찾을 방법이 없었고,
 * 탈퇴도 닫혀 있어 사용자는 계정에 갇혔다. 이 파일은 그 링크가 다시 Supabase 로
 * 돌아가지 않는지 본다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyTurnstile: vi.fn(),
  checkRateLimitPersistent: vi.fn(),
  createAdminClient: vi.fn(),
  generateLink: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/turnstile", () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  normalizeEmailForRateLimit: (value: string) => value.toLowerCase(),
}));
vi.mock("@/utils/rateLimit", () => ({
  checkRateLimitPersistent: mocks.checkRateLimitPersistent,
  getClientIp: () => "203.0.113.1",
  rateLimitKey: () => "ip-key",
  rateLimitSubjectKey: () => "subject-key",
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import { POST as forgotPassword } from "./forgot-password/route";

function sentLinks(): string[] {
  const html = String(mocks.send.mock.calls[0]?.[0]?.html ?? "");
  const links: string[] = [];
  let cursor = html.indexOf("https://");
  while (cursor !== -1) {
    let end = cursor;
    while (end < html.length && !['"', "'", "<", " ", "\n"].includes(html[end])) end += 1;
    links.push(html.slice(cursor, end).replace(/&amp;/g, "&"));
    cursor = html.indexOf("https://", end);
  }
  return links;
}

describe("비밀번호 재설정 메일 링크", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "test-key";
    process.env.NEXT_PUBLIC_SITE_URL = "https://hanbang.ai";
    mocks.verifyTurnstile.mockResolvedValue({ ok: true, skipped: false });
    mocks.checkRateLimitPersistent.mockResolvedValue(null);
    mocks.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok_recovery" } },
      error: null,
    });
    mocks.createAdminClient.mockReturnValue({
      auth: { admin: { generateLink: mocks.generateLink } },
    });
    mocks.send.mockResolvedValue({ data: { id: "mail-id" }, error: null });
  });

  async function request() {
    return forgotPassword(new Request("https://hanbang.ai/api/auth/forgot-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "sample@example.test", turnstileToken: "proof" }),
    }));
  }

  it("우리 라우트를 가리키고 token_hash 와 recovery 를 싣는다", async () => {
    await request();

    const confirm = sentLinks()
      .map((href) => new URL(href))
      .find((url) => url.pathname === "/api/auth/confirm");

    expect(confirm, `보낸 링크: ${sentLinks().join(" / ")}`).toBeDefined();
    expect(confirm!.origin).toBe("https://hanbang.ai");
    expect(confirm!.searchParams.get("token_hash")).toBe("tok_recovery");
    expect(confirm!.searchParams.get("type")).toBe("recovery");
  });

  it("Supabase verify 로 돌아가지 않는다", async () => {
    await request();

    // 회귀하면 여기서 걸린다 — action_link 는 supabase.co/auth/v1/verify 다.
    for (const href of sentLinks()) {
      expect(href, href).not.toContain("supabase");
      expect(href, href).not.toContain("/auth/v1/verify");
    }
  });

  it("링크를 만들지 못하면 메일을 보내지 않는다", async () => {
    mocks.generateLink.mockResolvedValue({ data: { properties: null }, error: null });

    const response = await request();

    // 계정 존재 여부가 새면 안 되므로 응답은 그대로 성공이다.
    expect(response.status).toBe(200);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
