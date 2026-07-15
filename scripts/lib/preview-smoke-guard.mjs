const PROJECT_REF_PATTERN = /^[a-z0-9]{8,64}$/;

export function assertApprovedPreviewTarget({
  supabaseUrl,
  expectedProjectRef,
  releaseTargets,
}) {
  if (!PROJECT_REF_PATTERN.test(expectedProjectRef ?? "")) {
    throw new Error("SUPABASE_EXPECTED_PROJECT_REF is invalid.");
  }

  const parsedUrl = new URL(supabaseUrl);
  const normalizedUrl = parsedUrl.origin;
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.pathname !== "/" ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.hostname !== `${expectedProjectRef}.supabase.co`
  ) {
    throw new Error("Supabase URL does not match the exact expected preview project.");
  }

  const productionRefs = releaseTargets?.productionSupabaseProjectRefs;
  const approvedPreviewRefs = releaseTargets?.approvedNonProductionSupabaseProjectRefs;
  if (!Array.isArray(productionRefs) || !Array.isArray(approvedPreviewRefs)) {
    throw new Error("Release target preview allowlist is invalid.");
  }
  if (
    productionRefs.includes(expectedProjectRef) ||
    !approvedPreviewRefs.includes(expectedProjectRef)
  ) {
    throw new Error("Smoke tests require an explicitly approved non-production project.");
  }

  return { projectRef: expectedProjectRef, supabaseUrl: normalizedUrl };
}
