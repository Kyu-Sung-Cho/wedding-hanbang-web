const CONTENT_ORIGINS = new Set([
  "member",
  "operator",
  "ai",
  "industry_professional",
  "legacy_unverified",
]);

const AD_DISCLOSURES = new Set(["general", "sponsored", "ad"]);

const CONTENT_ORIGIN_LABELS = {
  member: "일반 회원 · 경험 미인증",
  operator: "운영자",
  ai: "AI",
  industry_professional: "업계 종사자",
  legacy_unverified: "과거 글 · 출처 미확인",
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeOptionalText(value, maxLength) {
  return value === null
    || (typeof value === "string" && value.length <= maxLength);
}

export function parseCommunityPostTrust(value) {
  if (!isRecord(value)) return null;
  if (!CONTENT_ORIGINS.has(value.content_origin)) return null;
  if (!AD_DISCLOSURES.has(value.ad_disclosure)) return null;
  if (!isSafeOptionalText(value.sponsorship_detail, 500)) return null;
  if (typeof value.is_resolved !== "boolean") return null;
  if (typeof value.under_review !== "boolean") return null;
  if (
    value.ad_disclosure === "sponsored"
    && (typeof value.sponsorship_detail !== "string"
      || value.sponsorship_detail.trim().length < 5)
  ) return null;

  return {
    contentOrigin: value.content_origin,
    adDisclosure: value.ad_disclosure,
    sponsorshipDetail: value.sponsorship_detail,
    isResolved: value.is_resolved,
    underReview: value.under_review,
  };
}

export function parseCommunityCommentOrigin(value) {
  if (!isRecord(value) || !CONTENT_ORIGINS.has(value.content_origin)) return null;
  return value.content_origin;
}

export function communityContentOriginLabel(origin) {
  return CONTENT_ORIGIN_LABELS[origin] ?? CONTENT_ORIGIN_LABELS.legacy_unverified;
}

export function communityPostLoadFailure(status) {
  if (status === 401) return "auth_required";
  if (status === 403 || status === 404 || status === 410) return "unavailable";
  return "load_failed";
}
