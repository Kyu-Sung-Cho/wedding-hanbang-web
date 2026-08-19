import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { mergePlanningChecklist } from "@hanbang/shared/utils";

/**
 * 2026-08-19에 계약금 앞 확인 항목 9개를 넣으면서 템플릿이 132 → 141개가 됐다.
 * 사용자의 완료 기록은 DB에 **id로** 저장돼 있으므로, 번호를 다시 매기거나 id가
 * 바뀌면 이미 체크한 것이 풀린다. 항목을 추가하기 전 상태를 흉내 내서 실제로
 * 어긋나는지 돌려본다.
 */
describe("항목 추가가 기존 체크 기록을 건드리지 않는다", () => {
  const NEW_IDS = new Set([
    "venue_09",
    "studio_09",
    "studio_10",
    "ring_09",
    "ring_10",
    "snap_08",
    "snap_09",
    "housing_08",
    "housing_09",
  ]);

  it("추가 전에 전부 체크해 둔 사용자의 기록이 그대로 남는다", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      // 어제 상태 = 새 항목을 뺀 목록, 전부 완료로 저장돼 있었다고 가정
      const saved = category.items
        .filter((item) => !NEW_IDS.has(item.id))
        .map((item) => ({ ...item, done: true }));

      const merged = mergePlanningChecklist(category.items, saved);

      const lost = merged.filter((item) => !NEW_IDS.has(item.id) && !item.done);
      expect(lost.map((i) => i.id), `${category.key}: 체크가 풀린 항목`).toEqual([]);

      const added = merged.filter((item) => NEW_IDS.has(item.id));
      expect(added.every((item) => item.done === false), `${category.key}: 새 항목이 완료로 들어감`).toBe(true);

      expect(merged).toHaveLength(category.items.length);
    }
  });

  it("한 항목도 체크 안 한 사용자와 기록이 아예 없는 사용자도 깨지지 않는다", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      expect(mergePlanningChecklist(category.items, [])).toHaveLength(category.items.length);
      expect(mergePlanningChecklist(category.items, undefined)).toHaveLength(category.items.length);
    }
  });

  it("id가 중복되거나 사라진 것이 없다", () => {
    const ids = CATEGORY_CHECKLISTS.flatMap((c) => c.items.map((i) => i.id));
    expect(new Set(ids).size, "중복 id").toBe(ids.length);
    for (const id of NEW_IDS) {
      expect(ids, `${id}가 템플릿에 없다`).toContain(id);
    }
  });
});
