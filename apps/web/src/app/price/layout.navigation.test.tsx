import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/common/HiddenInsideMobileApp", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
import PriceLayout from "./layout";
describe("public price brand navigation", () => {
  it("returns both home links to the landing without the community rewrite", () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(<PriceLayout>가격</PriceLayout>);
    const homeLinks = host.querySelectorAll('a[aria-label="웨딩한방 홈으로 이동"]');
    expect(homeLinks).toHaveLength(2);
    for (const link of homeLinks) expect(link.getAttribute("href")).toBe("/landing");
    expect(host.querySelector('a[href="/price"]')).not.toBeNull();
  });
});
