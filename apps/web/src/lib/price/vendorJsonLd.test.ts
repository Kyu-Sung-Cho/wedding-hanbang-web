import { describe, expect, it } from "vitest";

import { buildPriceVendorStructuredData } from "./vendorJsonLd";

describe("buildPriceVendorStructuredData", () => {
  it("builds the complete evidence-backed vendor JSON-LD graph", () => {
    const graph = buildPriceVendorStructuredData({
      vendorName: "샘플스튜디오A",
      vendorSlug: "sample-studio-a",
      category: "studio",
      categoryLabel: "스튜디오",
    });

    expect(graph.map((entry) => entry["@type"])).toEqual([
      "BreadcrumbList",
      "WebPage",
      "Dataset",
      "FAQPage",
    ]);
    expect(graph[2]).toMatchObject({
      temporalCoverage: "2025-11",
      creator: { name: "한국소비자원" },
      publisher: { name: "웨딩한방" },
      citation: "한국소비자원 참가격",
    });
    expect(graph[3]).toMatchObject({
      mainEntity: [
        { name: "공시 가격이 무엇인가요?" },
        { name: "실제 계약 가격과 왜 다를 수 있나요?" },
        { name: "왜 일부 업체만 나오나요?" },
      ],
    });
  });
});
