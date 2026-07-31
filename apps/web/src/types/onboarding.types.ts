import type { UserRole } from "./database.types";
import { PLANNING_CATEGORY_LABELS } from "@/constants/planningCategories";
import type {
  WeddingBudgetTendencyValue,
  WeddingGuestCountValue,
  WeddingPriorityValue,
  WeddingStyleValue,
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

export type ChecklistStatus = "not_started" | "in_progress" | "completed" | "not_applicable";

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

const PROGRESS_CATEGORY_KEYS = [
  "meeting",
  "venue",
  "studio",
  "dress",
  "makeup",
  "ring",
  "hanbok",
  "yedan",
  "honeymoon",
  "houseware",
  "housing",
  "invitation",
  "snap",
  "shoes",
  "bouquet",
  "gift",
  "mc",
  "ham",
  "pyebaek",
] as const;

export const PROGRESS_CHECKLIST_ITEMS: ProgressChecklistItem[] =
  PROGRESS_CATEGORY_KEYS.map((key) => ({
    key,
    label: PLANNING_CATEGORY_LABELS[key],
    status: "not_started",
  }));
