import { redirect } from "next/navigation";

import { resolveCanonicalVendorDestination } from "@/lib/vendors/canonicalVendorDestination";

// Publication and slug state can change after an old UUID link is first opened.
// Never cache a category fallback that could keep hiding a newly published page.
export const dynamic = "force-dynamic";

export default async function PublicLegacyVendorResolverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(await resolveCanonicalVendorDestination(id));
}
