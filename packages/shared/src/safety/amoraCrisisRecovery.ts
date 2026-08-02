import {
  AMORA_CRISIS_CONTACT_POLICY_VERSION,
  classifyAmoraCrisis,
} from "./amoraCrisisSafety";
import type { AmoraCrisisKind } from "./amoraCrisisClassifier";

export type AmoraCrisisRecoveryVisibility =
  | "shared"
  | "bride_private"
  | "groom_private";

export interface AmoraCrisisRecoveryMessage {
  id: string;
  coupleId: string;
  senderId: string | null;
  senderRole: "bride" | "groom" | "ai";
  role: "user" | "assistant";
  content: string;
  visibility: AmoraCrisisRecoveryVisibility;
  target: "ai" | "partner" | null;
  createdAt: string;
  inReplyToUserMessageId: string | null;
}

export interface AmoraCrisisRecoveryViewer {
  coupleId: string;
  userId: string;
  role: "bride" | "groom";
}

export interface AmoraCrisisRecoveryCard {
  id: string;
  content: string;
  visibility: AmoraCrisisRecoveryVisibility;
  createdAt: string;
  inReplyToUserMessageId: string;
  safetyClassification: AmoraCrisisKind;
  metadata: {
    response_origin: "client_deterministic_crisis_recovery";
    question_scope: "W5_safety_override";
    memory_eligible: false;
    persistence_status: "local_recovery_only";
    safety_contact_policy: string;
    safety_classification: AmoraCrisisKind;
    in_reply_to_user_message_id: string;
    pinned_safety_card: true;
  };
}

export const AMORA_CRISIS_RECOVERY_CARD_ID_PREFIX =
  "amora-crisis-recovery:";

// This is deliberately generic. It is safe for self-harm, third-party risk,
// victim disclosures, and reporter-aggressor disclosures without inferring or
// repeating private details from the original message.
export const AMORA_CRISIS_RECOVERY_CARD_CONTENT = [
  "안전 확인 안내",
  "지금도 본인이나 다른 사람이 당장 다칠 위험이 있거나 이미 다쳤다면, 서로 거리를 두고 위험한 물건이나 장소에서 벗어나 경찰 112 또는 소방 119에 바로 연락하세요.",
  "가능하다면 혼자 감당하지 말고 믿을 수 있는 사람에게 지금 상황을 알려주세요. 자해·자살 위험은 자살예방상담전화 109에 연락할 수 있고, 폭력 피해 지원이 필요하면 여성긴급전화 1366에 연락할 수 있어요.",
  "한국 밖에 있다면 현지 긴급번호 또는 지역 위기상담기관에 바로 연락해주세요.",
].join("\n\n");

export function isAmoraCrisisRecoveryCardId(value: string): boolean {
  return value.startsWith(AMORA_CRISIS_RECOVERY_CARD_ID_PREFIX);
}

function compareChronologically(
  left: AmoraCrisisRecoveryMessage,
  right: AmoraCrisisRecoveryMessage,
): number {
  const byCreatedAt =
    new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  return byCreatedAt || left.id.localeCompare(right.id);
}

function canViewerSeeVisibility(
  visibility: AmoraCrisisRecoveryVisibility,
  viewer: AmoraCrisisRecoveryViewer,
): boolean {
  return visibility === "shared" || visibility === `${viewer.role}_private`;
}

/**
 * Rebuilds at most one local card from already-loaded canonical rows.
 * It never performs I/O, calls a provider, logs content, or copies the raw
 * disclosure into metadata. Only a later canonical AI row explicitly bound
 * to that user-row id makes it matched and suppresses the card.
 */
export function buildUnmatchedAmoraCrisisRecoveryCard(
  messages: readonly AmoraCrisisRecoveryMessage[],
  viewer: AmoraCrisisRecoveryViewer,
): AmoraCrisisRecoveryCard | null {
  if (!viewer.coupleId || !viewer.userId) return null;

  const canonicalRows = messages
    .filter((message) =>
      message.coupleId === viewer.coupleId
      && canViewerSeeVisibility(message.visibility, viewer)
      && message.target !== "partner"
      && !isAmoraCrisisRecoveryCardId(message.id)
    )
    .sort(compareChronologically);

  const candidates = canonicalRows
    .filter((message) =>
      message.role === "user"
      && message.senderId === viewer.userId
      && message.senderRole === viewer.role
    )
    .sort((left, right) => compareChronologically(right, left));

  for (const candidate of candidates) {
    const classification = classifyAmoraCrisis(candidate.content);
    if (!classification) continue;
    const hasBoundCanonicalAnswer = canonicalRows.some((message) =>
      message.role === "assistant"
      && message.senderRole === "ai"
      && message.visibility === candidate.visibility
      && message.inReplyToUserMessageId === candidate.id
      && compareChronologically(message, candidate) > 0
    );
    if (hasBoundCanonicalAnswer) continue;
    return {
      id: `${AMORA_CRISIS_RECOVERY_CARD_ID_PREFIX}${candidate.id}`,
      content: AMORA_CRISIS_RECOVERY_CARD_CONTENT,
      visibility: candidate.visibility,
      createdAt: candidate.createdAt,
      inReplyToUserMessageId: candidate.id,
      safetyClassification: classification.kind,
      metadata: {
        response_origin: "client_deterministic_crisis_recovery",
        question_scope: "W5_safety_override",
        memory_eligible: false,
        persistence_status: "local_recovery_only",
        safety_contact_policy: AMORA_CRISIS_CONTACT_POLICY_VERSION,
        safety_classification: classification.kind,
        in_reply_to_user_message_id: candidate.id,
        pinned_safety_card: true,
      },
    };
  }

  return null;
}
