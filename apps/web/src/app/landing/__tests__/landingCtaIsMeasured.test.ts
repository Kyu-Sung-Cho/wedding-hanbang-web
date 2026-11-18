import { describe, expect, it } from "vitest";
import { LANDING_CTA_SOURCES } from "@/lib/landingAnalytics";

import { everyLandingComponent, rendered } from "./landingSource";

/**
 * 랜딩의 행동 버튼이 전부 계측된다.
 *
 * ## 왜 생겼나
 *
 * 2026-08-28까지 계측이 **헤더 버튼 하나뿐**이었고, 그 버튼은 데스크톱에서만 보였다 —
 * 모바일에서는 랜딩 클릭 이벤트가 0건이었다. 숫자가 없으면 다음 판도 감이 된다.
 *
 * ## 무엇을 지키나
 *
 * 랜딩이 **다른 화면으로 보내는 행동**은 `TrackedLandingLink` 로 그린다. 바닥글의 링크
 * 목록과 정책 링크는 제외 — 퍼널이 아니라 탐색이다.
 *
 * ## 2026-11-17 — 시작 화면 한 장
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩은 시작 화면 한
 * 장이다. 행동은 셋뿐이다: 시작하기(`landing_hero_primary`), 예시 커플로 둘러보기
 * (`landing_hero_secondary`), 오른쪽 위 로그인(`landing_header`). 마무리 섹션이 없어져
 * "첫 화면과 마무리 양쪽" 단언은 첫 화면 하나로 줄었다.
 *
 * ## 2026-11-18 — 마무리가 돌아왔다
 *
 * 파운더 요청(원문: "랜딩도 만들어야지 비슷하게", 범위 "전체다")으로 시작 화면 아래 섹션과 마무리가
 * 생겼다. 마무리의 두 행동은 첫 화면과 같은 목적지로 가되 자기 자리 이름으로 센다
 * (`landing_closing_primary` · `landing_closing_secondary`) — 같은 이름을 쓰면 어디서 눌렀는지 모른다.
 */

/** 퍼널 목적지. 이 주소로 보내는 링크는 반드시 계측 컴포넌트로 그린다. */
const FUNNEL_HREFS = ["/wedding/chat", "/example", "/wedding-code", "/login?mode=signup"];

