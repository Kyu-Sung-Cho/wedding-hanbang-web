// 분기 변환 유틸 — cohort_rooms는 month 기반(1/4/7/10)으로 정규화 저장
// UI 표시는 분기(Q1~Q4)로 변환

export const FLEX_COHORT_YEAR = 2100;
export const FLEX_COHORT_MONTH = 10;
export const FLEX_COHORT_LABEL = "날짜 미정·1년 이후 동기방";
export const FLEX_COHORT_SHORT_LABEL = "날짜 미정·1년 이후";
export const FLEX_COHORT_DAYS_AWAY = 365;

export function dateToYearQuarter(date: Date | string): { year: number; quarter: 1 | 2 | 3 | 4 } {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const quarter = (Math.ceil((d.getMonth() + 1) / 3) as 1 | 2 | 3 | 4);
  return { year, quarter };
}

/** 분기를 cohort_rooms.month로 매핑 (Q1=1, Q2=4, Q3=7, Q4=10) */
export function quarterToMonth(quarter: 1 | 2 | 3 | 4): number {
  return quarter * 3 - 2;
}

/** cohort_rooms.month → 분기 (1=Q1, 4=Q2, 7=Q3, 10=Q4) */
export function monthToQuarter(month: number): 1 | 2 | 3 | 4 {
  return Math.ceil(month / 3) as 1 | 2 | 3 | 4;
}

export function isFlexibleCohort(year?: number | null, month?: number | null): boolean {
  return year === FLEX_COHORT_YEAR && month === FLEX_COHORT_MONTH;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function shouldUseFlexibleCohort(
  weddingDate: Date | string | null | undefined,
  now = new Date()
): boolean {
  if (!weddingDate) return true;
  const target = typeof weddingDate === "string" ? new Date(weddingDate) : weddingDate;
  if (Number.isNaN(target.getTime())) return true;

  const diffMs = startOfLocalDay(target).getTime() - startOfLocalDay(now).getTime();
  const diffDays = Math.ceil(diffMs / 86_400_000);
  return diffDays > FLEX_COHORT_DAYS_AWAY;
}

export function cohortRoomName(year: number, month: number, roomNumber = 1): string {
  const suffix = roomNumber > 1 ? ` ${roomNumber}방` : "";
  if (isFlexibleCohort(year, month)) {
    return `${FLEX_COHORT_LABEL}${suffix}`;
  }
  return `${year}년 ${monthToQuarter(month)}분기 결혼 동기${suffix}`;
}

/** UI 라벨: "2026년 Q2 (봄)" 같은 형태 */
const QUARTER_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: "겨울/초봄",
  2: "봄",
  3: "여름",
  4: "가을/초겨울",
};

export function formatYearQuarter(year: number, quarter: 1 | 2 | 3 | 4): string {
  return `${year}년 Q${quarter} (${QUARTER_LABEL[quarter]})`;
}

/** cohort_rooms.month 기반 → 분기 라벨 */
export function formatRoomLabel(year: number, month: number): string {
  if (isFlexibleCohort(year, month)) return FLEX_COHORT_SHORT_LABEL;
  return formatYearQuarter(year, monthToQuarter(month));
}
