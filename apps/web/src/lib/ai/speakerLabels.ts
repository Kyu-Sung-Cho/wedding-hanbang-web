// 채팅 히스토리 접두어를 만드는 유일한 곳.
//
// 이전에는 런타임(chat/route.ts)과 시스템 프롬프트(prompts.ts)가 각자 문자열을
// 갖고 있었다. 중립 준비 공간을 켜자 런타임은 [사용자→상대방]을 붙이는데
// 프롬프트는 [신부→상대방]만 "응답 금지"로 가르쳐서, 금지 규칙이 매칭에
// 실패했다 — 라벨이 성별인 것보다 이쪽이 더 위험하다.

/** 중립 준비 공간에서는 슬롯이 아니라 화자 기준으로 부른다. */
export const NEUTRAL_SELF_LABEL = "사용자";
export const NEUTRAL_PARTNER_LABEL = "파트너";
export const ROLE_BRIDE_LABEL = "신부";
export const ROLE_GROOM_LABEL = "신랑";

/** 상대방에게 직접 보낸 메시지에 붙는 꼬리표. */
export const PARTNER_TARGET_SUFFIX = "→상대방";

/**
 * 한 메시지의 화자 라벨. neutral 이면 슬롯(bride/groom)을 쳐다보지 않는다.
 */
export function speakerLabelFor(input: {
  neutral: boolean;
  isSelf: boolean;
  senderType: string | null | undefined;
}): string {
  if (input.neutral) {
    return input.isSelf ? NEUTRAL_SELF_LABEL : NEUTRAL_PARTNER_LABEL;
  }
  return input.senderType === "bride" ? ROLE_BRIDE_LABEL : ROLE_GROOM_LABEL;
}

/**
 * 프롬프트가 "커플 직접 대화"로 인식해야 하는 접두어 전부.
 * 런타임이 실제로 붙이는 값에서 파생되므로 둘이 갈라질 수 없다.
 */
export function partnerDirectedPrefixes(neutral: boolean): string[] {
  const speakers = neutral
    ? [NEUTRAL_SELF_LABEL, NEUTRAL_PARTNER_LABEL]
    : [ROLE_BRIDE_LABEL, ROLE_GROOM_LABEL];
  return speakers.map((speaker) => `[${speaker}${PARTNER_TARGET_SUFFIX}]`);
}

/** 프롬프트 예시에 쓸 "아모라에게 묻는" 접두어 하나. */
export function amoraDirectedExamplePrefix(neutral: boolean): string {
  return neutral ? `[${NEUTRAL_SELF_LABEL}]` : `[${ROLE_BRIDE_LABEL}]`;
}