describe("랜딩 행동 버튼은 계측된다", () => {
  it("퍼널 목적지로 보내는 링크를 <Link>·<Button> 으로 직접 그리지 않는다", () => {
    // `<Link href="/wedding/chat">` 나 공유 `Button` 에 href 를 바로 주면 클릭이 어디서도
    // 안 세어진다. 바닥글은 목록이라 제외한다 — 거기 링크는 탐색이지 행동 버튼이 아니다.
    const offenders: string[] = [];
    for (const [file, source] of everyLandingComponent()) {
      if (file === "LandingFooter.tsx" || file === "TrackedLandingLink.tsx") continue;
      for (const m of source.matchAll(/<(Link|Button|a)[\s>][\s\S]{0,240}?href="([^"]+)"/gu)) {
        if (FUNNEL_HREFS.includes(m[2])) offenders.push(`${file}: <${m[1]} href="${m[2]}">`);
      }
    }
    expect(offenders, "퍼널 버튼은 TrackedLandingLink 로 그려야 클릭이 세어집니다").toEqual([]);
  });

  it("카피에서 오는 행동 링크가 계측 컴포넌트로 그려진다", () => {
    // href 가 `{start.primary.href}` 처럼 표현식이면 값을 소스에서 알 수 없다.
    // 대신 **그 값을 그리는 여는 태그가 계측 컴포넌트인지**를 본다.
    for (const [file, key, sourceName] of [
      ["StartScreen.tsx", "start.primary.href", "landing_hero_primary"],
      ["StartScreen.tsx", "start.example.href", "landing_hero_secondary"],
      ["LandingAccountActions.tsx", "logIn.href", "landing_header"],
      ["ClosingSection.tsx", "start.primary.href", "landing_closing_primary"],
      ["ClosingSection.tsx", "start.example.href", "landing_closing_secondary"],
    ] as const) {
      const source = everyLandingComponent().find(([f]) => f === file)?.[1] ?? "";
      const at = source.indexOf(key);
      expect(at, `${file} 가 ${key} 를 그리지 않는다`).toBeGreaterThan(0);
      const opening = source.slice(source.lastIndexOf("<", at), at);
      expect(opening, `${file} 의 ${key} 가 계측되지 않는다`).toMatch(/^<TrackedLandingLink\b/u);
      // 같은 여는 태그 안에 자리 이름이 있다 — 다른 버튼의 이름을 빌려 쓰지 않는다.
      const tagEnd = source.indexOf(">", at);
      expect(source.slice(source.lastIndexOf("<", at), tagEnd), `${key} 의 자리 이름이 다르다`)
        .toContain(`source="${sourceName}"`);
    }
  });

  it("계측하는 자리 이름이 실제로 쓰인다", () => {
    // 목록에만 있고 아무도 안 쓰는 이름이 남으면, 그 자리가 계측되는 줄 착각한다.
    const declared = [...LANDING_CTA_SOURCES] as string[];
    expect(declared.length, "자리 이름을 못 찾았다").toBeGreaterThanOrEqual(3);

    // **계측 컴포넌트 자신은 뺀다.** 안 빼면 선언·전달이 곧 사용으로 세어진다.
    const used = everyLandingComponent()
      .filter(([file]) => file !== "TrackedLandingLink.tsx")
      .map(([, source]) => source)
      .join("\n");
    const unused = declared.filter((name) => !used.includes(`"${name}"`));
    expect(unused, "선언만 하고 아무도 안 쓰는 자리 이름").toEqual([]);
  });

  it("첫 화면의 두 행동과 로그인이 각자 자리 이름으로 계측된다", () => {
    // 시작하기와 예시 둘러보기가 같은 이름을 쓰면 어느 쪽이 눌렸는지 모른다.
    const start = rendered("src/components/landing/redesign/StartScreen.tsx");
    expect(start, "시작하기가 무계측이다").toContain('source="landing_hero_primary"');
    expect(start, "예시 커플로 둘러보기가 무계측이다").toContain('source="landing_hero_secondary"');
    expect(rendered("src/components/landing/redesign/LandingAccountActions.tsx"), "로그인이 무계측이다")
      .toContain('source="landing_header"');
  });

  it("마무리의 두 행동은 첫 화면과 다른 자기 자리 이름으로 계측된다", () => {
    // 같은 목적지라도 첫 화면에서 눌렀는지 페이지 끝에서 눌렀는지가 다음 판의 근거다.
    const closing = rendered("src/components/landing/redesign/ClosingSection.tsx");
    expect(closing, "마무리 시작하기가 무계측이다").toContain('source="landing_closing_primary"');
    expect(closing, "마무리 예시 둘러보기가 무계측이다").toContain('source="landing_closing_secondary"');
    expect(closing, "마무리가 첫 화면의 자리 이름을 빌려 쓴다").not.toMatch(/source="landing_hero_/u);
    // 퍼널 목적지(로그인이 필요한 아모라)는 첫 화면처럼 미리 받지 않는다.
    const primaryTag = closing.slice(closing.lastIndexOf("<", closing.indexOf("start.primary.href")), closing.indexOf(">", closing.indexOf("start.primary.href")));
    expect(primaryTag, "마무리 시작하기가 보호 경로를 미리 받는다").toContain("prefetch={false}");
  });

  it("계측에 사용자 입력이나 화면 문구를 싣지 않는다", () => {
    // 이 저장소에서 클릭 흔적이 첨부 파일명·게시글 제목·닉네임을 실어 나른 적이 있다.
    // `source` 는 고정 문자열이어야 하고, 그 밖의 payload 를 붙이면 안 된다.
    const tracked = rendered("src/components/landing/redesign/TrackedLandingLink.tsx");
    expect(tracked, "captureEvent 가 { source } 외의 것을 싣는다").toMatch(
      /captureEvent\(\s*"landing_cta_click"\s*,\s*\{\s*source\s*\}\s*\)/u,
    );
    // 창(window)을 재지 않고 **호출의 인자만** 꺼내 본다. 바이트 창은 호출 뒤에 렌더되는
    // `{children}` 까지 삼켜 오탐을 냈고, 템플릿 리터럴 안의 정규식 이스케이프가 조리돼
    // 무조건 통과한 적도 있다.
    const calls = [...tracked.matchAll(/captureEvent\(([\s\S]*?)\)/gu)].map((m) => m[1]);
    expect(calls.length, "captureEvent 호출을 못 찾았다 — 이 검사가 아무것도 안 보고 있다").toBeGreaterThan(0);
    for (const args of calls) {
      for (const leak of ["window.location", "document.", "children", "label", "textContent", "href"]) {
        expect(args, `계측 인자가 ${leak} 를 싣는다`).not.toContain(leak);
      }
    }
  });
});
