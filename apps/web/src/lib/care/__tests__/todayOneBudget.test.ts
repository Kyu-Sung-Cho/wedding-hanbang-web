import { describe, expect, it } from "vitest";

import {
  buildTodayOneBudgetGuardrailCandidates,
} from "@/lib/care/todayOneBudget";
import {
  buildTodayOneScheduleCandidates,
  mergeTodayOneCandidates,
  mergeTodayOneCandidatesWithHistory,
} from "@/lib/care/todayOne";

const TOTAL_BUDGET = 30_000_000;

function progressItem(overrides: Record<string, unknown> = {}) {
  return {
    status: "in_progress",
    ...overrides,
  };
}

describe("TodayOne recorded-spend-only budget guardrails", () => {
  it("creates a neutral total guardrail from explicit recorded spend only", () => {
    const candidates = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: TOTAL_BUDGET,
      progress: {
        venue: progressItem({ spent: 31_000_000, cost: 900_000_000 }),
      },
      stateRevision: 9,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      kind: "budget_guardrail",
      sourceKey: "budget:recorded-total-over-total",
      sourceRevision: 9,
      priority: 300,
      whyNow: "직접 기록한 지출 합계가 설정한 총예산보다 커졌어요.",
      confirmed: [
        "설정 총예산: 30,000,000원",
        "기록 지출 합계: 31,000,000원",
      ],
      nextAction: { label: "예산 열기", href: "/budget" },
    });
    expect(candidates[0].unknown).toContain("기록 지출은 결제 완료 증빙이 아님");
    expect(JSON.stringify(candidates[0])).not.toMatch(/큰일|위험|잘못|실패|당장/);
  });

  it("never treats legacy cost, a quote, or a planned amount as recorded spend", () => {
    const onlyNonSpendFields = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: 1_000_000,
      progress: {
        venue: progressItem({
          cost: 9_000_000,
          quote: 8_000_000,
          plannedAmount: 7_000_000,
        }),
      },
      stateRevision: 1,
    });
    expect(onlyNonSpendFields).toEqual([]);

    const first = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: 1_000_000,
      progress: {
        venue: progressItem({
          spent: 1_100_000,
          cost: 1,
          quote: 2,
          plannedAmount: 3,
        }),
        __booking_costs: { quotedTotal: 4 },
      },
      stateRevision: 1,
    })[0];
    const legacyCostChanged = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: 1_000_000,
      progress: {
        venue: progressItem({
          spent: 1_100_000,
          cost: 999_999_999,
          quote: 888_888_888,
          plannedAmount: 777_777_777,
        }),
        __booking_costs: { quotedTotal: 666_666_666 },
      },
      stateRevision: 2,
    })[0];

    expect(first.sourceKey).toBe(legacyCostChanged.sourceKey);
    expect(first.sourceStateDigest).toBe(legacyCostChanged.sourceStateDigest);
  });

  it("separates category overspend from over-allocation using explicit fields", () => {
    const candidates = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: TOTAL_BUDGET,
      progress: {
        dress: progressItem({ budget: 5_000_000, spent: 6_000_000 }),
        venue: progressItem({ budget: 27_000_000, spent: 0 }),
      },
      stateRevision: 4,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.priority)).toEqual([250, 200]);
    expect(candidates[0]).toMatchObject({
      whyNow: "드레스·예식 정장에 기록한 지출이 이 항목의 설정 예산보다 커졌어요.",
      confirmed: [
        "항목: 드레스·예식 정장",
        "설정 항목 예산: 5,000,000원",
        "기록 지출: 6,000,000원",
      ],
    });
    expect(candidates[1]).toMatchObject({
      sourceKey: "budget:allocated-total-over-total",
      whyNow: "항목별 설정 예산 합계가 전체 예산보다 커졌어요.",
      confirmed: [
        "설정 총예산: 30,000,000원",
        "항목별 설정 예산 합계: 32,000,000원",
      ],
    });
    expect(candidates.every((candidate) => (
      candidate.unknown.includes("기록 지출은 결제 완료 증빙이 아님")
    ))).toBe(true);
  });

  it("fails closed for absent, zero, or malformed explicit budget data", () => {
    const base = { venue: progressItem({ spent: 2_000_000 }) };
    expect(buildTodayOneBudgetGuardrailCandidates({
      totalBudget: 0,
      progress: base,
      stateRevision: 1,
    })).toEqual([]);
    expect(buildTodayOneBudgetGuardrailCandidates({
      totalBudget: "1000000",
      progress: base,
      stateRevision: 1,
    })).toEqual([]);
    expect(buildTodayOneBudgetGuardrailCandidates({
      totalBudget: 1_000_000,
      progress: { venue: progressItem({ spent: "2000000" }) },
      stateRevision: 1,
    })).toEqual([]);
    expect(buildTodayOneBudgetGuardrailCandidates({
      totalBudget: 1_000_000,
      progress: { venue: progressItem({ spent: 2_000_000, budget: -1 }) },
      stateRevision: 1,
    })).toEqual([]);
  });

  it("keeps category source identity stable while changing its relevant digest", () => {
    const first = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: TOTAL_BUDGET,
      progress: {
        custom_photo: progressItem({ label: "본식 사진", budget: 1_000_000, spent: 1_100_000 }),
      },
      stateRevision: 7,
    }).find((candidate) => candidate.priority === 250)!;
    const changed = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: TOTAL_BUDGET,
      progress: {
        custom_photo: progressItem({ label: "본식 사진", budget: 1_000_000, spent: 1_200_000 }),
      },
      stateRevision: 8,
    }).find((candidate) => candidate.priority === 250)!;

    expect(first.sourceKey).toBe(changed.sourceKey);
    expect(first.sourceStateDigest).not.toBe(changed.sourceStateDigest);
  });

  it("merges schedule and budget candidates by fixed priority and stable source key", () => {
    const schedule = buildTodayOneScheduleCandidates({
      progress: {
        __events: [{
          id: "evt_a",
          date: "2026-08-03",
          time: "18:00",
          title: "상견례",
          momentType: "sanggyeonrye",
          status: "planned",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }],
      },
      stateRevision: 4,
      now: new Date("2026-08-02T03:00:00.000Z"),
    });
    const budget = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: TOTAL_BUDGET,
      progress: {
        custom_z: progressItem({ label: "Z 항목", budget: 1, spent: 2 }),
        custom_a: progressItem({ label: "A 항목", budget: 1, spent: 2 }),
      },
      stateRevision: 4,
    });

    const merged = mergeTodayOneCandidates(schedule, budget);
    expect(merged[0].kind).toBe("budget_guardrail");
    expect(merged.at(-1)?.kind).toBe("schedule_moment");
    const tiedCategoryKeys = merged
      .filter((candidate) => candidate.priority === 250)
      .map((candidate) => candidate.sourceKey);
    expect(tiedCategoryKeys).toEqual([...tiedCategoryKeys].sort());
  });

  it("rotates persistent budget episodes around an unseen D-1 schedule across days", () => {
    const schedule = buildTodayOneScheduleCandidates({
      progress: {
        __events: [{
          id: "evt_a",
          date: "2026-08-03",
          time: "18:00",
          title: "상견례",
          momentType: "sanggyeonrye",
          status: "planned",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }],
      },
      stateRevision: 4,
      now: new Date("2026-08-02T03:00:00.000Z"),
    });
    const budget = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: TOTAL_BUDGET,
      progress: {
        custom_z: progressItem({ label: "Z 항목", budget: 1, spent: 2 }),
        custom_a: progressItem({ label: "A 항목", budget: 1, spent: 2 }),
      },
      stateRevision: 4,
    });
    const [firstBudget, secondBudget] = budget;
    const d1 = schedule[0];

    const dayOne = mergeTodayOneCandidatesWithHistory([], schedule, budget);
    expect(dayOne[0].sourceKey).toBe(firstBudget.sourceKey);

    const dayOneHistory = [{
      sourceKey: firstBudget.sourceKey,
      sourceStateDigest: firstBudget.sourceStateDigest,
      claimedForDate: "2026-08-01",
    }];
    const dayTwo = mergeTodayOneCandidatesWithHistory(
      dayOneHistory,
      schedule,
      budget,
    );
    expect(dayTwo[0].sourceKey).toBe(d1.sourceKey);

    const dayThree = mergeTodayOneCandidatesWithHistory(
      [
        ...dayOneHistory,
        {
          sourceKey: d1.sourceKey,
          sourceStateDigest: d1.sourceStateDigest,
          claimedForDate: "2026-08-02",
        },
      ],
      budget,
    );
    expect(dayThree[0].sourceKey).toBe(secondBudget.sourceKey);

    const dayFour = mergeTodayOneCandidatesWithHistory(
      [
        ...dayOneHistory,
        {
          sourceKey: secondBudget.sourceKey,
          sourceStateDigest: secondBudget.sourceStateDigest,
          claimedForDate: "2026-08-03",
        },
      ],
      budget,
    );
    expect(dayFour[0].sourceKey).toBe(firstBudget.sourceKey);
  });

  it("keeps today's durable daily claim first when exposure history changes ranking", () => {
    const schedule = buildTodayOneScheduleCandidates({
      progress: {
        __events: [{
          id: "evt_claimed",
          date: "2026-08-03",
          time: "18:00",
          title: "상견례",
          momentType: "sanggyeonrye",
          status: "planned",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }],
      },
      stateRevision: 4,
      now: new Date("2026-08-02T03:00:00.000Z"),
    });
    const budget = buildTodayOneBudgetGuardrailCandidates({
      totalBudget: 1_000_000,
      progress: { venue: progressItem({ spent: 1_100_000 }) },
      stateRevision: 4,
    });
    const d1 = schedule[0];
    const ranked = mergeTodayOneCandidatesWithHistory(
      [
        {
          sourceKey: budget[0].sourceKey,
          sourceStateDigest: budget[0].sourceStateDigest,
          claimedForDate: "2026-08-01",
        },
        {
          sourceKey: d1.sourceKey,
          sourceStateDigest: d1.sourceStateDigest,
          claimedForDate: "2026-08-02",
          claimedToday: true,
        },
      ],
      schedule,
      budget,
    );

    expect(ranked[0].sourceKey).toBe(d1.sourceKey);
  });
});
