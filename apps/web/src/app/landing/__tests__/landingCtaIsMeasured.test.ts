import { describe, expect, it } from "vitest";

import { everyLandingComponent, rendered } from "./landingSource";

/**
 * 랜딩의 행동 버튼이 전부 계측된다.
 *
 * ## 왜 생겼나
 *
 * 2026-08-28까지 계측이 **헤더 버튼 하나뿐**이었고, 그 버튼은
 * `hidden … sm:inline-flex` 라 데스크톱에서만 보인다 — **모바일에서는 랜딩 클릭
 * 이벤트가 0건**이었다. 히어로와 마무리의 진짜 1차 CTA 는 무계측이었다.
 *
 * 그 상태로 배포하면 **아무것도 배울 수 없다.** 이 랜딩의 후크는 세 번째 안이고
 * 앞의 둘은 물렸다. 이번 것이 맞는지는 사람이 들어와 봐야 아는데, 숫자가 없으면
 * 다음 판도 감이 된다.
 *
 * ## 무엇을 지키나
 *
 * 랜딩이 **다른 화면으로 보내는 링크**는 `TrackedLandingLink` 로 그린다.
 * 같은 페이지 안 앵커(`#now`)와 정책 링크는 제외 — 퍼널이 아니다.
 */

/**
 * 퍼널 목적지.
 *
 * 랜딩의 **모든** 링크를 요구하면 워드마크·내비 앵커·정책 링크까지 걸려 검사가
 * 시끄러워진다. 시끄러운 검사는 결국 꺼진다. 지켜야 하는 것은 둘뿐이다 —
 * 1차 행동(`/wedding-code`)과 계정 전환(`/login?mode=signup`).
 */
const FUNNEL_HREFS = ["/wedding-code", "/login?mode=signup"];

