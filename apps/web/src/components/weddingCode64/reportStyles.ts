// wc64 리포트 화면이 함께 쓰는 클래스와 화면 이름표.
// 색은 36문항 결과(result/Result36Client.tsx)와 30문항(components/weddingCodeLikert/*)이 쓰는 웨딩한방 토큰을 그대로 따른다.
import { WC64_NO_CEREMONY_DIM_TEXT } from "@/lib/weddingCode/wc64/copy";
import type {
  Wc64DimSkipReason, Wc64FacetPos, Wc64Letter, Wc64Level, Wc64Name, Wc64Plan, Wc64TypeCard,
} from "@/lib/weddingCode/wc64/types";

/**
 * 글자를 정하지 못한 까닭 한 줄(까닭은 model 의 `wc64DimSkipReason`). 내 결과의 결과 카드와 글자 장이 이 문장을 같이 쓴다.
 * 둘이 같이 보기(Compare64)도 이 표를 펼쳐 쓴다. '식 없이' 문장은 공용 문구(copy.ts 의 WC64_NO_CEREMONY_DIM_TEXT)라 세 곳이 같은 말이다.
 * 앱이 뺀 문장(식 없이 하기)을 사용자가 답을 덜 한 것처럼 쓰지 않는다.
 */
export const WC64_UNDECIDED_TEXT: Record<Wc64DimSkipReason, string> = {
  "no-ceremony": WC64_NO_CEREMONY_DIM_TEXT,
  skipped: "넘기거나 모두 해당 없음으로 고른 묶음이 있어 이 글자는 정하지 않았어요.",
  "too-few": "답한 문장이 모자라 이 글자는 정하지 않았어요.",
};

/**
 * 글자 밖 막대 카드 제목. 식 없이 하면 글자가 둘뿐이라 '네 글자'라고 부르지 않는다(2026-10-16 2단계 검토).
 * 결과 카드와 비워 둔 SPEND 장이 이 카드를 가리킬 때도 같은 이름을 쓴다.
 */
export function wc64OutsideTitle(plan: Wc64Plan | null): string {
  return plan === "none" ? "글자 밖에서 본 것" : "네 글자 밖에서 본 것";
}

/**
 * 16유형 제목과 부제를 한 줄로 묶는다(2026-10-16 DEC-10). 제목만으로는 네 가지뿐이라 부제까지 붙여야 16개가 모두 다르다.
 * 2026-10-17 결과 이름(형용사 + 동물)이 생긴 뒤로 화면이 '이름'이라고 부르는 것은 그 이름표이고, 이 줄은 이름 아래 작게 두는
 * 유형 제목이다(그래서 예전 wc64TypeName 을 이 이름으로 바꿨다).
 */
export function wc64TypeTitle(type: Pick<Wc64TypeCard, "title" | "sub">): string {
  return `${type.title}, ${type.sub}`;
}

/**
 * 결과 이름표 한 줄: 형용사와 동물을 띄어 쓴다(2026-10-17 파운더 결정). 모델이 만드는 report.name.label 과 같은 모양이고,
 * 유형 카드는 받은 유형의 name 으로 이 줄을 만든다. 고른 답 묶음에 붙인 이름이지 성격 설명이 아니라서 이름 둘레에 풀이를 붙이지 않는다.
 */
export function wc64NameLabel(name: Wc64Name): string {
  return `${name.adjective} ${name.animal}`;
}

/**
 * 결과 카드의 이름 글씨. 폰 너비 375px 에서 가장 긴 이름(일곱 글자와 띄어쓰기 하나)이 카드 안 한 줄에 들어가는 크기다.
 * 네 글자 줄(wc64NameLettersClass)은 그 아래 작게 둔다.
 */
export const wc64NameClass = "block text-[34px] font-semibold leading-tight tracking-[-0.01em] text-[var(--hb-text-strong)] sm:text-[40px]";
/** 이름 아래 작게 두는 네 글자 줄(고정폭 글씨, 옅은 색). 동점 글자의 점선 밑줄과 빈칸 표시는 이 줄에 그대로 둔다. */
export const wc64NameLettersClass = "flex gap-1 font-mono text-lg font-semibold leading-none tracking-[0.12em] text-[var(--hb-text-muted)]";

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

/** 글자 뒤 목적격 조사: L·M·R 뒤는 '을', 나머지는 '를' */
export function withObjectParticle(letter: Wc64Letter | string): string {
  return "LMR".includes(letter) ? `${letter}을` : `${letter}를`;
}

/** 글자 뒤 '(으)로': M 뒤만 '으로'(L·R 은 ㄹ 소리라 '로') */
export function withDirectionParticle(letter: Wc64Letter | string): string {
  return letter === "M" ? `${letter}으로` : `${letter}로`;
}

export const isShaky = (level: Wc64Level) => level === "slight" || level === "half";

/** 화면에서 칸 이름·버튼 이름을 따옴표로 감쌀 때 쓰는 모양(‘’ 하나로 맞춘다) */
export const quoted = (text: string) => `‘${text}’`;

/** 참고로만 결과에서 설명을 접어 둔 칸의 머리(결과 리포트와 유형 카드가 같이 쓴다). 옛 '참고로 펼치기'는 '참고로(덧붙여)'로 읽혔다. */
export const WC64_REFERENCE_FOLD_LABEL = "펼쳐 보기(참고용)";

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
/**
 * 접힌 칸 머리. flex 로 바꾸면 브라우저 삼각형이 사라지므로 삼각형을 숨기고, 오른쪽에 아래를 가리키는 꺾쇠를
 * ::after 로 그린다(펼치면 위를 가리킨다). 어느 details 안에서도 같은 모양이 나오게 클래스 한 곳에 둔다.
 */
export const summaryClass =
  "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-base font-semibold text-[var(--hb-text-strong)] [&::-webkit-details-marker]:hidden after:block after:size-2 after:shrink-0 after:-translate-y-0.5 after:rotate-45 after:border-b-2 after:border-r-2 after:border-current [details[open]>&]:after:translate-y-0.5 [details[open]>&]:after:-rotate-135 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]";
/** 접힌 칸 머리 안의 '펼치기'·'접기' 글. 열린 상태에 따라 하나만 보인다. */
export const foldClosedText = "[details[open]>summary>&]:hidden";
export const foldOpenText = "hidden [details[open]>summary>&]:inline";
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
