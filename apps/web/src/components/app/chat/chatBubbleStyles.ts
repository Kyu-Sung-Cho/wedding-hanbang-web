// 팔레트는 design-tokens/chat.ts와 같다. CSS가 늦게 도착해도 같은 색을 유지한다.
export const CHAT_BUBBLE_TONES = {
  sky: "border-[var(--hb-chat-sky-line,#BCD9EC)] bg-[var(--hb-chat-sky-surface,#E5F2FA)] text-[var(--hb-chat-sky-ink,#23445B)]",
  rose: "border-[var(--hb-chat-rose-line,#ECC7D0)] bg-[var(--hb-chat-rose-surface,#FBE9ED)] text-[var(--hb-chat-rose-ink,#623442)]",
  amora: "border-[var(--hb-chat-amora-line,#CDD8C7)] bg-[var(--hb-chat-amora-surface,#EEF2EA)] text-[var(--hb-chat-amora-ink,#34483E)]",
  neutral: "border-[var(--hb-chat-neutral-line,#DDD7CC)] bg-[var(--hb-chat-neutral-surface,#F2EFE9)] text-[var(--hb-chat-neutral-ink,#45413B)]",
} as const;

export type ChatBubbleTone = keyof typeof CHAT_BUBBLE_TONES;

/** 가입 순서의 role 슬롯은 받지 않는다. 본인이 확인한 표시 역할만 전달한다. */
export function confirmedRoleBubbleTone(confirmedRole: unknown): "sky" | "rose" | "neutral" {
  return confirmedRole === "groom" ? "sky" : confirmedRole === "bride" ? "rose" : "neutral";
}
