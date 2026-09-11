// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CATEGORY_CHECKLISTS, CHECKLIST_GROUPS, CHECKLIST_NOTE_SOURCES } from "@hanbang/shared/constants";
import { MANNERS_PARTS } from "../data";

describe("신혼집 임대차 계약 신고 안내", () => {
  it("계약 직후 확인할 별도 항목을 추가하고 기존 신혼집 항목·단계·근거를 보존한다", () => {
    const housing = CATEGORY_CHECKLISTS.find(category => category.key === "housing")!;
    const ids = housing.items.map(item => item.id);
    expect(ids.filter(id => id !== "housing_13")).toEqual(["housing_01", "housing_02", "housing_12", "housing_03", "housing_04", "housing_08", "housing_09", "housing_10", "housing_05", "housing_06", "housing_07", "housing_11"]);
    const report = housing.items.find(item => item.id === "housing_13");
    expect(report).toMatchObject({ done: false });
    expect(report?.label).toContain("주택 임대차 계약 신고");
    expect(report?.label).toContain("해당하는 경우");
    expect(report?.note).toContain("입주일이 아니라 계약 체결일");
    expect(ids.indexOf("housing_13")).toBe(ids.indexOf("housing_05") + 1);
    expect(CHECKLIST_GROUPS.housing[1].itemIds).toContain("housing_13");
    const source = CHECKLIST_NOTE_SOURCES.housing_13;
    expect(source).toBeDefined();
    const part = MANNERS_PARTS.find(item => item.slug === source.part)!;
    expect(part.sections[source.sectionIndex - 1].heading).toBe(source.heading);
  });

  it("신고 대상을 지역·금액·갱신 조건으로 한정하고 계약일 기한과 공식 출처를 함께 제공한다", () => {
    const part = MANNERS_PARTS.find(item => item.slug === "home-conversation")!;
    const section = part.sections.find(item => item.heading === "계약 직후 — 주택 임대차 계약 신고 대상 확인");
    expect(section).toBeDefined();
    const text = JSON.stringify(section);
    for (const claim of ["계약 체결일부터 30일 이내", "입주일", "보증금 6천만원", "월세 30만원", "초과", "계약금액의 변동이 없는 갱신계약", "제외", "수도권", "광역시", "군 지역", "전입신고"]) expect(text).toContain(claim);
    expect(text).not.toContain("모든 계약은 신고");
    expect(part.sources?.find(source => source.url === "https://rtms.molit.go.kr/main/serviceInfo.do")).toMatchObject({ checkedAt: "2026-09-11" });
  });
});
