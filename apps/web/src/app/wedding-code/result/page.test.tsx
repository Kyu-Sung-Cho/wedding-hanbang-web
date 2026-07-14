import { redirect } from "next/navigation";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn() }),
}));

import WeddingCodeResultPage, { dynamic, metadata } from "./page";

describe("웨딩코드 결과 화면 차단", () => {
  it("직접 접근도 검증 준비 안내 화면으로 보낸다", () => {
    WeddingCodeResultPage();

    expect(redirect).toHaveBeenCalledWith("/wedding-code");
    expect(dynamic).toBe("force-dynamic");
  });

  it("검색 노출을 막는 메타데이터를 유지한다", () => {
    expect(metadata).toMatchObject({
      robots: { index: false, follow: false },
    });
  });
});
