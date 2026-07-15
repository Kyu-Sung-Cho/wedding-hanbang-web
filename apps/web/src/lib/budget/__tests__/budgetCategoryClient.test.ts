import { describe, expect, it, vi } from "vitest";
import { mutateBudgetCategory } from "../budgetCategoryClient";

describe("mutateBudgetCategory", () => {
  it("sends one narrow category mutation and accepts the authoritative progress", async () => {
    const authoritativeProgress = {
      venue: {
        category: "venue",
        status: "in_progress",
        checklist: [{ id: "venue_01", label: "계약서 확인", done: true }],
        budget: 30_000_000,
        contractedTotal: 25_000_000,
        paidToDate: 5_000_000,
        nextPaymentAmount: 3_000_000,
        nextPaymentDate: "2026-09-15",
        spent: 4_000_000,
        payer: "both_parents",
      },
      __events: [{ id: "evt_partner" }],
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: authoritativeProgress,
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await mutateBudgetCategory({
      categoryKey: "venue",
      set: {
        budget: 30_000_000,
        contractedTotal: 25_000_000,
        paidToDate: 5_000_000,
        nextPaymentAmount: 3_000_000,
        nextPaymentDate: "2026-09-15",
      },
    }, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/journey/budget-categories",
      expect.objectContaining({ method: "POST" }),
    );
    const requestBody = JSON.parse(fetcher.mock.calls[0][1].body as string);
    expect(requestBody).toEqual({
      categoryKey: "venue",
      set: {
        budget: 30_000_000,
        contractedTotal: 25_000_000,
        paidToDate: 5_000_000,
        nextPaymentAmount: 3_000_000,
        nextPaymentDate: "2026-09-15",
      },
    });
    expect(requestBody.progress).toBeUndefined();
    expect(result.progress).toEqual(authoritativeProgress);
  });

  it("fails closed when a nominal success does not confirm the requested fields", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: {
        venue: {
          status: "completed",
          checklist: [{ id: "venue_01", label: "계약서 확인", done: true }],
          budget: 20_000_000,
        },
      },
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(mutateBudgetCategory({
      categoryKey: "venue",
      set: { budget: 30_000_000 },
    }, fetcher)).rejects.toThrow("저장된 예산 상태를 확인하지 못했습니다");
  });

  it.each([
    ["spent", 1_000_000],
    ["cost", 1_000_000],
    ["payer", "couple"],
  ])("rejects retired %s writes before making a request", async (field, value) => {
    const fetcher = vi.fn();

    await expect(mutateBudgetCategory({
      categoryKey: "venue",
      set: { [field]: value },
    }, fetcher)).rejects.toThrow("더 이상 새로 저장할 수 없습니다");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["fractional amount", { contractedTotal: 1.5 }],
    ["oversized amount", { nextPaymentAmount: 10_000_000_001 }],
    ["impossible date", { nextPaymentDate: "2026-04-31" }],
    ["paid above contract", { contractedTotal: 10, paidToDate: 11 }],
  ])("rejects %s before making a request", async (_label, set) => {
    const fetcher = vi.fn();

    await expect(mutateBudgetCategory({
      categoryKey: "venue",
      set,
    }, fetcher)).rejects.toThrow();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allows explicit removal of legacy money fields without reclassifying them", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: {
        venue: { category: "venue", budget: 20_000_000 },
      },
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await mutateBudgetCategory({
      categoryKey: "venue",
      remove: ["spent", "cost", "payer"],
    }, fetcher);

    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({
      categoryKey: "venue",
      remove: ["spent", "cost", "payer"],
    });
  });

  it("rejects a response whose merged record says paid exceeds contracted", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: {
        venue: {
          category: "venue",
          budget: 20_000_000,
          contractedTotal: 10_000_000,
          paidToDate: 11_000_000,
        },
      },
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(mutateBudgetCategory({
      categoryKey: "venue",
      set: { budget: 20_000_000 },
    }, fetcher)).rejects.toThrow("저장된 예산 상태를 확인하지 못했습니다");
  });

  it("rejects a response whose merged record contains an unsafe planned budget", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      progress: {
        venue: {
          category: "venue",
          budget: 1.5,
          contractedTotal: 10_000_000,
        },
      },
      categoryKey: "venue",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(mutateBudgetCategory({
      categoryKey: "venue",
      set: { contractedTotal: 10_000_000 },
    }, fetcher)).rejects.toThrow("저장된 예산 상태를 확인하지 못했습니다");
  });
});
