/**
 * `www.hanbang.ai` 는 `hanbang.ai` 로 간다 — 경로와 쿼리를 들고.
 *
 * ## 왜 필요한가
 *
 * 둘은 **서로 다른 오리진**이다. 인증 쿠키에 `domain` 을 주지 않으므로
 * (`lib/supabase/server.ts`) 세션이 호스트별로 갈린다 — www 에서 로그인한 사람이
 * apex 로 가면 로그아웃 상태다. 게다가 비밀번호 재설정 메일은 호스트와 무관하게 늘
 * apex 를 가리키므로(`api/auth/forgot-password` 의
 * `NEXT_PUBLIC_SITE_URL || "https://hanbang.ai"`), www 로 들어온 사람은 재설정 뒤
 * **세션이 없는 호스트**에 떨어진다.
 *
 * 2026-08-29 라이브 실측(수정 전):
 *
 *     https://hanbang.ai/       → 307 → hanbang.ai/landing        (맞다)
 *     https://www.hanbang.ai/   → 307 → www.hanbang.ai/landing    (www 에 머문다)
 *
 * ## 소스를 읽지 않고 **돌린다**
 *
 * 처음에는 `next.config.ts` 를 정규식으로 읽는 테스트를 썼다. 두 번 데였다 —
 * 주석 제거기가 `"https://"` 의 `//` 를 잘라 검사가 엉뚱하게 실패했고, 그러는 동안
 * `next.config.ts` 의 catch-all 이 **앱 링크 두 파일을 삼키는** 것을 기존 가드
 * (`lib/appLinks/__tests__/appLinkIdentity.test.ts`)가 잡아냈다. 지금은 미들웨어
 * (`src/proxy.ts`)에 있고, 이 파일은 그 함수를 **실제로 호출해 응답을 본다.**
 */
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";

async function hit(url: string) {
  const request = new NextRequest(new Request(url, { method: "GET" }));
  return proxy(request);
}

const location = (response: Response | null | undefined) =>
  response?.headers.get("location") ?? null;

describe("www 는 apex 로 간다", () => {
  it("루트가 apex 로 간다", async () => {
    const response = await hit("https://www.hanbang.ai/");
    expect(response?.status).toBe(308);
    expect(location(response)).toBe("https://hanbang.ai/");
  });

  it("경로를 그대로 들고 간다", async () => {
    // 홈으로 떨어뜨리면 www 로 공유된 모든 깊은 링크가 끊긴다.
    const response = await hit("https://www.hanbang.ai/wedding/community/post/12");
    expect(location(response)).toBe("https://hanbang.ai/wedding/community/post/12");
  });

  it("쿼리를 그대로 들고 간다", async () => {
    // 유입 표식이 여기서 끊기면 어느 캠페인에서 왔는지 사라진다.
    const response = await hit("https://www.hanbang.ai/landing?utm_source=kakao&utm_medium=share");
    expect(location(response)).toBe(
      "https://hanbang.ai/landing?utm_source=kakao&utm_medium=share",
    );
  });

  it("영구 이동이다", async () => {
    // 302 면 검색엔진이 두 주소를 계속 따로 본다.
    expect((await hit("https://www.hanbang.ai/about"))?.status).toBe(308);
  });

  it("앱 링크 두 파일은 비켜 간다", async () => {
    // Apple·Android 는 이 파일을 가져올 때 리다이렉트를 따라가지 않는다.
    for (const path of [
      "/.well-known/apple-app-site-association",
      "/.well-known/assetlinks.json",
    ]) {
      const response = await hit(`https://www.hanbang.ai${path}`);
      expect(location(response), `${path} 가 리다이렉트됐다`).not.toBe(
        `https://hanbang.ai${path}`,
      );
    }
  });

  it("apex·프리뷰·로컬은 건드리지 않는다", async () => {
    for (const url of [
      "https://hanbang.ai/landing",
      "https://wedding-hanbang-web.vercel.app/landing",
      "http://localhost:3000/landing",
      // `www.` 로 **시작하지만** 우리 도메인이 아닌 것. 접두사로 무르게 잡으면
      // 여기까지 apex 로 끌려간다 — 변형 검사가 그 구멍을 잡아냈다.
      "https://www.hanbang.co.kr/landing",
      "https://www.example.com/landing",
      "http://www.localhost:3000/landing",
    ]) {
      const response = await hit(url);
      const target = location(response);
      // null 이면 리다이렉트가 없었다는 뜻이고, 그게 정상이다.
      if (target !== null) {
        expect(target, `${url} 가 apex 로 옮겨졌다`).not.toMatch(/^https:\/\/hanbang\.ai\//u);
      }
    }
  });
});
