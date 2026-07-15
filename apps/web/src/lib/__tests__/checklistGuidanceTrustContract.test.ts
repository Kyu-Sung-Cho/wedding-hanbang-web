import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function tips(source: string): string[] {
  return [...source.matchAll(/\btip:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function itemLabels(source: string): string[] {
  return [...source.matchAll(/\{ id: "[^"]+", label: "([^"]+)"/g)].map(
    (match) => match[1],
  );
}

describe("checklist guidance trust boundary", () => {
  const web = read("src/constants/checklists.ts");
  const mobile = read("../mobile/src/constants/checklists.ts");

  it("keeps web and mobile guidance identical", () => {
    expect(tips(web)).toEqual(tips(mobile));
    expect(itemLabels(web)).toEqual(itemLabels(mobile));
    expect(tips(web)).toHaveLength(19);
  });

  it("does not present optional customs, vendor lead times, or quantities as universal rules", () => {
    const allTips = tips(web).join("\n");

    expect(allTips).not.toMatch(/최소 1년 전에 예약하세요|최소 3개월이 소요됩니다/);
    expect(allTips).not.toMatch(/10% 추가로 주문하세요|2~3명이면 충분합니다/);
    expect(allTips).not.toMatch(/가장 먼저 진행합니다|중 골라야 합니다|전문 업체에 맡기면 편합니다/);
    expect(allTips).toContain("선택");
    expect(allTips).toContain("업체");
    expect(allTips).toContain("직접 확인");
  });

  it("does not turn arbitrary vendor counts or timing into obligations", () => {
    const labels = itemLabels(web).join("\n");

    expect(labels).not.toMatch(/3곳|2회 이상|2개월 전|2~3명/);
  });

  it("makes contract actions explicit, direct, and evidence-based", () => {
    const labels = itemLabels(web);
    const safeContractAction = "계약한다면 원문 확인 후 직접 서명·납부 내역 보관";

    expect(labels).not.toContain("계약금 납부 및 계약서 보관");
    expect(labels).not.toContain("계약 및 계약금 납부");
    expect(labels).not.toContain("주문 및 계약금 납부");
    expect(labels.filter((label) => label === safeContractAction)).toHaveLength(6);
  });

  it("keeps optional family customs conditional at item level", () => {
    const optionalCustomKeys = new Set(["meeting", "yedan", "ham", "pyebaek"]);
    const optionalCustoms = CATEGORY_CHECKLISTS.filter((category) =>
      optionalCustomKeys.has(category.key),
    );

    expect(optionalCustoms).toHaveLength(optionalCustomKeys.size);
    expect(
      optionalCustoms.every((category) =>
        category.items.every((item) => item.label.includes("진행")),
      ),
    ).toBe(true);
  });
});
