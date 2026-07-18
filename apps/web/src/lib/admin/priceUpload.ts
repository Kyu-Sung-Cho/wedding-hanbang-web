import { createHash } from "node:crypto";

import { z } from "zod";

const categorySchema = z.enum(["studio", "dress", "makeup", "hall"]);
const sourceSchema = z.enum(["kca_tprice", "agency_site", "mixed"]);
const regionCodeSchema = z.enum([
  "seoul_gangnam3",
  "seoul_etc",
  "incheon",
  "busan",
  "daejeon",
  "gwangju",
  "daegu",
  "ulsan",
  "gyeonggi",
  "chungcheong",
  "jeolla",
  "gyeongsang",
  "gangwon",
  "jeju",
]);
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const krwSchema = z.number().int().nonnegative().max(POSTGRES_INTEGER_MAX);
const nullableTextSchema = z.string().trim().max(2_000).nullable();

/**
 * The upload endpoint has a 30 second statement budget. These limits bound a
 * single synchronous transaction to at most 200 parent rows and 1,000 option
 * rows, while leaving headroom for matching, validation, audit, and queue work.
 */
export const PRICE_UPLOAD_LIMITS = Object.freeze({
  maxEntries: 50,
  maxPricesPerEntry: 20,
  maxOptionsPerPrice: 50,
  maxTotalPrices: 200,
  maxTotalOptions: 1_000,
});

const optionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  price_min_krw: krwSchema,
  price_max_krw: krwSchema,
  unit: z.string().trim().max(100).nullable(),
  condition: z.string().trim().max(500).nullable(),
  raw_text: z.string().trim().min(1).max(2_000),
  is_effectively_mandatory: z.boolean().optional().default(false),
}).strict().superRefine((option, context) => {
  if (option.price_min_krw > option.price_max_krw) {
    context.addIssue({
      code: "custom",
      message: "최소 금액은 최대 금액보다 클 수 없습니다.",
      path: ["price_min_krw"],
    });
  }
});

const priceSchema = z.object({
  agency_slug: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/u),
  price_min_krw: krwSchema,
  price_max_krw: krwSchema,
  price_note: nullableTextSchema,
  base_spec: nullableTextSchema,
  options: z.array(optionSchema).max(PRICE_UPLOAD_LIMITS.maxOptionsPerPrice).default([]),
}).strict().superRefine((price, context) => {
  if (price.price_min_krw > price.price_max_krw) {
    context.addIssue({
      code: "custom",
      message: "최소 금액은 최대 금액보다 클 수 없습니다.",
      path: ["price_min_krw"],
    });
  }
  const optionIdentities = new Set<string>();
  price.options.forEach((option, index) => {
    const identity = JSON.stringify([
      option.name,
      option.unit ?? "",
      option.condition ?? "",
    ]);
    if (optionIdentities.has(identity)) {
      context.addIssue({
        code: "custom",
        message: "이름·단위·조건이 같은 옵션을 중복해서 올릴 수 없습니다.",
        path: ["options", index, "name"],
      });
    }
    optionIdentities.add(identity);
  });
});

const entrySchema = z.object({
  vendor_name: z.string().trim().min(1).max(200),
  category: categorySchema,
  region_code: regionCodeSchema,
  aliases: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
  prices: z.array(priceSchema).min(1).max(PRICE_UPLOAD_LIMITS.maxPricesPerEntry),
}).strict().superRefine((entry, context) => {
  const normalized = normalizeUploadVendor(entry.vendor_name, entry.aliases);
  if (!normalized.displayName || !normalized.normalizedName) {
    context.addIssue({
      code: "custom",
      message: "현재 업체명이 비어 있을 수 없습니다.",
      path: ["vendor_name"],
    });
  }
});

const priceUploadObjectSchema = z.object({
  period_label: z.string().trim().min(1).max(40),
  source: sourceSchema,
  source_note: z.string().trim().min(1).max(500),
  collected_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "유효한 날짜가 아닙니다."),
  entries: z.array(entrySchema).min(1).max(PRICE_UPLOAD_LIMITS.maxEntries),
}).strict();

type ParsedPriceUploadObject = z.infer<typeof priceUploadObjectSchema>;
type ParsedPriceUploadEntry = ParsedPriceUploadObject["entries"][number];
type ParsedPriceUploadPrice = ParsedPriceUploadEntry["prices"][number];

