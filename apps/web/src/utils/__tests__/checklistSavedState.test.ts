import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { mergePlanningChecklist, stripPlanningChecklistNotes } from "@hanbang/shared/utils";

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

/**
 * `note`는 템플릿이 소유한 제품 문구다. 사용자 행에는 들어가지 않아야 한다 —
 * 들어가면 문구를 고친 뒤에도 옛 문장 사본이 DB에 남고, 사용자 데이터와 제품 카피가
 * 섞인다. 저장 모양은 note를 들이기 전과 정확히 같아야 한다.
 */
describe("항목 안내 문구는 사용자 데이터가 아니다", () => {
  const withNotes = CATEGORY_CHECKLISTS.flatMap((c) => c.items).filter((i) => i.note);

  it("실제로 안내가 붙은 항목이 있다", () => {
    expect(withNotes.length).toBeGreaterThan(0);
  });

  it("저장 payload에는 안내가 실리지 않는다", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      const merged = mergePlanningChecklist(category.items, undefined);
      const stored = stripPlanningChecklistNotes(merged);

      expect(stored.some((item) => "note" in item), `${category.key}`).toBe(false);
      expect(stored.map((i) => i.id)).toEqual(merged.map((i) => i.id));
      expect(stored.map((i) => i.done)).toEqual(merged.map((i) => i.done));
    }
  });

  it("안내 없이 저장된 기록을 다시 읽으면 템플릿 문구가 되살아난다", () => {
    for (const category of CATEGORY_CHECKLISTS) {
      const saved = stripPlanningChecklistNotes(
        category.items.map((item) => ({ ...item, done: true })),
      );
      const merged = mergePlanningChecklist(category.items, saved);

      for (const item of category.items) {
        const back = merged.find((m) => m.id === item.id);
        expect(back?.note, `${category.key}/${item.id}`).toBe(item.note);
        expect(back?.done).toBe(true);
      }
    }
  });

  it("문구가 바뀌어도 저장된 옛 문장이 화면을 이기지 않는다", () => {
    const target = withNotes[0];
    const category = CATEGORY_CHECKLISTS.find((c) => c.items.some((i) => i.id === target.id))!;
    const stale = category.items.map((item) =>
      item.id === target.id ? { ...item, note: "예전에 저장된 옛 문장이에요.", done: true } : { ...item },
    );

    const merged = mergePlanningChecklist(category.items, stale);
    expect(merged.find((m) => m.id === target.id)?.note).toBe(target.note);
  });
});
