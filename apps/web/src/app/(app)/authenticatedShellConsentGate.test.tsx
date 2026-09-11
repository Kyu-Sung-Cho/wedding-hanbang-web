// 콜백만 막으면 **이미 세션을 들고 있는 사람**이 주소로 바로 들어온다.
// 소셜로 계정이 만들어진 뒤 동의 화면에서 뒤로가기를 눌러 /wedding/chat 을
// 직접 치는 경우가 그것이다. 셸에서도 같은 관문을 지나야 한다.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
