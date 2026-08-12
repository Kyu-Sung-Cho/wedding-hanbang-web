import { describe, expect, it } from "vitest";
import { buildDueMomentCells } from "../momentLoop";
import { SCHEDULE_CARE_MOMENT_OPTIONS } from "@hanbang/shared";
import { EVENT_MOMENT_TYPES, MOMENTS } from "@/constants/moments";
import type { ScheduleEvent } from "@/types/database.types";
import { addEvent } from "@/utils/scheduleEvents";

// 기준 시각 고정: 2026-06-15 12:00 KST (= 03:00 UTC) → 오늘(KST) = 2026-06-15
const NOW = new Date("2026-06-15T03:00:00Z");

function eventProgress(
  date: string,
  momentType = "sanggyeonrye",
  status?: ScheduleEvent["status"],
) {
  return {
    __events: [
      {
        id: "evt_test",
        date,
        title: "상견례",
        momentType,
        ...(status ? { status } : {}),
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ],
  };
}

describe("모멘트 루프 — D-3/D-1/D+1 셀 계산 (KST 기준)", () => {
  it("웹과 모바일의 선택 목록은 실제 event-triggered 모멘트 카탈로그와 일치한다", () => {
    expect(SCHEDULE_CARE_MOMENT_OPTIONS.map((option) => option.value).sort()).toEqual(
      [...EVENT_MOMENT_TYPES].sort(),
    );
    for (const option of SCHEDULE_CARE_MOMENT_OPTIONS) {
      expect(MOMENTS[option.value]).toMatchObject({
        label: option.label,
        trigger: "event",
      });
    }
  });

  it("사용자가 명시적으로 고른 타입은 저장 payload를 거쳐 케어 셀로 이어진다", () => {
    const { newProgress, newEvent } = addEvent({}, {
      date: "2026-06-16",
      title: "가족과 저녁 식사",
      momentType: "sanggyeonrye",
    });

    expect(newEvent.momentType).toBe("sanggyeonrye");
    expect(buildDueMomentCells({ progress: newProgress, now: NOW })).toEqual([
      expect.objectContaining({
        cellKind: "d1",
        momentType: "sanggyeonrye",
        sourceEventId: newEvent.id,
      }),
    ]);
  });

  it("모멘트 3일 전이면 d3 셀이 나온다", () => {
    const cells = buildDueMomentCells({ progress: eventProgress("2026-06-18"), now: NOW });
    expect(cells).toHaveLength(1);
    expect(cells[0].cellKind).toBe("d3");
    expect(cells[0].momentType).toBe("sanggyeonrye");
    expect(cells[0].dedupeKey).toBe("sanggyeonrye:d3:2026-06-18:evt_test");
    expect(cells[0].sourceEventId).toBe("evt_test");
  });

  it("모멘트 하루 전이면 d1 셀(체크리스트 포함)이 나온다", () => {
    const cells = buildDueMomentCells({ progress: eventProgress("2026-06-16"), now: NOW });
    expect(cells).toHaveLength(1);
    expect(cells[0].cellKind).toBe("d1");
    // d1 메시지에 체크리스트가 조립되어 들어간다
    expect(cells[0].message).toContain("✓");
  });

  it("이미 완료한 일정은 다시 독촉하지 않는다", () => {
    const progress = eventProgress("2026-06-16", "sanggyeonrye", "completed");

    expect(buildDueMomentCells({ progress, now: NOW })).toEqual([]);
  });

  it("취소된 일정은 D-3, D-1, D+1 케어 후보에서 제외한다", () => {
    const progress = {
      __events: [{
        ...eventProgress("2026-06-16", "sanggyeonrye").__events[0],
        status: "cancelled",
        cancellation: {
          cancelledAt: "2026-06-15T01:00:00.000Z",
          cancelledByProfileId: "7ec381b3-c70a-4f59-a6cc-6bdf76f95ab2",
        },
      }],
    };

    expect(buildDueMomentCells({ progress, now: NOW })).toEqual([]);
  });

  it("모멘트 다음날이면 dAfter 셀 + 기억 저장 키가 나온다", () => {
    const cells = buildDueMomentCells({ progress: eventProgress("2026-06-14"), now: NOW });
    expect(cells).toHaveLength(1);
    expect(cells[0].cellKind).toBe("dAfter");
    expect(cells[0].memoryKeys).toEqual(MOMENTS.sanggyeonrye.memoryKeys);
  });

  it("d3/d1 셀에는 기억 키가 없다 (D+1 답변에서만 수집)", () => {
    const cells = buildDueMomentCells({ progress: eventProgress("2026-06-18"), now: NOW });
    expect(cells[0].memoryKeys).toEqual([]);
  });

  it("해당 없는 날짜(D-10, D-2, 당일)에는 아무것도 발화하지 않는다", () => {
    for (const date of ["2026-06-25", "2026-06-17", "2026-06-15"]) {
      const cells = buildDueMomentCells({ progress: eventProgress(date), now: NOW });
      expect(cells, date).toHaveLength(0);
    }
  });

  it("KST 자정 경계: UTC로는 전날 밤이어도 KST 날짜 기준으로 계산한다", () => {
    // 2026-06-15 16:30 UTC = 2026-06-16 01:30 KST → KST 오늘 = 06-16 → 06-17 모멘트는 d1
    const lateNight = new Date("2026-06-15T16:30:00Z");
    const cells = buildDueMomentCells({ progress: eventProgress("2026-06-17"), now: lateNight });
    expect(cells).toHaveLength(1);
    expect(cells[0].cellKind).toBe("d1");
  });

  it("momentType이 없는 일반 일정은 발화하지 않는다", () => {
    const progress = {
      __events: [
        {
          id: "evt_plain",
          date: "2026-06-16",
          title: "드레스샵 방문",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    };
    const cells = buildDueMomentCells({ progress, now: NOW });
    expect(cells).toHaveLength(0);
  });

  it("알 수 없는 기존 momentType은 보존 대상이지만 케어 발화로 추측하지 않는다", () => {
    expect(buildDueMomentCells({
      progress: eventProgress("2026-06-16", "future_supported_moment"),
      now: NOW,
    })).toEqual([]);
  });

  it("예식일 기반 자동 모멘트: 예식 3일 전이면 본식 d3가 발화한다", () => {
    const cells = buildDueMomentCells({ weddingDate: "2026-06-18", progress: {}, now: NOW });
    expect(cells.some((cell) => cell.momentType === "wedding_day" && cell.cellKind === "d3")).toBe(
      true
    );
  });

  it("우선순위: 같은 날 d1이 d3보다 먼저 온다", () => {
    const progress = {
      __events: [
        {
          id: "evt_a",
          date: "2026-06-18", // D-3
          title: "상견례",
          momentType: "sanggyeonrye",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
        {
          id: "evt_b",
          date: "2026-06-16", // D-1
          title: "양가 첫인사",
          momentType: "family_greeting",
          createdAt: "2026-06-01T00:00:00Z",
          updatedAt: "2026-06-01T00:00:00Z",
        },
      ],
    };
    const cells = buildDueMomentCells({ progress, now: NOW });
    expect(cells).toHaveLength(2);
    expect(cells[0].cellKind).toBe("d1");
    expect(cells[1].cellKind).toBe("d3");
  });

  it("같은 momentType이라도 날짜가 다르면 dedupeKey가 다르다", () => {
    const a = buildDueMomentCells({ progress: eventProgress("2026-06-18"), now: NOW })[0];
    const b = buildDueMomentCells({ progress: eventProgress("2026-06-16"), now: NOW })[0];
    expect(a.dedupeKey).not.toBe(b.dedupeKey);
  });

  it("같은 event ID가 반복된 경우에만 하나의 care cell로 축약한다", () => {
    const duplicate = eventProgress("2026-07-17", "sanggyeonrye").__events[0];
    const cells = buildDueMomentCells({
      progress: { __events: Array.from({ length: 300 }, () => ({ ...duplicate })) },
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(cells.filter((cell) => cell.dedupeKey === "sanggyeonrye:d1:2026-07-17:evt_test")).toHaveLength(1);
  });

  it("같은 날짜와 타입이어도 서로 다른 실제 일정은 각각 유지한다", () => {
    const first = eventProgress("2026-07-17", "sanggyeonrye").__events[0];
    const cells = buildDueMomentCells({
      progress: {
        __events: [
          { ...first, id: "evt_first", title: "첫 번째 상견례 일정" },
          { ...first, id: "evt_second", title: "두 번째 상견례 일정" },
        ],
      },
      now: new Date("2026-07-16T03:00:00.000Z"),
    });

    expect(cells.map((cell) => cell.sourceEventId).sort()).toEqual([
      "evt_first",
      "evt_second",
    ]);
  });
});
