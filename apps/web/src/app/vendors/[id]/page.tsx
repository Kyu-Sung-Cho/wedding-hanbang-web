import { redirect } from "next/navigation";

import { resolveCanonicalVendorDestination } from "@/lib/vendors/canonicalVendorDestination";

export default async function LegacyVendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(await resolveCanonicalVendorDestination(id));
}
