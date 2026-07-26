import { kstMidnightFromYmd, ymdInKst } from "@/lib/utils/kstDate";

/**
 * 저장해 둔 이야기를 계약 전에 한 번 되짚어 주는 판정.
 *
 * 저장 버튼만 있고 저장본이 스스로 찾아오지 않으면 아무도 다시 보지 않는다.
 * 저장하는 시점은 보통 알아보는 중이고, 정작 필요한 건 계약이 몰리는 예식 두 달
 * 전이다. 그 하루에만 알린다.
 *
 * 내용은 언급하지 않는다 — 저장본은 커플의 것이고, 우리가 요약하면 그것도 해석이다.
 * 몇 건인지와 어디서 보는지만 말한다.
 */

/** 계약이 몰리는 시점 — 이날 하루만 알린다. */
export const SAVED_NOTES_RECALL_DAYS_BEFORE = 60;

export type SavedNotesRecall = { message: string; requestId: string };

export function shouldRecallSavedNotes(input: {
  weddingDate?: string | Date | null;
  savedCount: number;
  now?: Date;
}): SavedNotesRecall | null {
  if (!Number.isInteger(input.savedCount) || input.savedCount < 1) return null;
  if (!input.weddingDate) return null;

  const ymd = typeof input.weddingDate === "string"
    ? (/^\d{4}-\d{2}-\d{2}$/.test(input.weddingDate)
      ? input.weddingDate
      : safeYmd(input.weddingDate))
    : safeYmd(input.weddingDate);
  if (!ymd) return null;

  const wedding = kstMidnightFromYmd(ymd);
  const today = kstMidnightFromYmd(ymdInKst(input.now ?? new Date()));
  if (Number.isNaN(wedding.getTime()) || Number.isNaN(today.getTime())) return null;

  const daysLeft = Math.round((wedding.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft !== SAVED_NOTES_RECALL_DAYS_BEFORE) return null;

  return {
    message: `결혼식까지 두 달 남았어요. 그동안 저장해 두신 이야기가 ${input.savedCount}건 있는데,`
      + " 계약을 앞두고 다시 보기 좋은 것들이에요."
      + "\n\n왼쪽 메뉴 '저장한 이야기'에서 한 번에 보실 수 있어요.",
    // 예식일에 묶어 두면 같은 커플에게 두 번 가지 않는다.
    requestId: `saved-notes-recall:${ymd}`,
  };
}

function safeYmd(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return ymdInKst(date);
}
