import { describe, expect, it } from "vitest";

import { CHECKLIST_MAP } from "@hanbang/shared/constants";

/**
 * 옷·신발·꽃이 **누가 무엇을 입는지 먼저 정해 버리지 않는가.**
 *
 * 이 제품은 온보딩에서 신부·신랑 역할을 묻지 않는다(`neutralPreparationSpace`).
 * 그런데 세 분야의 문구는 한 사람이 드레스와 꽃다발을 맡는다고 가정하고, 예식 정장과
 * 그 신발과 옷에 다는 꽃을 "배우자 것도 따로 확인"으로 뒤에 붙여 두었다. 묻지 않은
 * 역할을 화면이 대신 정해 준 셈이다.
 *
 * 화면에 사람을 고르는 칩이 없으므로 새로 만들지 않는다. 대신 기본 경로가 한쪽을
 * 가정하지 않게 문구를 고쳤고, 여기서 그 상태를 고정한다.
 */
describe("드레스·신발·꽃의 기본값", () => {
  const CATEGORIES = ["dress", "shoes", "bouquet"] as const;

  it("분야 설명이 한 사람의 옷차림을 기본으로 두지 않는다", () => {
    for (const key of CATEGORIES) {
      const { tip } = CHECKLIST_MAP[key];
      // "배우자 것도 따로" 라고 덧붙이는 문장은 그 자체가 기본값 선언이다.
      expect(tip, key).not.toMatch(/배우자/);
      expect(tip, key).toContain("두 사람");
    }
  });

  it("예식 정장·신발·옷에 다는 꽃이 같은 급의 항목이다", () => {
    const secondPersonItems = [
      CHECKLIST_MAP.dress.items.find((item) => item.id === "dress_07"),
      CHECKLIST_MAP.shoes.items.find((item) => item.id === "shoes_06"),
      CHECKLIST_MAP.bouquet.items.find((item) => item.id === "bouquet_05"),
    ];

    for (const item of secondPersonItems) {
      expect(item, "항목이 사라졌다 — 지우는 것은 이 변경의 범위가 아니다").toBeDefined();
      // "배우자 ~", "~도 필요한지 확인" 은 뒤에 붙인 말투다. 항목 자체는 남기고
      // 말투만 나머지 항목과 같게 맞춘다.
      expect(item!.label).not.toMatch(/배우자/);
      expect(item!.label).not.toMatch(/도 필요한지/);
    }
  });

  it("첫 항목이 드레스를 입는 사람을 가정하지 않는다", () => {
    // 분야를 열었을 때 맨 위에 오는 줄이 기본 경로다.
    expect(CHECKLIST_MAP.dress.items[0].label).toContain("두 사람이 각자");
    expect(CHECKLIST_MAP.shoes.items[0].label).not.toContain("드레스");
  });

  it("항목을 새로 늘리지 않았다", () => {
    // 이번 변경은 문구만 고친다. 항목이 늘면 저장된 완료가 낡고 진행률이 흔들린다.
    expect(CHECKLIST_MAP.dress.items).toHaveLength(9);
    expect(CHECKLIST_MAP.shoes.items).toHaveLength(6);
    expect(CHECKLIST_MAP.bouquet.items).toHaveLength(7);
  });
});
