// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { WEDDING_CODE_V06_AXES } from "@/constants/weddingCodeV06";
import { parseWeddingCodeString, WEDDING_CODE_LETTERS } from "@/lib/weddingCode/profile/letters";
import { V31_STYLE_DIMENSIONS } from "@/lib/weddingCode/v31StyleSummary";
import WeddingCodeMeaningPage, { generateMetadata, generateStaticParams } from "./page";

const LOOKUP_LABELS = [
  ["비용·조건", "분위기·경험"],
  ["함께 살피기", "맡아서 하기"],
  ["둘의 선택", "가족 참여"],
  ["마음", "할 일"],
] as const;

async function render(code: string) {
  const element = await WeddingCodeMeaningPage({ params: Promise.resolve({ code }) });
  return renderToStaticMarkup(element);
}

describe("코드만 아는 사람을 위한 화면", () => {
  /**
   * MBTI는 「나 INFP야」만 알아도 뜻을 찾아볼 수 있다. 그게 코드가 퍼지는 방식이다.
   * 스무 문항을 다시 풀어야만 뜻을 볼 수 있으면 코드라고 부를 이유가 없다.
   */
  it("네 글자만으로 각 자리의 뜻을 보여준다", async () => {
    const html = await render("VTUH");
    expect(html).toContain('data-code-meaning="VTUH"');
    for (const axis of WEDDING_CODE_V06_AXES) {
      expect(html, axis.key).toContain(`data-meaning-axis="${axis.key}"`);
    }
    // 반대쪽 글자도 알려줘야 자리를 이해할 수 있다.
    expect(html).toContain("반대쪽 글자");
    expect(html).toContain("지금 웨딩코드 해보기");
  });

  /**
   * 이 경로의 글자표는 장면 문항 판(v0.6~v1.2)의 것이다. 지금 판(v3.1)은 질문도 글자를
   * 정하는 방식도 다르다. 예전에는 판을 밝히지 않고 옛 판의 「스무 장면」을 지금 검사처럼
   * 적었다(2026-09-26 감사).
   */
  it("이전 판 코드라는 사실과 지금 판으로 가는 안내를 화면에 적는다", async () => {
    for (const { code } of generateStaticParams()) {
      const root = document.createElement("div");
      root.innerHTML = await render(code);
      const meaning = root.querySelector("[data-code-meaning]")!;
      expect(meaning.querySelector('[data-code-edition="previous"]')?.textContent, code).toBe("이전 판 웨딩코드");
      // 판 표시는 코드 바로 위, 풀이보다 먼저 나와야 한다.
      const label = meaning.querySelector("[data-code-edition]")!;
      const firstAxis = meaning.querySelector("[data-meaning-axis]")!;
      expect(label.compareDocumentPosition(firstAxis) & Node.DOCUMENT_POSITION_FOLLOWING, code).toBeTruthy();

      const note = root.querySelector("[data-current-edition-note]");
      expect(note?.textContent, code).toContain("질문도, 네 글자를 정하는 방식도 바뀌었어요.");
      expect(note?.textContent, code).toContain("지금 웨딩코드에서 받은 네 글자라면 여기 풀이와 맞지 않아요.");

      const cta = [...root.querySelectorAll("a")].find((link) => link.textContent === "지금 웨딩코드 해보기");
      expect(cta?.getAttribute("href"), code).toBe("/wedding-code");

      const text = root.textContent ?? "";
      // 옛 판 문항 수를 지금 검사의 분량처럼 적지 않는다. 재지 않은 소요 시간도 적지 않는다.
      expect(text, code).not.toMatch(/스무|20\s*장면|장면 · 로그인|\d+\s*분|약\s*\d/);
      // 줄표를 쓰지 않고, 판정이 아니라는 말은 화면에 한 번만 한다.
      expect(text, code).not.toMatch(/[—–]/);
      expect(text.match(/아니에요/g) ?? [], code).toHaveLength(1);
    }
  });

  /**
   * 지금 판도 네 글자를 만든다. 그중 `MTFA`(M=중간 답, T, F, A)는 이전 판 글자표로도 읽혀서
   * 이 화면이 옛 뜻으로 풀어 준다. 판을 밝혀야 하는 이유가 이것이다.
   * 나머지 지금 판 코드는 이 경로에서 풀지 않는다(새 경로도 만들지 않았다).
   */
  it("지금 판 코드는 옛 뜻으로 풀지 않고, 겹치는 글자는 이전 판이라고 밝힌다", async () => {
    // 자리마다 두 문장 글자와 둘 다(B)·중간(M)·둘 다 낮음(N). `?`는 주소에 들어갈 수 없어 뺀다.
    const v31Letters = V31_STYLE_DIMENSIONS.map((dimension) => [dimension.first.letter, dimension.second.letter, "B", "M", "N"]);
    const v31Codes: string[] = [];
    const walk = (prefix: string, depth: number) => {
      if (depth === v31Letters.length) { v31Codes.push(prefix); return; }
      for (const letter of v31Letters[depth]) walk(prefix + letter, depth + 1);
    };
    walk("", 0);
    expect(v31Codes).toHaveLength(625);

    const collide = v31Codes.filter((code) => parseWeddingCodeString(code));
    expect(collide).toEqual(["MTFA"]);
    const root = document.createElement("div");
    root.innerHTML = await render("MTFA");
    expect(root.querySelector('[data-code-edition="previous"]')?.textContent).toBe("이전 판 웨딩코드");
    expect(root.querySelector("[data-current-edition-note]")?.textContent).toContain("여기 풀이와 맞지 않아요");

    for (const code of v31Codes.filter((item) => !collide.includes(item))) {
      await expect(render(code), code).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  /**
   * 양쪽 글자는 기존 방향 그대로 두고, 문항 판이 필요 없는 공통 범주만 읽어준다.
   * 코드에 있는 글자만 강조하고, 실제 답 수를 알 수 없으므로 칸 막대는 그리지 않는다.
   */
  it("자리마다 공통 주제를 기존 글자 방향으로 보여준다", async () => {
    for (const code of ["VTUH", "MOFA", "vOuA"]) {
      const html = await render(code);
      const root = document.createElement("div");
      root.innerHTML = html;
      for (const [index, axis] of WEDDING_CODE_V06_AXES.entries()) {
        const pair = WEDDING_CODE_LETTERS[axis.key];
        const row = root.querySelector(`[data-meaning-axis="${axis.key}"]`)!;
        const left = row.querySelector('[data-pole="left"]');
        const right = row.querySelector('[data-pole="right"]');
        expect(left?.textContent, `${code} ${axis.key}`).toBe(`${pair.left.letter}${LOOKUP_LABELS[index][0]}`);
        expect(right?.textContent, `${code} ${axis.key}`).toBe(`${pair.right.letter}${LOOKUP_LABELS[index][1]}`);
        const chosen = code[index].toUpperCase() === pair.left.letter ? "left" : "right";
        const other = chosen === "left" ? pair.right : pair.left;
        expect(row.querySelector('[data-pole-chosen="true"]')?.getAttribute("data-pole"), `${code} ${axis.key}`).toBe(chosen);
        expect(row.querySelectorAll('[data-pole-chosen="true"]'), `${code} ${axis.key}`).toHaveLength(1);
        const otherLabel = LOOKUP_LABELS[index][chosen === "left" ? 1 : 0];
        expect(row.textContent, `${code} ${axis.key}`).toContain(`반대쪽 글자 ${other.letter}(${otherLabel}):`);
        expect(row.querySelector("[data-count-bar]"), `${code} ${axis.key}`).toBeNull();
      }
    }
  });

  it("소문자로 와도 같은 뜻으로 열린다", async () => {
    const html = await render("vtuh");
    expect(html).toContain('data-code-meaning="VTUH"');
  });

  it("모든 코드에서 문항 판과 실제 답을 추정하지 않고 결과 링크로 안내한다", async () => {
    for (const { code } of generateStaticParams()) {
      const root = document.createElement("div");
      root.innerHTML = await render(code);
      const meaning = root.querySelector("[data-code-meaning]")!;
      expect(meaning.textContent, code).toContain("코드만으로는 어떤 문항에 답했는지 알 수 없어요.");
      expect(meaning.textContent, code).toContain("정확한 풀이와 고른 답은 함께 받은 결과 링크에서 확인해 주세요.");
      expect(meaning.textContent, code).toContain("문항에 따라 가족 의견을 언제 들을지, 마지막 선택을 누구와 할지를 물어요.");
      expect(meaning.textContent, code).not.toMatch(/더 많이 골랐어요|적힌 내용이 사실인지|가족과 하객 사정을 앞에 둔|스무 장면|20장면/);
      for (const row of meaning.querySelectorAll("[data-meaning-axis]")) {
        expect(row.textContent, code).toContain("쪽을 뜻해요");
      }
      const metadata = await generateMetadata({ params: Promise.resolve({ code }) });
      expect(metadata.description, code).toContain("코드만으로는 어떤 문항에 답했는지 알 수 없어요");
      expect(metadata.description, code).toContain("함께 받은 결과 링크");
      expect(metadata.description, code).not.toMatch(/더 많이 골랐|스무 장면|20장면/);
    }
  });

  it("없는 코드를 그럴듯하게 풀어주지 않는다", async () => {
    for (const broken of ["XXXX", "VTU", "VTUHH", "1234", ""]) {
      await expect(render(broken), broken).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  /**
   * 예전에는 "응답이 없으니 색인해도 된다"고 열어 두었다. 응답이 없는 건 여전하지만, 이 화면은
   * 지금 판을 설명하지 않는다. 검색으로 들어온 사람이 옛 판 풀이를 지금 웨딩코드로 읽게 두지 않는다.
   */
  it("이전 판 화면이라 검색 색인을 막고, 판을 제목에 밝힌다", async () => {
    for (const { code } of generateStaticParams()) {
      const metadata = await generateMetadata({ params: Promise.resolve({ code }) });
      expect(metadata.robots, code).toMatchObject({ index: false });
      expect(metadata.title, code).toContain(`이전 판 웨딩코드 ${code}`);
      // 자기 자신을 대표 주소로 적으면 "색인하지 말라"와 엇갈린 신호가 된다.
      expect(metadata.alternates, code).toBeUndefined();
    }
    const lower = await generateMetadata({ params: Promise.resolve({ code: "mofa" }) });
    expect(lower.robots).toMatchObject({ index: false });

    const broken = await generateMetadata({ params: Promise.resolve({ code: "ZZZZ" }) });
    expect(broken.robots).toMatchObject({ index: false });
  });

  /**
   * 정하지 않으면 루트 layout 의 카드(아모라 문구, `og:url=/landing`)를 물려받는다.
   * 부모 폴더의 웨딩코드 카드 이미지는 지금 판을 소개하므로 여기엔 붙이지 않는다.
   */
  it("공유 카드는 이 화면의 제목·설명을 쓰고 랜딩 카드를 물려받지 않는다", async () => {
    for (const code of ["MOFA", "vtuh", "ZZZZ"]) {
      const metadata = await generateMetadata({ params: Promise.resolve({ code }) });
      expect(metadata.openGraph, code).toMatchObject({ title: metadata.title, description: metadata.description, siteName: "웨딩한방", locale: "ko_KR", type: "website" });
      expect(metadata.twitter, code).toMatchObject({ title: metadata.title, description: metadata.description });
      const card = JSON.stringify([metadata.openGraph, metadata.twitter]);
      expect(card, code).not.toMatch(/landing|아모라|og-image/);
      expect(Object.prototype.hasOwnProperty.call(metadata.openGraph, "url"), code).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(metadata.openGraph, "images"), code).toBe(false);
    }
  });

  it("성격을 설명하거나 궁합을 매기지 않는다", async () => {
    const html = await render("MOFA");
    // 「성격을 맞히거나 궁합을 보는 코드는 아니에요」 같은 고지는 남아야 하므로 낱말이 아니라 주장 형태를 막는다.
    for (const banned of ["당신은 ", "성격이", "성격은", "궁합이", "잘 맞는", "예측", "등급"]) {
      expect(html, banned).not.toContain(banned);
    }
    expect(html).not.toMatch(/\d+\s*점|\d+\s*%/);
    expect(html).toContain("성격을 맞히거나 궁합을 보는 코드는 아니에요");
    // 같은 코드라도 고른 장면은 다르다는 사실을 숨기지 않는다.
    expect(html).toContain("사람마다 달라요");
  });

  it("열여섯 조합을 모두 미리 만든다", () => {
    const params = generateStaticParams();
    expect(params).toHaveLength(16);
    expect(new Set(params.map((item) => item.code)).size).toBe(16);
    for (const { code } of params) {
      expect(code, code).toMatch(/^[VM][TO][UF][HA]$/);
    }
  });
});
