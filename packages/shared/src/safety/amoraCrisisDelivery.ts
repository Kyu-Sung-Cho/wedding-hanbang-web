import {
  buildAmoraCrisisResponse,
  classifyAmoraCrisis,
  type AmoraCrisisClassification,
} from "./amoraCrisisSafety";
import { assessAmoraSafetyText } from "./amoraCrisisClassifier";
import { isClosedPartnerViolenceStatement } from "./partnerViolenceClosedVocabulary";

export type AmoraCrisisDeliveryVisibility =
  | "shared"
  | "bride_private"
  | "groom_private";
export type AmoraCrisisDeliveryTarget = "ai" | "partner";
export type AmoraCrisisDeliverySenderRole = "bride" | "groom";

export type AmoraCrisisDeliveryPreflight =
  | {
      disposition: "continue";
      classification: null;
      effectiveVisibility: AmoraCrisisDeliveryVisibility;
      safetyPrivacyRedirected: false;
      partnerDeliveryHeld: false;
      response: null;
    }
  | {
      disposition: "private_safety_route";
      safetyResolution: "non_immediate_safety";
      classification: null;
      effectiveVisibility: "bride_private" | "groom_private";
      safetyPrivacyRedirected: boolean;
      partnerDeliveryHeld: false;
      response: null;
    }
  | {
      disposition: "local_safety_hold";
      safetyResolution: "immediate_crisis" | "non_immediate_safety";
      classification: AmoraCrisisClassification | null;
      effectiveVisibility: "bride_private" | "groom_private";
      safetyPrivacyRedirected: boolean;
      partnerDeliveryHeld: boolean;
      response: string;
    };

const NON_IMMEDIATE_PARTNER_HOLD_RESPONSE = [
  "폭력·위협·통제와 관련된 민감한 안전 내용이라 상대방에게 바로 보내지 않았어요.",
  "나만 상담에서 상황과 원하는 도움을 먼저 정리해 주세요. 지금 안전하지 않다면 안전한 곳으로 이동하고 경찰 112 또는 소방 119에 바로 연락해 주세요.",
].join("\n\n");

/**
 * Runs before storage, Realtime, analytics, uploads, or network calls.
 * Immediate crisis disclosures stay local-only by default: the raw text is
 * neither persisted nor delivered, and the fixed safety response is rendered
 * in the sender's private lane.
 */
export function planAmoraCrisisDelivery(input: {
  userText: string;
  requestedVisibility: AmoraCrisisDeliveryVisibility;
  target: AmoraCrisisDeliveryTarget;
  senderRole: AmoraCrisisDeliverySenderRole;
  /**
   * 호출자가 따로 판정한 안전 신호. 이 파일의 두 탐지기가 못 잡는 서술을 상위
   * 계층이 잡았을 때 넘긴다.
   *
   * 필요한 이유: 중재 요청의 안전 판정은 실제로 두 갈래로 갈려 있었다. 여기의
   * `classifyAmoraCrisis`/`assessAmoraSafetyText`가 한 갈래고, 웹의 질문 범위
   * 분류(강압적 통제·신체 폭력 서술)가 다른 갈래다. 뒤쪽만 걸리는 문장이
   * 측정상 12개 중 11개였고, 그 문장들의 답은 공유 레인에 저장돼 상대 화면에
   * 남았다. 안전 문구로 바뀐 답이라도 "파트너가 안전 관련해서 뭔가 물었다"는
   * 사실 자체가 통제하는 쪽에 도착한다.
   *
   * 판정을 여기로 옮기지 않고 신호만 받는 이유는 그 어휘가 웹 계층에 있고,
   * 이 패키지가 상위 계층을 import하면 방향이 뒤집히기 때문이다.
   */
  externalSafetySignal?: boolean;
}): AmoraCrisisDeliveryPreflight {
  const classification = classifyAmoraCrisis(input.userText);
  const effectiveVisibility = `${input.senderRole}_private` as const;
  if (classification) {
    return {
      disposition: "local_safety_hold",
      safetyResolution: "immediate_crisis",
      classification,
      effectiveVisibility,
      safetyPrivacyRedirected: input.requestedVisibility !== effectiveVisibility,
      partnerDeliveryHeld: input.target === "partner",
      response: buildAmoraCrisisResponse(classification.kind, classification.language),
    };
  }

  const assessment = assessAmoraSafetyText(input.userText);
  // 2026-09-26: 닫힌 어휘로 된 친밀한 관계 폭력·위협·통제 서술(`남편이 때려요`·`밀쳐서 멍들었어`·
  // `파혼하면 죽인대`·`친구 못 만나게 해`). 두 판정이 **아무것도 못 찾았고**(위기 분류 null ·
  // 구조 판정 inconclusive) 호출자 신호도 없을 때만 본다 — 운영 판정은 그대로 두고 더하기만 한다.
  // 결과는 아래 비즉시 경로와 같다(새 disposition 없음). 모바일 사전 판정은 호출자 신호를
  // 넘기지 않으므로 여기 있어야 앱도 같은 레인을 고른다.
  const closedPartnerViolence =
    assessment.resolution === "inconclusive"
    && !input.externalSafetySignal
    && isClosedPartnerViolenceStatement(input.userText);
  if (
    assessment.resolution === "non_immediate_safety"
    || input.externalSafetySignal
    || closedPartnerViolence
  ) {
    if (input.target === "partner") {
      return {
        disposition: "local_safety_hold",
        safetyResolution: "non_immediate_safety",
        classification: null,
        effectiveVisibility,
        safetyPrivacyRedirected: input.requestedVisibility !== effectiveVisibility,
        partnerDeliveryHeld: true,
        response: NON_IMMEDIATE_PARTNER_HOLD_RESPONSE,
      };
    }
    return {
      disposition: "private_safety_route",
      safetyResolution: "non_immediate_safety",
      classification: null,
      effectiveVisibility,
      safetyPrivacyRedirected: input.requestedVisibility !== effectiveVisibility,
      partnerDeliveryHeld: false,
      response: null,
    };
  }

  return {
    disposition: "continue",
    classification: null,
    effectiveVisibility: input.requestedVisibility,
    safetyPrivacyRedirected: false,
    partnerDeliveryHeld: false,
    response: null,
  };
}
