import { describe, expect, it } from "vitest";

import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import {
  calculatePlanningChecklistStatus,
  resolvePlanningChecklistStatus,
  type PlanningChecklistItem,
} from "@hanbang/shared/utils";

/**
 * 항목이 늘어난 뒤에도 화면이 맞는 상태를 말하는지 본다.
 *
 * `progress.status`는 저장된 값인데 **템플릿에 항목이 늘면 낡는다.** 열한 개를 다 끝내
 * `completed`로 저장된 분야에 열두 번째가 생기면, 화면은 개수를 병합본에서 세고 상태는
 * 저장값을 써서 `11/12개 완료 · 완료`가 된다. 더 나쁜 것은 라운지 '지금 할 일'과 마감
 * 알림이 저장값만 보고 그 분야를 **통째로 숨기는** 것이다. 새 항목이 안 보이니 열지 않고,
 * 열지 않으니 저장값이 갱신될 계기도 없다.
 *
 * 그런데 저장값을 전부 파생으로 갈아치우면 안 된다. `status`에는 두 종류가 섞여 있다 —
 * 항목에서 파생한 캐시와, 항목 없이 저장된 **분야 단위 선언**(온보딩 "이건 이미 했어요",
 * 대시보드 세 버튼 피커, 아모라 `update_task_status`)이다. 서버도 `checklist` 키가 없는
 * 행을 통과시켜 이 모양을 계약으로 인정한다(`api/journey/route.ts:199`).
 *
 * 그래서 가르는 표지는 **저장된 `checklist` 배열의 유무**다. 이 파일은 세 갈래가 각각
 * 제 몫을 하는지 본다.
 */
