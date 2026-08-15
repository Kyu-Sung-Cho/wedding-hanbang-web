// 기존 웹 import 경로는 유지하고, 웹·모바일이 동일한 순수 판정 계약을 사용한다.
export {
  assessMediationOffer,
  hasUnresolvedPrivateMediationSafetyHold,
  hasMediationSafetySignal,
  shouldOfferMediation,
  type MediationOfferAssessment,
  type MediationOfferMessage,
  type PrivateMediationSafetyHoldMessage,
} from "@hanbang/shared/mediation-offer";
