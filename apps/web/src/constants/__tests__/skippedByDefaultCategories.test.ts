import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS, CHECKLIST_MAP } from "@hanbang/shared/constants";
import {
  resolvePlanningChecklistStatus,
  summarizePlanningChecklist,
} from "@hanbang/shared/utils";
import { mannersPartForCategory } from "@/lib/manners/categoryMap";

/**
 * "안 해요"에서 시작하는 분야의 계약.
 *
 * 이바지·호칭·집들이는 하는 집도 있고 안 하는 집도 있다. 그런 자리를 "시작 전"으로
 * 두면 아무도 고르지 않은 할 일이 진행률 분모에 눌러앉고, 라운지의 "지금 할 일"과
 * 마감 알림에도 계속 뜬다 — 함·폐백을 생략한 커플에게 지워지지 않는 할 일이 생겼던
 * 것과 같은 모양이다.
 *
 * 그래서 저장된 값이 없으면 "안 해요"로 시작한다. 여기서 확인하는 것은 세 가지다 —
 * 정말 그 상태로 시작하는가, 진행률에서 빠지는가, 그리고 **되돌리면 되돌아오는가.**
 * 마지막이 빠지면 하기로 한 커플이 이 분야를 영영 못 쓴다.
 */
describe("안 해요로 시작하는 분야", () => {
  const SKIPPED_BY_DEFAULT = ["address", "ibaji", "housewarming"] as const;

  it("정본에서 그 분야를 실제로 찾아낸다", () => {
    // 목록이 비면 아래 검사는 전부 빈 배열끼리 비교해 늘 통과한다.
    const declared = CATEGORY_CHECKLISTS
      .filter((category) => category.defaultStatus === "not_applicable")
      .map((category) => category.key);
    expect(declared).toEqual([...SKIPPED_BY_DEFAULT]);
  });

  it("저장된 값이 없으면 '해당 없음'이다", () => {
    for (const key of SKIPPED_BY_DEFAULT) {
      const template = CHECKLIST_MAP[key];
      expect(
        resolvePlanningChecklistStatus(template.items, undefined, template.defaultStatus),
        key,
      ).toBe("not_applicable");
    }
  });

  it("나머지 분야는 종전대로 '시작 전'이다", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      if (category.defaultStatus === "not_applicable") continue;
      expect(
        resolvePlanningChecklistStatus(category.items, undefined, category.defaultStatus),
        category.key,
      ).toBe("not_started");
    }
  });

  it("되돌리면 다시 준비 목록으로 돌아온다", () => {
    // 모달의 "다시 준비 목록에 넣기"가 저장하는 모양이다. 기본값이 이걸 덮으면
    // 하기로 한 커플이 체크를 할 수 없다.
    for (const key of SKIPPED_BY_DEFAULT) {
      const template = CHECKLIST_MAP[key];
      const saved = {
        status: "not_started" as const,
        checklist: template.items.map((item) => ({ ...item, done: false })),
      };
      expect(
        resolvePlanningChecklistStatus(template.items, saved, template.defaultStatus),
        key,
      ).toBe("not_started");

      const done = {
        status: "completed" as const,
        checklist: template.items.map((item) => ({ ...item, done: true })),
      };
      expect(
        resolvePlanningChecklistStatus(template.items, done, template.defaultStatus),
        key,
      ).toBe("completed");
    }
  });

  it("아무것도 안 한 커플의 진행률 분모에 들어가지 않는다", () => {
    const summary = summarizePlanningChecklist(CATEGORY_CHECKLISTS, {});
    const openItems = CATEGORY_CHECKLISTS
      .filter((category) => category.defaultStatus !== "not_applicable")
      .reduce((total, category) => total + category.items.length, 0);

    expect(summary.skippedCategories).toBe(SKIPPED_BY_DEFAULT.length);
    expect(summary.total).toBe(openItems);
    expect(summary.done).toBe(0);
  });

  it("한 분야를 켜면 그만큼만 분모가 는다", () => {
    const template = CHECKLIST_MAP.housewarming;
    const summary = summarizePlanningChecklist(CATEGORY_CHECKLISTS, {
      housewarming: { status: "not_started", checklist: template.items },
    });
    const base = summarizePlanningChecklist(CATEGORY_CHECKLISTS, {});

    expect(summary.skippedCategories).toBe(base.skippedCategories - 1);
    expect(summary.total).toBe(base.total + template.items.length);
  });

  it("건너뛸 수 있는 자리답게 한 줄짜리이고 읽을 예절 편이 있다", () => {
    for (const key of SKIPPED_BY_DEFAULT) {
      const template = CHECKLIST_MAP[key];
      // 안 할 수도 있는 자리에 일곱 줄을 깔지 않는다. 먼저 할지부터 정하는 한 줄이다.
      expect(template.items, key).toHaveLength(1);
      expect(mannersPartForCategory(key), `${key}에 읽을 편이 없다`).not.toBeNull();
    }
  });

  it("이바지와 하객 답례품은 같은 편을 읽어도 다른 분야다", () => {
    // 「이바지·답례품 예절」 한 편이 두 주제를 담는다. 편이 같다고 분야를 합치면
    // 상대 집에 보내는 음식과 하객에게 주는 선물이 한 칸에 섞인다.
    expect(mannersPartForCategory("ibaji")?.slug).toBe("return-gift");
    expect(mannersPartForCategory("gift")?.slug).toBe("return-gift");
    expect(CHECKLIST_MAP.ibaji.items).not.toEqual(CHECKLIST_MAP.gift.items);
  });
});
