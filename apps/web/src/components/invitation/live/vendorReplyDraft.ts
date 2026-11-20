import type {
  ConsultationPasteSchedulePost,
  ConsultationReplyPaste,
  VendorReplyChip,
} from "@hanbang/shared/invitation";

/**
 * 받은 답 붙여 넣기(D-83 1단계, 2026-11-18)의 일정 칸. 화면 없는 순수 함수다.
 *
 * 칩을 누르면 그 날짜·시간을 칸에 옮길 뿐이다. 일정에 넣는 것은 사람이 넣기 단추를 누를 때만이고, 업체가 오전·오후를
 * 적지 않아 짐작한 시간은 사람이 오전·오후를 고르기 전에는 넣지 않는다. 서버로 나가는 것은 홀·날짜·시간 세 칸뿐이고
 * 붙여 넣은 글은 여기에 없다.
 */

export type PasteDraft = {
  hallId: string | null;
  /** YYYY-MM-DD. 고르지 않았으면 빈 글. */
  date: string;
  /** HH:MM(24시). 고르지 않았으면 빈 글. */
  time: string;
  /** "시간 없이 넣기"를 골랐다. */
  noTime: boolean;
  /** 짐작한 시간(업체가 오전·오후를 적지 않음)을 칩에서 옮겼고 아직 오전·오후를 고르지 않았다. */
  meridiemPending: boolean;
  /**
   * 시간 칸에 덜 고른 시간이 남아 있다(웹의 시간 칸에서 시만 고르고 분을 비운 것처럼). 그런 칸의 값은 빈 글이라 빈 칸과
   * 구별되지 않으므로, 칸의 `validity.badInput` 을 여기에 적어 둔다. 칩이 시간을 채우면 거짓으로 돌린다.
   */
  timeIncomplete: boolean;
};

/** 넣기 전에 사람이 더 골라야 하는 것. `timeIncomplete` 는 시간 칸을 끝까지 고르지 않은 것이다. */
export type PasteDraftProblem = "hall" | "date" | "timeIncomplete" | "meridiem";

export type PasteScheduleCheck =
  | { ok: true; body: ConsultationPasteSchedulePost }
  | { ok: false; problem: PasteDraftProblem };

/** 날짜·시간을 칸에 옮길 수 있는 칩. 금액·보증 인원·업체가 쓴 말은 보여 주기만 한다. */
export type SchedulableChip = Extract<VendorReplyChip, { kind: "datetime" | "date" | "time" }>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 고를 웨딩홀이 하나뿐이면 미리 골라 둔다. 날짜와 시간은 사람이 고른다. */
export function initialPasteDraft(halls: ConsultationReplyPaste["halls"]): PasteDraft {
  return {
    hallId: halls.length === 1 ? halls[0].hallId : null,
    date: "",
    time: "",
    noTime: false,
    meridiemPending: false,
    timeIncomplete: false,
  };
}

export function isSchedulableChip(chip: VendorReplyChip): chip is SchedulableChip {
  return chip.kind === "datetime" || chip.kind === "date" || chip.kind === "time";
}

/** 날짜·시간·금액·보증 인원 가운데 하나라도 찾았는가(업체가 쓴 말만 있으면 찾지 못한 것이다). */
export function foundAnyValue(chips: readonly VendorReplyChip[]): boolean {
  return chips.some((chip) => chip.kind !== "phrase");
}

/** 날짜가 든 칩 가운데 업체가 적은 요일이 그 날짜의 달력 요일과 다른 것이 있는가(칩은 달력 요일을 보인다). */
export function hasWeekdayMismatch(chips: readonly VendorReplyChip[]): boolean {
  return chips.some((chip) => (chip.kind === "date" || chip.kind === "datetime") && chip.weekdayMismatch);
}

/**
 * 칩의 날짜(와 시간)를 칸에 옮긴다. 날짜 칩은 날짜만, 시간 칩은 시간만 바꾼다. 시간이 든 칩은 시간 칸을 끝까지
 * 채우므로(화면이 칸에 값을 넣는다) 덜 고른 시간도 없어진다.
 */
export function draftWithChip(draft: PasteDraft, chip: SchedulableChip): PasteDraft {
  if (chip.kind === "date") return { ...draft, date: chip.ymd };
  const time = { time: chip.time, noTime: false, meridiemPending: chip.meridiemGuessed };
  const filled = { ...draft, ...time, timeIncomplete: false };
  return chip.kind === "datetime" ? { ...filled, date: chip.ymd } : filled;
}

/** 이 칩의 값이 지금 칸에 들어 있는가(눌린 칩으로 그린다). */
export function chipIsChosen(draft: PasteDraft, chip: SchedulableChip): boolean {
  const timeChosen = chip.kind !== "date" && !draft.noTime && draft.time === chip.time;
  if (chip.kind === "time") return timeChosen;
  const dateChosen = draft.date === chip.ymd;
  return chip.kind === "date" ? dateChosen : dateChosen && timeChosen;
}

/** 사람이 오전·오후를 골랐다. 시각의 시만 그쪽 반나절로 옮긴다(2시 → 오전 02:00, 오후 14:00). */
export function draftWithMeridiem(draft: PasteDraft, meridiem: "am" | "pm"): PasteDraft {
  const match = HHMM.exec(draft.time);
  if (!match) return { ...draft, meridiemPending: false };
  const hour12 = Number(match[1]) % 12;
  const hour = meridiem === "pm" ? hour12 + 12 : hour12;
  return { ...draft, time: `${String(hour).padStart(2, "0")}:${match[2]}`, meridiemPending: false };
}

/**
 * 넣기 요청 본문. 홀과 날짜는 있어야 하고, 시간은 고른 경우에만 넣는다("시간 없이 넣기"면 빼고 보낸다).
 * 시간 칸에 덜 고른 시간이 남아 있으면 날짜만 넣지 않고 끝까지 고르라고 한다("시간 없이 넣기"를 골랐으면 그대로 넣는다).
 * 짐작한 시간에 오전·오후를 아직 고르지 않았으면 보내지 않는다.
 */
export function pasteScheduleBody(draft: PasteDraft): PasteScheduleCheck {
  if (!draft.hallId) return { ok: false, problem: "hall" };
  if (!YMD.test(draft.date)) return { ok: false, problem: "date" };
  if (draft.timeIncomplete && !draft.noTime) return { ok: false, problem: "timeIncomplete" };
  const dateOnly: ConsultationPasteSchedulePost = { hallId: draft.hallId, date: draft.date };
  if (draft.noTime || !HHMM.test(draft.time)) return { ok: true, body: dateOnly };
  if (draft.meridiemPending) return { ok: false, problem: "meridiem" };
  return { ok: true, body: { ...dateOnly, time: draft.time } };
}
