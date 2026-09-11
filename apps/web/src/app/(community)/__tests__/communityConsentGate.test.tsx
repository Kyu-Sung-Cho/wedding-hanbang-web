// @vitest-environment node

/**
 * 커뮤니티도 동의 관문을 지난다. 단 **비로그인은 절대 막지 않는다.**
 *
 * ## 무엇이 있었나
 *
 * 동의 관문은 `(app)` 그룹의 `AuthenticatedAppShell` 에만 있었다. 커뮤니티는
 * `(community)` 라는 다른 그룹이라 그 관문 밖이다. 그래서 동의 기록이 없는
 * 계정이 주소만 치고 들어와 **글을 쓸 수 있었다** — 서버도 막지 않는다
 * (동의를 요구하는 API 는 `/api/onboarding` 하나뿐이고 `/api/community/*` 는
 * 요구하지 않는다).
 *
 * 새로 로그인하면 `postAuthLanding` 이 잡는다. 그런데 **이미 세션을 들고 있는
 * 사람은 그 길을 지나지 않는다.** 동의 수집은 2026-08-22 에 들어왔으므로
 * (`SIGNUP_CONSENT_INTRODUCED_AT`) 그 전 계정은 전부 여기 해당한다.
 *
 * ## 왜 비로그인 단언이 이 파일에서 제일 중요한가
 *
 * 커뮤니티 읽기는 로그인 없이 열려 있다. 이 저장소에는 로그아웃일 때 **늘**
 * 나는 `getUser()` 오류를 "확인 실패"로 읽어 커뮤니티 세 곳이 비로그인을
 * 차단한 이력이 있다. 같은 실수를 다시 하지 않도록 오류 경로를 직접 세운다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as { user_metadata?: unknown; created_at?: string } | null,
  error: null as { message: string } | null,
  redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    state.redirected.push(path);
    // 실제 redirect() 는 던져서 렌더를 끊는다. 그 모양을 흉내 내지 않으면
    // 관문을 통과한 것처럼 아래가 계속 돈다.
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.user },
        error: state.error,
      }),
    },
  }),
}));

async function renderLayout() {
  const { default: CommunityLayout } = await import("../layout");
  return CommunityLayout({ children: null });
}

beforeEach(() => {
  vi.stubEnv("SIGNUP_CONSENT_LEGACY_BEFORE", "2026-09-01T00:00:00.000Z");
  vi.resetModules();
  state.user = null;
  state.error = null;
  state.redirected = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("커뮤니티 동의 관문", () => {
  it("동의 기록이 없는 계정은 동의 화면으로 보낸다", async () => {
    state.user = { user_metadata: {} };
    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT");
    expect(state.redirected).toEqual(["/consent"]);
  });

  it("한쪽만 동의한 기록은 동의로 치지 않는다", async () => {
    for (const metadata of [
      { terms_agreed: true },
      { privacy_agreed: true },
      { terms_agreed: true, privacy_agreed: false },
      { terms_agreed: "true", privacy_agreed: "true" },
    ]) {
      state.redirected = [];
      state.user = { user_metadata: metadata };
      await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT");
      expect(state.redirected, JSON.stringify(metadata)).toEqual(["/consent"]);
    }
  });

  it("동의한 계정은 그대로 들어온다", async () => {
    state.user = { created_at: "2026-08-30T00:00:00.000Z", user_metadata: { terms_agreed: true, privacy_agreed: true } };
    await expect(renderLayout()).resolves.toBeTruthy();
    expect(state.redirected).toEqual([]);
  });
});

describe("비로그인은 막지 않는다", () => {
  it("세션이 없으면 그대로 읽는다", async () => {
    // 커뮤니티 읽기는 로그인 없이 열려 있다. 여기서 막으면 유입이 끊긴다.
    state.user = null;
    await expect(renderLayout()).resolves.toBeTruthy();
    expect(state.redirected).toEqual([]);
  });

  it("getUser 가 오류를 함께 줘도 막지 않는다", async () => {
    // **이것이 이 파일에서 가장 중요한 줄이다.**
    //
    // 로그아웃이면 getUser() 는 늘 오류를 낸다. 그 오류를 "확인 실패"로 읽고
    // 막았다가 커뮤니티 세 곳이 비로그인을 차단한 적이 있다. 오류를 보지 않고
    // 사람이 확실히 있을 때만 판단해야 이 검사가 통과한다.
    state.user = null;
    state.error = { message: "Auth session missing!" };
    await expect(renderLayout()).resolves.toBeTruthy();
    expect(state.redirected).toEqual([]);
  });
});
