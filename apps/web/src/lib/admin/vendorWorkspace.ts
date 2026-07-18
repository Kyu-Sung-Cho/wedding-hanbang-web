import { z } from "zod";
import {
  PRICE_BANDS,
  validateVendorAttributes,
  type VendorAttributeCategory,
} from "@/lib/vendors/attributeSchemas";

const nullableText = (max: number) =>
  z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.string().trim().max(max).nullable(),
  );

const nullableMoney = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.coerce.number().int().min(0).max(2_147_483_647).nullable(),
);

const nullableConfidence = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.coerce.number().min(0).max(1).nullable(),
);

const expectedReviewVersion = z.number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const OFFICIAL_PRICE_CATEGORIES = [
  "studio",
  "dress",
  "makeup",
  "hall",
  "other",
] as const;

export const AGENCY_PACKAGE_CATEGORY_SCOPES = [
  "studio",
  "dress",
  "makeup",
  "venue",
] as const;

const VALIDATION_ISSUE_LABELS: Readonly<Record<string, string>> = {
  price_min_gt_max: "최소 금액이 최대 금액보다 큼",
  missing_source_quote: "가격 근거 원문 누락",
  base_price_out_of_sanity_range: "기본가가 일반 검토 범위 밖임",
  price_source_quote_unparseable: "근거 원문에서 금액을 보수적으로 해석할 수 없음",
  price_source_quote_mismatch: "정규화 금액과 근거 원문이 일치하지 않음",
  source_quote_requires_visual_review: "PDF·이미지 원본 직접 대조 필요",
  source_quote_not_found_in_text: "근거 원문이 변환 텍스트에서 확인되지 않음",
  unknown_document_kind: "문서 유형 미확인",
  document_payload_conflict: "문서 유형과 추출 내용이 충돌함",
  no_price_records: "적재 가능한 가격 레코드 없음",
  conflicting_agency_package_prices: "동일 패키지의 가격·옵션이 서로 충돌함",
  document_kind_conflict: "폴더 힌트와 문서 유형이 충돌함",
  business_name_conflict: "문서 상호와 대상 업체명이 일치하지 않음",
  region_mismatch: "폴더 지역과 문서 지역이 일치하지 않음",
  low_confidence: "추출 신뢰도가 낮거나 모델이 검토를 요청함",
};

export function validationIssueLabel(issueCode: unknown): string {
  if (typeof issueCode !== "string" || issueCode.trim() === "") {
    return "검증 이슈 코드 미확인 — 원본 직접 확인 필요";
  }
  return VALIDATION_ISSUE_LABELS[issueCode.trim()]
    ?? "정의되지 않은 검증 이슈 — 원본 직접 확인 필요";
}

const priceOptionSchema = z.strictObject({
  id: z.string().uuid().nullable().optional().default(null),
  name: z.string().trim().min(1).max(200),
  price_min_krw: nullableMoney.optional().default(null),
  price_max_krw: nullableMoney.optional().default(null),
  unit: nullableText(100).optional().default(null),
  condition: nullableText(1_000).optional().default(null),
  raw_text: nullableText(2_000).optional().default(null),
  source_quote: nullableText(4_000).optional().default(null),
  confidence: nullableConfidence.optional().default(null),
}).superRefine((value, context) => {
  if (
    value.price_min_krw !== null
    && value.price_max_krw !== null
    && value.price_min_krw > value.price_max_krw
  ) {
    context.addIssue({
      code: "custom",
      path: ["price_max_krw"],
      message: "옵션 최대 금액은 최소 금액보다 작을 수 없습니다.",
    });
  }
});

