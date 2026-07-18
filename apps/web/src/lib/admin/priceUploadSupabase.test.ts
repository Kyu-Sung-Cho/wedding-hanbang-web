// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createSupabasePriceUploadRepository } from "./priceUploadSupabase";

describe("Supabase price upload repository", () => {
  it("commits the prepared upload through one bounded atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        entry_index: 0,
        outcome: "auto_matched",
        vendor_id: "00000000-0000-4000-8000-000000000001",
        vendor_name: "Sample Studio",
        confirmation_id: null,
        snapshot_id: "00000000-0000-4000-8000-000000000030",
        staged_prices: 1,
      }],
      error: null,
    });
    const repository = createSupabasePriceUploadRepository({ rpc } as never);
    const sourceObjectKey = `${"a".repeat(64)}.json`;

    await expect(repository.commitUpload({
      sourceObjectKey,
      createdBy: "00000000-0000-4000-8000-000000000090",
      upload: {
        period_label: "2026Q3",
        source: "mixed",
        source_note: "operator upload",
        collected_at: "2026-07-18",
      },
      entries: [{
        entryIndex: 0,
        entry: {
          vendor_name: "Sample Studio",
          category: "studio",
          region_code: "seoul_gangnam3",
          aliases: [],
          prices: [{
            agency_slug: "sample-agency-a",
            price_min_krw: 1_000_000,
            price_max_krw: 1_200_000,
            price_note: null,
            base_spec: "Base package",
            options: [],
            source_record_key: `admin-json:${"b".repeat(64)}`,
            source_quote: "JSON /entries/0/prices/0/base_spec: Base package",
          }],
        },
        resolution: {
          kind: "existing",
          vendorId: "00000000-0000-4000-8000-000000000001",
          vendorName: "Sample Studio",
        },
      }],
    })).resolves.toMatchObject({
      snapshot_id: "00000000-0000-4000-8000-000000000030",
      counts: { auto_matched: 1, staged_prices: 1 },
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("apply_admin_json_price_upload", {
      p_created_by: "00000000-0000-4000-8000-000000000090",
      p_entries: [{
        entry_index: 0,
        entry_payload: expect.objectContaining({ vendor_name: "Sample Studio" }),
        resolution: {
          kind: "existing",
          vendor_id: "00000000-0000-4000-8000-000000000001",
          vendor_name: "Sample Studio",
        },
      }],
      p_source_object_key: sourceObjectKey,
      p_upload_context: expect.objectContaining({ period_label: "2026Q3" }),
    });
  });

  it("matches every prepared entry through one bounded read-only RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        entry_index: 3,
        candidates: [{
          vendor_id: "00000000-0000-4000-8000-000000000001",
          vendor_name: "샘플스튜디오가",
          vendor_slug: "sample-studio-a",
          aliases: ["샘플스튜디오구명"],
          similarity: 0.75,
          match_kind: "similar",
        }],
      }],
      error: null,
    });
    const repository = createSupabasePriceUploadRepository({ rpc } as never);

    await expect(repository.findVendorCandidatesBatch([{
      entryIndex: 3,
      name: "샘플 스튜디오 가",
      category: "studio",
    }])).resolves.toEqual([{
      entryIndex: 3,
      candidates: [{
        vendorId: "00000000-0000-4000-8000-000000000001",
        vendorName: "샘플스튜디오가",
        vendorSlug: "sample-studio-a",
        aliases: ["샘플스튜디오구명"],
        similarity: 0.75,
        matchKind: "similar",
      }],
    }]);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("match_vendors_for_price_upload_batch", {
      p_requests: [{ entry_index: 3, name: "샘플 스튜디오 가", category: "studio" }],
    });
  });

  it("resolves only active agency slugs before staging an entry", async () => {
    const is = vi.fn().mockResolvedValue({
      data: [{ id: "00000000-0000-4000-8000-000000000010", slug: "sample-agency-a" }],
      error: null,
    });
    const inFilter = vi.fn().mockReturnValue({ is });
    const activeEq = vi.fn().mockReturnValue({ in: inFilter });
    const select = vi.fn().mockReturnValue({ eq: activeEq });
    const from = vi.fn().mockReturnValue({ select });
    const repository = createSupabasePriceUploadRepository({ from } as never);

    await expect(repository.findAgencies(["sample-agency-a"]))
      .resolves.toEqual([{
        id: "00000000-0000-4000-8000-000000000010",
        slug: "sample-agency-a",
      }]);
    expect(from).toHaveBeenCalledWith("agencies");
    expect(select).toHaveBeenCalledWith("id,slug");
    expect(activeEq).toHaveBeenCalledWith("is_active", true);
    expect(inFilter).toHaveBeenCalledWith("slug", ["sample-agency-a"]);
    expect(is).toHaveBeenCalledWith("merged_into_agency_id", null);
  });
});
