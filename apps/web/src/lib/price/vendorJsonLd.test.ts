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
    const dataset = graph.find((entry) => entry["@type"] === "Dataset");
    expect(dataset).toHaveProperty("description", expect.any(String));
    const description = dataset && "description" in dataset ? dataset.description : "";
    expect(description).toContain("샘플스튜디오A");
    expect(description).toContain("스튜디오");
    expect(description).toContain("한국소비자원 참가격");
    expect(description).toContain("2025년 11월");
    expect(description).toContain("실제 계약 조건");
    expect(String(description).length).toBeGreaterThanOrEqual(50);
    expect(String(description).length).toBeLessThanOrEqual(5000);
    expect(graph[3]).toMatchObject({
      mainEntity: [
        { name: "공시 가격이 무엇인가요?" },
        { name: "실제 계약 가격과 왜 다를 수 있나요?" },
        { name: "왜 일부 업체만 나오나요?" },
      ],
    });
  });
});
