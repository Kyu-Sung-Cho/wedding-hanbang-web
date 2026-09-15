import { parseProfileAvatarUrl } from "./profileAvatarPresentation.mjs";

// 채팅 말풍선 색과 발신자 아바타를 고르는 순수 규칙. 웹 chatBubbleStyles.ts 의
// confirmedRoleBubbleTone 과 같은 규칙이다(2026-09-12 요청):
//   본인이 확인한 표시 역할이 groom → sky, bride → rose, 확인 전·모름 → neutral, 아모라 → amora
// 가입 순서로 채워지는 profiles.role 슬롯은 받지 않는다. 사용자가 고른 적 없는 역할로
// 색을 칠하지 않으려는 것이다. 역할은 /api/auth/me 의 confirmed_role 만 쓴다.

/** @returns {"sky" | "rose" | "neutral"} */
export function confirmedRoleBubbleTone(confirmedRole) {
  return confirmedRole === "groom" ? "sky" : confirmedRole === "bride" ? "rose" : "neutral";
}

export const EMPTY_CHAT_PARTICIPANT_PRESENTATION = Object.freeze({
  selfId: null,
  partnerId: null,
  selfConfirmedRole: null,
  partnerConfirmedRole: null,
  selfAvatarUrl: null,
  partnerAvatarUrl: null,
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function confirmedRole(value) {
  return value === "bride" || value === "groom" ? value : null;
}

/**
 * /api/auth/me 응답에서 채팅 표시에 필요한 것만 읽는다.
 * 요청을 시작한 본인·커플·확인된 상대와 응답이 모두 맞을 때만 채운다. 하나라도 어긋나면
 * (계정 전환, 커플 변경, 상대 연결 해제) 빈 값을 돌려 중립 색과 이름 첫 글자로 둔다.
 */
export function readChatParticipantPresentation(payload, { selfId, partnerId, coupleId }) {
  if (!isRecord(payload) || typeof selfId !== "string" || !selfId) return EMPTY_CHAT_PARTICIPANT_PRESENTATION;
  const { user, profile, partner } = payload;
  if (!isRecord(user) || user.id !== selfId || !isRecord(profile) || profile.id !== selfId) {
    return EMPTY_CHAT_PARTICIPANT_PRESENTATION;
  }
  if (typeof coupleId === "string" && profile.couple_id !== coupleId) return EMPTY_CHAT_PARTICIPANT_PRESENTATION;
  const partnerMatches = typeof partnerId === "string" && partnerId !== "" && partnerId !== selfId
    && isRecord(partner) && partner.id === partnerId
    && (typeof coupleId !== "string" || partner.couple_id === undefined || partner.couple_id === coupleId);
  return Object.freeze({
    selfId,
    partnerId: partnerMatches ? partnerId : null,
    selfConfirmedRole: confirmedRole(profile.confirmed_role),
    partnerConfirmedRole: partnerMatches ? confirmedRole(partner.confirmed_role) : null,
    selfAvatarUrl: parseProfileAvatarUrl(profile.avatar_url, selfId),
    partnerAvatarUrl: partnerMatches ? parseProfileAvatarUrl(partner.avatar_url, partnerId) : null,
  });
}

/**
 * 메시지 한 건의 말풍선 색과 아바타. sender_id 가 없는 과거 메시지에는 지금 사람의
 * 역할·사진을 붙이지 않는다(오귀속 방지). 웹 ChatContent 가 sender_id 를 대조하는 것과 같다.
 * @returns {{ tone: "amora" | "sky" | "rose" | "neutral", avatarUrl: string | null, avatarOwnerId: string | null }}
 */
export function resolveChatSenderPresentation({ isAi, senderId, presentation }) {
  if (isAi) return { tone: "amora", avatarUrl: null, avatarOwnerId: null };
  const current = presentation ?? EMPTY_CHAT_PARTICIPANT_PRESENTATION;
  if (typeof senderId !== "string" || !senderId) return { tone: "neutral", avatarUrl: null, avatarOwnerId: null };
  if (current.selfId && senderId === current.selfId) {
    return { tone: confirmedRoleBubbleTone(current.selfConfirmedRole), avatarUrl: current.selfAvatarUrl, avatarOwnerId: current.selfId };
  }
  if (current.partnerId && senderId === current.partnerId) {
    return { tone: confirmedRoleBubbleTone(current.partnerConfirmedRole), avatarUrl: current.partnerAvatarUrl, avatarOwnerId: current.partnerId };
  }
  return { tone: "neutral", avatarUrl: null, avatarOwnerId: null };
}

/**
 * 왼쪽 사람 말풍선 옆 아바타에 쓸 이름. 확인된 본인·상대의 메시지에만 이름을 준다.
 * 누구인지 확인할 수 없는 메시지는 null — 아바타가 사람 아이콘으로 남는다.
 */
export function chatSenderAvatarName({ senderId, selfId, selfName, partnerId, partnerName }) {
  if (typeof senderId !== "string" || !senderId) return null;
  if (selfId && senderId === selfId) return selfName ?? null;
  if (partnerId && senderId === partnerId) return partnerName ?? null;
  return null;
}
