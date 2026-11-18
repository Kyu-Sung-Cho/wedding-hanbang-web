// 팔레트는 design-tokens/chat.ts와 같다. CSS가 늦게 도착해도 같은 색을 유지한다.
export const CHAT_BUBBLE_TONES = {
  sky: "border-[var(--hb-chat-sky-line,#BCD9EC)] bg-[var(--hb-chat-sky-surface,#E5F2FA)] text-[var(--hb-chat-sky-ink,#23445B)]",
  rose: "border-[var(--hb-chat-rose-line,#ECC7D0)] bg-[var(--hb-chat-rose-surface,#FBE9ED)] text-[var(--hb-chat-rose-ink,#623442)]",
  amora: "border-[var(--hb-chat-amora-line,#CDD8C7)] bg-[var(--hb-chat-amora-surface,#EEF2EA)] text-[var(--hb-chat-amora-ink,#34483E)]",
  neutral: "border-[var(--hb-chat-neutral-line,#DDD7CC)] bg-[var(--hb-chat-neutral-surface,#F2EFE9)] text-[var(--hb-chat-neutral-ink,#45413B)]",
} as const;

export type ChatBubbleTone = keyof typeof CHAT_BUBBLE_TONES;

/** 대화 칸의 모양. 기본은 지금까지의 말풍선, `invitation` 은 청첩장 디자인의 대화다. */
export type ChatPresentation = "default" | "invitation";

/**
 * 청첩장 디자인(2026-11-17, 파운더 디자인 아티팩트 `Web.dc`·`Chat.dc`, 원문 "이 디자인 완전 같아야해")의 대화 모양.
 * 모양만 정한다. 무엇을 그릴지(나만 보기 표시, 상대에게 보낸 표시, 저장·의견 단추)는 기본 모양과 같다.
 *
 *   - 아모라 말: 말풍선 없는 17px 글줄, 줄 높이 1.7, 먹색. 마크다운 줄마다 붙는 기본 줄 높이도 1.7 로 맞춘다.
 *   - 사람 말: 돌빛 말풍선, 반경 20, 위아래 10·좌우 16, 15px.
 *   - 제안 칩: 높이 38, 반경 19, 좌우 14, 카드 고리 색 테두리, 13px, 기본 단추 글자색(아티팩트가 색을 적지 않았다).
 *   - 공개 범위 칩: 웹 탭과 같은 42px 알약. 고른 쪽은 먹색 채움.
 *   - 입력칸: 종이색 알약(반경 28, 안쪽 고리) 안에 46px 입력과 44px 먹색 보내기.
 */
export const INVITATION_CHAT_STYLES = {
  amoraText: "min-w-0 break-words text-[17px] leading-[1.7] text-inv-ink [&_.leading-relaxed]:leading-[1.7]",
  personBubble: "rounded-[20px] bg-inv-stone px-4 py-2.5 text-[15px] text-inv-ink",
  personText: "whitespace-pre-wrap break-words",
  speaker: "text-[12px] text-inv-muted",
  marker: "inline-flex items-center gap-1 text-[12px] text-inv-muted",
  column: "mx-auto w-full max-w-[540px]",
  messageList: "min-h-0 flex-1 overflow-y-auto scrollbar-hide flex flex-col gap-[18px] py-2 [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-[540px]",
  suggestionRow: "flex flex-wrap gap-2",
  suggestionChip:
    "tap-area h-[38px] shrink-0 whitespace-nowrap rounded-[19px] border border-inv-ring bg-inv-white px-3.5 text-[13px] text-[color:buttontext] transition-opacity disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2",
  laneGroup: "flex flex-wrap items-center gap-1",
  laneChip:
    "tap-area inline-flex h-[42px] items-center justify-center gap-1 rounded-[21px] px-[18px] text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2",
  laneChipOn: "bg-inv-ink font-medium text-inv-white",
  laneChipOff: "bg-transparent text-inv-body hover:text-inv-ink",
  status: "mt-1.5 flex items-center gap-1 text-[12px] leading-[1.5] text-inv-muted",
  note: "text-[12px] leading-[1.5] text-inv-muted",
  composer:
    "flex items-center gap-2 rounded-[28px] bg-inv-paper-soft py-1.5 pr-1.5 pl-1.5 shadow-[inset_0_0_0_1px_#EEEAE6] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--hb-focus-ring)]",
  composerInput:
    "h-[46px] min-w-0 flex-1 border-none bg-transparent px-0.5 py-px text-[15px] text-inv-ink outline-none placeholder:text-inv-muted disabled:opacity-50",
  composerAttach:
    "flex size-11 flex-shrink-0 items-center justify-center rounded-[22px] text-inv-muted transition-colors hover:bg-inv-stone disabled:opacity-30",
  composerSend:
    "flex size-11 flex-shrink-0 items-center justify-center rounded-[22px] bg-inv-ink text-inv-white transition-opacity disabled:cursor-not-allowed disabled:opacity-30",
} as const;

/** 가입 순서의 role 슬롯은 받지 않는다. 본인이 확인한 표시 역할만 전달한다. */
export function confirmedRoleBubbleTone(confirmedRole: unknown): "sky" | "rose" | "neutral" {
  return confirmedRole === "groom" ? "sky" : confirmedRole === "bride" ? "rose" : "neutral";
}
