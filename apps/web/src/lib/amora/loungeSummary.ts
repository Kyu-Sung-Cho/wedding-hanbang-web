import { isValidScheduleYmd } from "@/utils/scheduleEvents";

export function formatLoungeWon(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0) return "금액 확인 필요";
  const tenThousands = Math.floor(amount / 10_000);
  const remainder = amount % 10_000;
  if (!tenThousands) return `${remainder.toLocaleString("ko-KR")}원`;
  return `${tenThousands.toLocaleString("ko-KR")}만${remainder ? remainder.toLocaleString("ko-KR") : ""}원`;
}

export function formatLoungeBudgetRatio(spent: number, total: number): string {
  if (!Number.isSafeInteger(spent) || spent < 0 || !Number.isSafeInteger(total) || total <= 0) return "비율 계산 전";
  const ratio = spent / total * 100;
  if (ratio > 0 && ratio < 0.1) return "0.1% 미만";
  const rounded = Math.round(ratio * 10) / 10;
  return `${rounded === ratio ? "" : "약 "}${rounded.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;
}

export function getLoungeSetupGuidance(weddingDate: string | null | undefined, totalBudget: number) {
  const needsDate = !isValidScheduleYmd(weddingDate);
  const needsBudget = !Number.isSafeInteger(totalBudget) || totalBudget <= 0;
  if (!needsDate && !needsBudget) return null;
  return {
    needsDate, needsBudget,
    text: [
      needsDate ? "결혼식 날짜를 입력하면 준비 시점을 날짜에 맞춰 볼 수 있어요." : null,
      needsBudget ? "총 예산을 입력하면 기록한 지출과 비교할 수 있어요." : null,
    ].filter(Boolean).join(" "),
  };
}
