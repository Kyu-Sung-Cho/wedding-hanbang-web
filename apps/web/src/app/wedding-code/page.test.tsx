import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import WeddingCodePage, { metadata } from "./page";

describe("웨딩코드 진입 화면", () => {
  it("응답이 들어 있는 주소를 색인하지 않는다", () => {
    expect(metadata).toMatchObject({ robots: { index: false, follow: false } });
  });

  it("서버 렌더는 쿼리 답변과 무관하게 항상 빈 시작 상태다", () => {
    const pageWithIgnoredLegacyProps = WeddingCodePage as unknown as (
      props: { searchParams: Promise<{ a: string; b: string }> },
    ) => ReturnType<typeof WeddingCodePage>;
    const element = pageWithIgnoredLegacyProps({
      searchParams: Promise.resolve({
        a: "AAAAAAAAAAAAAAAA",
        b: "DDDDDDDDDDDDDDDD",
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("결혼 준비 열여섯 장면");
    expect(html).not.toContain('data-result="couple"');
    expect(html).not.toContain("AAAAAAAAAAAAAAAA");
    expect(html).not.toContain("DDDDDDDDDDDDDDDD");
  });
});
