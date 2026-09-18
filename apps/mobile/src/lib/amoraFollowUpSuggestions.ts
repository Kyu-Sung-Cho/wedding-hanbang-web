/**
 * 아모라 답 뒤의 후속 질문 칩 — 웹 「추천 대화」(`SuggestionButtons`)와 같은 자리다(2026-09-18).
 *
 * 서버는 답이 끝날 때 `{"type":"suggestions","suggestions":[…]}` 를 보낸다(`apps/web/src/app/api/chat/route.ts`).
 * 받은 값은 신뢰 경계 밖에서 온 것이므로 여기서 모양을 다시 본다. 서버가 저장된 칩을 되돌려 줄 때 쓰는
 * 규칙(`getStoredSuggestions`: 문자열·160자 이하·최대 4개)과 같은 상한을 쓴다.
 */

export const AMORA_FOLLOW_UP_LABEL = "추천 대화";

const MAX_FOLLOW_UPS = 4;
const MAX_FOLLOW_UP_LENGTH = 160;

export type AmoraFollowUpLane = "shared_ai" | "private_ai";

export interface AmoraFollowUpSuggestions {
  /** 이 칩을 만든 답이 나온 칸. 다른 칸(특히 상대에게 보내는 칸)으로 옮겨 보이지 않는다. */
  lane: AmoraFollowUpLane;
  items: string[];
}

export function normalizeAmoraFollowUpSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const text = entry.trim();
    if (!text || text.length > MAX_FOLLOW_UP_LENGTH || items.includes(text)) continue;
    items.push(text);
    if (items.length === MAX_FOLLOW_UPS) break;
  }
  return items;
}

/**
 * 지금 보여 줄 칩. 그 답이 나온 아모라 칸에 있고 답이 끝났을 때만 — 상대에게 보내는 칸
 * (`shared_partner`)에서는 절대 보이지 않는다. 웹도 받는 사람이 상대면 칩을 거둔다.
 */
export function visibleAmoraFollowUps(
  state: AmoraFollowUpSuggestions | null,
  { activeLane, streaming }: { activeLane: string | null; streaming: boolean },
): string[] {
  if (!state || streaming || activeLane !== state.lane) return [];
  return state.items;
}
