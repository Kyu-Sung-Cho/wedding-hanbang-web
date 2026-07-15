import { describe, expect, it } from "vitest";
import { getFinancialRecords } from "../financialRecords";

describe("getFinancialRecords", () => {
  it("keeps plan, signed contract, and paid records separate", () => {
    expect(
      getFinancialRecords({
        venue: {
          budget: 30_000_000,
          contractedTotal: 28_000_000,
          paidToDate: 8_000_000,
        },
        studio: {
          budget: 5_000_000,
          contractedTotal: 4_500_000,
          paidToDate: 1_000_000,
        },
      }),
    ).toEqual({
      categoryPlanTotal: 35_000_000,
      contractedTotal: 32_500_000,
      paidToDate: 9_000_000,
    });
  });

  it("never treats legacy spent or cost fields as current financial records", () => {
    expect(
      getFinancialRecords({
        venue: { spent: 20_000_000, cost: 30_000_000 },
      }),
    ).toEqual({
      categoryPlanTotal: 0,
      contractedTotal: 0,
      paidToDate: 0,
    });
  });

  it("ignores negative, non-finite, and non-number values", () => {
    expect(
      getFinancialRecords({
        venue: { budget: -1, contractedTotal: Number.NaN, paidToDate: "1000" },
        __events: [{ id: "evt" }],
      }),
    ).toEqual({
      categoryPlanTotal: 0,
      contractedTotal: 0,
      paidToDate: 0,
    });
  });
});
