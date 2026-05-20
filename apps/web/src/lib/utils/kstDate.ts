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
