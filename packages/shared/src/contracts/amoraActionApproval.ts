export type AmoraActionApprovalPolicy = "single" | "couple" | "blocked";

export const SINGLE_APPROVAL_PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;
export const COUPLE_APPROVAL_PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1_000;

/**
 * 공유 계획을 건드리는 도구들. 예전에는 이 목록이 **두 사람 승인** 대상이었다.
 *
 * 이 목록은 알림을 결정하지 **않는다.** 상대 알림은 DB 트리거
 * `trg_notify_amora_shared_action_completion` 이 하고, 그 트리거는 도구도 정책도
 * 보지 않고 성공한 모든 적용에 발행한다 — 목록보다 강하다. 여기 이름을 빠뜨려도
 * 상대는 알림을 받는다. 이 목록이 정하는 것은 승인 정책뿐이다.
 *
 * 2026-08-23 파운더 결정으로 두 사람 승인을 없애고 **한 사람이 확인하면 바로
 * 반영하고 상대에게는 알림을 준다.** 파운더 원문: "그냥 파트너가 뭘 추가하거나
 * 뭘 변경했거나 삭제했을 때 알림을 그냥 상단에 텍스트 메시지처럼 보여주면 되지
 * 않을까?"
 *
 * 목록은 지우지 않고 이름만 바꿔 남긴다. 알림 계층이 **어떤 변경이 상대에게
 * 반드시 가야 하는가**를 이 목록으로 판단하기 때문이다. 승인이 없어졌다고 이
 * 구분까지 없애면, 상대는 자기 예식일이 바뀐 것을 영영 모를 수 있다.
 */
export const SHARED_PLAN_TOOLS: ReadonlySet<string> = new Set([
  "update_budget",
  "update_wedding_date",
  "update_venue",
  "apply_budget_plan",
  // 이름은 "기록"이지만 `add_schedule_event`와 같은 공유 일정 배열
  // (`progress.__events`)에 쓴다. 상대에게 알려야 할 변경이다.
  "log_wedding_event",
  "update_schedule_event",
  "cancel_schedule_event",
  "restore_schedule_event",
  "add_schedule_event",
  "update_category_budget",
  "add_custom_category",
]);

const SINGLE_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "update_task_status",
  "toggle_checklist_item",
  "add_amora_action",
]);

/**
 * Canonical web/mobile approval policy. Unknown mutations stay blocked so a
 * newly introduced tool cannot silently inherit a one-person confirmation.
 */
export function getAmoraActionApprovalPolicy(
  toolName: string,
  // 예전에는 입력값이 정책을 갈랐다(카테고리 예산에 금액이 있으면 두 사람,
  // 없으면 한 사람). 이제는 갈리지 않는다. 호출부가 많아 서명은 유지한다.
  _input?: unknown,
): AmoraActionApprovalPolicy {
  // 목록에 없는 도구는 그대로 막힌다. 승인을 한 사람으로 줄이는 것과, 아모라가
  // 아예 손대지 않기로 한 것(예약·삭제)을 푸는 것은 다른 이야기다.
  if (
    SHARED_PLAN_TOOLS.has(toolName)
    || SINGLE_APPROVAL_TOOLS.has(toolName)
  ) {
    // 2026-08-23부터 공유 계획 변경도 한 사람 확인으로 반영된다.
    // 상대에게는 `couple_change_notifications` 의 `change_applied` 가 간다.
    return "single";
  }

  return "blocked";
}

export function getAmoraPendingActionTtlMs(
  toolName: string,
  _input?: unknown,
): number {
  // 예전에는 승인 정책에서 뽑았다. 정책이 전부 single 이 된 뒤에도 **금액·예식일
  // 같은 공유 계획 변경에는 넉넉한 창을 준다** — 사용자가 숫자를 한 번 더 생각하러
  // 자리를 뜨는 시간이다. 체크리스트처럼 즉시 누르는 것은 10분이면 된다.
  //
  // DB(`amora_shared_action_context_pre_roster_binding`)는 이 두 값만 허용하고
  // 목록은 갖고 있지 않다. 도구별 판단은 여기 한 곳에만 둔다.
  return SHARED_PLAN_TOOLS.has(toolName)
    ? COUPLE_APPROVAL_PENDING_ACTION_TTL_MS
    : SINGLE_APPROVAL_PENDING_ACTION_TTL_MS;
}
