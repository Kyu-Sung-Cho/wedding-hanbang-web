import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceCatalog } from "@/lib/price/catalog";

const mocks = vi.hoisted(() => ({
  loadCatalog: vi.fn<() => Promise<PriceCatalog>>(),
}));

vi.mock("@/lib/price/buildCatalog", () => ({
  loadPriceCatalogWithBuildFallback: mocks.loadCatalog,
}));
vi.mock("@/lib/demoTrial", () => ({ isPublicDemoTrialEnabled: () => false }));

import PriceIndexPage from "./page";

describe("public price hub follow-through", () => {
  beforeEach(() => {
    mocks.loadCatalog.mockResolvedValue({
      periodLabel: "2026Q3",
      categories: { studio: [], dress: [], makeup: [], hall: [] },
      counts: { studio: 0, dress: 0, makeup: 0, hall: 0 },
      agencies: [],
    });
  });

  async function pageDocument() {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(await PriceIndexPage());
    return host;
  }

  it("keeps the Amora destination for existing members and visitors who still need auth", async () => {
    const page = await pageDocument();
    const amoraEntry = [...page.querySelectorAll("a")]
      .find((link) => link.textContent?.includes("아모라와 시작하기"));

    expect(amoraEntry?.getAttribute("href")).toBe("/wedding/chat");
    expect(page.querySelector('a[href="/login?mode=signup"]')).toBeNull();
    expect(page.textContent).toContain("아모라는 로그인 후 이용해요.");
    expect(page.textContent).toContain("내용을 직접 확인해 기록하세요.");
    expect(page.textContent).not.toContain("계정을 만들면");
    expect(page.textContent).not.toContain("지금 본 가격을 기준으로");
  });

  it("offers quote questions without an unsupported completion-time promise", async () => {
    const page = await pageDocument();
    const quoteEntry = page.querySelector('a[href="/wedding/community/quote-check"]');

    expect(quoteEntry?.textContent).toContain("이미 견적서를 받았다면");
    expect(quoteEntry?.textContent).toContain("업체에 보낼 질문");
    expect(quoteEntry?.textContent).toContain("로그인 없이 무료예요.");
    expect(quoteEntry?.textContent).not.toMatch(/(?:\d+|삼)\s*분\s*(?:만에|안에|이면|내)/u);
    expect(page.textContent).toContain("가격 출처: 한국소비자원 참가격");
    expect(page.textContent).toContain("계약 전 업체에 직접 확인하세요.");
  });
});
