import { describe, expect, it } from "vitest";

import { CHECKLIST_MAP, PLANNING_CATEGORY_LABELS } from "@hanbang/shared/constants";
import { MANNERS_PARTS } from "@/lib/manners/data";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";

/**
 * 체크리스트가 예절 안내와 **반대되는 일을 시키지 않는가.**
 *
 * 「부모님 첫 만남」 카드는 하단에서 같은 이름의 예절 편을 연다. 그 편은 그 자리에서
 * 피할 이야기로 "재산이나 연봉 같은 돈 이야기"를 못 박아 두는데, 체크리스트는 같은 날
 * 전체 예산과 비용 분담을 하라고 시키고 있었다. 두 화면이 한 걸음 사이에 서로 반대되는
 * 말을 하면 사용자는 어느 쪽이 이 제품의 말인지 알 수 없다.
 *
 * 항목을 내리는 것만으로는 부족하다. 분담 이야기는 여전히 해야 하는 일이고, 어디서
 * 하는지 말해 주지 않으면 사용자는 그냥 잃어버린다. 그래서 안내 한 줄이 함께 있다.
 */
describe("부모님 첫 만남 — 돈 이야기", () => {
  const meeting = CHECKLIST_MAP.meeting;
  const copy = [
    meeting.tip,
    ...meeting.items.map((item) => `${item.label} ${item.note ?? ""}`),
  ].join("\n");

  it("예절 편이 그 자리의 돈 이야기를 실제로 말린다", () => {
    // 근거가 사라졌으면 이 검사 전체가 근거 없는 규칙이 된다. 원문을 먼저 확인한다.
    const part = MANNERS_PARTS.find((entry) => entry.slug === "family-meeting");
    expect(mannersPartForCategory("meeting")?.slug).toBe("family-meeting");
    expect(JSON.stringify(part)).toContain("재산이나 연봉 같은 돈 이야기");
  });

  it("그날 예산·분담을 이야기하라고 시키는 항목이 없다", () => {
    expect(meeting.items.map((item) => item.id)).toEqual([
      "meeting_01",
      "meeting_02",
      "meeting_07",
      "meeting_03",
      "meeting_04",
    ]);
    expect(copy).not.toMatch(/전체 예산|비용 분담|분담 이야기/);
  });

  /**
   * 식사비는 남는다. 예절 편이 말리는 것은 **그 자리에서 꺼내는** 돈 이야기이고,
   * 식사비 항목은 반대로 "그날 계산대 앞에서 정하지 말고 미리 정하라"는 말이다.
   */
  it("식사비를 미리 정하는 항목은 그대로 있다", () => {
    const meal = meeting.items.find((item) => item.id === "meeting_07");
    expect(meal?.label).toContain("미리 정하기");
  });

  it("분담 항목은 원래 있던 자리에 그대로 있다", () => {
    expect(CHECKLIST_MAP.houseware.items[0].label).toContain("누가 얼마나 낼지 합의");
    expect(CHECKLIST_MAP.yedan.items.slice(0, 2).map((item) => item.label)).toEqual([
      "두 가족에게 드릴 선물을 준비할지 가족과 합의",
      "준비할 품목과 전체 예산 정하기",
    ]);
  });

  it("어디서 하는 이야기인지 분야 아래에서 알려 준다", () => {
    const notDoing = meeting.notDoing;
    expect(notDoing?.title).toBe("이 날 안 하는 것");
    // 두 분야를 이름으로 가리킨다. 라벨이 바뀌면 여기도 함께 바뀌어야 하므로
    // 문자열을 다시 적지 않고 정본에서 가져와 대조한다.
    expect(notDoing?.body).toContain(PLANNING_CATEGORY_LABELS.houseware);
    expect(notDoing?.body).toContain(PLANNING_CATEGORY_LABELS.yedan);
  });

  it("안내 한 줄은 할 일 행이 아니다", () => {
    // 항목으로 만들면 체크할 수 있는 일이 되고, 안 하기로 한 것이 진행률 분모에 들어간다.
    expect(meeting.items.some((item) => item.label.includes("안 하는 것"))).toBe(false);
  });

  it("분야 설명이 그날 예산을 이야기한다고 읽히지 않는다", () => {
    expect(meeting.tip).not.toMatch(/예산|분담|주제/);
    expect(meeting.tip).toContain("날짜와 장소");
    expect(meeting.tip).toContain("참석자");
    expect(meeting.tip).toContain("선물");
  });
});