describe("랜딩 행동 버튼은 계측된다", () => {
  it("퍼널 목적지로 보내는 링크를 <Link> 로 직접 그리지 않는다", () => {
    // `<Link href="/wedding-code">` 처럼 직접 그리면 클릭이 어디서도 안 세어진다.
    // 푸터는 목록이라 제외한다 — 거기 링크는 탐색이지 행동 버튼이 아니다.
    const offenders: string[] = [];
    for (const [file, source] of everyLandingComponent()) {
      if (file === "LandingFooter.tsx" || file === "MobileLandingMenu.tsx") continue;
      for (const m of source.matchAll(/<Link[\s>][\s\S]{0,240}?href="([^"]+)"/gu)) {
        if (FUNNEL_HREFS.includes(m[1])) offenders.push(`${file}: <Link href="${m[1]}">`);
      }
    }
    expect(
      offenders,
      "퍼널 버튼은 TrackedLandingLink 로 그려야 클릭이 세어집니다",
    ).toEqual([]);
  });

  it("카피에서 오는 퍼널 링크도 계측된다", () => {
    // href 가 `{hero.primary.href}` 처럼 표현식이면 값을 소스에서 알 수 없다.
    // 대신 **그 값을 그리는 컴포넌트가 계측 컴포넌트를 쓰는지**를 본다.
    for (const [file, key] of [
      ["TransformationHero.tsx", "hero.primary.href"],
      ["ClosingAction.tsx", "closing.primary.href"],
      ["ClosingAction.tsx", "closing.secondary.href"],
    ] as const) {
      const source = everyLandingComponent().find(([f]) => f === file)?.[1] ?? "";
      const at = source.indexOf(key);
      expect(at, `${file} 가 ${key} 를 그리지 않는다`).toBeGreaterThan(0);
      // 그 href 앞 200자 안에 여는 태그가 있다.
      const opening = source.slice(Math.max(0, at - 200), at);
      expect(
        opening,
        `${file} 의 ${key} 가 계측되지 않는다`,
      ).toContain("TrackedLandingLink");
    }
  });

  it("계측하는 자리 이름이 실제로 쓰인다", () => {
    // 목록에만 있고 아무도 안 쓰는 이름이 남으면, 그 자리가 계측되는 줄 착각한다.
    const tracked = rendered(
      "src/components/landing/redesign/TrackedLandingLink.tsx",
    );
    const declared = [...tracked.matchAll(/\|\s*"(landing_[a-z_]+)"/gu)].map((m) => m[1]);
    expect(declared.length, "자리 이름을 못 찾았다").toBeGreaterThanOrEqual(5);

    // **선언한 파일 자신은 뺀다.** 안 빼면 선언이 곧 사용으로 세어져,
    // 아무도 안 쓰는 이름을 넣어도 통과한다(변형으로 확인했다).
    const used = everyLandingComponent()
      .filter(([file]) => file !== "TrackedLandingLink.tsx")
      .map(([, source]) => source)
      .join("\n");
    const unused = declared.filter((name) => !used.includes(`"${name}"`));
    expect(unused, "선언만 하고 아무도 안 쓰는 자리 이름").toEqual([]);
  });

  it("1차 CTA 가 첫 화면과 마무리 양쪽에 계측된다", () => {
    // 이 둘이 퍼널의 처음과 끝이다. 하나만 있으면 어디서 새는지 모른다.
    const hero = rendered("src/components/landing/redesign/TransformationHero.tsx");
    const closing = rendered("src/components/landing/redesign/ClosingAction.tsx");
    expect(hero, "히어로 1차 CTA 가 무계측이다").toContain("landing_hero_primary");
    expect(closing, "마무리 1차 CTA 가 무계측이다").toContain("landing_closing_primary");
  });

  it("계측에 사용자 입력이나 화면 문구를 싣지 않는다", () => {
    // 이 저장소에서 클릭 흔적이 첨부 파일명·게시글 제목·닉네임을 실어 나른 적이 있다.
    // `source` 는 고정 문자열이어야 하고, 그 밖의 payload 를 붙이면 안 된다.
    const tracked = rendered(
      "src/components/landing/redesign/TrackedLandingLink.tsx",
    );
    expect(tracked, "captureEvent 가 { source } 외의 것을 싣는다").toMatch(
      /captureEvent\(\s*"landing_cta_click"\s*,\s*\{\s*source\s*\}\s*\)/u,
    );
    // ⚠️ 이 검사는 **두 번 틀려 있었다.**
    //
    // 처음엔 이렇게 쓰여 있었다:
    //   new RegExp(`captureEvent[\s\S]{0,120}${leak.replace(".", "\.")}`, "u")
    // 템플릿 리터럴이 `\s`→`s`, `\S`→`S`, `\.`→`.` 로 **조리해서** 실제 패턴은
    // `captureEvent[sS]{0,120}document.` 였고, `.not.toMatch` 라 **무조건 통과**했다.
    // (`\b` 가 백스페이스로 박히던 사고와 같은 병인데, 제어문자를 안 남겨 스캐너가 못 본다.)
    //
    // 그걸 String.raw 로 되살리자 **오탐**이 나왔다 — `{0,120}` 은 바이트 창이라
    // 호출 **뒤** 60자에 있는 JSX 본문 `{children}` 까지 삼킨다. 그건 계측에 실리는
    // 것이 아니라 그냥 렌더되는 자식이다. 양쪽으로 틀렸으면 기계가 틀린 것이다.
    //
    // 그래서 창을 재지 않고 **호출의 인자만** 꺼내 본다. 정규식 이스케이프가 아예
    // 필요 없어져서 위의 조리 사고가 다시 날 자리도 사라진다.
    const calls = [...tracked.matchAll(/captureEvent\(([\s\S]*?)\)/gu)].map((m) => m[1]);
    expect(calls.length, "captureEvent 호출을 못 찾았다 — 이 검사가 아무것도 안 보고 있다").toBeGreaterThan(0);
    for (const args of calls) {
      for (const leak of ["window.location", "document.", "children", "label", "textContent"]) {
        expect(args, `계측 인자가 ${leak} 를 싣는다`).not.toContain(leak);
      }
    }
  });
});
