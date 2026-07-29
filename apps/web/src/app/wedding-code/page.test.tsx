import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { WEDDING_CODE_V06_QUESTIONS } from "@/constants/weddingCodeV06";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import WeddingCodePage, { metadata } from "./page";

const LEFT_ISH: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "A"]),
);
const RIGHT_ISH: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "D"]),
);

async function render(searchParams: { a?: string; b?: string }) {
  const element = await WeddingCodePage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

describe("웨딩코드 진입 화면", () => {
  it("응답이 들어 있는 주소라서 색인하지 않는다", () => {
    // ?a=·?b=에는 누군가의 실제 응답이 담긴다. 색인되면 남의 답이 검색에 남는다.
    expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
  });

  it("코드가 없으면 처음부터 답하는 화면이다", async () => {
    const html = await render({});
    expect(html).toContain("결혼 준비 열여섯 장면");
    expect(html).toContain("시작하기");
    // 예전의 중단 안내가 남아 있으면 안 된다.
    expect(html).not.toContain("정식 검증을 준비하고 있어요");
    expect(html).not.toContain("답변을 받거나 저장하지 않습니다");
  });

  it("판정 언어를 화면에 쓰지 않는다", async () => {
    const html = await render({});
    for (const banned of ["점수가", "등급", "궁합이", "유형이에요", "당신은 "]) {
      expect(html, banned).not.toContain(banned);
    }
    expect(html).toContain("점수도 유형도 궁합도 나오지 않아요");
  });

  it("상대 코드가 오면 상대가 먼저 답했다고 알린다", async () => {
    const html = await render({ a: encodeWeddingCodeV06(LEFT_ISH) });
    expect(html).toContain("상대가 먼저 답하고 보냈어요");
    expect(html).toContain("나도 답해보기");
  });

  /**
   * 이 제품에서 제일 나쁜 버그는 고르지도 않은 답이 「상대는 이렇게 답했어요」로 뜨는 것이다.
   * 망가진 코드는 조용히 채우지 말고 처음부터 답하게 해야 한다.
   */
  it("망가진 코드는 상대 답으로 취급하지 않는다", async () => {
    for (const broken of ["ABC", "ZZZZZZZZZZZZZZZZ", "", "----------------"]) {
      const html = await render({ a: broken });
      expect(html, `코드 "${broken}"`).toContain("결혼 준비 열여섯 장면");
      expect(html, `코드 "${broken}"`).not.toContain("상대가 먼저 답하고 보냈어요");
    }
  });

  it("두 코드가 다 있으면 차이 지도를 바로 연다", async () => {
    const html = await render({
      a: encodeWeddingCodeV06(LEFT_ISH),
      b: encodeWeddingCodeV06(RIGHT_ISH),
    });
    expect(html).toContain('data-result="couple"');
    expect(html).toContain("갈렸어요");
    expect(html).toContain("어느 쪽이 맞는지는 없어요");
  });

  it("차이 지도가 두 사람이 실제로 고른 문장을 인용한다", async () => {
    const html = await render({
      a: encodeWeddingCodeV06(LEFT_ISH),
      b: encodeWeddingCodeV06(RIGHT_ISH),
    });
    // 화면에 뜬 첫 갈림에 대해 A안·D안 문구가 실제로 들어 있어야 한다.
    const shown = WEDDING_CODE_V06_QUESTIONS.filter((question) =>
      html.includes(`data-gap="${question.key}"`),
    );
    expect(shown.length).toBeGreaterThan(0);
    for (const question of shown) {
      const a = question.options.find((option) => option.value === "A")!.label;
      const d = question.options.find((option) => option.value === "D")!.label;
      expect(html, `${question.key} A안`).toContain(a);
      expect(html, `${question.key} D안`).toContain(d);
    }
  });

  it("한쪽 코드만 있으면 차이 지도를 열지 않는다", async () => {
    const html = await render({ b: encodeWeddingCodeV06(RIGHT_ISH) });
    expect(html).not.toContain('data-result="couple"');
  });
});
