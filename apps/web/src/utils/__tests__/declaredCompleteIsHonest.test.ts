import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import { PREPARATION_STAGE_OPTIONS } from "@hanbang/shared/constants";
import { isPlanningChecklistStatusDeclared } from "@hanbang/shared/utils";

/**
 * "체크를 다 안 했는데 완료라고 뜬다" (2026-08-22 파운더 제보).
 *
 * 고장이 아니었다. 온보딩에서 **"준비 단계" 한 줄**을 고르면 여러 분야가 한꺼번에
 * 완료로 채워지고(`preparationStage.ts`의 `suggested`), 그 분야는 항목 기록 없이
 * 상태만 저장된다. 그러면 화면이 개수와 상태를 나란히 써서 **`0/9개 완료 · 완료`** 가 된다.
 *
 * 두 가지를 고쳤고 이 파일이 둘 다 지킨다.
 *
 * 1. **화면이 구분해서 말한다** — 항목 기록이 없으면 개수 대신 "완료로 표시함 · 항목은
 *    확인 전". 상태를 바꾸지는 않는다. 선언을 파생으로 덮으면 온보딩에서 "이미 했어요"라고
 *    한 분야가 전부 "시작 전"으로 뒤집힌다.
 * 2. **근거 없는 제안을 뺐다** — 세 단계가 상견례를 완료로 제안했는데, 어느 문장도
 *    상견례를 말하지 않는다.
 */
describe("선언된 완료를 정직하게 말한다", () => {
  const category = CATEGORY_CHECKLISTS[0];

  describe("선언인지 아닌지 가른다", () => {
    it("항목 기록이 없으면 선언이다", () => {
      expect(isPlanningChecklistStatusDeclared({ status: "completed" })).toBe(true);
      expect(isPlanningChecklistStatusDeclared({ status: "in_progress" })).toBe(true);
      expect(isPlanningChecklistStatusDeclared({ status: "completed", checklist: [] })).toBe(true);
    });

    it("항목 기록이 있으면 선언이 아니다", () => {
      const checklist = category.items.map((item) => ({ ...item, done: true }));
      expect(isPlanningChecklistStatusDeclared({ status: "completed", checklist })).toBe(false);
    });

    it("아직 시작 안 한 분야와 \"안 해요\"는 선언으로 치지 않는다", () => {
      // 이 둘은 화면이 이미 제 나름의 문구를 갖고 있다. 여기까지 "표시함"으로 바꾸면
      // 아무것도 안 한 분야가 뭔가 한 것처럼 읽힌다.
      expect(isPlanningChecklistStatusDeclared({ status: "not_started" })).toBe(false);
      expect(isPlanningChecklistStatusDeclared({ status: "not_applicable" })).toBe(false);
      expect(isPlanningChecklistStatusDeclared(undefined)).toBe(false);
    });
  });

  describe("준비 단계 제안은 사용자가 고른 문장이 말한 것만 담는다", () => {
    it("어느 단계도 상견례를 완료로 제안하지 않는다", () => {
      // "결혼식장을 계약했어요" / "촬영·드레스·메이크업을 진행 중이에요" /
      // "거의 마무리 단계예요" — 셋 다 계약·예약에 관한 말이고 상견례는 가족을 만나는
      // 일이다. 식장을 먼저 잡고 상견례를 나중에 하는 커플이 많다.
      const offenders = PREPARATION_STAGE_OPTIONS
        .filter((option) => option.suggested.meeting !== undefined)
        .map((option) => `${option.value}: meeting=${option.suggested.meeting}`);

      expect(offenders, "사용자가 말한 적 없는 것을 본인 기록으로 만든다").toEqual([]);
    });

    it("판별식이 실제로 제안을 읽어낸다", () => {
      // 제안이 전부 비어 있으면 위 검사는 늘 통과한다. 먼저 표본이 있는지 본다.
      const withSuggestions = PREPARATION_STAGE_OPTIONS
        .filter((option) => Object.keys(option.suggested).length > 0);
      expect(withSuggestions.length).toBeGreaterThan(2);
      // 식장은 남아 있어야 한다 — "결혼식장을 계약했어요"가 실제로 말한 것이다.
      expect(
        PREPARATION_STAGE_OPTIONS.find((o) => o.value === "venue_booked")?.suggested.venue,
      ).toBe("completed");
    });
  });
});
