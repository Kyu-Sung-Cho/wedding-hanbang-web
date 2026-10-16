// wc64 리포트 화면이 함께 쓰는 클래스와 화면 이름표.
// 색은 36문항 결과(result/Result36Client.tsx)와 30문항(components/weddingCodeLikert/*)이 쓰는 웨딩한방 토큰을 그대로 따른다.
import type { Wc64FacetPos, Wc64Letter, Wc64Level } from "@/lib/weddingCode/wc64/types";

/** 글자 단단함 네 단계 */
export const LEVEL_TEXT: Record<Wc64Level, string> = {
  clear: "또렷해요",
  lean: "기울어 있어요",
  slight: "아슬해요",
  half: "반반이에요",
};

/** 묶음이 글자와 어디에 놓였는지 */
export const POS_TEXT: Record<Wc64FacetPos, string> = {
  same: "글자와 같은 쪽",
  opp: "이 묶음은 반대쪽",
  mid: "가운데",
  "both-high": "두 쪽 다 끌려요",
  "both-low": "두 쪽 다 덜 와닿아요",
};

/** 글자 뒤 조사: L·M·R 뒤는 '이', 나머지는 '가' */
export function withSubjectParticle(letter: Wc64Letter | string): string {
  return "LMR".includes(letter) ? `${letter}이` : `${letter}가`;
}

export const isShaky = (level: Wc64Level) => level === "slight" || level === "half";

/* ---------------- 클래스 ---------------- */

export const cardClass =
  "flex min-w-0 flex-col gap-4 rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] p-5 sm:p-6";
export const kickerClass = "text-xs font-semibold tracking-[0.12em] text-[var(--hb-selected-text)]";
export const h2Class = "text-xl font-semibold leading-snug text-[var(--hb-text-strong)]";
export const h3Class = "text-base font-semibold leading-7 text-[var(--hb-text-strong)]";
export const bodyClass = "text-sm leading-7 text-[var(--hb-text-body)]";
export const metaClass = "text-xs leading-6 text-[var(--hb-text-muted)]";
export const noteClass = "rounded-lg bg-[var(--hb-surface-hover)] p-4 text-sm leading-7 text-[var(--hb-text-body)]";
export const listClass = "flex list-disc flex-col gap-1.5 pl-5 text-sm leading-7 text-[var(--hb-text-body)]";
export const summaryClass =
  "flex min-h-11 cursor-pointer items-center text-base font-semibold text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]";
export const linkClass =
  "text-[var(--hb-selected-text)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]";

/** 버튼 모양은 36문항 화면(WeddingCodeClient.tsx 의 wc36Primary·wc36Secondary)과 같게 맞춘다. */
export const primaryButtonClass =
  "min-h-12 whitespace-normal! rounded-lg bg-[var(--hb-primary)] px-6 py-3 text-sm text-[var(--hb-on-primary)] hover:bg-[var(--hb-primary-hover)]";
export const secondaryButtonClass =
  "min-h-11 whitespace-normal! rounded-lg border border-[var(--hb-hairline)] bg-white px-4 py-2 text-sm font-medium text-[var(--hb-text-body)] hover:bg-[var(--hb-surface-hover)]";

const LEVEL_CHIP: Record<Wc64Level, string> = {
  clear: "bg-[#DFE6DA] text-[#4E5E50]",
  lean: "bg-[var(--hb-summary-surface)] text-[var(--hb-text-body)]",
  slight: "bg-[#F6E3D1] text-[#8A4F25]",
  half: "bg-[#F6E3D1] text-[#8A4F25]",
};

export function levelChipClass(level: Wc64Level): string {
  return `inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${LEVEL_CHIP[level]}`;
}

export function posTagClass(pos: Wc64FacetPos | null): string {
  const tone = pos === "same" ? "bg-[#DFE6DA] text-[#4E5E50]"
    : pos === "opp" ? "bg-[#F6E3D1] text-[#8A4F25]"
    : "bg-[var(--hb-surface-hover)] text-[var(--hb-text-body)]";
  return `inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`;
}
