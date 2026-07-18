import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { createPublicClient } from "@/lib/supabase/public";
import { isUuid } from "@/utils/requestValidation";

type PublishedVendorLink = {
  vendor_slug: string | null;
  vendor_category: string | null;
};

type PublicVendorLink = {
  category: string | null;
};

function priceCategory(value: string | null): "studio" | "dress" | "makeup" | "hall" {
  if (value === "dress" || value === "makeup" || value === "hall") return value;
  if (value === "venue") return "hall";
  return "studio";
}

async function canonicalVendorDestination(id: string): Promise<string> {
  if (!isUuid(id)) return "/price/studio";
  const client = createPublicClient() as unknown as SupabaseClient;
  const published = await client
    .from("v_public_official_prices")
    .select("vendor_slug,vendor_category")
    .eq("vendor_id", id)
    .eq("is_current", true)
    .order("period_label", { ascending: false })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<PublishedVendorLink>();
  if (published.error) throw new Error("LEGACY_VENDOR_DESTINATION_UNAVAILABLE");
  if (published.data?.vendor_slug) {
    return `/price/vendor/${encodeURIComponent(published.data.vendor_slug)}`;
  }

  // An approved vendor without a published price has no truthful detail page.
  // Keep only its broad public category context; never restore the legacy claim surface.
  const publicVendor = await client
    .from("v_public_vendors")
    .select("category")
    .eq("id", id)
    .limit(1)
    .maybeSingle<PublicVendorLink>();
  if (publicVendor.error) throw new Error("LEGACY_VENDOR_DESTINATION_UNAVAILABLE");
  return `/price/${priceCategory(publicVendor.data?.category ?? null)}`;
}

export default async function LegacyVendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(await canonicalVendorDestination(id));
}