const priceReviewSchema = z.strictObject({
  action: z.enum(["save", "approve", "reject"]),
  expected_review_version: expectedReviewVersion,
  category: z.enum(OFFICIAL_PRICE_CATEGORIES),
  item_name: z.string().trim().min(1).max(200),
  base_spec: nullableText(2_000).optional().default(null),
  price_min_krw: nullableMoney.optional().default(null),
  price_max_krw: nullableMoney.optional().default(null),
  vat_note: nullableText(500).optional().default(null),
  price_note: nullableText(2_000).optional().default(null),
  source_quote: nullableText(4_000).optional().default(null),
  confidence: nullableConfidence.optional().default(null),
  options: z.array(priceOptionSchema).max(100).default([]),
  selected_alias_proposal_ids: z.array(z.string().uuid()).max(100).refine(
    (values) => new Set(values).size === values.length,
    "선택한 업체 별칭 제안이 중복되었습니다.",
  ).optional().default([]),
}).superRefine((value, context) => {
  if (
    value.price_min_krw !== null
    && value.price_max_krw !== null
    && value.price_min_krw > value.price_max_krw
  ) {
    context.addIssue({
      code: "custom",
      path: ["price_max_krw"],
      message: "최대 금액은 최소 금액보다 작을 수 없습니다.",
    });
  }
  if (value.action === "approve" && !value.source_quote) {
    context.addIssue({
      code: "custom",
      path: ["source_quote"],
      message: "승인하려면 근거 원문이 필요합니다.",
    });
  }
  if (value.action === "approve" && value.confidence === null) {
    context.addIssue({
      code: "custom",
      path: ["confidence"],
      message: "승인하려면 신뢰도를 확인해야 합니다.",
    });
  }
  if (value.action === "approve") {
    value.options.forEach((option, index) => {
      if (!option.source_quote || option.confidence === null) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "source_quote"],
          message: "승인할 옵션에는 근거 원문과 신뢰도가 필요합니다.",
        });
      }
    });
  }
  if (value.action !== "approve" && value.selected_alias_proposal_ids.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["selected_alias_proposal_ids"],
      message: "업체 별칭 제안은 가격 승인과 함께만 결정할 수 있습니다.",
    });
  }
});

export function parsePriceReviewSubmission(input: unknown) {
  return priceReviewSchema.safeParse(input);
}

const agencyPackageOptionSchema = z.strictObject({
  name: z.string().trim().min(1).max(300),
  price_min_krw: nullableMoney,
  price_max_krw: nullableMoney,
  unit: nullableText(100),
  condition: nullableText(1_000),
  raw_text: nullableText(2_000),
  source_quote: nullableText(1_000),
}).superRefine((value, context) => {
  if (
    value.price_min_krw !== null
    && value.price_max_krw !== null
    && value.price_min_krw > value.price_max_krw
  ) {
    context.addIssue({
      code: "custom",
      path: ["price_max_krw"],
      message: "옵션 최대 금액은 최소 금액보다 작을 수 없습니다.",
    });
  }
});

const agencyPackageReviewSchema = z.strictObject({
  action: z.enum(["save", "approve", "reject"]),
  expected_review_version: expectedReviewVersion,
  package_name: z.string().trim().min(1).max(300),
  category_scope: z.array(z.enum(AGENCY_PACKAGE_CATEGORY_SCOPES)).max(4).refine(
    (values) => new Set(values).size === values.length,
    "패키지 범위가 중복되었습니다.",
  ),
  price_min_krw: nullableMoney,
  price_max_krw: nullableMoney,
  vat_note: nullableText(1_000),
  price_note: nullableText(2_000),
  source_quote: nullableText(1_000),
  confidence: nullableConfidence,
  options: z.array(agencyPackageOptionSchema).max(100),
}).superRefine((value, context) => {
  if (
    value.price_min_krw !== null
    && value.price_max_krw !== null
    && value.price_min_krw > value.price_max_krw
  ) {
    context.addIssue({
      code: "custom",
      path: ["price_max_krw"],
      message: "최대 금액은 최소 금액보다 작을 수 없습니다.",
    });
  }
  if (value.action === "approve" && value.category_scope.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["category_scope"],
      message: "승인하려면 패키지 범위를 하나 이상 선택해야 합니다.",
    });
  }
  if (value.action === "approve" && !value.source_quote) {
    context.addIssue({
      code: "custom",
      path: ["source_quote"],
      message: "승인하려면 근거 원문이 필요합니다.",
    });
  }
  if (value.action === "approve" && value.confidence === null) {
    context.addIssue({
      code: "custom",
      path: ["confidence"],
      message: "승인하려면 신뢰도를 확인해야 합니다.",
    });
  }
  if (
    value.action === "approve"
    && value.price_min_krw === null
    && value.price_max_krw === null
    && !value.options.some((option) => (
      option.price_min_krw !== null || option.price_max_krw !== null
    ))
  ) {
    context.addIssue({
      code: "custom",
      path: ["price_min_krw"],
      message: "승인하려면 패키지 또는 옵션에 가격이 하나 이상 필요합니다.",
    });
  }
  if (value.action === "approve") {
    value.options.forEach((option, index) => {
      if (!option.source_quote) {
        context.addIssue({
          code: "custom",
          path: ["options", index, "source_quote"],
          message: "승인할 옵션에는 근거 원문이 필요합니다.",
        });
      }
    });
  }
});

