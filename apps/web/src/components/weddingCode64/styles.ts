// 웨딩코드 wc64 화면이 함께 쓰는 클래스.
// 색과 간격은 36문항 화면(app/wedding-code/WeddingCodeClient.tsx)의 쓰임을 따른다.
// 버튼은 공용 Button(variant primary/secondary) 위에 이 클래스를 얹어 쓴다.

/** 바깥 틀: 36문항과 같은 바탕·글자색, 폰 폭에서 양옆 20px */
export const wc64Page = "min-h-screen overflow-x-hidden bg-[#FDFCF7] px-5 py-8 text-[#3A2A27] [word-break:keep-all] [overflow-wrap:anywhere] sm:py-12";
/** 가운데 기둥 */
export const wc64Column = "mx-auto w-full min-w-0 max-w-xl";
/**
 * 라운지 안에 넣을 때의 바깥 틀: 앱 껍데기가 바탕과 높이를 맡으므로 바탕색과 min-h-screen 이 없다.
 * 여백은 v3.1 라운지(embedded)와 같고, 화면이 바뀌어 이 틀로 스크롤할 때 위 고정 머리줄에 가리지 않게 scroll-mt 를 둔다.
 */
export const wc64EmbeddedPage = "scroll-mt-20 overflow-x-hidden px-4 pb-8 pt-5 text-[#3A2A27] [word-break:keep-all] [overflow-wrap:anywhere] sm:px-6 md:scroll-mt-28";
/** 라운지 안의 가운데 기둥 */
export const wc64EmbeddedColumn = "mx-auto w-full min-w-0 max-w-2xl";
export const wc64Eyebrow = "text-xs font-semibold tracking-[0.15em] text-[#8F6662]";
export const wc64Title = "text-2xl font-semibold leading-9 outline-none";
export const wc64Body = "text-base leading-8 text-[#5A4742]";
export const wc64Meta = "text-xs leading-6 text-[#6E5A54]";
/** 연한 바탕 안내 */
export const wc64Note = "rounded-lg bg-[#F8F4EA] px-4 py-3 text-sm leading-7 text-[#5A4742]";
/** 고지처럼 눈에 띄어야 하는 안내 */
export const wc64Notice = "rounded-lg border border-[#DEC9BA] bg-[#F3E7DB] px-4 py-3 text-sm leading-7 text-[#3A2A27]";
/** 묶음 이름 같은 작은 꼬리표 */
export const wc64Tag = "text-sm font-semibold text-[#8F6662]";
export const wc64Card = "flex min-w-0 flex-col gap-4 rounded-xl border border-[#E2DED2] bg-white px-5 py-6";
export const wc64Chip = "inline-flex items-center gap-1.5 rounded-full bg-[#F3E7DB] px-3 py-1 text-[13px] text-[#5A4742]";

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8F6662]";

/** 주 버튼(Button variant="primary" 와 함께) */
export const wc64Primary = `inline-flex min-h-12 items-center justify-center gap-2 whitespace-normal! rounded-lg bg-[#8F6662] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#7D5753] disabled:cursor-not-allowed disabled:opacity-40 ${focus}`;
/** 보조 버튼(Button variant="secondary" 와 함께) */
export const wc64Secondary = `inline-flex min-h-11 items-center justify-center gap-2 whitespace-normal! rounded-lg border border-[#E2DED2] bg-white px-4 py-2 text-sm font-medium text-[#5A4742] hover:bg-[#F8F4EA] disabled:opacity-40 ${focus}`;
/** 넘기기·해당 없음처럼 밑줄 친 가벼운 버튼(Button variant="secondary" 와 함께) */
export const wc64Quiet = `inline-flex min-h-11 items-center justify-center whitespace-normal! rounded-lg border-0 bg-transparent px-3 py-2 text-sm font-medium text-[#6E5A54] underline underline-offset-4 hover:bg-[#F8F4EA] ${focus}`;

/** 다섯 칸·식 질문 보기 버튼. 고른 칸은 채운 색으로 눌림을 보여 준다. */
export function wc64Choice(selected: boolean): string {
  const base = `flex! min-h-14 w-full items-center justify-start! gap-4 whitespace-normal! rounded-lg border px-4 py-3 text-left text-sm transition-colors motion-reduce:transition-none ${focus}`;
  return selected
    ? `${base} border-[#8F6662] bg-[#8F6662] font-semibold text-white hover:bg-[#7D5753]`
    : `${base} border-[#E2DED2] bg-white font-medium text-[#3A2A27] hover:bg-[#F8F4EA]`;
}

/** 진행 막대 */
export const wc64ProgressTrack = "block h-1.5 w-full overflow-hidden rounded-full bg-[#F3E7DB]";
export const wc64ProgressFill = "block h-full rounded-full bg-[#8F6662] transition-[width] duration-200 motion-reduce:transition-none";
