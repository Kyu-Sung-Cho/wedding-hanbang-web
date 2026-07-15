export function normalizeMarketPrice(
  value: number | null | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function formatMarketPrice(
  value: number | null | undefined,
  suffix = "만원",
) {
  const normalized = normalizeMarketPrice(value);
  return normalized !== null
    ? `${normalized.toLocaleString()}${suffix}`
    : "자료 없음";
}

export function compareAvailableMarketPrices(
  left: number | null | undefined,
  right: number | null | undefined,
  ascending: boolean,
) {
  const normalizedLeft = normalizeMarketPrice(left);
  const normalizedRight = normalizeMarketPrice(right);
  const leftAvailable = normalizedLeft !== null;
  const rightAvailable = normalizedRight !== null;
  if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;
  if (!leftAvailable || !rightAvailable) return 0;
  return ascending
    ? normalizedLeft - normalizedRight
    : normalizedRight - normalizedLeft;
}
