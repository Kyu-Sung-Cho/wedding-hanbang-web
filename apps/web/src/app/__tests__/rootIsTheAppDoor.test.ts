import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 도메인 루트는 공개 랜딩이며 명시적 앱 주소의 인증 경계와 독립적이다. */
const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getUser: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import HomePage from "../page";

const WEB_ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("루트는 로그인 상태와 관계없이 랜딩으로 보낸다", () => {
  beforeEach(() => {
    mocks.getUser.mockReset().mockResolvedValue({ data: { user: null } });
    mocks.createClient.mockReset().mockResolvedValue({ auth: { getUser: mocks.getUser } });
    mocks.redirect.mockReset().mockImplementation(() => { throw new Error("ROOT_REDIRECT"); });
  });
  it("엣지가 루트를 가로채지 않는다", () => {
    const config = read("next.config.ts");
    // 루트 307은 미들웨어에서 관리한다. 별도 정적 규칙과 목적지가 갈리지 않게 한다.
    expect(config).not.toMatch(/source:\s*"\/"\s*(?=[,}\r\n])/u);
  });

  it.each([null, { id: "signed-in" }])("폴백은 세션에 관계없이 랜딩으로 보낸다: %j", async (user) => {
    mocks.getUser.mockResolvedValueOnce({ data: { user } });
    await expect(HomePage({})).rejects.toThrow("ROOT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/landing");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("유입 query의 여러 값과 빈 값을 목적지까지 보존한다", async () => {
    await expect(HomePage({ searchParams: Promise.resolve({
      utm_source: "카카오 & 친구", tag: ["a", "b"], empty: "", missing: undefined,
    }) })).rejects.toThrow("ROOT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(
      "/landing?utm_source=%EC%B9%B4%EC%B9%B4%EC%98%A4+%26+%EC%B9%9C%EA%B5%AC&tag=a&tag=b&empty=",
    );
  });

  it("인증 서비스가 실패하는 환경도 폴백의 목적지를 바꾸지 않는다", async () => {
    mocks.createClient.mockRejectedValueOnce(new Error("Auth unavailable"));
    await expect(HomePage({})).rejects.toThrow("ROOT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/landing");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("검색 유입은 여전히 랜딩으로 들어온다", () => {
    // 루트를 로그인으로 바꾸면서 색인 자리를 잃지 않았다는 근거다.
    expect(read("src/app/sitemap.ts")).toContain("${BASE_URL}/landing");
    expect(read("src/app/landing/page.tsx")).toContain('canonical: "/landing"');
  });

  it("정책 화면의 '홈으로'가 한 번에 랜딩으로 간다", () => {
    // 약관·개인정보·AI 고지는 로그인 없이 읽을 수 있어야 하는 문서다.
    // 루트도 이제 랜딩으로 가지만 그건 307 한 번을 더 타는 길이다 — 직접 가리킨다.
    for (const file of [
      "src/app/terms/page.tsx",
      "src/app/privacy/page.tsx",
      "src/app/ai-policy/page.tsx",
    ]) {
      const source = read(file);
      expect(source, `${file}에 루트 링크가 남아 있습니다`).not.toMatch(
        /href="\/"/u,
      );
      expect(source).toContain('href="/landing"');
    }
  });

  it("어드민 로그인의 '홈으로'가 바로 옆 '고객 로그인'과 같은 곳에 떨어지지 않는다", () => {
    // 한때 루트가 로그인으로 가서 그 화면의 두 링크가 같은 목적지가 된 적이 있다.
    // 관리자가 서비스를 확인하러 누르는 링크는 설명이 있는 `/landing`을 직접 가리킨다.
    const source = read("src/app/(admin)/admin/login/page.tsx");
    expect(source).not.toContain('href="/"');
    expect(source).toContain('href="/landing"');
  });
});

describe("아모라의 호칭", () => {
  it("아모라를 '파트너'로 소개하지 않는다", () => {
    // 제품 계약: 아모라의 정본 호칭은 "결혼 준비 동반자"이고, 이 제품에서 "파트너"는
    // **배우자될 사람**을 가리킨다(wedding/CLAUDE.md). 루트가 한때 로그인으로 가면서
    // 그 화면이 제품의 첫인상이 됐는데, 거기서 아모라를 파트너라고 부르고 있었다.
    // 정문은 다시 랜딩이 됐지만 이 금지는 화면과 무관하게 유효하다.
    //
    // 웹에는 '플래너' 금지 단언은 있었지만(lib/ai/__tests__/amoraVoiceReach.test.ts)
    // '파트너'는 막는 곳이 없었다.
    for (const file of [
      "src/app/(auth)/login/page.tsx",
      "src/app/demo/login/page.tsx",
      "src/components/price/PriceAmoraBridge.tsx",
    ]) {
      const source = read(file);
      for (const banned of ["AI 파트너 아모라", "파트너 아모라", "아모라 파트너"]) {
        expect(source, `${file}에 "${banned}"가 남아 있습니다`).not.toContain(
          banned,
        );
      }
    }
  });
});
