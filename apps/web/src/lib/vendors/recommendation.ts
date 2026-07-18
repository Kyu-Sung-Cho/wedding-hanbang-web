import {
  getAttributeFieldKeys,
  getAttributeFieldLabel,
  type VendorAttributeCategory,
} from "./attributeSchemas";

export type VendorRecommendationRequest = {
  category: VendorAttributeCategory;
  region_codes?: string[];
  budget_max_krw?: number;
  preferred_tags?: string[];
  required_attrs?: Record<string, unknown>;
  wedding_month?: string;
  limit?: number;
};

export type RecommendationCandidate = {
  id: string;
  slug: string;
  name: string;
  category: VendorAttributeCategory;
  regionCode: string | null;
  status: string;
  attributes: Record<string, unknown>;
  tags: Array<{ slug: string; label: string }>;
  urls: {
    official: string | null;
    instagram: string | null;
    naverPlace: string | null;
  };
  price: {
    minKrw: number;
    maxKrw: number | null;
    periodLabel: string;
    hasMarketData: boolean;
    isLatestSnapshot: boolean;
  } | null;
};

export type VendorRecommendationResult = {
  vendor: {
    id: string;
    slug: string;
    name: string;
    category: VendorAttributeCategory;
    region_code: string | null;
  };
  score: number;
  match_reasons: string[];
  price_summary: {
    min_krw: number;
    max_krw: number | null;
    period_label: string;
    has_market_data: boolean;
  };
  data_badges: string[];
  detail_url: string;
};

export type VendorRecommendationResponse = {
  results: VendorRecommendationResult[];
  coverage_note: string;
  disclaimer: string;
};

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const BASE_COVERAGE_NOTE = "가격을 공개한 업체 기준 추천입니다.";
const RELAXED_COVERAGE_NOTE =
  "가격을 공개한 업체 기준 추천입니다. 요청 지역의 결과가 적어 검색 범위를 전국으로 넓혔습니다.";
const DISCLAIMER =
  "공시 기준 가격이며 실제 계약 조건에 따라 달라질 수 있습니다.";

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeMatchText(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function isUnknown(value: unknown): boolean {
  return value === null
    || value === undefined
    || value === "unknown"
    || (typeof value === "string" && value.trim() === "")
    || (Array.isArray(value) && value.length === 0);
}

function requiredValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((expectedValue) =>
      actual.some((actualValue) => Object.is(actualValue, expectedValue))
    );
  }
  return Object.is(actual, expected);
}

