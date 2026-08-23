import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import {
  collectAmoraChecklistLabels,
  mentionsKnownChecklistItem,
} from "@/lib/ai/amoraToolPolicy";
import { mergePlanningChecklist } from "@hanbang/shared";

/**
 * 아모라가 보는 항목 이름과 사용자가 보는 항목 이름이 같아야 한다.
 *
 * 화면은 `mergePlanningChecklist(template, saved)` 로 그린다. 그 병합은
 * **템플릿 라벨이 이기고** 저장값에서는 `done` 만 가져온다. 그래서 사용자가
 * 읽는 이름은 언제나 템플릿의 이름이다.
 *
 * 그런데 아모라는 저장된 progress 의 라벨을 그대로 읽고 있었다. 둘이 갈리면
 * 아모라는 사용자가 말한 이름을 영영 못 알아본다.
 *
 * 실측(2026-08-24 운영): 체크리스트 항목 173개 중 90개, 19커플 중 15커플의
 * 저장 라벨이 물음표로 깨져 있었다.
 *
 *     venue|venue_01|true|'??? ??? ??'
 *     studio|studio_01|false|'?? ??? ??'
 *
 * 화면은 멀쩡했다. 아모라만 "항목 이름을 다시 보내주세요" 를 반복했다.
 */

const CATEGORY = CATEGORY_CHECKLISTS.find((entry) => entry.items.length > 0);

/** 저장값이 깨진 커플. 실제 운영에서 나온 모양 그대로. */
function corruptedProgress() {
  if (!CATEGORY) throw new Error("템플릿에 항목이 있는 분야가 없습니다");
  return {
    [CATEGORY.key]: {
      status: "in_progress",
      checklist: CATEGORY.items.map((item) => ({
        id: item.id,
        label: "??? ??? ??",
        done: false,
      })),
    },
  };
}

describe("아모라가 쓰는 체크리스트 이름은 템플릿에서 온다", () => {
  it("저장값이 깨져 있어도 사람이 읽는 이름을 안다", () => {
    const labels = collectAmoraChecklistLabels(corruptedProgress());
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).toContain(CATEGORY!.items[0]!.label);
    // 깨진 저장 라벨은 아모라에게 가지 않는다.
    expect(labels).not.toContain("??? ??? ??");
  });

  it("사용자가 화면에서 읽은 이름 그대로 말하면 알아본다", () => {
    const labels = collectAmoraChecklistLabels(corruptedProgress());
    const shown = mergePlanningChecklist(
      CATEGORY!.items,
      corruptedProgress()[CATEGORY!.key]!.checklist as never,
    );
    // 화면이 보여주는 이름 == 아모라가 아는 이름
    expect(shown[0]!.label).toBe(CATEGORY!.items[0]!.label);
    expect(
      mentionsKnownChecklistItem(`${shown[0]!.label} 끝냈어`, labels),
    ).toBe(true);
  });

  it("아직 열지 않은 분야의 항목은 세지 않는다", () => {
    // 없는 항목을 완료 처리하겠다고 나서면 안 된다.
    expect(collectAmoraChecklistLabels({})).toEqual([]);
    expect(collectAmoraChecklistLabels({ [CATEGORY!.key]: null })).toEqual([]);
  });

  it("이상한 입력에 터지지 않는다", () => {
    for (const value of [null, undefined, 0, "x", []]) {
      expect(collectAmoraChecklistLabels(value)).toEqual([]);
    }
  });
});
