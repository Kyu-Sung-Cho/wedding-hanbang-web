import { describe, expect, it, vi } from "vitest";

// `vi.mock` 은 파일 맨 위로 끌어올려지므로 목 함수도 `vi.hoisted` 안에서 만들어야 한다.
const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import DemoLoginRedirect from "./page";

/**
 * `/demo/login` 은 `/login` 의 복제본이었다. 두 가지가 달랐고 **복제본 쪽이 나빴다**:
 *
 * 1. `INTERNAL DEV` 배지가 조건 없이 렌더됐다 — 공개 화면에서 두 클릭에 닿는 자리다.
 * 2. **"로그인 없이 체험하기" 입구가 없었다.** 정품 `/login` 에는 있다.
 *    데모를 보러 온 사람을 데모를 못 쓰는 화면으로 보내고 있었다.
 *
 * 운영 실측(2026-08-27):
 *
 *     /login       "또는 로그인 없이 체험하기 …"      체험 입구 있음
 *     /demo/login  "INTERNAL DEV"                    체험 입구 0개
 *
 * 이 파일은 그 되돌림을 막는다. 특히 **쿼리 보존**이 중요하다 —
 * `api/auth/callback/route.ts` 가 `from=demo` 소셜 로그인 실패를 이 주소로
 * 돌려보내므로, 쿼리를 버리면 그 오류 문구가 사용자에게 영영 안 보인다.
 */

async function redirectTargetOf(
  params: Record<string, string | string[] | undefined>,
): Promise<string> {
  redirect.mockClear();
  try {
    await DemoLoginRedirect({ searchParams: Promise.resolve(params) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("NEXT_REDIRECT:")) throw error;
  }
  expect(redirect, "리다이렉트를 부르지 않았다").toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0][0];
}

describe("측정기가 살아 있다", () => {
  it("이 페이지는 화면을 그리지 않고 리다이렉트만 한다", async () => {
    await expect(redirectTargetOf({})).resolves.toBe("/login");
  });
});

describe("정품 로그인으로 보낸다", () => {
  it("쿼리가 없으면 그냥 /login", async () => {
    expect(await redirectTargetOf({})).toBe("/login");
  });

  it("소셜 로그인 실패 문구를 잃지 않는다", async () => {
    expect(await redirectTargetOf({ error: "access_denied" }))
      .toBe("/login?error=access_denied");
  });

  it("여러 파라미터를 모두 옮긴다", async () => {
    const target = await redirectTargetOf({ error: "verify_failed", mode: "signup" });
    expect(target.startsWith("/login?")).toBe(true);
    expect(target).toContain("error=verify_failed");
    expect(target).toContain("mode=signup");
  });

  it("배열로 온 값도 버리지 않는다", async () => {
    expect(await redirectTargetOf({ error: ["first", "second"] }))
      .toBe("/login?error=first");
  });

  it("빈 배열은 빈 쿼리를 만들지 않는다", async () => {
    expect(await redirectTargetOf({ error: [] })).toBe("/login");
  });
});

describe("INTERNAL DEV 배지가 공개 화면에 다시 생기지 않는다", () => {
  it("이 라우트 소스에 배지 문구가 없다", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const root = resolve(__dirname, "..", "..", "..", "..", "..", "..");
    const source = readFileSync(
      join(root, "apps", "web", "src", "app", "demo", "login", "page.tsx"),
      "utf8",
    );
    // 주석에서 무엇이 있었는지 설명하는 것은 허용한다. 렌더되는 문자열만 막는다.
    const rendered = source
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    expect(rendered, "공개 화면에 내부 개발 배지가 돌아왔다")
      .not.toContain("INTERNAL DEV");
  });
});