function formatKrw(value: number): string {
  if (value % 10_000 === 0) {
    return `${new Intl.NumberFormat("ko-KR").format(value / 10_000)}만원`;
  }
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function publicAttributeFillRatio(candidate: RecommendationCandidate): number {
  const keys = getAttributeFieldKeys(candidate.category);
  if (keys.length === 0) return 0;
  const filled = keys.filter((key) => !isUnknown(candidate.attributes[key])).length;
  return filled / keys.length;
}

function matchingTags(
  preferredTags: string[],
  candidateTags: RecommendationCandidate["tags"],
): string[] {
  const candidateValues = new Set(
    candidateTags.flatMap(({ slug, label }) => [slug, label]).map(normalizeMatchText),
  );
  return preferredTags.filter((tag) => candidateValues.has(normalizeMatchText(tag)));
}

function candidatePassesRequiredAttributes(
  request: VendorRecommendationRequest,
  candidate: RecommendationCandidate,
): boolean {
  for (const [key, expected] of Object.entries(request.required_attrs ?? {})) {
    const actual = candidate.attributes[key];
    if (!isUnknown(actual) && !requiredValueMatches(actual, expected)) return false;
  }
  return true;
}

function candidatePassesHardFilters(
  request: VendorRecommendationRequest,
  candidate: RecommendationCandidate,
  enforceRegion: boolean,
): boolean {
  if (candidate.category !== request.category) return false;
  // `approved` is the current Hanbang DB name for an active, publicly eligible vendor.
  if (candidate.status !== "approved" && candidate.status !== "active") return false;
  if (!candidate.price) return false;
  if (!candidatePassesRequiredAttributes(request, candidate)) return false;

  const regions = request.region_codes ?? [];
  if (
    enforceRegion
    && regions.length > 0
    && (!candidate.regionCode || !regions.includes(candidate.regionCode))
  ) {
    return false;
  }

  const budget = request.budget_max_krw;
  if (budget !== undefined) {
    if (!candidate.price || candidate.price.minKrw > budget) return false;
  }
  return true;
}

function scoreCandidate(
  request: VendorRecommendationRequest,
  candidate: RecommendationCandidate,
): number {
  const preferredTags = [...new Set(request.preferred_tags ?? [])];
  const tagRatio = preferredTags.length === 0
    ? 0
    : matchingTags(preferredTags, candidate.tags).length / preferredTags.length;

  const budget = request.budget_max_krw;
  const budgetSlack = budget === undefined
    ? 0.1
    : clamp(1 - (candidate.price?.minKrw ?? budget) / budget);

  const hasUrl = Object.values(candidate.urls).some(
    (url) => typeof url === "string" && url.trim().length > 0,
  );
  const completeness = (hasUrl ? 0.3 : 0)
    + publicAttributeFillRatio(candidate) * 0.4
    + (candidate.tags.length > 0 ? 0.3 : 0);
  const freshness = candidate.price?.isLatestSnapshot ? 1 : 0;

  // 정책: 추천 점수에 광고/수수료 변수 입력 금지
  const score = 0.5 * tagRatio
    + 0.2 * budgetSlack
    + 0.2 * completeness
    + 0.1 * freshness;
  return Math.round(score * 10_000) / 10_000;
}

function buildMatchReasons(
  request: VendorRecommendationRequest,
  candidate: RecommendationCandidate,
): string[] {
  const reasons: string[] = [];
  const preferredTags = [...new Set(request.preferred_tags ?? [])];
  const matches = matchingTags(preferredTags, candidate.tags);
  if (matches.length > 0) {
    reasons.push(
      `선호 태그 ${matches.length}/${preferredTags.length} 일치: ${matches.join(", ")}`,
    );
  }

  if (request.budget_max_krw !== undefined && candidate.price) {
    reasons.push(`공시 기본가 ${formatKrw(candidate.price.minKrw)}으로 예산 내`);
  }

  for (const [key] of Object.entries(request.required_attrs ?? {})) {
    const label = getAttributeFieldLabel(request.category, key) ?? key;
    const actual = candidate.attributes[key];
    reasons.push(
      isUnknown(actual) ? `${label} 확인 필요` : `${label} 조건 충족`,
    );
  }

  if (candidate.price?.isLatestSnapshot) {
    reasons.push("최신 공시 가격 기준");
  }
  if (reasons.length === 0) {
    reasons.push("공시 가격과 확인된 업체 정보를 기준으로 찾았어요.");
  }
  return reasons;
}

function toResult(
  request: VendorRecommendationRequest,
  candidate: RecommendationCandidate,
): VendorRecommendationResult {
  if (!candidate.price) {
    throw new Error("Recommendation candidates must have an approved official price");
  }
  const badges = ["공시가"];
  if (candidate.price.hasMarketData) badges.push("시장 데이터");
  if (candidate.price.isLatestSnapshot) badges.push("최신 공시");

  return {
    vendor: {
      id: candidate.id,
      slug: candidate.slug,
      name: candidate.name,
      category: candidate.category,
      region_code: candidate.regionCode,
    },
    score: scoreCandidate(request, candidate),
    match_reasons: buildMatchReasons(request, candidate),
    price_summary: {
      min_krw: candidate.price.minKrw,
      max_krw: candidate.price.maxKrw,
      period_label: candidate.price.periodLabel,
      has_market_data: candidate.price.hasMarketData,
    },
    data_badges: badges,
    detail_url: `/price/vendor/${encodeURIComponent(candidate.slug)}`,
  };
}

function compareResults(
  left: VendorRecommendationResult,
  right: VendorRecommendationResult,
): number {
  return right.score - left.score
    || left.price_summary.min_krw - right.price_summary.min_krw
    || left.vendor.name.localeCompare(right.vendor.name, "ko-KR")
    || left.vendor.id.localeCompare(right.vendor.id);
}

function ranked(
  request: VendorRecommendationRequest,
  candidates: RecommendationCandidate[],
  enforceRegion: boolean,
): VendorRecommendationResult[] {
  return candidates
    .filter((candidate) => candidatePassesHardFilters(request, candidate, enforceRegion))
    .map((candidate) => toResult(request, candidate))
    .sort(compareResults);
}

export function rankVendorRecommendations(
  request: VendorRecommendationRequest,
  candidates: RecommendationCandidate[],
): VendorRecommendationResponse {
  const limit = Math.min(MAX_LIMIT, Math.max(1, request.limit ?? DEFAULT_LIMIT));
  const requestedRegions = request.region_codes ?? [];
  const localResults = ranked(request, candidates, true);
  const minimumCoverage = Math.min(3, limit);
  const shouldRelax = requestedRegions.length > 0 && localResults.length < minimumCoverage;
  const results = (shouldRelax ? ranked(request, candidates, false) : localResults)
    .slice(0, limit);

  return {
    results,
    coverage_note: shouldRelax ? RELAXED_COVERAGE_NOTE : BASE_COVERAGE_NOTE,
    disclaimer: DISCLAIMER,
  };
}
