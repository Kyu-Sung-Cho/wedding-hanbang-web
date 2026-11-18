/**
 * 한국 시간으로 읽는 날짜·시각 꼬리표. 서버는 UTC 로 돌기 때문에 모든 꼬리표를 Asia/Seoul 로 자른다.
 * 꼴은 아티팩트를 따른다("11. 22", "11월 22일", "일요일 오전 11시", "13:40").
 */

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const KOREAN_WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"] as const;

export type KstParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = 일요일. */
  weekday: number;
  ymd: string;
};

export function kstParts(date: Date): KstParts {
  const values: Record<string, number> = {};
  for (const part of PARTS.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute } = values;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const pad = (value: number) => String(value).padStart(2, "0");
  return { year, month, day, hour, minute, weekday, ymd: `${year}-${pad(month)}-${pad(day)}` };
}

/** "오전 11시", "오후 4시", "오후 1시 30분". */
export function koreanClock(hour: number, minute: number): string {
  const half = hour < 12 ? "오전" : "오후";
  const clock = hour % 12 === 0 && hour !== 0 ? 12 : hour % 12;
  return minute === 0 ? `${half} ${clock}시` : `${half} ${clock}시 ${minute}분`;
}

/** "오후 1:40". */
export function compactClock(hour: number, minute: number): string {
  const half = hour < 12 ? "오전" : "오후";
  const clock = hour % 12 === 0 && hour !== 0 ? 12 : hour % 12;
  return `${half} ${clock}:${String(minute).padStart(2, "0")}`;
}

/** "13:40". */
export function hhmm(date: Date): string {
  const parts = kstParts(date);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** "11월 22일". */
export function monthDayLabel(date: Date): string {
  const parts = kstParts(date);
  return `${parts.month}월 ${parts.day}일`;
}

/** 편지와 상담 화면의 "11. 22". */
export function dotDateLabel(date: Date): string {
  const parts = kstParts(date);
  return `${parts.month}. ${parts.day}`;
}

/** 상담 화면의 "일요일 오전 11시". */
export function weekdayClockLabel(date: Date): string {
  const parts = kstParts(date);
  return `${KOREAN_WEEKDAYS[parts.weekday]} ${koreanClock(parts.hour, parts.minute)}`;
}

/** 제안 시간의 "21일 토요일 오후 4시". */
export function dayWeekdayClockLabel(date: Date): string {
  const parts = kstParts(date);
  return `${parts.day}일 ${KOREAN_WEEKDAYS[parts.weekday]} ${koreanClock(parts.hour, parts.minute)}`;
}

/** 아모라 소식의 시각. 오늘이면 "오늘 오후 1:40", 아니면 "11월 21일 오후 1:40". */
export function updateTimeLabel(date: Date, now: Date = new Date()): string {
  const parts = kstParts(date);
  const clock = compactClock(parts.hour, parts.minute);
  return parts.ymd === kstParts(now).ymd ? `오늘 ${clock}` : `${parts.month}월 ${parts.day}일 ${clock}`;
}

/** 출처 확인일 "11월 14일". 올해가 아니면 "2025년 11월 14일". */
export function checkedOnLabel(ymd: string, now: Date = new Date()): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year === kstParts(now).year ? `${month}월 ${day}일` : `${year}년 ${month}월 ${day}일`;
}
