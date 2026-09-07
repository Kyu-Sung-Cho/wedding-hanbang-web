const ORDERS = new Set(["region_kind", "kind_distance", "kind_provider"]);

/** @param {unknown} value */
export function readPlaceRequestedCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20
    ? value : null;
}

/** 제공자 자유문장은 이 계약에 들어오지 않는다. @param {unknown} value */
export function readPlaceSearchFacts(value) {
  const output = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const requestedCount = readPlaceRequestedCount(output.requestedCount);
  return {
    ...(requestedCount !== null ? { requestedCount } : {}),
    ...(ORDERS.has(output.orderBasis) ? { orderBasis: output.orderBasis } : {}),
  };
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** @param {unknown} value */
export function formatPlaceSearchDate(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(DATE_FORMAT.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

/** @param {unknown} output @param {number} displayedCount */
export function getPlaceSearchPresentation(output, displayedCount) {
  const facts = readPlaceSearchFacts(output);
  const count = Number.isSafeInteger(displayedCount) && displayedCount >= 0 ? displayedCount : 0;
  const requested = facts.requestedCount;
  const shortfall = requested !== undefined && count < requested;
  const orderLabel = facts.orderBasis === "region_kind"
    ? "장소 종류를 고려하고 지역별 결과를 번갈아 배치했어요."
    : facts.orderBasis === "kind_distance"
      ? "장소 종류를 먼저 고려하고 같은 종류 안에서는 확인 가능한 직선거리 순으로 정리했어요."
      : facts.orderBasis === "kind_provider"
        ? "장소 종류를 먼저 고려하고 같은 종류 안에서는 네이버 검색 순서를 유지했어요."
        : "이 목록의 순서는 행사 적합성이나 인기도를 보장하지 않아요.";
  return {
    countLabel: requested !== undefined
      ? count <= requested ? `요청 ${requested}곳 중 ${count}곳 표시` : `요청 ${requested}곳 · ${count}곳 표시`
      : `검색 결과 ${count}곳`,
    shortageLabel: shortfall
      ? `이번 검색에서 표시할 수 있는 결과가 요청보다 적어요.${requested > 5 ? " 한 번에 최대 5곳까지 표시해요." : ""} 다른 지역이나 검색어로 더 찾아볼 수 있어요.`
      : null,
    orderLabel,
    verificationLabel: "수용인원·예약 가능일·가격은 확인되지 않았어요. 행사 후보로 결정하기 전에 업체에 직접 확인해 주세요.",
  };
}
