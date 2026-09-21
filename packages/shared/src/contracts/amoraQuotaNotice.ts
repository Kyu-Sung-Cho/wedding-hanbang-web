export type AmoraQuotaPeriod = "daily" | "total";

export type AmoraQuotaWarning = {
  type: "quota";
  remaining: number;
  period?: AmoraQuotaPeriod;
};

/** 가장 먼저 닿는 한도만 안내한다. 차단 판단이나 추가 AI 호출은 하지 않는다. */
export function getAmoraQuotaWarning(reservation: {
  allowed: boolean;
  remaining?: number;
  dailyRemaining?: number;
}): AmoraQuotaWarning | null {
  if (!reservation.allowed) return null;
  const nearLimit = (value: number | undefined): value is number =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 15;
  const total = nearLimit(reservation.remaining) ? reservation.remaining : undefined;
  const daily = nearLimit(reservation.dailyRemaining) ? reservation.dailyRemaining : undefined;
  if (daily !== undefined && (total === undefined || daily < total)) {
    return { type: "quota", remaining: daily, period: "daily" };
  }
  return total === undefined ? null : { type: "quota", remaining: total };
}

export function formatAmoraQuotaNotice(
  remaining: number,
  period: AmoraQuotaPeriod = "total",
): string {
  if (period === "daily") {
    return remaining > 0
      ? `오늘 상담이 약 ${remaining}회 남았어요. 대화 정리에서 다음에 이어갈 내용을 확인해 주세요. 예산·일정 기록은 유지돼요.`
      : "오늘 상담 횟수를 모두 사용했어요. 내일 다시 이어갈 수 있어요. 대화 정리와 예산·일정 기록은 계속 확인할 수 있어요.";
  }
  return remaining > 0
    ? `무료 상담이 ${remaining}회 남았어요. 소진돼도 예산·일정 기록은 그대로 보관돼요.`
    : "무료 상담을 모두 사용했어요. 예산·일정 기록은 그대로 보관돼요.";
}
