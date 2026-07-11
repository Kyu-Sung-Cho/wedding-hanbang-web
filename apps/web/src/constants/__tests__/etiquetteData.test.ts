import { describe, expect, it } from "vitest";
import {
  ETIQUETTE_CATEGORIES,
  ETIQUETTE_GUIDE_NOTICE,
  ETIQUETTE_OFFICIAL_SOURCES,
  ETIQUETTE_PARTS,
} from "@/constants/etiquetteData";

describe("etiquette guide content contract", () => {
  const allCopy = ETIQUETTE_PARTS
    .flatMap((part) => [part.title, part.subtitle, part.description, part.content])
    .join("\n");

  it("keeps all 25 parts complete, ordered, and parseable", () => {
    expect(ETIQUETTE_PARTS).toHaveLength(25);
    expect(ETIQUETTE_PARTS.map((part) => part.number)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );

    for (const part of ETIQUETTE_PARTS) {
      expect(part.title.trim()).not.toBe("");
      expect(part.subtitle.trim()).not.toBe("");
      expect(part.description.trim()).not.toBe("");
      expect(part.content).toContain("\n### ");
      expect(part.content).toContain("\n#### ");
    }
  });

  it("does not restore pressure, guarantees, unsupported amounts, or promotional AI claims", () => {
    const harmfulPhrases = [
      "완벽",
      "절대",
      "무조건",
      "사망 플래그",
      "100점",
      "30~50%",
      "회수율",
      "플래너 없이도 OK",
      "웨딩한방 AI가 24시간",
      "결혼 평균 비용",
    ];

    for (const phrase of harmfulPhrases) {
      expect(allCopy).not.toContain(phrase);
    }

    expect(allCopy).not.toMatch(/\d[\d,.]*(?:만|억)?원/);
    expect(allCopy).not.toMatch(/\d+(?:\.\d+)?%/);
  });

  it("states the choice boundary and links only to HTTPS official sources", () => {
    expect(ETIQUETTE_GUIDE_NOTICE).toContain("관습은 선택");
    expect(ETIQUETTE_GUIDE_NOTICE).toContain("공식 안내");
    expect(ETIQUETTE_OFFICIAL_SOURCES.map((source) => source.label)).toEqual(
      expect.arrayContaining([
        "정부24 혼인신고 안내",
        "대한민국 법원 혼인신고 안내",
        "국세청 세액공제 안내",
        "국민건강보험공단",
      ]),
    );

    for (const source of ETIQUETTE_OFFICIAL_SOURCES) {
      expect(source.href).toMatch(/^https:\/\//);
    }
  });

  it("keeps every category reference valid and covers each part once", () => {
    const categoryParts = ETIQUETTE_CATEGORIES.flatMap((category) => [...category.parts]);
    expect(categoryParts.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
  });
});
