/**
 * 웨딩코드 4.0 혼자 보는 결과 화면들이 함께 쓰는 클래스 상수.
 *
 * 색은 역할 변수(하이픈 둘로 시작하는 hb 변수)만 쓰고, 뜻은 색이 아니라 글과 모양(굵은 테두리, 표식)으로 전한다.
 * 클래스 예시를 주석에 적지 않는다. 주석의 클래스 모양 글자도 스타일 생성기가 읽어 잘못된 규칙을 만든다.
 */

/** 화면 안의 큰 구역 제목. */
export const sectionTitle = "text-lg font-semibold leading-snug text-balance text-[var(--hb-text-strong)]";
/** 구역 안의 작은 제목. */
export const subTitle = "text-sm font-semibold leading-snug text-[var(--hb-text-strong)]";
/** 본문 한 줄. */
export const bodyLine = "text-sm leading-relaxed text-[var(--hb-text-body)]";
/** 조금 더 강조하는 본문(글자와 세기를 함께 적은 줄). */
export const emphasisLine = "text-base font-semibold leading-snug text-[var(--hb-text-strong)]";
/** 목록: 점 표식과 들여쓰기. */
export const bulletList = "list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-[var(--hb-text-body)] marker:text-[var(--hb-text-muted)]";
/** 화면 안 구역 사이의 간격은 부모가 정한다. 구역 하나의 바탕 상자. */
export const panel = "rounded-xl border border-paper-outline bg-[var(--hb-surface-raised)] p-4";
/** 글자 옆에 붙는 작은 알약 표시(반반, 임시). 테두리로 모양을 주고 색에 기대지 않는다. */
export const pill =
  "inline-flex items-center rounded-full border border-paper-outline px-2 py-0.5 text-[11px] font-medium leading-none text-[var(--hb-text-body)]";
