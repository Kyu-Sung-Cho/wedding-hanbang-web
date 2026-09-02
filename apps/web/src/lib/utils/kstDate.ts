// Asia/Seoul 기준 날짜 헬퍼.
//
// 이전 사고: Vercel 서버는 UTC 로 돌아서 `new Date()`/`getFullYear()`/`toISOString()`
// 모두 UTC 기준이었다. KST 새벽(00:00~09:00)에 호출되면 사용자가 보는 "오늘"보다
// 하루 전 날짜를 시스템 프롬프트·슬롯 조회·예약 저장에 사용해, 사용자가 명시한
// "8월 1일" 이 7월 31일 / 8월 2일로 어긋나는 버그 발생.
//
// 모든 사용자-노출 날짜 계산은 이 헬퍼를 통과시켜 KST 기준으로 일관되게 처리.

const KST_YMD_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const KST_KO_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

/** Asia/Seoul 기준 YYYY-MM-DD. 인자 없으면 현재 시각. */
export function ymdInKst(d: Date = new Date()): string {
  return KST_YMD_FORMATTER.format(d);
}

/** Asia/Seoul 기준 "YYYY년 M월 D일 요일". 인자 없으면 현재 시각. */
export function koreanDateInKst(d: Date = new Date()): string {
  return KST_KO_FORMATTER.format(d);
}

const KST_MONTH_DAY_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const KST_FULL_DATE_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * 저장된 날짜 값을 KST 달력 날짜로 읽는다. 읽을 수 없으면 null.
 *
 * ## 왜 `new Date(value)` 를 그대로 쓰면 안 되는가
 *
 * `new Date("2026-10-05")` 는 **UTC 자정**으로 읽힌다(ISO 날짜만 있는 문자열의
 * 규격이 그렇다). 그 값을 실행 환경의 시간대로 그리면 UTC−인 곳에서는 10월 4일이
 * 된다. 반면 `new Date("2026-10-05T00:00:00")` 은 **로컬 자정**이다. 같은 저장소
 * 안에서 라운지는 앞의 방식, 일정 화면은 뒤의 방식을 쓰고 있었고, 그래서 **같은
 * 일정이 두 화면에서 하루 다르게** 보였다.
 *
 * 이 제품의 날짜는 사용자가 고른 **한국 날짜**다. 그러니 읽는 것도 그리는 것도
 * 한국 달력으로 고정한다.
 */
export function kstDateFromValue(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? kstMidnightFromYmd(value)
      : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 저장된 날짜 값 → KST 기준 "10월 5일 (일)". 읽을 수 없으면 null. */
export function koreanMonthDayInKst(value: string | Date | null | undefined): string | null {
  const date = kstDateFromValue(value);
  return date ? KST_MONTH_DAY_FORMATTER.format(date) : null;
}

/** 저장된 날짜 값 → KST 기준 "2026년 10월 5일". 읽을 수 없으면 null. */
export function koreanFullDateInKst(value: string | Date | null | undefined): string | null {
  const date = kstDateFromValue(value);
  return date ? KST_FULL_DATE_FORMATTER.format(date) : null;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * "YYYY-MM-DD" → "10/5 (일)".
 *
 * 시간대를 아예 쓰지 않는다. 달력 날짜에서 달·일·요일만 뽑으므로 서버든 어느
 * 기기든 같은 값이 나온다 — 이 저장소가 겪은 하루 어긋남은 전부 이 문자열을
 * 굳이 `Date` 로 바꿔 실행 환경 시간대를 한 번 더 섞으면서 생겼다.
 */
export function shortKoreanDateFromYmd(ymd: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}/${day} (${weekday})`;
}

/** "YYYY-MM-DD" → KST 자정의 Date 객체 (range 계산용) */
export function kstMidnightFromYmd(ymd: string): Date {
  // ISO 8601 + KST offset → JS Date는 내부적으로 UTC ms 저장.
  // 비교/일수 가감(setDate/getDate UTC variant)에서 모두 안전.
  return new Date(`${ymd}T00:00:00+09:00`);
}

/** 오늘(KST 기준) 자정의 Date 객체 */
export function todayKstMidnight(): Date {
  return kstMidnightFromYmd(ymdInKst());
}

/** Date에 일수 더하기 — UTC date 단위로 가감해 KST 같은 시각 유지. */
export function addDaysUtc(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
