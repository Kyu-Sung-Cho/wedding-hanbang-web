import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import WeddingCodePage, { metadata } from "./page";

describe("웨딩코드 중단 안내 화면", () => {
  it("답변을 받지 않는다는 안내와 웨딩한방 복귀 링크를 보여준다", () => {
    const html = renderToStaticMarkup(<WeddingCodePage />);

    expect(html).toContain("정식 검증을 준비하고 있어요");
    expect(html).toContain("답변을 받거나 저장하지 않습니다");
    expect(html).toContain('href="/wedding"');
    expect(html).toContain("웨딩한방으로 돌아가기");
    expect(html).not.toContain("테스트 시작하기");
  });

  it("검색 노출을 막는 메타데이터를 유지한다", () => {
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
    });
  });
});
