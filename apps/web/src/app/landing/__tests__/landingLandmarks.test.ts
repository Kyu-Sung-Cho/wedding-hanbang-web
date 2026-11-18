// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import LandingPage from "../page";
import { everyLandingComponent, rendered, renderedSections } from "./landingSource";

vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

/**
 * 랜딩의 랜드마크와 장식이 보조기기에 올바르게 보이는지.
 *
 * ## 왜 생겼나
 *
 * 2026-08-27 실측에서 **섹션 랜드마크 두 개에 이름이 없었다.** 스크린리더 랜드마크 목록에서
 * 그 둘이 "section" 으로만 떴다. 목록으로 건너뛰는 사람에게는 그 자리가 어디인지 알 방법이 없다.
 *
 * ## 2026-11-17 — 시작 화면 한 장
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩은 시작 화면 한 장과
 * 조용한 바닥글이 됐다. 섹션 여럿·내비 앵커·붙어 따라오는 머리줄이 없어져, 그것을 지키던
 * 단언(앵커가 섹션을 가리킨다 · 붙는 머리줄 위에 overflow 금지 · 그림 버튼 숨김)은 대상이 없어
 * 지웠다. 남은 구조: 이름 있는 섹션, 하나뿐인 h1, 본문 바로가기, 장식의 숨김.
 *
 * 색 대비와 실제 포커스 표시는 픽셀을 봐야 알 수 있어 여기서 다루지 않는다.
 */

const components = everyLandingComponent();

function landingDocument(): Document {
  return new DOMParser().parseFromString(renderToStaticMarkup(createElement(LandingPage)), "text/html");
}

/** `<section` 을 여는 자리마다 그 여는 태그 전체를 뽑는다. */
function openingSections(source: string): string[] {
  const out: string[] = [];
  const re = /<section\b/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    let depth = 0;
    let i = m.index;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    out.push(source.slice(m.index, i + 1));
  }
  return out;
}

