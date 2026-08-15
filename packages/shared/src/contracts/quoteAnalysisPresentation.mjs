export const QUOTE_ANALYSIS_REOPEN_FALLBACK =
  "견적 체크 내용을 안전하게 확인하지 못했어요. 견적 체크리스트를 다시 열어주세요.";

const LEGACY_MARKER = "[quote_analysis]";
const V2_OPEN = "[quote_analysis_v2]";
const V2_CLOSE = "[/quote_analysis_v2]";
const MAX_BYTES = 8_192;
const MAX_ITEMS_PER_STATE = 64;
const MAX_VENDOR_CHARS = 160;

const CATEGORY_LABELS = Object.freeze({
  sdm_package: "사진 촬영·드레스·메이크업 묶음 견적",
  studio: "사진 촬영",
  dress: "웨딩드레스",
  makeup: "헤어·메이크업",
});

const REGION_LABELS = Object.freeze({
  seoul: "서울",
  gyeonggi: "경기/인천",
  busan: "부산",
  daegu: "대구",
  other: "기타 지역",
});

const STUDIO_ITEM_IDS = Object.freeze([
  "studio_original_data",
  "studio_album_extra",
  "studio_retouch_extra",
  "studio_frame_change",
  "studio_early_start",
  "studio_designate",
  "studio_outdoor",
  "studio_confirm_fee",
  "studio_overtime",
  "studio_video",
  "studio_prop_costume",
  "studio_photo_table",
]);

const DRESS_ITEM_IDS = Object.freeze([
  "dress_helper_shoot",
  "dress_helper_ceremony",
  "dress_fitting_extra",
  "dress_alteration",
  "dress_second",
  "dress_designate",
  "dress_tuxedo",
  "dress_innerwear",
  "dress_accessories",
  "dress_cleaning_deposit",
]);

const MAKEUP_ITEM_IDS = Object.freeze([
  "makeup_rehearsal",
  "makeup_parents",
  "makeup_groom",
  "makeup_designate",
  "makeup_early_start",
  "makeup_hairpiece",
  "makeup_trip_fee",
  "makeup_eyelash",
  "makeup_accessory_rental",
]);

const ITEM_IDS = Object.freeze({
  studio: STUDIO_ITEM_IDS,
  dress: DRESS_ITEM_IDS,
  makeup: MAKEUP_ITEM_IDS,
  sdm_package: Object.freeze([
    ...STUDIO_ITEM_IDS,
    ...DRESS_ITEM_IDS,
    ...MAKEUP_ITEM_IDS,
  ]),
});

function utf8ByteLength(value) {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      bytes += code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff ? 4 : 3;
    } else bytes += 3;
  }
  return bytes;
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseIdArray(value) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS_PER_STATE) return null;
  if (value.some((id) => typeof id !== "string" || !/^[a-z][a-z0-9_]{0,79}$/u.test(id))) {
    return null;
  }
  if (new Set(value).size !== value.length) return null;
  return [...value];
}

function parsePayload(value) {
  if (!isRecord(value) || !hasExactKeys(value, [
    "version",
    "category",
    "region",
    "quotePriceManwon",
    "vendorName",
    "states",
  ])) return null;

  const category = value.category;
  const region = value.region;
  const price = value.quotePriceManwon;
  const vendorName = value.vendorName;
  if (
    value.version !== 2
    || typeof category !== "string"
    || !Object.hasOwn(CATEGORY_LABELS, category)
    || typeof region !== "string"
    || !Object.hasOwn(REGION_LABELS, region)
    || typeof price !== "number"
    || !Number.isFinite(price)
    || price <= 0
    || price > 10_000
    || Math.round(price * 100) !== price * 100
    || typeof vendorName !== "string"
    || vendorName.length > MAX_VENDOR_CHARS
    || vendorName !== vendorName.trim()
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(vendorName)
    || !isRecord(value.states)
    || !hasExactKeys(value.states, ["included", "notNeeded", "unknown"])
  ) return null;

  const included = parseIdArray(value.states.included);
  const notNeeded = parseIdArray(value.states.notNeeded);
  const unknown = parseIdArray(value.states.unknown);
  if (!included || !notNeeded || !unknown) return null;

  const expected = ITEM_IDS[category];
  const partition = [...included, ...notNeeded, ...unknown];
  if (
    partition.length !== expected.length
    || new Set(partition).size !== partition.length
    || partition.some((id) => !expected.includes(id))
    || expected.some((id) => !partition.includes(id))
  ) return null;

  return {
    category,
    region,
    quotePriceManwon: price,
    vendorName,
    states: { included, notNeeded, unknown },
  };
}

function expectedHeader(payload) {
  const subject = payload.vendorName || CATEGORY_LABELS[payload.category];
  return `견적 체크: ${subject} · ${CATEGORY_LABELS[payload.category]} · ${REGION_LABELS[payload.region]} · ${String(payload.quotePriceManwon)}만원`;
}

export function getQuoteAnalysisExpectedItemIds(category) {
  return Object.hasOwn(ITEM_IDS, category) ? [...ITEM_IDS[category]] : [];
}

export function getQuoteAnalysisMessagePresentation(text) {
  if (typeof text !== "string") {
    return { kind: "fallback", text: QUOTE_ANALYSIS_REOPEN_FALLBACK };
  }
  const hasLegacy = text.includes(LEGACY_MARKER);
  const openCount = text.split(V2_OPEN).length - 1;
  const closeCount = text.split(V2_CLOSE).length - 1;
  if (!hasLegacy && openCount === 0 && closeCount === 0) {
    return { kind: "plain", text };
  }
  if (
    hasLegacy
    || openCount !== 1
    || closeCount !== 1
    || utf8ByteLength(text) > MAX_BYTES
  ) return { kind: "fallback", text: QUOTE_ANALYSIS_REOPEN_FALLBACK };

  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (
    lines.length !== 4
    || lines[1] !== V2_OPEN
    || lines[3] !== V2_CLOSE
  ) return { kind: "fallback", text: QUOTE_ANALYSIS_REOPEN_FALLBACK };

  let rawPayload;
  try {
    rawPayload = JSON.parse(lines[2]);
  } catch {
    return { kind: "fallback", text: QUOTE_ANALYSIS_REOPEN_FALLBACK };
  }
  const payload = parsePayload(rawPayload);
  if (!payload || lines[0] !== expectedHeader(payload)) {
    return { kind: "fallback", text: QUOTE_ANALYSIS_REOPEN_FALLBACK };
  }
  return { kind: "valid_v2", text: lines[0] };
}
