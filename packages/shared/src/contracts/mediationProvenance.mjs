/**
 * 조율 초안의 출처 표식 — 그 카드에 담긴 말이 누구 말인지.
 *
 * 사용자가 요청하는 조율 초안은 **요청한 사람이 직접 쓴 요약 하나만** 모델에 보낸다.
 * 상대의 메시지는 보내지 않는다. 동의 화면이 그렇게 약속하기 때문이다.
 *
 * 그래서 화면이 아모라가 양쪽 이야기를 다 듣고 정리한 것처럼 쓰면 사실이 아니게
 * 된다. 싸운 다음 날 상대가 그 카드를 열면, 아모라가 한쪽 편을 들었다고 읽는다 —
 * 요청자 요약만 쓰기로 한 설계가 막으려던 바로 그 오해다.
 *
 * 판별 기준을 웹과 앱이 각자 갖고 있으면 한쪽만 고쳐진다. 그래서 여기 한 벌만 둔다.
 * `.mjs`인 이유는 앱 테스트가 번들러 없이 이 파일을 그대로 불러 실제 판정을 쓰기
 * 위해서다(`communityNotification.mjs`와 같은 이유).
 */

export const AMORA_REQUESTER_SUMMARY_MEDIATION = Object.freeze({
  origin: "user_requested",
  evidenceScope: "requester_summary_only",
  schemaVersion: 2,
});

/**
 * 이 초안이 "요청자 요약만" 계약으로 만들어진 것인지. 표식이 하나라도 어긋나면
 * 출처를 알 수 없는 것으로 보고 `false`를 돌려준다 — 모르면 아는 척하지 않는다.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRequesterSummaryMediationProvenance(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return value.origin === AMORA_REQUESTER_SUMMARY_MEDIATION.origin
    && value.evidenceScope === AMORA_REQUESTER_SUMMARY_MEDIATION.evidenceScope
    && value.schemaVersion === AMORA_REQUESTER_SUMMARY_MEDIATION.schemaVersion;
}
