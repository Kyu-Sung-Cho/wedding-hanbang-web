import type { BudgetImpactPreview } from "./budgetImpactPreview";

/**
 * 아모라 변경 제안의 「내용 확인하기」 창이 말하는 것 — 웹과 앱이 같은 표를 쓴다.
 *
 * 2026-09-18 전에는 이 표가 웹 확인 창(`apps/web/src/components/app/chat/AmoraSaveSheet.tsx`) 안에만
 * 있었고, 앱 카드는 확인 창 없이 한 번 누르면 바로 반영했다. 앱에도 같은 확인 창을 두면서 표를 여기로
 * 옮겼다. 도구마다 붙은 안내("예약을 대신 진행하지 않아요", "업체 예약을 취소하지 않아요")는 아모라가
 * 손대지 않는 범위를 사용자가 누르기 전에 읽게 하려는 것이라, 두 화면이 한 글자도 다르면 안 된다.
 */
export interface AmoraChangeDetail {
  category: string;
  effect: string;
}

export const AMORA_CHANGE_DETAILS: Readonly<Record<string, AmoraChangeDetail>> = {
  update_budget: { category: "예산", effect: "준비 예산의 총금액을 바꿔요." },
  apply_budget_plan: { category: "예산", effect: "제안한 예산 배분을 한 번에 반영해요." },
  update_category_budget: { category: "예산", effect: "해당 항목의 예산 정보를 바꿔요." },
  add_custom_category: { category: "예산", effect: "확인한 맞춤 예산 항목에 금액을 반영해요." },
  update_wedding_date: { category: "예식 준비", effect: "준비 정보의 결혼식 날짜를 바꿔요." },
  update_venue: { category: "예식 준비", effect: "준비 정보의 예식장 정보를 바꿔요. 예약을 대신 진행하지 않아요." },
  add_schedule_event: { category: "일정", effect: "준비 일정에 새 일정을 추가해요." },
  log_wedding_event: { category: "일정", effect: "준비 일정에 해당 내용을 기록해요." },
  update_schedule_event: { category: "일정", effect: "기존 일정의 내용을 바꿔요." },
  cancel_schedule_event: { category: "일정", effect: "준비 일정에서 해당 일정을 취소로 표시해요. 업체 예약을 취소하지 않아요." },
  restore_schedule_event: { category: "일정", effect: "취소로 표시한 준비 일정을 다시 복원해요." },
  update_task_status: { category: "체크리스트", effect: "해당 준비 항목의 진행 상태를 바꿔요." },
  toggle_checklist_item: { category: "체크리스트", effect: "해당 체크리스트 항목의 완료 여부를 바꿔요." },
  add_amora_action: { category: "준비 행동", effect: "다음에 할 일을 준비 행동으로 추가해요. 이미 끝낸 일로 표시하지 않아요." },
};

/** 표에 없는 도구. 승인 정책도 이런 도구는 막는다(`getAmoraActionApprovalPolicy` → blocked). */
export const AMORA_UNKNOWN_CHANGE_DETAIL: AmoraChangeDetail = {
  category: "준비 정보",
  effect: "지원 여부를 확인할 수 없는 변경은 반영할 수 없어요.",
};

export const AMORA_EXISTING_CUSTOM_CATEGORY_EFFECT = "기존 맞춤 예산 항목의 금액을 바꿔요.";

/**
 * 공유 계획을 바꾸고 상대가 연결돼 있을 때 카드·확인 창이 붙이는 말(2026-08-23 파운더 결정: 한 사람이
 * 확인하면 바로 반영하고 상대에게는 알림). 상대가 없으면 없는 사람에 대한 약속이 되므로 붙이지 않는다.
 */
export const AMORA_SHARED_PLAN_PARTNER_NOTICE = "확인하면 바로 반영되고, 상대에게 바뀐 내용이 알림으로 가요.";

/** 확인 창 문구. 웹 `AmoraSaveSheet`·`AmoraSheetFrame`·`PendingAmoraActionCard` 와 앱 확인 시트가 같은 말을 쓴다. */
export const AMORA_CHANGE_REVIEW_COPY = {
  openLabel: "내용 확인하기",
  openAccessibilityLabel: "변경 내용 확인하기",
  title: "이 내용을 반영할까요?",
  description: "함께 보는 준비 정보에 반영할 변경이에요. 아래 내용을 확인해 주세요.",
  confirmationLabel: "확인할 내용",
  reasonLabel: "제안의 근거",
  reason: "아모라가 정리한 제안이에요. 대화에서 요청한 내용과 맞는지 확인해 주세요.",
  categoryLabel: "분야",
  scopeTitle: "공개 범위 · 함께 보는 준비 정보",
  scopeBody: "확인한 변경은 함께 보는 준비 정보에 반영돼요. 나만 상담한 대화를 이 창에서 공유하지 않아요.",
  defer: "나중에 정하기",
  close: "확인 창 닫기",
} as const;

/**
 * 이 제안의 분야와 효과. `boundPreview` 는 호출부가 이미 같은 도구·입력·기준 revision 에 묶어 검증한
 * 예산 영향 미리보기다(웹 `parseBudgetImpactPreview`, 앱 `getPendingAmoraBudgetImpactPreview`).
 *
 * 맞춤 예산 항목은 새 항목인지 기존 항목의 금액 변경인지 미리보기로만 가를 수 있다. 기존 0원 항목과 새
 * 항목을 구분할 수 없는 미리보기에는 "기존 항목을 바꿔요"라고 단정하지 않는다.
 */
export function describeAmoraChange(
  tool: string,
  boundPreview: BudgetImpactPreview | null,
): AmoraChangeDetail {
  const details = Object.hasOwn(AMORA_CHANGE_DETAILS, tool)
    ? AMORA_CHANGE_DETAILS[tool]
    : AMORA_UNKNOWN_CHANGE_DETAIL;
  const categoryImpact = boundPreview?.categories.length === 1 ? boundPreview.categories[0] : null;
  const changesExistingCustom = tool === "add_custom_category"
    && boundPreview !== null && categoryImpact !== null
    && categoryImpact.key.startsWith("custom_")
    && (categoryImpact.currentBudget > 0 || categoryImpact.currentRecordedSpend > 0)
    && boundPreview.delta.totalBudget === 0
    && categoryImpact.proposedBudget - categoryImpact.currentBudget === boundPreview.delta.allocatedBudget
    && categoryImpact.proposedRecordedSpend - categoryImpact.currentRecordedSpend === boundPreview.delta.recordedSpend;
  return {
    category: details.category,
    effect: changesExistingCustom ? AMORA_EXISTING_CUSTOM_CATEGORY_EFFECT : details.effect,
  };
}
