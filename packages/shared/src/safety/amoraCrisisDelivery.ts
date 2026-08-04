import {
  buildAmoraCrisisResponse,
  classifyAmoraCrisis,
  type AmoraCrisisClassification,
} from "./amoraCrisisSafety";
import { assessAmoraSafetyText } from "./amoraCrisisClassifier";

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
      response: buildAmoraCrisisResponse(classification.kind),
    };
  }

  const assessment = assessAmoraSafetyText(input.userText);
  if (assessment.resolution === "non_immediate_safety") {
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