export const AGENCY_PACKAGE_EDITABLE_COLUMNS = [
  "package_name",
  "category_scope",
  "price_min_krw",
  "price_max_krw",
  "vat_note",
  "price_note",
  "source_quote",
  "confidence",
] as const;

export function parseAgencyPackageReviewSubmission(input: unknown) {
  return agencyPackageReviewSchema.safeParse(input);
}

function isTrustedHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && (parsed.port === "" || parsed.port === "443");
  } catch {
    return false;
  }
}

function hostnameMatches(value: string, domains: readonly string[]): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/u, "");
    return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

const httpsUrl = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.string().trim().url().max(2_000)
    .refine(isTrustedHttpsUrl, "안전한 https URL만 입력할 수 있습니다.")
    .nullable(),
);

const instagramUrl = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.string().trim().url().max(2_000)
    .refine(isTrustedHttpsUrl, "안전한 https URL만 입력할 수 있습니다.")
    .refine(
      (value) => hostnameMatches(value, ["instagram.com"]),
      "instagram.com 주소만 입력할 수 있습니다.",
    )
    .nullable(),
);

const naverPlaceUrl = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.string().trim().url().max(2_000)
    .refine(isTrustedHttpsUrl, "안전한 https URL만 입력할 수 있습니다.")
    .refine(
      (value) => hostnameMatches(value, ["naver.com", "naver.me"]),
      "네이버 지도·플레이스 주소만 입력할 수 있습니다.",
    )
    .nullable(),
);

const enrichmentEnvelopeSchema = z.strictObject({
  action: z.enum(["save", "complete"]),
  official_url: httpsUrl.optional().default(null),
  instagram_url: instagramUrl.optional().default(null),
  naver_place_url: naverPlaceUrl.optional().default(null),
  attributes: z.unknown(),
  tag_ids: z.array(z.string().uuid()).max(100).refine(
    (values) => new Set(values).size === values.length,
    "태그가 중복되었습니다.",
  ),
});

export type ParsedEnrichmentSubmission = {
  action: "save" | "complete";
  officialUrl: string | null;
  instagramUrl: string | null;
  naverPlaceUrl: string | null;
  publicAttributes: Record<string, unknown>;
  priceBand: string | null;
  notesInternal: string | null;
  tagIds: string[];
};

export function parseEnrichmentSubmission(
  category: VendorAttributeCategory,
  input: unknown,
) {
  const envelope = enrichmentEnvelopeSchema.safeParse(input);
  if (!envelope.success) return envelope;

  const attributes = validateVendorAttributes(category, envelope.data.attributes);
  if (!attributes.success) return attributes;

  const {
    notes_internal: rawNotes,
    price_band: rawPriceBand,
    ...publicAttributes
  } = attributes.data as Record<string, unknown>;
  const notesInternal = typeof rawNotes === "string" && rawNotes.length > 0 ? rawNotes : null;
  const priceBand = typeof rawPriceBand === "string" ? rawPriceBand : null;
  return {
    success: true as const,
    data: {
      action: envelope.data.action,
      officialUrl: envelope.data.official_url,
      instagramUrl: envelope.data.instagram_url,
      naverPlaceUrl: envelope.data.naver_place_url,
      publicAttributes,
      priceBand,
      notesInternal,
      tagIds: envelope.data.tag_ids,
    } satisfies ParsedEnrichmentSubmission,
  };
}

export function mergePrivateEnrichmentAttributes(
  attributes: unknown,
  priceBand: unknown,
): Record<string, unknown> {
  const rawAttributes = attributes && typeof attributes === "object" && !Array.isArray(attributes)
    ? attributes as Record<string, unknown>
    : {};
  const publicAttributes = { ...rawAttributes };
  delete publicAttributes.notes_internal;
  delete publicAttributes.price_band;
  return typeof priceBand === "string" && (PRICE_BANDS as readonly string[]).includes(priceBand)
    ? { ...publicAttributes, price_band: priceBand }
    : publicAttributes;
}

export type ApprovedFittingFeeSuggestion = {
  value_krw: number;
  source_quote: string;
  price_id: string;
  option_id: string;
};

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedKrw(value: unknown): number | null {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 2_147_483_647
    ? value
    : null;
}

/**
 * Produces an admin-only proposal, never a persisted attribute. A suggestion
 * is allowed only when approved evidence points to one exact value; conflicting
 * or ranged evidence stays manual instead of choosing a convenient number.
 */
