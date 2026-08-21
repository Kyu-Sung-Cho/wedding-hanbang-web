import type { UserRole } from "./database.types";
import {
  createPreparationProgressItems,
  type PreparationProgressStatus,
  type WeddingBudgetTendencyValue,
  type WeddingGuestCountValue,
  type WeddingPriorityValue,
  type WeddingStyleValue,
} from "@hanbang/shared";

// 웨딩 스타일 선호도 타입
export type WeddingStyle = WeddingStyleValue;
export type PriorityItem = WeddingPriorityValue;
export type BudgetTendency = WeddingBudgetTendencyValue;
export type GuestCount = WeddingGuestCountValue;

export interface WeddingPreferences {
  weddingStyle: WeddingStyle | null;
  priorities: PriorityItem[];
  budgetTendency: BudgetTendency | null;
  guestCount: GuestCount | null;
}

export interface OnboardingState {
  currentStep: number;
  totalSteps: 5;
  role: UserRole | null;
  coupleAction: "create" | "join" | null;
  inviteCode: string;
  partnerInviteCode: string;
  weddingDate: string | null;
  weddingDateUndecided: boolean;
  venue: string | null;
  venueUndecided: boolean;
  approximateBudget: number | null;
  preferences: WeddingPreferences;
  progressChecklist: ProgressChecklistItem[];
}

/** 상태 어휘의 정본도 @hanbang/shared다 — 웹 3상태 / 앱 4상태로 갈라져 있던 것을 합쳤다. */
export type ChecklistStatus = PreparationProgressStatus;

export interface ProgressChecklistItem {
  key: string;
  label: string;
  status: ChecklistStatus;
  cost?: number;
}

export const ONBOARDING_STEPS = [
  { step: 1, title: "역할 선택", description: "신랑/신부 중 선택해주세요" },
  { step: 2, title: "파트너 연결", description: "함께 준비할 사람과 연결하세요" },
  { step: 3, title: "결혼 정보", description: "알고 있는 정보만 입력하세요" },
  { step: 4, title: "결혼식 선호", description: "원하는 방향을 알려주세요" },
  { step: 5, title: "준비 현황", description: "현재 준비 상태를 알려주세요" },
] as const;

// 19항목의 정본은 @hanbang/shared로 옮겼다. 여기 따로 적어 두면 앱이 자기 나름대로
// 목록을 조립하게 되고, 카테고리가 하나 늘어난 날 앱 온보딩이 통째로 400을 맞는다
// (서버는 모르는 키가 하나만 섞여도 요청 전체를 거절한다).
export const PROGRESS_CHECKLIST_ITEMS: ProgressChecklistItem[] =
  createPreparationProgressItems();
