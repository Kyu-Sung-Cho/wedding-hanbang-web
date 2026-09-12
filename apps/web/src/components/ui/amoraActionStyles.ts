// 이동·인증·전송은 호출부가 소유한다. 아모라 질문 컨트롤의 표시만 공유한다.
const AMORA_ACTION_BASE = "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-[var(--hb-amora-line,#8F6662)] bg-[var(--hb-amora-surface,#FBF8F2)] text-[var(--hb-amora-ink,#7D5753)] transition-colors duration-150 hover:bg-[var(--hb-amora-hover,#EADDD8)] active:bg-[var(--hb-amora-hover,#EADDD8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[var(--hb-amora-surface,#FBF8F2)] motion-reduce:transition-none";

export const AMORA_ACTION_CLASS = `${AMORA_ACTION_BASE} px-4 py-2 text-sm font-medium`;
export const AMORA_ICON_ACTION_CLASS = `${AMORA_ACTION_BASE} size-11 shrink-0 p-0`;

export const AMORA_FAB_CLASS = "inline-flex items-center justify-center rounded-full border border-[var(--hb-amora-line,#8F6662)] bg-[var(--hb-amora-surface,#FBF8F2)] text-[var(--hb-amora-ink,#7D5753)] shadow-lg transition-colors hover:bg-[var(--hb-amora-hover,#EADDD8)] active:bg-[var(--hb-amora-hover,#EADDD8)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 motion-reduce:transition-none";
