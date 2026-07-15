export const VERIFIED_PARTNER_EXCLUDED_CONTEXT_POLICY = "partner_excluded_v1";

export const VERIFIED_PARTNER_EXCLUDED_PROVENANCE = {
  ai_context_policy: VERIFIED_PARTNER_EXCLUDED_CONTEXT_POLICY,
  partner_messages_excluded: true,
} as const;

export function hasVerifiedPartnerExcludedProvenance(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.ai_context_policy === VERIFIED_PARTNER_EXCLUDED_CONTEXT_POLICY
    && record.partner_messages_excluded === true;
}
