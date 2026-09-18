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
  /**
   * 이 칩을 만든 답이 응답한 사용자 질문의 id. 그 질문의 실시간 도착 알림이 답보다 늦게 와도
   * 새 대화로 보고 칩을 거두지 않게 한다(`followUpsAfterIncomingMessage`).
   */
  answersMessageId?: string;
}

/** 보낸 문장이 어디서 왔는가 — 입력창(`composer`)인가, 추천 대화 칩(`follow_up`)인가. */
export type AmoraDraftOrigin = "composer" | "follow_up";

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

/**
 * 실시간으로 새 메시지가 도착했을 때 칩을 남길지. 웹 `chatStore` 의 실시간 INSERT 처리와 같다 —
 * 아모라 답이 아니고 두 사람끼리 나눈 말(`target: "partner"`)도 아닌 새 메시지가 칩과 같은 칸에 오면
 * (예: 상대가 웹에서 함께 대화로 아모라에게 새 질문을 했다) 이 칩은 더는 지금 대화의 다음 질문이 아니다.
 * 이 칩을 만든 질문 자체의 도착 알림은 예외다.
 */
export function followUpsAfterIncomingMessage(
  state: AmoraFollowUpSuggestions | null,
  incoming: { id: string; senderType: string; target: unknown; lane: AmoraFollowUpLane },
): AmoraFollowUpSuggestions | null {
  if (!state) return null;
  if (incoming.senderType === "ai" || incoming.target === "partner" || incoming.lane !== state.lane) return state;
  if (state.answersMessageId !== undefined && incoming.id === state.answersMessageId) return state;
  return null;
}

/**
 * 저장에 실패한 질문을 「다시 보내기」 할 때 그 칸의 입력창. 비어 있거나 같은 문장일 때만 보낼 문장으로
 * 채운다 — 다른 글(칩을 누르기 전에 쓰던 초안)이 있으면 그대로 둔다. 덮어쓰면 다시 보내기가 성공한 뒤
 * `sendAiDraft` 가 보낸 문장과 같아진 입력창을 비워 그 초안이 사라진다.
 */
export function laneInputForRetry(currentInput: string, draftText: string): string {
  const current = currentInput.trim();
  return current === "" || current === draftText ? draftText : currentInput;
}

/**
 * 저장에 실패한 직후 그 칸의 입력창. 입력창에서 보낸 문장은 원래 입력창에 있으니 건드리지 않는다.
 * 칩에서 보낸 문장은 입력창이 비어 있을 때만 거기 둔다 — 실패 안내("내용을 확인한 뒤 새 메시지로")가
 * 가리킬 문장이 화면에 있어야 하고, 쓰던 초안은 덮지 않는다.
 */
export function laneInputAfterFailedSend(
  currentInput: string,
  draft: { text: string; origin?: AmoraDraftOrigin },
): string {
  if (draft.origin !== "follow_up") return currentInput;
  return currentInput.trim() === "" ? draft.text : currentInput;
}