function uploadSourceRecordIdentity(
  upload: Pick<ParsedPriceUploadObject, "period_label" | "source">,
  entry: ParsedPriceUploadEntry,
  price: ParsedPriceUploadPrice,
) {
  const normalized = normalizeUploadVendor(entry.vendor_name, entry.aliases);
  const options = price.options
    .map((option) => ({
      name: option.name,
      price_min_krw: option.price_min_krw,
      price_max_krw: option.price_max_krw,
      unit: option.unit,
      condition: option.condition,
      raw_text: option.raw_text,
      is_effectively_mandatory: option.is_effectively_mandatory,
    }))
    .sort((left, right) => {
      const leftKey = JSON.stringify(left);
      const rightKey = JSON.stringify(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
  return {
    period_label: upload.period_label,
    source: upload.source,
    vendor_name: normalized.normalizedName,
    category: entry.category,
    region_code: entry.region_code,
    agency_slug: price.agency_slug,
    price_min_krw: price.price_min_krw,
    price_max_krw: price.price_max_krw,
    price_note: price.price_note,
    base_spec: price.base_spec,
    options,
  };
}

export const priceUploadSchema = priceUploadObjectSchema.superRefine((upload, context) => {
  const totalPrices = upload.entries.reduce((sum, entry) => sum + entry.prices.length, 0);
  const totalOptions = upload.entries.reduce(
    (sum, entry) => sum + entry.prices.reduce(
      (entrySum, price) => entrySum + price.options.length,
      0,
    ),
    0,
  );
  if (totalPrices > PRICE_UPLOAD_LIMITS.maxTotalPrices) {
    context.addIssue({
      code: "custom",
      message: `한 번에 가격 행은 최대 ${PRICE_UPLOAD_LIMITS.maxTotalPrices}개까지 업로드할 수 있습니다.`,
      path: ["entries"],
    });
  }
  if (totalOptions > PRICE_UPLOAD_LIMITS.maxTotalOptions) {
    context.addIssue({
      code: "custom",
      message: `한 번에 옵션은 최대 ${PRICE_UPLOAD_LIMITS.maxTotalOptions}개까지 업로드할 수 있습니다.`,
      path: ["entries"],
    });
  }

  const identities = new Set<string>();
  upload.entries.forEach((entry, entryIndex) => {
    entry.prices.forEach((price, priceIndex) => {
      const identity = JSON.stringify(uploadSourceRecordIdentity(upload, entry, price));
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "같은 원본 가격 행이 중복되어 있습니다.",
          path: ["entries", entryIndex, "prices", priceIndex],
        });
      }
      identities.add(identity);
    });
  });
});

export type PriceUpload = z.infer<typeof priceUploadSchema>;

export type PriceUploadParseResult =
  | { success: true; data: PriceUpload }
  | { success: false; issues: Array<{ path: string; message: string }> };

export type VendorMatchKind = "exact_name" | "exact_alias" | "similar";

export interface PriceUploadVendorCandidate {
  vendorId: string;
  vendorName: string;
  vendorSlug: string | null;
  aliases: string[];
  similarity: number;
  matchKind: VendorMatchKind;
}

export type EnrichedPriceUploadEntry = Omit<PriceUpload["entries"][number], "prices"> & {
  prices: Array<PriceUpload["entries"][number]["prices"][number] & {
    source_record_key: string;
    source_quote: string;
  }>;
};

export type PreparedPriceUploadEntry = {
  entryIndex: number;
  entry: EnrichedPriceUploadEntry;
  resolution:
    | {
      kind: "existing";
      vendorId: string;
      vendorName: string;
    }
    | {
      kind: "draft";
      vendorName: string;
      normalizedName: string;
      vendorSlug: string;
    }
    | {
      kind: "confirmation";
      candidateVendorIds: string[];
      candidates: PriceUploadVendorCandidate[];
    };
};

export type AtomicPriceUploadInput = {
  sourceObjectKey: string;
  createdBy: string;
  upload: Pick<PriceUpload, "period_label" | "source" | "source_note" | "collected_at">;
  entries: PreparedPriceUploadEntry[];
};

export interface PriceUploadRepository {
  findAgencies(slugs: readonly string[]): Promise<Array<{ id: string; slug: string }>>;
  findVendorCandidatesBatch(inputs: ReadonlyArray<{
    entryIndex: number;
    name: string;
    category: PriceUpload["entries"][number]["category"];
  }>): Promise<Array<{
    entryIndex: number;
    candidates: PriceUploadVendorCandidate[];
  }>>;
  commitUpload(input: AtomicPriceUploadInput): Promise<PriceUploadReport>;
}

