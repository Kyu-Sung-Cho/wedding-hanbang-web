import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 루트(`/`)는 앱의 문이다 — 세션이 있으면 라운지로, 없으면 랜딩으로.
 *
 * ## 무엇을 지키는가
 *
 * **세션을 보고 갈린다**는 것 하나다. 목적지 두 개가 다 맞아야 한다.
 *
 * 이 판정이 무너지는 방법이 둘 있고, 둘 다 조용하다.
 *
 * 1. **엣지 리다이렉트가 되살아난다.** `next.config.ts`에 `source: "/"`가 생기면
 *    page.tsx의 세션 판정은 영영 돌지 않는다. 엣지는 세션을 볼 수 없으므로 로그인한
 *    사람도 매번 랜딩을 지나 다시 앱으로 들어가야 한다 — 2026-08-20에 실제로 그랬고,
 *    그 왕복이 그때 루트를 바꾼 이유였다. 랜딩을 정문으로 되돌린 지금도 이건 막는다.
 * 2. **한쪽 목적지만 고친다.** 판정이 미들웨어와 page.tsx 두 곳에 있어서, 한 곳만
 *    고치면 미들웨어가 도는 환경과 안 도는 환경의 결론이 갈린다.
 *
 * ## 2026-08-27 — 로그아웃 목적지가 `/login`에서 `/landing`으로
 *
 * 파운더 결정이다. 8-20에는 로그아웃이면 로그인 화면이었다. 이유는 "앱의 첫 화면이
 * 로그인인데 웹만 소개 페이지면 제품의 약속이 웹에서만 거짓"이라는 것이었는데,
 * 그 규칙이 웹의 일과 어긋났다 — 제품 계약(CLAUDE.md)은 **웹이 유입·설명을 담당**한다고
 * 정한다. 유입·설명이 일인 표면의 정문이 로그인 벽이면 그 일을 할 수가 없다.
 *
 * 8-20이 막으려던 왕복은 여기서 세션을 보고 갈라 그대로 막는다.
 *
 * ## 무엇을 지키지 않는가
 *
 * 랜딩의 내용은 지키지 않는다 — `landing/__tests__/`가 한다. 여기서는 **도착지가
 * 어디인가**만 본다. canonical과 sitemap이 `/landing`을 가리키는 것도 함께 고정한다.
 * 루트는 307로 거기 보내므로 같은 내용이 두 주소에 생기지 않는다.
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
    // `source: "/"`인 리다이렉트가 있으면 page.tsx는 절대 돌지 않는다.
    //
    // 처음에는 뒤에 쉼표가 오는 형태만 봤다. 그래서 `source`를 객체의 **마지막 키**로
    // 쉼표 없이 쓰면 8/8 통과하면서 엣지 리다이렉트가 되살아났다(2026-08-21 변이로 확인).
    // 쉼표·닫는 중괄호·줄바꿈 어느 것이 뒤에 와도 잡는다.
    expect(config).not.toMatch(/source:\s*"\/"\s*(?=[,}\r\n])/u);
  });

  it("세션이 있으면 라운지로, 없으면 랜딩으로 보낸다", () => {
    const page = read("src/app/page.tsx");
    expect(page).toContain("supabase.auth.getUser()");
    expect(page).toMatch(/signedIn \? "\/wedding\/lounge" : "\/landing"/u);
  });

  it("미들웨어와 폴백이 같은 결론을 낸다", () => {
    // 판정이 두 곳에 있다. 한 곳만 고치면 미들웨어가 도는 환경과 안 도는 환경의
    // 결론이 갈리고, 갈린 날 사람이 두 화면 사이에 갇힌다.
    // 문자열 비교가 아니라 **같은 두 목적지를 같은 조건으로 고르는지**를 본다.
    const middleware = read("src/lib/supabase/middleware.ts");
    expect(middleware).toMatch(
      /signedIn \? "\/wedding\/lounge" : "\/landing"/u,
    );
    // 로그아웃을 로그인 화면으로 보내던 경로가 어느 쪽에도 남으면 안 된다.
    for (const [name, source] of [
      ["page.tsx", read("src/app/page.tsx")],
      ["middleware.ts", middleware],
    ] as const) {
      expect(source, `${name}에 옛 로그아웃 목적지가 남아 있습니다`).not.toMatch(
        /signedIn \? "\/wedding\/lounge" : "\/login"/u,
      );
    }
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
