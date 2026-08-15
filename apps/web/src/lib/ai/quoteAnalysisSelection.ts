import {
  AMORA_QUOTE_CATEGORY_LABELS,
  AMORA_QUOTE_REGION_LABELS,
  getQuoteCheckItems,
  type AmoraQuoteCategory,
  type AmoraQuoteRegion,
} from "@/lib/amora/quoteCheck";
import { getQuoteAnalysisMessagePresentation } from "@hanbang/shared/quote-analysis-presentation";

const LEGACY_QUOTE_ANALYSIS_TAG = "[quote_analysis]";
export const QUOTE_ANALYSIS_V2_OPEN = "[quote_analysis_v2]";
export const QUOTE_ANALYSIS_V2_CLOSE = "[/quote_analysis_v2]";
const MAX_CANONICAL_BYTES = 8_192;
const MAX_ITEMS_PER_STATE = 64;
const MAX_VENDOR_CHARS = 160;
const CATEGORY_SET = new Set<AmoraQuoteCategory>([
  "sdm_package",
  "studio",
  "dress",
  "makeup",
]);
const REGION_SET = new Set<AmoraQuoteRegion>([
  "seoul",
  "gyeonggi",
  "busan",
  "daegu",
  "other",
]);

type QuoteItemStates = {
  included: string[];
  notNeeded: string[];
  unknown: string[];
};

type QuoteAnalysisV2Payload = {
  version: 2;
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  quotePriceManwon: number;
  vendorName: string;
  states: QuoteItemStates;
};

export type CanonicalQuoteAnalysisSelection = {
  status: "absent" | "valid" | "invalid";
  includedItems: string[];
  notNeededItems: string[];
  unknownItems: string[];
  checklistConfirmed: boolean;
  category?: AmoraQuoteCategory;
  region?: AmoraQuoteRegion;
  quotePriceManwon?: number;
  vendorName?: string;
};

export type CanonicalQuoteAnalysisMessageInput = {
  category: AmoraQuoteCategory;
  region: AmoraQuoteRegion;
  quotePriceManwon: number;
  vendorName: string;
  includedItemIds: string[];
  notNeededItemIds: string[];
  unknownItemIds: string[];
};

const EMPTY_SELECTION = {
  includedItems: [] as string[],
  notNeededItems: [] as string[],
  unknownItems: [] as string[],
  checklistConfirmed: false,
};

function invalidSelection(): CanonicalQuoteAnalysisSelection {
  return { status: "invalid", ...EMPTY_SELECTION };
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isBoundedVendorName(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= MAX_VENDOR_CHARS
    && value === value.trim()
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value);
}

function isBoundedQuotePrice(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value <= 10_000
    && Math.round(value * 100) === value * 100;
}

function parseIdArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_STATE) return null;
  if (value.some((id) => (
    typeof id !== "string"
    || !/^[a-z][a-z0-9_]{0,79}$/u.test(id)
  ))) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

function hasExactFullPartition(
  category: AmoraQuoteCategory,
  region: AmoraQuoteRegion,
  states: QuoteItemStates,
): boolean {
  const expectedIds = getQuoteCheckItems(category, region).map((item) => item.id);
  const allIds = [...states.included, ...states.notNeeded, ...states.unknown];
  return allIds.length === expectedIds.length
    && new Set(allIds).size === allIds.length
    && allIds.every((id) => expectedIds.includes(id))
    && expectedIds.every((id) => allIds.includes(id));
}

