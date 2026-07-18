// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  listPendingPriceUploadConfirmations,
  resolvePendingPriceUploadConfirmation,
} from "./priceUploadConfirmations";

const CONFIRMATION_ID = "00000000-0000-4000-8000-000000000099";
const VENDOR_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000090";

describe("price upload confirmation repository", () => {
  it("returns a bounded safe queue projection without private evidence keys", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        confirmation_id: CONFIRMATION_ID,
        entry_index: 2,
        vendor_name: "Sample Studio A",
        category: "studio",
        region_code: "seoul_gangnam3",
        candidates: [{
          vendor_id: VENDOR_ID,
          vendor_name: "Sample Studio",
          vendor_slug: "sample-studio",
          aliases: [],
          similarity: 0.72,
          match_kind: "similar",
          category: "studio",
          region_code: "seoul_gangnam3",
        }],
        state: "pending",
        version: 0,
        selected_vendor_id: null,
        staged_snapshot_id: null,
        staged_price_count: null,
        created_at: "2026-07-18T12:00:00.000Z",
        resolved_at: null,
      }],
      error: null,
    });

    const result = await listPendingPriceUploadConfirmations({ rpc } as never);

    expect(result).toEqual([expect.objectContaining({
      confirmation_id: CONFIRMATION_ID,
      vendor_name: "Sample Studio A",
      category: "studio",
      regionCode: "seoul_gangnam3",
      candidates: [expect.objectContaining({
        vendorId: VENDOR_ID,
        category: "studio",
        regionCode: "seoul_gangnam3",
      })],
    })]);
    expect(JSON.stringify(result)).not.toContain("source_object_key");
    expect(rpc).toHaveBeenCalledWith("list_price_upload_confirmations", {
      p_state: "pending",
    });
  });

  it("resolves with optimistic versioning and classifies a different retry as conflict", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          confirmation_id: CONFIRMATION_ID,
          snapshot_id: "00000000-0000-4000-8000-000000000030",
          staged_prices: 2,
          version: 1,
          already_resolved: false,
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "PRICE_UPLOAD_CONFIRMATION_ALREADY_RESOLVED_DIFFERENT_VENDOR" },
      });
    const client = { rpc } as never;

    await expect(resolvePendingPriceUploadConfirmation(client, {
      confirmationId: CONFIRMATION_ID,
      selectedVendorId: VENDOR_ID,
      expectedVersion: 0,
      resolvedBy: ADMIN_ID,
    })).resolves.toMatchObject({ staged_prices: 2, version: 1 });
    await expect(resolvePendingPriceUploadConfirmation(client, {
      confirmationId: CONFIRMATION_ID,
      selectedVendorId: "00000000-0000-4000-8000-000000000002",
      expectedVersion: 0,
      resolvedBy: ADMIN_ID,
    })).rejects.toMatchObject({ kind: "conflict" });
  });
});
