import type { ConsultationReplyPaste } from "@hanbang/shared/invitation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord, isUuid } from "@/utils/requestValidation";
import { isValidScheduleTime, isValidScheduleYmd } from "@/utils/scheduleEvents";
import { readHallsByIds, readShortlist, type ReadResult } from "./hallRepository";
import { readOpenLetter } from "./inquiryRepository";
import { kstParts } from "./kstFormat";

/**
 * 받은 답 붙여 넣기(D-83 1단계)의 서버 쪽 경계. 붙여 넣은 글은 여기에 오지 않는다(기기 안에서만 읽는다).
 * 서버가 다루는 것은 둘뿐이다: 고를 수 있는 웨딩홀 목록, 그리고 사람이 고른 홀·날짜·시간 세 칸의 검사.
 * 상담 화면(목록을 준다)과 일정 넣기(목록 안의 홀만 받는다)가 같은 목록을 쓴다.
 */

export type ReplyPasteHall = ConsultationReplyPaste["halls"][number];

/** 열린 편지의 받는 곳, 그다음 담은 홀(담은 순서). 이름은 홀 자료에서 읽고, 읽히지 않는 홀은 뺀다. */
export async function readReplyPasteHalls(supabase: SupabaseClient, coupleId: string): Promise<ReadResult<ReplyPasteHall[]>> {
  const [openResult, shortlistResult] = await Promise.all([
    readOpenLetter(supabase, coupleId),
    readShortlist(supabase, coupleId),
  ]);
  if (!openResult.ok || !shortlistResult.ok) return { ok: false };
  const ids = [...new Set([...(openResult.value?.version.recipientHallIds ?? []), ...shortlistResult.value])];
  const hallsResult = await readHallsByIds(supabase, ids);
  if (!hallsResult.ok) return { ok: false };
  const nameById = new Map(hallsResult.value.map((hall) => [hall.id, hall.name]));
  return {
    ok: true,
    value: ids.flatMap((hallId) => {
      const name = nameById.get(hallId);
      return name ? [{ hallId, name }] : [];
    }),
  };
}

const PAST_DAYS = 30;
const FUTURE_YEARS = 3;

function utcYmd(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** 넣을 수 있는 날짜(한국 날짜, 양끝 포함): 오늘에서 30일 전부터 3년 뒤 같은 날까지. */
export function pastedScheduleDateWindow(now: Date = new Date()): { min: string; max: string } {
  const today = kstParts(now);
  return {
    min: utcYmd(Date.UTC(today.year, today.month - 1, today.day - PAST_DAYS)),
    max: utcYmd(Date.UTC(today.year + FUTURE_YEARS, today.month - 1, today.day)),
  };
}

export type PastedScheduleInput = { hallId: string; date: string; time: string | null };

export type PastedScheduleInputResult =
  | { ok: true; value: PastedScheduleInput }
  | { ok: false; field: "body" | "hallId" | "date" | "dateRange" | "time" };

const INPUT_KEYS: ReadonlySet<string> = new Set(["hallId", "date", "time"]);

/** 빼거나 null 이면 시간 없는 일정(null)이다. "HH:MM" 이 아니면 틀린 값(undefined)이다. */
function optionalTime(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return isValidScheduleTime(value) ? value : undefined;
}

/** `{ hallId, date, time? }` 만 받는다. 다른 칸이 하나라도 있으면 받지 않는다. */
export function parsePastedScheduleInput(value: unknown, now: Date = new Date()): PastedScheduleInputResult {
  if (!isRecord(value) || Object.keys(value).some((key) => !INPUT_KEYS.has(key))) return { ok: false, field: "body" };
  const { hallId, date } = value;
  if (!isUuid(hallId)) return { ok: false, field: "hallId" };
  const window = pastedScheduleDateWindow(now);
  if (!isValidScheduleYmd(date)) return { ok: false, field: "date" };
  // 날짜는 골랐지만 넣을 수 있는 기간 밖이면 "날짜를 골라 주세요"가 아니라 그 기간을 말한다.
  if (date < window.min || date > window.max) return { ok: false, field: "dateRange" };
  const time = optionalTime(value.time);
  if (time === undefined) return { ok: false, field: "time" };
  return { ok: true, value: { hallId: hallId.toLowerCase(), date, time } };
}