export interface PriceUploadReport {
  snapshot_id: string | null;
  counts: {
    auto_matched: number;
    newly_created: number;
    needs_confirmation: number;
    errors: number;
    staged_prices: number;
  };
  details: {
    auto_matched: Array<{ entry_index: number; vendor_id: string; vendor_name: string }>;
    newly_created: Array<{ entry_index: number; vendor_id: string; vendor_name: string }>;
    needs_confirmation: Array<{
      confirmation_id: string;
      version: 0;
      entry_index: number;
      vendor_name: string;
      candidates: PriceUploadVendorCandidate[];
    }>;
    errors: Array<{ entry_index: number; vendor_name: string; code: string; message: string }>;
  };
}

export type PriceUploadEvidence = {
  actorId: string;
  objectKey: string;
};

function adminJsonPriceQuote(
  entryIndex: number,
  priceIndex: number,
  price: PriceUpload["entries"][number]["prices"][number],
): string {
  const pointer = `/entries/${entryIndex}/prices/${priceIndex}`;
  const quote = price.base_spec
    ? `JSON ${pointer}/base_spec: ${price.base_spec}`
    : price.price_note
      ? `JSON ${pointer}/price_note: ${price.price_note}`
      : `JSON ${pointer}: price_min_krw=${price.price_min_krw}; price_max_krw=${price.price_max_krw}`;
  return quote.slice(0, 2_000);
}

export function normalizeVendorName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ko-KR").replace(/\s+/gu, "");
}

export function createDraftVendorSlug(
  category: PriceUpload["entries"][number]["category"],
  regionCode: PriceUpload["entries"][number]["region_code"],
  normalizedName: string,
): string {
  const digest = createHash("sha256")
    .update(`${category}\0${regionCode}\0${normalizedName}`, "utf8")
    .digest("hex")
    .slice(0, 12);
  return `${category}-${regionCode.replaceAll("_", "-")}-${digest}`;
}

export function normalizeUploadVendor(
  rawName: string,
  suppliedAliases: readonly string[],
): { displayName: string; normalizedName: string; aliases: string[] } {
  const formerNames = Array.from(rawName.matchAll(/\(\s*구\.?\s*([^)]+)\)/gu))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const displayName = rawName
    .replace(/\(\s*구\.?\s*([^)]+)\)/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
  const normalizedName = normalizeVendorName(displayName);
  const seen = new Set<string>([normalizedName]);
  const aliases: string[] = [];
  for (const rawAlias of [...suppliedAliases, ...formerNames]) {
    const alias = rawAlias.trim().replace(/\s+/gu, " ");
    const normalizedAlias = normalizeVendorName(alias);
    if (!alias || seen.has(normalizedAlias)) continue;
    seen.add(normalizedAlias);
    aliases.push(alias);
  }
  return { displayName, normalizedName, aliases };
}

export function createUploadSourceRecordKey(
  upload: PriceUpload,
  entry: PriceUpload["entries"][number],
  price: PriceUpload["entries"][number]["prices"][number],
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(uploadSourceRecordIdentity(upload, entry, price)), "utf8")
    .digest("hex");
  return `admin-json:${digest}`;
}

