import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { loadOwnedVendorWithServiceRole } from "../serverOwnership";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const VENDOR_ID = "20000000-0000-4000-8000-000000000001";

function clientReturning(data: unknown, error: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn().mockReturnThis();
  const select = vi.fn().mockReturnValue({ eq, maybeSingle });
  const from = vi.fn().mockReturnValue({ select });
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    select,
    eq,
    maybeSingle,
  };
}

describe("loadOwnedVendorWithServiceRole", () => {
  it("filters by the authenticated owner and returns only public identity fields", async () => {
    const mock = clientReturning({ id: VENDOR_ID, name: "샘플 업체" });

    await expect(loadOwnedVendorWithServiceRole(
      mock.client,
      OWNER_ID,
      VENDOR_ID,
    )).resolves.toEqual({ id: VENDOR_ID, name: "샘플 업체" });

    expect(mock.from).toHaveBeenCalledWith("vendors");
    expect(mock.select).toHaveBeenCalledWith("id,name");
    expect(mock.eq).toHaveBeenNthCalledWith(1, "owner_id", OWNER_ID);
    expect(mock.eq).toHaveBeenNthCalledWith(2, "status", "approved");
    expect(mock.eq).toHaveBeenNthCalledWith(3, "id", VENDOR_ID);
  });

  it("returns null when the service-side ownership predicate has no match", async () => {
    const mock = clientReturning(null);

    await expect(loadOwnedVendorWithServiceRole(mock.client, OWNER_ID, VENDOR_ID))
      .resolves.toBeNull();
  });

  it("fails closed on invalid ids, query errors, and malformed service data", async () => {
    const invalid = clientReturning(null);
    await expect(loadOwnedVendorWithServiceRole(invalid.client, "not-a-user"))
      .rejects.toThrow("INVALID_VENDOR_OWNERSHIP_ID");
    expect(invalid.from).not.toHaveBeenCalled();

    await expect(loadOwnedVendorWithServiceRole(
      clientReturning(null, { code: "offline" }).client,
      OWNER_ID,
    )).rejects.toThrow("VENDOR_OWNERSHIP_LOOKUP_FAILED");
    await expect(loadOwnedVendorWithServiceRole(
      clientReturning({ id: VENDOR_ID, name: "" }).client,
      OWNER_ID,
    )).rejects.toThrow("VENDOR_OWNERSHIP_LOOKUP_MALFORMED");
  });
});
