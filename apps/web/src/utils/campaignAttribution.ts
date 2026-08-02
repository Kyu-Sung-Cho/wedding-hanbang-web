const SAFE_ATTRIBUTION_TOKEN = /^[\p{L}\p{N}][\p{L}\p{N}._~-]*$/u;
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const PHONE_LIKE = /^\+?[\d().\s-]{8,}$/u;
const JWT_LIKE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/u;
const SECRET_PREFIX = /^(?:bearer|basic|sk[-_]|pk[-_]|gh[pousr]_|github_pat_|xox[baprs]-|eyj)/iu;
const OPAQUE_SECRET_LIKE = /^(?=.{32,}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_-]+$/u;

/**
 * Campaign attribution is metadata, not a free-text collection channel.
 * Reject values that could carry URLs, email addresses, phone numbers, or
 * credentials instead of truncating and persisting a potentially sensitive
 * prefix.
 */
export function sanitizeCampaignAttribution(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maxLength) return null;
  if (!SAFE_ATTRIBUTION_TOKEN.test(normalized)) return null;
  if (
    EMAIL_LIKE.test(normalized) ||
    PHONE_LIKE.test(normalized) ||
    JWT_LIKE.test(normalized) ||
    SECRET_PREFIX.test(normalized) ||
    OPAQUE_SECRET_LIKE.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

export function sanitizeUtmFields(values: {
  source?: unknown;
  medium?: unknown;
  campaign?: unknown;
  content?: unknown;
}): {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
} {
  return {
    source: sanitizeCampaignAttribution(values.source, 80),
    medium: sanitizeCampaignAttribution(values.medium, 80),
    campaign: sanitizeCampaignAttribution(values.campaign, 120),
    content: sanitizeCampaignAttribution(values.content, 120),
  };
}
