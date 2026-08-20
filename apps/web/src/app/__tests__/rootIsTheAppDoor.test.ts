import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 루트(`/`)는 앱의 문이다 — 세션이 있으면 앱으로, 없으면 로그인으로.
 *
 * ## 무엇을 지키는가
 *
 * 2026-08-20 파운더 결정 이전에는 `next.config.ts`가 엣지에서 `/` → `/landing`으로
 * 보냈다. 그러면 두 가지가 깨진다. (1) "앱을 처음 열면 로그인이 뜬다"는 제품의 약속이
 * 웹에서만 거짓이 되고, (2) 엣지는 세션을 볼 수 없어 이미 로그인한 사람도 매번 소개
 * 페이지를 지나 다시 앱으로 들어가야 한다.
 *
 * 이 테스트가 막는 것은 그 리다이렉트가 **조용히 되살아나는 것**이다. 엣지에서 `/`를
 * 가로채는 순간 page.tsx의 세션 판정은 영영 돌지 않고, 아무 테스트도 깨지지 않은 채
 * 로그인한 사람이 소개 페이지로 떨어진다.
 *
 * ## 무엇을 지키지 않는가
 *
 * 랜딩 자체는 그대로다. sitemap과 canonical이 처음부터 `/landing`을 가리키므로
 * 검색 유입은 루트가 아니라 랜딩으로 들어온다 — 그 사실도 함께 고정한다.
 *
 * ## page.tsx는 폴백이지 정본이 아니다
 *
 * 실제 판정은 **미들웨어**(`lib/supabase/middleware.ts`의 `redirectAppDoor`)가 한다.
 * 거기서 해야 진짜 307이 나가기 때문이다 — 서버 컴포넌트의 `redirect()`는 세션을
 * 물어보는 사이 스트리밍이 시작돼서 `200 + HTML`로 나가고, 리다이렉트가 클라이언트로
 * 밀린다. 그 동작은 `lib/supabase/middleware.test.ts`가 상태 코드로 지킨다.
 *
 * 아래 page.tsx 단언들은 **미들웨어가 돌지 않는 환경**(Supabase 설정 누락 등)의 폴백을
 * 지킨다. 중복으로 보인다는 이유로 지우면, 그 환경에서 루트가 다시 폴백 문서가 된다.
 */

const WEB_ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(WEB_ROOT, relativePath), "utf8");
}

describe("루트는 앱의 문이다", () => {
  it("엣지가 루트를 가로채지 않는다", () => {
    const config = read("next.config.ts");
    // `source: "/"`로 시작하는 리다이렉트가 있으면 page.tsx는 절대 돌지 않는다.
    expect(config).not.toMatch(/source:\s*"\/"\s*,/u);
  });

  it("세션이 있으면 앱으로, 없으면 로그인으로 보낸다", () => {
    const page = read("src/app/page.tsx");
    expect(page).toContain("supabase.auth.getUser()");
    expect(page).toMatch(/signedIn \? "\/wedding\/lounge" : "\/login"/u);
    // 랜딩으로 되돌려 보내는 경로가 남아 있으면 안 된다.
    expect(page).not.toContain('"/landing"');
  });

  it("유입 표식을 목적지까지 들고 간다", () => {
    // 루트에서 쿼리가 끊기면 어느 캠페인에서 왔는지가 로그인 직전에 사라진다.
    const page = read("src/app/page.tsx");
    expect(page).toMatch(/\$\{destination\}\?\$\{query\}/u);
  });

  it("세션을 못 물어봐도 화면이 죽지 않는다", () => {
    // 설정 누락·네트워크 실패로 여기서 던지면 도메인 루트가 통째로 오류가 된다.
    const page = read("src/app/page.tsx");
    expect(page).toMatch(/catch\s*\{\s*signedIn = false;/u);
  });

  it("검색 유입은 여전히 랜딩으로 들어온다", () => {
    // 루트를 로그인으로 바꾸면서 색인 자리를 잃지 않았다는 근거다.
    expect(read("src/app/sitemap.ts")).toContain("${BASE_URL}/landing");
    expect(read("src/app/landing/page.tsx")).toContain('canonical: "/landing"');
  });

  it("정책 화면의 '홈으로'는 로그인 벽을 만나지 않는다", () => {
    // 약관·개인정보·AI 고지는 로그인 없이 읽을 수 있어야 하는 문서다. 거기서
    // "홈으로"가 로그인으로 떨어지면 읽던 사람이 벽 앞에 선다.
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
});

describe("첫 화면이 된 로그인의 호칭", () => {
  it("아모라를 '파트너'로 소개하지 않는다", () => {
    // 제품 계약: 아모라의 정본 호칭은 "결혼 준비 동반자"이고, 이 제품에서 "파트너"는
    // **배우자될 사람**을 가리킨다(wedding/CLAUDE.md). 루트가 로그인으로 바뀌면서
    // 이 화면이 제품의 첫인상이 됐는데, 거기서 아모라를 파트너라고 부르고 있었다.
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