export async function processPriceUpload(
  upload: PriceUpload,
  repository: PriceUploadRepository,
  evidence: PriceUploadEvidence,
): Promise<PriceUploadReport> {
  const agencySlugs = Array.from(new Set(
    upload.entries.flatMap((entry) => entry.prices.map((price) => price.agency_slug)),
  ));
  const agencies = await repository.findAgencies(agencySlugs);
  const agencyBySlug = new Map(agencies.map((agency) => [agency.slug, agency.id]));
  const preflightReport: PriceUploadReport = {
    snapshot_id: null,
    counts: {
      auto_matched: 0,
      newly_created: 0,
      needs_confirmation: 0,
      errors: 0,
      staged_prices: 0,
    },
    details: { auto_matched: [], newly_created: [], needs_confirmation: [], errors: [] },
  };
  const preparedEntries: PreparedPriceUploadEntry[] = [];
  const eligibleEntries: Array<{
    entryIndex: number;
    entry: PriceUpload["entries"][number];
    normalized: ReturnType<typeof normalizeUploadVendor>;
  }> = [];

  for (const [entryIndex, entry] of upload.entries.entries()) {
    const missingAgency = entry.prices.find((price) => !agencyBySlug.has(price.agency_slug));
    if (missingAgency) {
      preflightReport.counts.errors += 1;
      preflightReport.details.errors.push({
        entry_index: entryIndex,
        vendor_name: entry.vendor_name,
        code: "AGENCY_NOT_FOUND",
        message: `등록되지 않은 대행사 slug입니다: ${missingAgency.agency_slug}`,
      });
      continue;
    }

    const normalized = normalizeUploadVendor(entry.vendor_name, entry.aliases);
    eligibleEntries.push({ entryIndex, entry, normalized });
  }
  if (eligibleEntries.length === 0) return preflightReport;
  const candidateBatches = await repository.findVendorCandidatesBatch(
    eligibleEntries.map(({ entryIndex, entry, normalized }) => ({
      entryIndex,
      name: normalized.displayName,
      category: entry.category,
    })),
  );
  const candidatesByEntry = new Map(
    candidateBatches.map((batch) => [batch.entryIndex, batch.candidates]),
  );
  if (candidatesByEntry.size !== eligibleEntries.length) {
    throw new Error("PRICE_UPLOAD_MATCH_RESPONSE_INVALID");
  }

  for (const { entryIndex, entry, normalized } of eligibleEntries) {
    const candidates = candidatesByEntry.get(entryIndex);
    if (!candidates) throw new Error("PRICE_UPLOAD_MATCH_RESPONSE_INVALID");
    const exactMatches = candidates.filter((candidate) => candidate.matchKind !== "similar");
    const reviewCandidates = exactMatches.length > 1
      ? exactMatches
      : candidates.filter(
        (candidate) => candidate.matchKind === "similar" && candidate.similarity >= 0.6,
      );
    if (exactMatches.length !== 1 && reviewCandidates.length > 0) {
      preparedEntries.push({
        entryIndex,
        entry: {
          ...entry,
          vendor_name: normalized.displayName,
          aliases: normalized.aliases,
          prices: entry.prices.map((price, priceIndex) => ({
            ...price,
            source_record_key: createUploadSourceRecordKey(upload, entry, price),
            source_quote: adminJsonPriceQuote(entryIndex, priceIndex, price),
          })),
        },
        resolution: {
          kind: "confirmation",
          candidateVendorIds: reviewCandidates.map((candidate) => candidate.vendorId),
          candidates: reviewCandidates,
        },
      });
      continue;
    }
    const enrichedEntry: EnrichedPriceUploadEntry = {
      ...entry,
      vendor_name: normalized.displayName,
      aliases: normalized.aliases,
      prices: entry.prices.map((price, priceIndex) => ({
        ...price,
        source_record_key: createUploadSourceRecordKey(upload, entry, price),
        source_quote: adminJsonPriceQuote(entryIndex, priceIndex, price),
      })),
    };
    if (exactMatches.length === 1) {
      preparedEntries.push({
        entryIndex,
        entry: enrichedEntry,
        resolution: {
          kind: "existing",
          vendorId: exactMatches[0].vendorId,
          vendorName: exactMatches[0].vendorName,
        },
      });
    } else {
      preparedEntries.push({
        entryIndex,
        entry: enrichedEntry,
        resolution: {
          kind: "draft",
          vendorName: normalized.displayName,
          normalizedName: normalized.normalizedName,
          vendorSlug: createDraftVendorSlug(
            entry.category,
            entry.region_code,
            normalized.normalizedName,
          ),
        },
      });
    }
  }
  if (preparedEntries.length === 0) return preflightReport;
  const committed = await repository.commitUpload({
    sourceObjectKey: evidence.objectKey,
    createdBy: evidence.actorId,
    upload: {
      period_label: upload.period_label,
      source: upload.source,
      source_note: upload.source_note,
      collected_at: upload.collected_at,
    },
    entries: preparedEntries,
  });
  return {
    ...committed,
    counts: {
      ...committed.counts,
      errors: committed.counts.errors + preflightReport.counts.errors,
    },
    details: {
      ...committed.details,
      errors: [...preflightReport.details.errors, ...committed.details.errors],
    },
  };
}

export function parsePriceUpload(input: unknown): PriceUploadParseResult {
  const parsed = priceUploadSchema.safeParse(input);
  if (parsed.success) return { success: true, data: parsed.data };
  return {
    success: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  };
}
