const DISCLOSURE_DISCLAIMER =
  "본 정보는 공시 기준이며 실제 계약 조건·시점에 따라 달라질 수 있습니다. 계약 전 업체에 직접 확인하세요.";

export function formatDisclosurePeriod(periodLabel: string): string {
  const normalized = periodLabel.trim();
  const quarter = /^(\d{4})Q([1-4])$/i.exec(normalized);
  if (quarter) return `${quarter[1]}년 ${quarter[2]}분기`;

  const month = /^(\d{4})-(0?[1-9]|1[0-2])$/.exec(normalized);
  if (month) return `${month[1]}년 ${Number(month[2])}월`;

  return normalized || "기간 확인 필요";
}

export function priceDisclosureLines(periodLabel: string): readonly [string, string] {
  return [
    `가격 출처: 한국소비자원 참가격 · ${formatDisclosurePeriod(periodLabel)} 공시 기준`,
    DISCLOSURE_DISCLAIMER,
  ];
}
