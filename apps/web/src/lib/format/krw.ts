const UNKNOWN_PRICE_LABEL = "가격 확인 필요";

function validKrw(value: number | null | undefined): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && Number.isSafeInteger(value)
    && value >= 0;
}

function manwonNumber(value: number): string {
  const rounded = Math.round(value / 1_000) / 10;
  return new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(rounded);
}

export function krwToManwonLabel(value: number | null | undefined): string {
  return validKrw(value) ? `${manwonNumber(value)}만원` : UNKNOWN_PRICE_LABEL;
}

export function krwRangeLabel(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
): string {
  if (!validKrw(minimum)) {
    return validKrw(maximum) ? `최대 ${krwToManwonLabel(maximum)}` : UNKNOWN_PRICE_LABEL;
  }
  if (!validKrw(maximum)) return `${krwToManwonLabel(minimum)}부터`;
  if (minimum === maximum) return krwToManwonLabel(minimum);

  return `${manwonNumber(minimum)}~${manwonNumber(maximum)}만원`;
}