export function deriveApprovedFittingFeeSuggestion(
  prices: unknown,
): ApprovedFittingFeeSuggestion | null {
  if (!Array.isArray(prices)) return null;
  const candidates: ApprovedFittingFeeSuggestion[] = [];

  for (const rawPrice of prices) {
    const price = unknownRecord(rawPrice);
    if (!price || price.review_status !== "approved" || !Array.isArray(price.options)) continue;
    const priceId = typeof price.id === "string" ? price.id : "";
    if (!priceId) continue;

    for (const rawOption of price.options) {
      const option = unknownRecord(rawOption);
      if (!option) continue;
      const optionId = typeof option.id === "string" ? option.id : "";
      const sourceQuote = typeof option.source_quote === "string"
        ? option.source_quote.trim()
        : "";
      const evidenceText = [option.name, option.raw_text, sourceQuote]
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      if (!optionId || !sourceQuote || !/(피팅|fitting)/iu.test(evidenceText)) continue;

      const minimum = boundedKrw(option.price_min_krw);
      const maximum = boundedKrw(option.price_max_krw);
      if (minimum === null || (maximum !== null && maximum !== minimum)) continue;
      candidates.push({
        value_krw: minimum,
        source_quote: sourceQuote,
        price_id: priceId,
        option_id: optionId,
      });
    }
  }

  if (candidates.length === 0 || new Set(candidates.map(({ value_krw }) => value_krw)).size !== 1) {
    return null;
  }
  return candidates.sort((left, right) =>
    left.price_id.localeCompare(right.price_id)
    || left.option_id.localeCompare(right.option_id)
  )[0] ?? null;
}

const DB_TO_ATTRIBUTE_CATEGORY: Record<string, VendorAttributeCategory> = {
  studio: "studio",
  dress: "dress",
  makeup: "makeup",
  venue: "hall",
  hall: "hall",
};

export function normalizeVendorCategory(value: string): VendorAttributeCategory | null {
  return DB_TO_ATTRIBUTE_CATEGORY[value] ?? null;
}

export function attributeCategoryToDb(value: VendorAttributeCategory): string {
  return value === "hall" ? "venue" : value;
}

export function sourceFileLabel(sourceFile: string | null | undefined): string | null {
  return sourceFileLabels(sourceFile)[0] ?? null;
}

export function sourceFileLabels(sourceFile: string | null | undefined): string[] {
  if (!sourceFile) return [];
  let paths: string[] = [sourceFile];
  try {
    const parsed: unknown = JSON.parse(sourceFile);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      paths = parsed;
    }
  } catch {
    // Single-file provenance is stored as a plain relative path.
  }
  return paths.flatMap((value) => {
    const normalized = value.replaceAll("\\", "/");
    const label = normalized.split("/").filter(Boolean).at(-1)?.trim();
    return label ? [label] : [];
  });
}

export function isSafeDisclosureObjectKey(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{64}\.(xlsx|docx|hwp|pdf|png|json)$/.test(value);
}

export const VENDOR_REGION_LABELS: Readonly<Record<string, string>> = {
  seoul_gangnam3: "서울 강남권",
  seoul_etc: "서울 강남 외",
  gyeonggi: "경기",
  incheon: "인천",
  gangwon: "강원",
  chungcheong: "충청",
  daejeon: "대전",
  jeolla: "전라",
  gwangju: "광주",
  gyeongsang: "경상",
  busan: "부산",
  ulsan: "울산",
  daegu: "대구",
  jeju: "제주",
};

export function vendorRegionLabel(regionCode: unknown): string {
  return typeof regionCode === "string" ? VENDOR_REGION_LABELS[regionCode] ?? "" : "";
}

export function buildVendorSearchLinks(name: string, regionLabel: string) {
  const query = [name.trim(), regionLabel.trim()].filter(Boolean).join(" ");
  const searchParams = new URLSearchParams({ query });
  return {
    naverSearch: `https://search.naver.com/search.naver?${searchParams.toString()}`,
    naverMap: `https://map.naver.com/p/search/${encodeURIComponent(query)}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(query)}`,
  } as const;
}

export const PRICE_EDITABLE_COLUMNS = [
  "category",
  "item_name",
  "base_spec",
  "price_min_krw",
  "price_max_krw",
  "vat_note",
  "price_note",
  "source_quote",
  "confidence",
] as const;
