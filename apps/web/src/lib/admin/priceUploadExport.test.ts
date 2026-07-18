// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadCurrentPublishedPriceExport } from "./priceUploadExport";

afterEach(() => vi.useRealTimers());

describe("loadCurrentPublishedPriceExport", () => {
  it("exports current published snapshots through service-only evidence views", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T12:00:00.000Z"));
    const snapshotId = "00000000-0000-4000-8000-000000000001";
    const priceId = "00000000-0000-4000-8000-000000000002";
    const rows: Record<string, unknown[]> = {
      price_snapshots: [{
        id: snapshotId,
        period_label: "2026Q3",
        source: "mixed",
        source_note: "수동 공시 자료",
        collected_at: "2026-07-18",
        published: true,
        published_at: "2026-07-18",
        is_current: true,
      }],
      v_private_admin_official_prices: [{
        id: priceId,
        snapshot_id: snapshotId,
        vendor_id: "00000000-0000-4000-8000-000000000003",
        vendor_name: "샘플스튜디오가",
        price_category: "studio",
        price_min_krw: 1_000_000,
        price_max_krw: 1_200_000,
      }],
      v_private_admin_official_price_options: [{
        id: "00000000-0000-4000-8000-000000000004",
        official_price_id: priceId,
        name: "샘플 추가 구성",
        raw_text: "샘플 추가 구성 10만원",
        is_effectively_mandatory: false,
        sort_order: 0,
      }],
      v_private_admin_agency_packages: [],
    };
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const from = vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "in", "order"] as const) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.range = async (start: number, end: number) => {
        calls.push({ table, method: "range", args: [start, end] });
        return { data: rows[table]?.slice(start, end + 1) ?? [], error: null };
      };
      return builder;
    });

    const exported = await loadCurrentPublishedPriceExport({ from } as never);

    expect(exported).toMatchObject({
      schema_version: 1,
      generated_at: "2026-07-18T12:00:00.000Z",
      snapshots: [{ id: snapshotId, published: true, is_current: true }],
      prices: [{ id: priceId, options: [{ raw_text: "샘플 추가 구성 10만원" }] }],
      agency_packages: [],
    });
    expect(calls).toContainEqual({
      table: "price_snapshots",
      method: "eq",
      args: ["published", true],
    });
    expect(calls).toContainEqual({
      table: "price_snapshots",
      method: "eq",
      args: ["is_current", true],
    });
    expect(from).toHaveBeenCalledWith("v_private_admin_official_prices");
    expect(from).toHaveBeenCalledWith("v_private_admin_official_price_options");
    expect(from).toHaveBeenCalledWith("v_private_admin_agency_packages");
    expect(from).not.toHaveBeenCalledWith("official_prices");
    expect(from).not.toHaveBeenCalledWith("official_price_options");
    expect(from).not.toHaveBeenCalledWith("v_public_official_prices");
    expect(from).not.toHaveBeenCalledWith("v_public_official_price_options");
    expect(from).not.toHaveBeenCalledWith("v_public_agency_packages");
  });
});
