import { describe, expect, it } from "vitest";

import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";

/**
 * 아모라가 "완료로 바꿨어요" 라고 말한 뒤 어느 화면도 안 바뀌었다.
 *
 *     /checklist 에서 결혼식장 항목 9개 중 3개를 체크한다
 *     아모라에게 "예식장은 이제 다 끝났어. 완료로 바꿔줘"
 *     → 카드 → 확인 → "결혼식장을 완료로 변경했어요"
 *     → 체크리스트 화면: 그대로 "진행 중"
 *     → 다음 턴에 아모라도 "진행 중" 이라고 말한다
 *
 * 체크리스트 배열이 있는 분야는 저장된 `status` 가 **완전히 무시되고** 항목에서
 * 파생된다(resolvePlanningChecklistStatus). 즉 보이지 않는 쓰기였다.
 *
 * 항목을 대신 체크해 주지는 않는다 — 사용자가 하지 않은 일을 했다고 적는 것이다.
 * 대신 왜 안 바뀌는지 말하고 다음 행동을 제안한다.
 */

const CONTEXT = (checklist: { id: string; label: string; done: boolean }[]) => ({
  coupleId: "11111111-1111-4111-8111-111111111111",
  weddingContext: {
    progress: {
      venue: { category: "venue", status: "in_progress", checklist },
    },
  },
});

const NINE = (doneCount: number) =>
  Array.from({ length: 9 }, (_, index) => ({
    id: `venue_0${index + 1}`,
    label: `항목 ${index + 1}`,
    done: index < doneCount,
  }));

describe("화면이 보여줄 수 없는 상태로는 바꾸지 않는다", () => {
  it("항목이 덜 끝났으면 완료로 바꾸지 않고 이유를 말한다", () => {
    const op = buildAmoraAtomicToolOperation(
      "update_task_status",
      { category: "venue", status: "completed" },
      CONTEXT(NINE(3)) as never,
      "a".repeat(64),
    );
    expect(op.domainMutation).toEqual({ kind: "none" });
    expect(op.result.success).toBe(false);
    expect(op.result.displayMessage).toContain("9개 중 3개");
    expect(op.result.displayMessage).toContain("진행 중");
  });

  it("항목이 다 끝났으면 완료로 바꾼다", () => {
    const op = buildAmoraAtomicToolOperation(
      "update_task_status",
      { category: "venue", status: "completed" },
      CONTEXT(NINE(9)) as never,
      "b".repeat(64),
    );
    expect(op.result.success).toBe(true);
    expect(op.domainMutation).not.toEqual({ kind: "none" });
  });

  it("체크리스트가 없는 분야는 그대로 바꾼다", () => {
    const op = buildAmoraAtomicToolOperation(
      "update_task_status",
      { category: "venue", status: "completed" },
      {
        coupleId: "11111111-1111-4111-8111-111111111111",
        weddingContext: { progress: { venue: { category: "venue", status: "in_progress" } } },
      } as never,
      "c".repeat(64),
    );
    expect(op.result.success).toBe(true);
  });

  it("항목이 하나도 안 끝났는데 진행 중으로 바꾸려 하면 막는다", () => {
    const op = buildAmoraAtomicToolOperation(
      "update_task_status",
      { category: "venue", status: "in_progress" },
      {
        coupleId: "11111111-1111-4111-8111-111111111111",
        weddingContext: {
          progress: { venue: { category: "venue", status: "completed", checklist: NINE(0) } },
        },
      } as never,
      "d".repeat(64),
    );
    // 항목이 0개 완료면 화면은 "시작 전"으로 보인다.
    expect(op.domainMutation).toEqual({ kind: "none" });
    expect(op.result.displayMessage).toContain("9개 중 0개");
  });
});
