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
import WeddingCodeMeaningPage, { generateMetadata, generateStaticParams } from "./page";

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
      expect(html, axis.labelKo).toContain(axis.labelKo);
    }
    // 반대쪽 글자도 알려줘야 자리를 이해할 수 있다.
    expect(html).toContain("이 자리의 다른 쪽은");
    expect(html).toContain("내 웨딩코드 받아보기");
  });

  it("소문자로 와도 같은 뜻으로 열린다", async () => {
    const html = await render("vtuh");
    expect(html).toContain('data-code-meaning="VTUH"');
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
    // 「성격을 맞힌 게 아니라서」 같은 고지는 남아야 하므로 낱말이 아니라 주장 형태를 막는다.
    for (const banned of ["당신은 ", "성격이", "성격은", "궁합이", "잘 맞는", "예측", "등급"]) {
      expect(html, banned).not.toContain(banned);
    }
    expect(html).not.toMatch(/\d+\s*점|\d+\s*%/);
    expect(html).toContain("성격을 맞힌 게 아니라서");
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