function formatQuotePrice(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function humanHeader(payload: QuoteAnalysisV2Payload): string {
  const subject = payload.vendorName || AMORA_QUOTE_CATEGORY_LABELS[payload.category];
  return `견적 체크: ${subject} · ${AMORA_QUOTE_CATEGORY_LABELS[payload.category]} · ${AMORA_QUOTE_REGION_LABELS[payload.region]} · ${formatQuotePrice(payload.quotePriceManwon)}만원`;
}

function parseV2Payload(value: unknown): QuoteAnalysisV2Payload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!hasExactKeys(payload, [
    "version",
    "category",
    "region",
    "quotePriceManwon",
    "vendorName",
    "states",
  ])) return null;
  if (
    payload.version !== 2
    || !CATEGORY_SET.has(payload.category as AmoraQuoteCategory)
    || !REGION_SET.has(payload.region as AmoraQuoteRegion)
    || !isBoundedQuotePrice(payload.quotePriceManwon)
    || !isBoundedVendorName(payload.vendorName)
    || !payload.states
    || typeof payload.states !== "object"
    || Array.isArray(payload.states)
  ) return null;

  const rawStates = payload.states as Record<string, unknown>;
  if (!hasExactKeys(rawStates, ["included", "notNeeded", "unknown"])) return null;
  const included = parseIdArray(rawStates.included);
  const notNeeded = parseIdArray(rawStates.notNeeded);
  const unknown = parseIdArray(rawStates.unknown);
  if (!included || !notNeeded || !unknown) return null;

  const parsed: QuoteAnalysisV2Payload = {
    version: 2,
    category: payload.category as AmoraQuoteCategory,
    region: payload.region as AmoraQuoteRegion,
    quotePriceManwon: payload.quotePriceManwon,
    vendorName: payload.vendorName,
    states: { included, notNeeded, unknown },
  };
  return hasExactFullPartition(parsed.category, parsed.region, parsed.states)
    ? parsed
    : null;
}

export function buildCanonicalQuoteAnalysisMessage(
  input: CanonicalQuoteAnalysisMessageInput,
): string {
  const payload = parseV2Payload({
    version: 2,
    category: input.category,
    region: input.region,
    quotePriceManwon: input.quotePriceManwon,
    vendorName: input.vendorName,
    states: {
      included: input.includedItemIds,
      notNeeded: input.notNeededItemIds,
      unknown: input.unknownItemIds,
    },
  });
  if (!payload) throw new Error("INVALID_QUOTE_ANALYSIS_V2_CONTEXT");
  const message = `${humanHeader(payload)}\n${QUOTE_ANALYSIS_V2_OPEN}\n${JSON.stringify(payload)}\n${QUOTE_ANALYSIS_V2_CLOSE}`;
  if (new TextEncoder().encode(message).byteLength > MAX_CANONICAL_BYTES) {
    throw new Error("QUOTE_ANALYSIS_V2_CONTEXT_TOO_LARGE");
  }
  return message;
}

export function parseCanonicalQuoteAnalysisSelection(
  userText: string,
): CanonicalQuoteAnalysisSelection {
  const hasLegacyTag = userText.includes(LEGACY_QUOTE_ANALYSIS_TAG);
  const openCount = userText.split(QUOTE_ANALYSIS_V2_OPEN).length - 1;
  const closeCount = userText.split(QUOTE_ANALYSIS_V2_CLOSE).length - 1;
  if (!hasLegacyTag && openCount === 0 && closeCount === 0) {
    return { status: "absent", ...EMPTY_SELECTION };
  }
  if (
    hasLegacyTag
    || openCount !== 1
    || closeCount !== 1
    || new TextEncoder().encode(userText).byteLength > MAX_CANONICAL_BYTES
  ) return invalidSelection();

  const normalized = userText.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (
    lines.length !== 4
    || lines[1] !== QUOTE_ANALYSIS_V2_OPEN
    || lines[3] !== QUOTE_ANALYSIS_V2_CLOSE
  ) return invalidSelection();

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(lines[2]);
  } catch {
    return invalidSelection();
  }
  const payload = parseV2Payload(rawPayload);
  if (!payload || lines[0] !== humanHeader(payload)) return invalidSelection();

  return {
    status: "valid",
    category: payload.category,
    region: payload.region,
    includedItems: payload.states.included,
    notNeededItems: payload.states.notNeeded,
    unknownItems: payload.states.unknown,
    checklistConfirmed: true,
    quotePriceManwon: payload.quotePriceManwon,
    vendorName: payload.vendorName,
  };
}

export function bindCanonicalQuoteAnalysisInput(
  providerInput: Record<string, unknown>,
  selection: CanonicalQuoteAnalysisSelection,
): Record<string, unknown> {
  return {
    ...providerInput,
    ...(selection.status === "valid"
      ? {
          category: selection.category,
          region: selection.region,
          quote_price: selection.quotePriceManwon,
          vendor_name: selection.vendorName,
        }
      : {}),
    included_items: [...selection.includedItems],
    not_needed_items: [...selection.notNeededItems],
    checklist_confirmed: selection.checklistConfirmed,
  };
}

export function getVisibleQuoteAnalysisMessage(text: string): string {
  return getQuoteAnalysisMessagePresentation(text).text;
}
