import { differenceInDays, format, isValid, parseISO } from "date-fns";
import { ko } from "date-fns/locale";

// 가격 포맷 (만원 단위)
export function formatBudgetAmount(amount: number): string {
  if (amount >= 10000) {
    const billions = Math.floor(amount / 10000);
    const millions = amount % 10000;
    return millions === 0 ? `${billions}억` : `${billions}억 ${millions.toLocaleString()}만원`;
  }
  return `${amount.toLocaleString()}만원`;
}

// 퍼센트 포맷
export function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

// 날짜 포맷
export function formatDate(dateStr: string, formatStr: string = "yyyy.MM.dd"): string {
  const date = parseISO(dateStr);
  if (!isValid(date)) return dateStr;
  return format(date, formatStr, { locale: ko });
}

// D-day 계산
export function getDaysUntilWedding(weddingDate: string | Date | null): number | null {
  if (!weddingDate) return null;
  const target = typeof weddingDate === "string" ? parseISO(weddingDate) : weddingDate;
  if (!isValid(target)) return null;
  return differenceInDays(target, new Date());
}

// D-day 표시 텍스트
export function formatDday(days: number | null): string {
  if (days === null) return "D-??";
  if (days === 0) return "D-Day";
  if (days > 0) return `D-${days}`;
  return `D+${Math.abs(days)}`;
}

// 예산 상태 색상
export function getBudgetStatusColor(spentPercentage: number): string {
  if (spentPercentage >= 100) return "#EF4444";
  if (spentPercentage >= 80) return "#F59E0B";
  if (spentPercentage >= 50) return "#3B82F6";
  return "#22C55E";
}
