/**
 * 준비 상태 — 이 사람에게 지금 결혼 준비가 진행 중인가.
 *
 * 예식이 연기되거나 취소된 사람에게 앱이 계속 "D-42"를 띄우고 축하하고 다음 할 일을
 * 독촉하는 것은, 어떤 버그보다 아프다. 그런데 지금 코드에는 그 상태 자체가 없어서
 * 끌 방법도 없다.
 *
 * ## 왜 커플 승인이 아니라 개인 상태인가
 *
 * 예식 취소는 분명히 두 사람의 일이다. 그런데도 이 상태만은 혼자 정할 수 있어야 한다.
 * 카운트다운을 끄는 데 상대의 승인이 필요하면, 관계를 떠나는 사람이 바로 그것을 끄지
 * 못한다. 상대에게 자동으로 알려서도 안 된다 — 알림 자체가 위험이 되는 상황이 있다.
 *
 * 그래서 이 상태는 상대의 화면을 바꾸지 않는다. 공유 여정의 예식일도 건드리지 않는다.
 * 바꾸는 것은 **이 사람에게 아모라가 말하는 방식**뿐이다. 두 사람이 함께 정리하기로
 * 했다면 예식일과 일정은 평소의 공동 승인 경로로 바꾸면 된다.
 *
 * ## 모델이 정하지 않는다
 *
 * 사용자가 "결혼 취소했어"라고 말했다고 아모라가 이 상태를 바꾸지 않는다. 사람의
 * 가장 아픈 사실을 모델의 해석으로 확정할 수는 없다. 아모라는 이 상태를 바꿀 수 있는
 * 곳을 알려줄 뿐이고, 바꾸는 것은 사용자다.
 */

export const PREPARATION_STATUSES = ["preparing", "paused", "called_off"] as const;

export type PreparationStatus = (typeof PREPARATION_STATUSES)[number];

/**
 * 저장된 값이 없거나 알 수 없으면 `preparing`이다. 상태를 모른다고 해서 조용해지면,
 * 저장 컬럼이 아직 없는 동안 모든 사용자의 준비가 멈춘 것처럼 보인다.
 */
export function normalizePreparationStatus(value: unknown): PreparationStatus {
  return typeof value === "string"
    && (PREPARATION_STATUSES as readonly string[]).includes(value)
    ? (value as PreparationStatus)
    : "preparing";
}

/** 남은 날짜 세기(D-42, D-Day)를 보여줘도 되는가. */
export function allowsCountdown(status: PreparationStatus): boolean {
  return status === "preparing";
}

/** "이건 서둘러야 해요" 류의 재촉을 해도 되는가. */
export function allowsUrgency(status: PreparationStatus): boolean {
  return status === "preparing";
}

/**
 * 축하해도 되는가.
 *
 * 연기와 취소를 여기서 함께 묶는 이유: 연기한 사람에게도 "축하드려요"는 어긋난다.
 * 다시 준비를 시작하면 사용자가 상태를 되돌리고, 그때 축하가 돌아온다.
 */
export function allowsCelebration(status: PreparationStatus): boolean {
  return status === "preparing";
}

/**
 * 지금 이 사람에게 아모라가 먼저 꺼내도 되는 이야기.
 *
 * 멈춘 사람에게 남는 일은 준비가 아니라 정리다. 문서가 이름 붙인 세 가지 —
 * 알림 정리, 계약 조건 확인, 환급·취소 일정 — 만 남긴다. 그마저도 먼저 밀어붙이지
 * 않고, 사용자가 원할 때 꺼낼 수 있게 둔다.
 */
export function allowedCareTopics(status: PreparationStatus): readonly string[] {
  if (status === "preparing") return [];
  return ["notification_cleanup", "contract_terms", "refund_and_cancellation_dates"];
}