describe("낡은 분야 상태", () => {
  /**
   * "항목이 늘기 전"을 흉내 낸다 — 마지막 항목 하나를 잘라내고 나머지를 전부 done으로.
   * 자매 파일 `checklistSavedState.test.ts`가 쓰는 방법과 같다.
   */
  function savedBeforeLastItemWasAdded(items: readonly PlanningChecklistItem[]) {
    return items.slice(0, -1).map((item) => ({ id: item.id, label: item.label, done: true }));
  }

  it("판별식이 실제로 무언가를 고른다", () => {
    // 잘라낼 항목이 없으면 아래 검사는 늘 통과한다. 먼저 표본이 있는지 본다.
    const cuttable = CATEGORY_CHECKLISTS.filter((category) => category.items.length >= 2);
    expect(cuttable.length).toBe(CATEGORY_CHECKLISTS.length);
    expect(cuttable.length).toBeGreaterThan(15);
  });

  it("항목이 늘면 저장된 완료는 진행 중으로 되살아난다 — 분야 전부", () => {
    const stillSaysCompleted = CATEGORY_CHECKLISTS.filter((category) => {
      const saved = {
        status: "completed" as const,
        checklist: savedBeforeLastItemWasAdded(category.items),
      };
      return resolvePlanningChecklistStatus(category.items, saved) !== "in_progress";
    });

    expect(
      stillSaysCompleted.map((category) => category.key),
      "새 항목이 생겼는데도 완료라고 말하면 라운지가 그 항목을 영원히 숨긴다",
    ).toEqual([]);
  });

  it("항목 기록이 없는 분야 단위 선언은 그대로 둔다", () => {
    // 온보딩에서 "이건 이미 했어요"를 고르면 항목 없이 status만 저장된다.
    // 여기서 파생하면 0/12 "시작 전"이 되어 낡은 "완료"보다 나쁘다.
    for (const category of CATEGORY_CHECKLISTS) {
      expect(
        resolvePlanningChecklistStatus(category.items, { status: "completed" }),
        `${category.key}: 온보딩 선언이 파생에 덮였다`,
      ).toBe("completed");
      expect(
        resolvePlanningChecklistStatus(category.items, { status: "in_progress", checklist: [] }),
        `${category.key}: 빈 배열은 근거가 아니다`,
      ).toBe("in_progress");
      expect(resolvePlanningChecklistStatus(category.items, undefined)).toBe("not_started");
    }
  });

  it("\"안 해요\"는 항목을 다 채워도 뒤집히지 않는다", () => {
    // 파생은 이 값을 만들 수 없다(`calculatePlanningChecklistStatus`의 반환형이 제외한다).
    // 이 갈래가 유일한 방어선이고, 뚫리면 함·폐백을 생략한 커플에게 지워지지 않는 할 일이 생긴다.
    // 전부 done인 픽스처로 심어야 "파생이 우연히 같은 값을 냈다"가 아님을 보인다.
    for (const category of CATEGORY_CHECKLISTS) {
      const allDone = category.items.map((item) => ({ ...item, done: true }));
      expect(calculatePlanningChecklistStatus(allDone)).toBe("completed");
      expect(
        resolvePlanningChecklistStatus(category.items, {
          status: "not_applicable",
          checklist: allDone,
        }),
        `${category.key}: "안 해요"가 완료로 뒤집혔다`,
      ).toBe("not_applicable");
    }
  });

  /**
   * 화이트리스트는 두 호출부(라운지·대시보드)가 각각 갖고 있던 것을 리졸버로 모은 것이다.
   * 옮기고 나서 이 검사를 안 붙였더니 화이트리스트를 통째로 지워도 초록불이었다 —
   * 변형 시험이 잡았다. DB에 옛 형식이나 알 수 없는 값이 남아 있어도 화면이 그것을
   * 그대로 그리면 안 된다.
   */
  it("알 수 없는 저장값은 그리지 않는다", () => {
    const category = CATEGORY_CHECKLISTS[0];
    for (const garbage of ["archived", "done", "COMPLETED", "", "완료"]) {
      expect(
        resolvePlanningChecklistStatus(category.items, { status: garbage } as never),
        `"${garbage}"가 그대로 화면에 나간다`,
      ).toBe("not_started");
    }
    // 항목 기록이 있으면 이상한 값과 무관하게 병합본에서 파생한다.
    expect(
      resolvePlanningChecklistStatus(category.items, {
        status: "archived",
        checklist: category.items.map((item) => ({ ...item, done: true })),
      } as never),
    ).toBe("completed");
  });

  /**
   * 서버는 **제출된 status가 제출된 checklist의 파생값과 같은지** 검증하고, 다르면 저장을
   * 거부한다(`api/journey/route.ts:221-227`). 그 판정식은 인라인 사본이고 리졸버가 세 번째
   * 사본이 된다. 항목이 늘지 않은 평상시에 셋이 같은 답을 내지 않으면 "읽기는 파생, 쓰기는
   * 거부" 같은 교착이 조용히 생긴다.
   */
  it("항목이 늘지 않았으면 리졸버와 서버 검증식이 같은 답을 낸다", () => {
    // route.ts:222-226의 축자 사본. 저쪽이 바뀌면 이 검사가 어긋나야 한다.
    function serverDerived(checklist: readonly PlanningChecklistItem[]) {
      const doneCount = checklist.filter((item) => item.done).length;
      return doneCount === 0 || checklist.length === 0
        ? "not_started"
        : doneCount === checklist.length
          ? "completed"
          : "in_progress";
    }

    const disagreed: string[] = [];
    for (const category of CATEGORY_CHECKLISTS) {
      const shapes = [
        category.items.map((item) => ({ ...item, done: false })),
        category.items.map((item) => ({ ...item, done: true })),
        category.items.map((item, index) => ({ ...item, done: index === 0 })),
      ];
      for (const checklist of shapes) {
        const server = serverDerived(checklist);
        const resolved = resolvePlanningChecklistStatus(category.items, {
          status: server,
          checklist,
        });
        if (resolved !== server) disagreed.push(`${category.key}: ${resolved} ≠ ${server}`);
      }
    }
    expect(disagreed).toEqual([]);
  });
});
