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
import { WEDDING_CODE_LETTERS } from "@/lib/weddingCode/profile/letters";
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
    expect(html).toContain("내 웨딩코드 받아보기");
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
   * 이 경로에는 네 글자밖에 없다 — 누가 어떤 장면에서 무엇을 골랐는지는 코드에 들어
   * 있지 않다. 그래서 색인해도 남의 응답이 노출되지 않는다.
   */
  it("응답이 없으므로 색인을 막지 않는다", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ code: "MOFA" }) });
    expect(metadata.robots).toBeUndefined();
    expect(metadata.title).toContain("MOFA");
    expect(metadata.alternates?.canonical).toBe("/wedding-code/c/MOFA");

    const broken = await generateMetadata({ params: Promise.resolve({ code: "ZZZZ" }) });
    expect(broken.robots).toMatchObject({ index: false });
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
