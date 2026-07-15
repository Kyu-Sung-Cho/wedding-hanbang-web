import { describe, expect, it } from "vitest";
import { buildDueMomentCells } from "../momentLoop";
import { MOMENTS } from "@/constants/moments";

// 기준 시각 고정: 2026-06-15 12:00 KST (= 03:00 UTC) → 오늘(KST) = 2026-06-15
const NOW = new Date("2026-06-15T03:00:00Z");

function eventProgress(date: string, momentType = "sanggyeonrye") {
  return {
    __events: [
      {
        id: "evt_test",
        date,
        title: "상견례",
        momentType,
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-01T00:00:00Z",
      },
    ],
  };
}

describe("모멘트 루프 — D-3/D-1/D+1 셀 계산 (KST 기준)", () => {
  it("모멘트 3일 전이면 d3 셀이 나온다", () => {
    const cells = buildDueMomentCells({ progress: eventProgress("2026-06-18"), now: NOW });
    expect(cells).toHaveLength(1);
    expect(cells[0].cellKind).toBe("d3");
    expect(cells[0].momentType).toBe("sanggyeonrye");
    expect(cells[0].dedupeKey).toBe("sanggyeonrye:d3:2026-06-18");
  });

  it("모멘트 하루 전이면 d1 셀(체크리스트 포함)이 나온다", () => {
    const cells = buildDueMomentCells({ progress: eventProgress("2026-06-16"), now: NOW });
    expect(cells).toHaveLength(1);
    expect(cells[0].cellKind).toBe("d1");
    // d1 메시지에 체크리스트가 조립되어 들어간다
    expect(cells[0].message).toContain("✓");
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

  it("예식일 기반 자동 모멘트: 예식 3일 전이면 본식 d3가 발화한다", () => {
    const cells = buildDueMomentCells({ weddingDate: "2026-06-18", progress: {}, now: NOW });
    expect(cells.some((cell) => cell.momentType === "wedding_day" && cell.cellKind === "d3")).toBe(
      true
    );
  });

  it("does not invent a honeymoon or family-visit date from the wedding date", () => {
    const cells = buildDueMomentCells({ weddingDate: "2026-06-15", progress: {}, now: NOW });

    expect(cells.map((cell) => cell.momentType)).not.toContain("honeymoon_departure");
    expect(cells.map((cell) => cell.momentType)).not.toContain("family_visit_after");
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
});
