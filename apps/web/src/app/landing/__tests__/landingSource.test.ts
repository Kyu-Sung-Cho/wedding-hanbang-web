import { describe, expect, it } from "vitest";

import {
  contentBlock,
  everyLandingComponent,
  renderedSections,
  stripComments,
} from "./landingSource";

/**
 * 주석 제거기 자체를 검사한다.
 *
 * 랜딩 가드 대부분이 "이 문자열이 소스에 있나"로 묻는다. 그러면 **주석에 적힌 글자가
 * 화면 대신 대답한다.** 2026-08-27 적대적 검증에서 변형 215개 중 8개가 정확히 이
 * 갈래로 빠져나갔다 — 아래 `사례` 들이 그때 실제로 통과했던 우회다.
 *
 * 제거기가 조용히 약해지면 그 위에 선 가드 수십 개가 한꺼번에 빈 통과가 된다.
 * 그래서 여기서는 **우회를 직접 넣어 보고** 지워지는지 본다.
 */
describe("stripComments", () => {
  it("줄 끝 주석을 지운다", () => {
    // 실제로 빠져나간 변형: 화면에서 지운 문장을 줄 끝 주석으로만 남겼다.
    const src = `body: "…보여드려요.", // 웨딩한방은 둘이 어디서 갈리는지부터 봅니다.`;
    expect(stripComments(src)).not.toContain("갈리는지부터 봅니다");
    expect(stripComments(src)).toContain("보여드려요.");
  });

  it("줄 처음 주석을 지운다", () => {
    expect(stripComments("  // 여기는 설명\nreal();")).not.toContain("여기는 설명");
  });

  it("블록 주석 안의 마크업을 지운다", () => {
    // 실제로 빠져나간 변형: 주석에 헤드라인 예시를 넣어 대조를 통과시켰다.
    const src = `/* <h2>{scenes.title}</h2> */\n<h2>여기는 다른 문장</h2>`;
    const out = stripComments(src);
    expect(out).not.toContain("scenes.title");
    expect(out).toContain("여기는 다른 문장");
  });

  it("JSX 주석으로 꺼 놓은 컴포넌트를 지운다", () => {
    // 실제로 빠져나간 변형: 섹션을 꺼도 순서 검사 3개가 통과했다.
    const src = `<main>\n  <A />\n  {/* <PrivateLaneSection /> */}\n  <B />\n</main>`;
    expect(stripComments(src)).not.toContain("PrivateLaneSection");
  });

  it("문자열 안의 // 는 건드리지 않는다", () => {
    // 옛 구현이 줄 처음만 본 이유다. 여기를 잘못 고치면 링크가 통째로 사라진다.
    for (const src of [
      `href: "https://hanbang.ai/landing"`,
      `const u = 'http://localhost:3000/'`,
      "const t = `https://hanbang.ai/${slug}`",
    ]) {
      expect(stripComments(src), src).toBe(src);
    }
  });

  it("문자열 안의 /* 도 건드리지 않는다", () => {
    const src = `const note = "형식은 /* 이렇게 */ 씁니다"`;
    expect(stripComments(src)).toBe(src);
  });

  it("주석 안의 따옴표가 뒤를 삼키지 않는다", () => {
    // 주석에 홑따옴표가 하나 있으면(예: 사용자's) 그 뒤 전부를 문자열로 오인할 수 있다.
    const src = `// 사람'이 쓴 말\nkeep("살아 있어야 한다");`;
    const out = stripComments(src);
    expect(out).toContain("살아 있어야 한다");
    expect(out).not.toContain("사람");
  });

  it("이스케이프된 따옴표를 문자열의 끝으로 읽지 않는다", () => {
    const src = `const a = "그가 \\"안녕\\" 이라 했다"; // 지워질 주석\nkeep();`;
    const out = stripComments(src);
    expect(out).toContain("안녕");
    expect(out).not.toContain("지워질 주석");
    expect(out).toContain("keep()");
  });
});

/**
 * 블록 경계 가드.
 *
 * 옛 방식은 `text.slice(text.indexOf(a), text.indexOf(b))` 뒤에 `length > 0` 만
 * 확인했다. `indexOf` 가 -1 이면 `slice(-1)` 이 **마지막 한 글자**를 돌려주므로
 * 그 가드는 경계가 사라져도 영원히 참이다 — 변형으로 확인했다.
 */
describe("contentBlock", () => {
  it("경계를 못 찾으면 던진다", () => {
    expect(() => contentBlock("존재하지않는블록")).toThrow(/찾지 못했습니다/u);
    expect(() => contentBlock("closing", "존재하지않는경계")).toThrow(/경계/u);
  });

  it("요구한 블록만 돌려준다", () => {
    const closing = contentBlock("closing", "footer");
    expect(closing).toContain("closing: {");
    expect(closing).not.toContain("footer: {");
    expect(closing.length).toBeGreaterThan(80);
  });

  it("최상위 export 도 잘라낸다", () => {
    const block = contentBlock("availableNow", "footerLinks");
    expect(block).toContain("export const availableNow");
    expect(block).not.toContain("export const footerLinks");
  });
});

describe("renderedSections", () => {
  it("page.tsx 가 실제로 그리는 섹션만 센다", () => {
    const sections = renderedSections();
    expect(sections.length).toBeGreaterThanOrEqual(8);
    expect(sections).toContain("TransformationHero");
    expect(new Set(sections).size, "같은 섹션을 두 번 그린다").toBe(sections.length);
  });
});

describe("everyLandingComponent", () => {
  it("폴더를 읽어 목록을 만든다", () => {
    const files = everyLandingComponent().map(([f]) => f);
    expect(files.length).toBeGreaterThanOrEqual(10);
    expect(files.some((f) => f.includes(".test."))).toBe(false);
    // 손으로 적은 목록이 아니라는 증거 — page.tsx 가 그리는 섹션이 전부 들어 있다.
    for (const section of renderedSections()) {
      expect(files, `${section}.tsx 가 목록에 없다`).toContain(`${section}.tsx`);
    }
  });
});