describe("랜딩 랜드마크", () => {
  it("모든 <section> 에 이름이 있다", () => {
    const nameless: string[] = [];
    for (const [file, source] of components) {
      for (const tag of openingSections(source)) {
        if (!/aria-labelledby=|aria-label=/u.test(tag)) {
          nameless.push(`${file}: ${tag.replace(/\s+/gu, " ").slice(0, 70)}`);
        }
      }
    }
    expect(nameless, "이름 없는 섹션 랜드마크").toEqual([]);

    // 렌더 결과로도 본다 — 소스 밖에서 섹션이 생기면 위 검사가 못 본다.
    const doc = landingDocument();
    const sections = [...doc.querySelectorAll("section")];
    expect(sections.length, "섹션을 하나도 못 찾았다").toBeGreaterThanOrEqual(2);
    for (const section of sections) {
      const id = section.getAttribute("aria-labelledby");
      expect(id || section.getAttribute("aria-label"), "이름 없는 섹션").toBeTruthy();
      if (id) expect(doc.getElementById(id)?.textContent?.trim(), `${id} 가 가리키는 제목이 비었다`).toBeTruthy();
    }
  });

  it("aria-labelledby 가 같은 파일 안의 실재하는 id 를 가리킨다", () => {
    // 끊긴 참조는 이름이 없는 것과 같은데, 화면은 멀쩡해 보인다.
    const dangling: string[] = [];
    for (const [file, source] of components) {
      for (const [, target] of source.matchAll(/aria-labelledby="([^"{}]+)"/gu)) {
        if (!source.includes(`id="${target}"`)) dangling.push(`${file}: ${target}`);
      }
    }
    expect(dangling, "가리키는 id 가 없는 aria-labelledby").toEqual([]);
  });

  it("머리줄·본문·바닥글 랜드마크가 하나씩 있다", () => {
    const doc = landingDocument();
    expect(doc.querySelectorAll("header")).toHaveLength(1);
    expect(doc.querySelectorAll("main")).toHaveLength(1);
    expect(doc.querySelectorAll("footer")).toHaveLength(1);
    // 바닥글의 링크 묶음은 묶음마다 이름 있는 내비다.
    const navs = [...doc.querySelectorAll("footer nav")];
    expect(navs.length).toBeGreaterThanOrEqual(3);
    for (const nav of navs) expect(nav.getAttribute("aria-label"), "이름 없는 내비").toBeTruthy();
  });

  it("장식 그림은 보조기기에서 숨긴다", () => {
    // 보케 사진과 오브는 읽어 줄 내용이 없다. 오브는 바로 위에 아모라 이름이 적혀 있다.
    const doc = landingDocument();
    for (const svg of doc.querySelectorAll("svg")) {
      const named = svg.getAttribute("role") === "img" && svg.getAttribute("aria-label");
      expect(svg.getAttribute("aria-hidden") === "true" || Boolean(named), "숨기지도 이름 주지도 않은 SVG").toBe(true);
    }
    for (const img of doc.querySelectorAll("img")) {
      expect(img.getAttribute("alt"), "대체 글이 없는 그림").not.toBeNull();
    }
    expect(doc.querySelector("main svg")?.getAttribute("aria-hidden"), "오브가 이름을 한 번 더 읽는다").toBe("true");
    expect(doc.querySelector("main img")?.getAttribute("alt"), "장식 사진이 읽힌다").toBe("");
  });

  it("페이지에 h1 이 하나뿐이고, 시작 화면이 갖는다", () => {
    const h1Owners = components.filter(([, source]) => /<h1\b/u.test(source)).map(([file]) => file);
    expect(h1Owners, "h1 을 가진 컴포넌트").toEqual(["StartScreen.tsx"]);
    const doc = landingDocument();
    expect(doc.querySelectorAll("h1")).toHaveLength(1);
    // 바닥글 제목은 h2 다 — 문서 개요가 두 갈래로 갈리지 않는다.
    expect(doc.querySelectorAll("footer h1"), "바닥글에 h1 이 있다").toHaveLength(0);
    expect(doc.querySelectorAll("footer h2").length, "바닥글 제목이 h2 가 아니다").toBeGreaterThanOrEqual(1);
  });

  it("본문 바로가기가 <main> 을 가리킨다", () => {
    // 키보드 첫 Tab 이 닿는 곳이다. 가리키는 id 가 없으면 아무 데도 안 간다.
    const page = rendered("src/app/landing/page.tsx");
    const skip = rendered("src/components/landing/redesign/LandingSkipLink.tsx");
    expect(skip).toContain('href="#main-content"');
    expect(page).toContain('id="main-content"');
    expect(page).toContain("tabIndex={-1}");
    expect(page).toContain("<LandingSkipLink />");
    // 링크가 먼저 와야 Tab 순서에서 첫 번째가 된다 — 로그인 알약보다도 앞이다.
    expect(page.indexOf("<LandingSkipLink />")).toBeLessThan(page.indexOf("<LandingHeader"));
    expect(renderedSections()).toEqual(["StartScreen"]);
  });

  it("래퍼가 시작 화면을 자르지 않는다", () => {
    // 자르는 일은 시작 화면이 자기 상자에서 한다. 래퍼에 overflow 를 걸면 로그인 알약의 초점
    // 고리가 잘리고, 언젠가 붙는 머리줄이 생기면 조용히 죽는다(2026-08-29 실측 사고).
    const page = rendered("src/app/landing/page.tsx");
    const at = page.indexOf("<div");
    expect(at, "랜딩 래퍼 <div> 를 못 찾았다").toBeGreaterThan(-1);
    const wrapper = page.slice(at, page.indexOf(">", at));
    expect(wrapper).not.toMatch(/overflow-(hidden|clip|auto|scroll|x-hidden|y-hidden)/u);
    expect(rendered("src/components/landing/redesign/StartScreen.tsx"), "시작 화면이 자기 상자에서 자르지 않는다")
      .toMatch(/overflow-hidden/u);
  });
});
