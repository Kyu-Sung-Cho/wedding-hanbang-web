import type { SupabaseClient } from "@supabase/supabase-js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OwnedVendor = {
  id: string;
  name: string;
};

/**
 * Checks currently approved vendor ownership with a server-only service client
 * after the caller has authenticated the request. `owner_id` is deliberately
 * never granted to browser roles or returned from this helper.
 */
export async function loadOwnedVendorWithServiceRole(
  client: SupabaseClient,
  ownerId: string,
  vendorId?: string,
): Promise<OwnedVendor | null> {
  if (!UUID_PATTERN.test(ownerId) || (vendorId !== undefined && !UUID_PATTERN.test(vendorId))) {
    throw new Error("INVALID_VENDOR_OWNERSHIP_ID");
  }

  let query = client
    .from("vendors")
    .select("id,name")
    .eq("owner_id", ownerId)
    .eq("status", "approved");
  if (vendorId !== undefined) query = query.eq("id", vendorId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("VENDOR_OWNERSHIP_LOOKUP_FAILED");
  if (data === null) return null;
  if (
    typeof data !== "object"
    || Array.isArray(data)
    || !UUID_PATTERN.test(String(data.id ?? ""))
    || typeof data.name !== "string"
    || data.name.trim() === ""
  ) {
    throw new Error("VENDOR_OWNERSHIP_LOOKUP_MALFORMED");
  }
  return { id: data.id, name: data.name };
}
