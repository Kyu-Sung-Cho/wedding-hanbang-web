// 콜백만 막으면 **이미 세션을 들고 있는 사람**이 주소로 바로 들어온다.
// 소셜로 계정이 만들어진 뒤 동의 화면에서 뒤로가기를 눌러 /wedding/chat 을
// 직접 치는 경우가 그것이다. 셸에서도 같은 관문을 지나야 한다.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  getUser: vi.fn(),
  cookieGet: vi.fn(() => undefined as { value: string } | undefined),
  verifyDemoSessionToken: vi.fn(() => false),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookieGet }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock("@/lib/demoSession", () => ({
  verifyDemoSessionToken: mocks.verifyDemoSessionToken,
}));
vi.mock("./AppClientLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("./DemoModeBanner", () => ({ default: () => null }));

import { SIGNUP_CONSENT_PATH } from "@hanbang/shared";

import AuthenticatedAppShell from "./AuthenticatedAppShell";

async function renderShell(): Promise<string | null> {
  try {
    await AuthenticatedAppShell({ children: <span>제품 화면</span> });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
}

describe("앱 셸 동의 관문", () => {
  beforeEach(() => {
    vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z");
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`REDIRECT:${path}`);
    });
    mocks.cookieGet.mockReturnValue(undefined);
    mocks.verifyDemoSessionToken.mockReturnValue(false);
  });

  it("동의 기록이 없으면 제품 화면 대신 동의 화면으로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", user_metadata: {} } } });

    expect(await renderShell()).toBe(SIGNUP_CONSENT_PATH);
  });

  it("한쪽만 동의한 기록은 통과시키지 않는다", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "u2", user_metadata: { terms_agreed: true } } },
    });

    expect(await renderShell()).toBe(SIGNUP_CONSENT_PATH);
  });

  it("동의를 마친 사람은 그대로 들어간다", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: "u3", created_at: "2026-08-30T00:00:00.000Z", user_metadata: { terms_agreed: true, privacy_agreed: true } },
      },
    });

    expect(await renderShell()).toBeNull();
  });

  it("로그인하지 않았으면 동의 화면이 아니라 로그인으로 보낸다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    expect(await renderShell()).toBe("/login");
  });

  it("동의 판정에 추가 조회를 하지 않는다", async () => {
    // app_metadata와 생성 시각은 getUser()에 이미 실려 온다. 여기서 DB를 한 번 더
    // 때리면 모든 인증 요청에 왕복이 하나 붙는다.
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u4", user_metadata: {} } } });

    await renderShell();

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    new AuthRetryableFetchError("private SDK transport detail", 503),
    new AuthApiError("private service detail", 500, "unexpected_failure"),
    new AuthApiError("private limiter detail", 429, "over_request_rate_limit"),
    new Error("private unknown detail"),
  ])("인증 장애는 로그인 이동 대신 재시도 경계로 보내고 내부 오류를 숨긴다: $name", async error => {
    for (const user of [null, { id: "stale-user", created_at: "2026-08-30T00:00:00.000Z" }]) {
      mocks.getUser.mockResolvedValue({ data: { user }, error });
      await expect(AuthenticatedAppShell({ children: <span>비공개 내용</span> }))
        .rejects.toThrow("로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
      expect(mocks.redirect).not.toHaveBeenCalled();
    }
  });

  it("인증 SDK 예외도 내부 진단 없이 같은 재시도 경계로 보낸다", async () => {
    mocks.getUser.mockRejectedValue(new Error("private thrown SDK detail"));
    await expect(AuthenticatedAppShell({ children: <span>비공개 내용</span> }))
      .rejects.toThrow("로그인 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    new AuthSessionMissingError(),
    new AuthApiError("expired", 403, "bad_jwt"),
  ])("확정된 세션 종료는 모순된 사용자 값이 있어도 로그인으로 보낸다: $name", async error => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "stale-user", created_at: "2026-08-30T00:00:00.000Z" } }, error });
    expect(await renderShell()).toBe("/login");
  });

  it("서명된 데모는 인증 서버 조회 없이 정상 데모 계약을 유지한다", async () => {
    mocks.cookieGet.mockImplementation((name?: string) => name === "demo_mode" ? { value: "true" } : { value: "signed-demo" });
    mocks.verifyDemoSessionToken.mockReturnValue(true);
    mocks.getUser.mockRejectedValue(new Error("must not query auth"));
    const result = await AuthenticatedAppShell({ children: <span>체험 화면</span> });
    expect(result.props.initialDemo).toBe(true);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
