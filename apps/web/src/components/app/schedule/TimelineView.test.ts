import { describe, expect, it } from "vitest";

import { PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared";
import { CATEGORY_CHECKLISTS } from "@/constants/checklists";
import { buildPhases, formatTimelineStatusChip } from "./TimelineView";

describe("일정 시간축 상태 칩", () => {
  it("예산 화면과 같은 상태 이름을 쓴다", () => {
    expect(formatTimelineStatusChip("not_started", false)).toBe(PREPARATION_PROGRESS_STATUS_LABELS.not_started);
    expect(formatTimelineStatusChip("in_progress", true)).toBe(PREPARATION_PROGRESS_STATUS_LABELS.in_progress);
    expect(formatTimelineStatusChip("completed", true)).toBe(PREPARATION_PROGRESS_STATUS_LABELS.completed);
    expect(formatTimelineStatusChip("not_applicable", true)).toBe(PREPARATION_PROGRESS_STATUS_LABELS.not_applicable);
  });

  it("세부 항목 없이 고른 상태는 조사를 받침에 맞춰 붙이고, '안 해요' 는 그대로 둔다", () => {
    expect(formatTimelineStatusChip("in_progress", false)).toBe("준비 중으로 입력");
    expect(formatTimelineStatusChip("completed", false)).toBe("완료로 입력");
    expect(formatTimelineStatusChip("not_applicable", false)).toBe("안 해요");
  });

  it("예전 이름을 쓰지 않는다", () => {
    for (const status of ["not_started", "in_progress", "completed", "not_applicable"] as const) {
      for (const hasItemProgress of [true, false]) {
        expect(formatTimelineStatusChip(status, hasItemProgress)).not.toMatch(/진행중|시작전|해당 없음|완료으로/);
      }
    }
  });
});

describe("일정 단계 구간", () => {
  it("각 단계의 날짜 범위와 월 표기가 같은 기준을 사용한다", () => {
    const phases = buildPhases();

    expect(phases.map((phase) => phase.dday)).toEqual([
      "D-390 ~ D-300",
      "D-270 ~ D-240",
      "D-180 ~ D-120",
      "D-90 ~ D-60",
    ]);
    expect(phases.map((phase) => phase.period)).toEqual([
      "약 13~10개월 전",
      "약 9~8개월 전",
      "약 6~4개월 전",
      "약 3~2개월 전",
    ]);
  });

  it("기본 카테고리를 빠뜨리거나 두 단계에 중복 배치하지 않는다", () => {
    const phaseKeys = buildPhases().flatMap((phase) =>
      phase.categories.map((category) => category.key),
    );
    const templateKeys = CATEGORY_CHECKLISTS.map((category) => category.key);

    expect(new Set(phaseKeys).size).toBe(phaseKeys.length);
    expect([...phaseKeys].sort()).toEqual([...templateKeys].sort());
  });
});
