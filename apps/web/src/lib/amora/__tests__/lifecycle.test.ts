import { describe, expect, it } from "vitest";
import { buildAmoraLifecyclePlan } from "../lifecycle";

describe("Amora lifecycle KST calendar boundaries", () => {
  it("keeps the entire Korean wedding date in wedding-day stage", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-07-11",
      now: new Date("2026-07-11T14:59:59.000Z"),
      totalBudget: 50_000_000,
      progress: {},
    });

    expect(plan.dday).toBe(0);
    expect(plan.stage).toBe("wedding_day");
  });

  it("uses only a signed contract total above the plan for a record-check warning", () => {
    const undecided = buildAmoraLifecyclePlan({
      weddingDate: "2028-10-15",
      now: new Date("2026-07-13T00:00:00.000Z"),
      totalBudget: 0,
      progress: {},
    });
    expect(undecided.guardrails.some((item) => item.id === "missing_total_budget")).toBe(false);

    const legacyAndPaidRecords = buildAmoraLifecyclePlan({
      weddingDate: "2028-10-15",
      now: new Date("2026-07-13T00:00:00.000Z"),
      totalBudget: 100_000_000,
      progress: {
        venue: {
          status: "in_progress",
          spent: 150_000_000,
          cost: 160_000_000,
          paidToDate: 120_000_000,
        },
      },
    });
    expect(legacyAndPaidRecords.guardrails.some((item) => item.id === "budget_over_limit")).toBe(false);
    expect(legacyAndPaidRecords).toMatchObject({
      contractedTotal: 0,
      paidToDate: 120_000_000,
      riskLevel: "calm",
    });

    const equalContractRecord = buildAmoraLifecyclePlan({
      totalBudget: 100_000_000,
      progress: { venue: { status: "in_progress", contractedTotal: 100_000_000 } },
    });
    expect(equalContractRecord.guardrails.some((item) => item.id === "budget_over_limit")).toBe(false);

    const mismatchedContractRecord = buildAmoraLifecyclePlan({
      totalBudget: 100_000_000,
      progress: { venue: { status: "in_progress", contractedTotal: 100_000_001 } },
    });
    expect(mismatchedContractRecord.guardrails.some((item) => item.id === "budget_over_limit")).toBe(true);
    expect(mismatchedContractRecord.primaryAction.body).toMatch(/중복|단위/);
  });

  it("moves to aftercare at the next KST midnight", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-07-11",
      now: new Date("2026-07-11T15:00:00.000Z"),
      totalBudget: 50_000_000,
      progress: {},
    });

    expect(plan.dday).toBe(-1);
    expect(plan.stage).toBe("aftercare");
  });

  it("treats an impossible date as missing instead of rolling it over", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-02-30",
      now: new Date("2026-02-01T00:00:00.000Z"),
      progress: {},
    });

    expect(plan.dday).toBeNull();
    expect(plan.stage).toBe("setup");
    expect(plan.guardrails.some((item) => item.id === "missing_wedding_date")).toBe(true);
  });

  it("does not turn generic checklist timing into a personal deadline or risk score", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-10-15",
      now: new Date("2026-07-11T00:00:00.000Z"),
      totalBudget: 25_000_000,
      progress: {},
    });

    expect(plan.guardrails.some((item) => item.id.startsWith("category_"))).toBe(false);
    expect(plan.guardrails.every((item) => item.dueLabel === undefined)).toBe(true);
    expect(plan.guardrails.map((item) => `${item.title} ${item.body}`).join(" ")).not.toMatch(
      /\d+일 (?:지남|남음)|긴급|기한 초과/
    );
    expect("riskScore" in plan).toBe(false);
  });

  it("labels D-day-derived guidance as reference instead of claiming a personal stage", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-01-15",
      now: new Date("2026-07-13T00:00:00.000Z"),
      progress: {},
    });

    expect(plan.stageLabel).toContain("D-day 참고");
    expect(plan.stageLabel).not.toMatch(/결정기|계약기|준비기|카운트다운/);
    expect(plan.stageSummary).toContain("일반적인 준비 순서");
  });

  it("keeps quote support available without injecting a D-day guardrail", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-01-15",
      now: new Date("2026-07-13T00:00:00.000Z"),
      progress: {},
    });
    const quoteAction = plan.quickActions.find((item) => item.id === "quote");

    expect(`${quoteAction?.label} ${quoteAction?.text}`).not.toMatch(/점검|빠진 항목/);
    expect(`${quoteAction?.label} ${quoteAction?.text}`).toMatch(/질문|포함 여부/);
    expect(plan.guardrails.some((item) => item.id === "quote_before_contract")).toBe(false);
  });

  it("ignores invalid or negative money values instead of deriving a misleading budget state", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2027-01-15",
      now: new Date("2026-07-13T00:00:00.000Z"),
      totalBudget: Number.POSITIVE_INFINITY,
      progress: {
        venue: { status: "in_progress", contractedTotal: -30_000_000, paidToDate: -1 },
        studio: { status: "in_progress", contractedTotal: Number.NaN, paidToDate: Number.NaN },
        dress: { status: "in_progress", contractedTotal: 2_000_000, paidToDate: 1_000_000 },
      },
    });

    expect(plan.totalBudget).toBe(0);
    expect(plan.contractedTotal).toBe(2_000_000);
    expect(plan.paidToDate).toBe(1_000_000);
    expect("spentBudget" in plan).toBe(false);
    expect("budgetPercent" in plan).toBe(false);
    expect(plan.riskLevel).toBe("calm");
  });

  it("does not inject contract or final-script work from D-day alone", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-07-14",
      now: new Date("2026-07-13T00:00:00.000Z"),
      progress: {},
    });

    expect(plan.dday).toBe(1);
    expect(plan.guardrails.map((item) => item.id)).not.toContain("quote_before_contract");
    expect(plan.guardrails.map((item) => item.id)).not.toContain("final_script_ready");
    expect(plan.primaryAction.id).toBe("all_steady");
  });

  it("does not promise that aftercare records or reminders happen automatically", () => {
    const plan = buildAmoraLifecyclePlan({
      weddingDate: "2026-07-11",
      now: new Date("2026-07-13T00:00:00.000Z"),
      progress: {},
    });
    const aftercare = plan.guardrails.find((item) => item.id === "aftercare_thanks");

    expect(aftercare).toBeDefined();
    expect(`${aftercare?.title} ${aftercare?.body}`).not.toMatch(/기록해둘게요|놓치지 않아요/);
    expect(`${aftercare?.title} ${aftercare?.body}`).toMatch(/직접 일정에 남겨두세요/);
  });

  it("does not count untouched optional templates as the couple's progress", () => {
    const empty = buildAmoraLifecyclePlan({
      weddingDate: "2027-01-15",
      now: new Date("2026-07-13T00:00:00.000Z"),
      progress: {},
    });
    const started = buildAmoraLifecyclePlan({
      weddingDate: "2027-01-15",
      now: new Date("2026-07-13T00:00:00.000Z"),
      progress: {
        venue: {
          status: "in_progress",
          checklist: [
            { id: "visit", label: "방문", done: true },
            { id: "contract", label: "계약", done: false },
          ],
        },
        pyebaek: {
          status: "not_started",
          checklist: [{ id: "decide", label: "진행 여부 결정", done: false }],
        },
      },
    });

    expect(empty).toMatchObject({ progressPercent: 0, totalDone: 0, totalItems: 0 });
    expect(started).toMatchObject({ progressPercent: 50, totalDone: 1, totalItems: 2 });
  });
});
