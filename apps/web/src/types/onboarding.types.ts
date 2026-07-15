import type { UserRole } from "./database.types";

// 웨딩 스타일 선호도 타입
export type WeddingStyle = "minimal" | "classic" | "fancy" | "natural";
export type PriorityItem = "sdm" | "venue" | "rings" | "honeymoon" | "ceremony" | "housing";
export type BudgetTendency = "saving" | "balanced" | "premium";
export type GuestCount = "under50" | "50to100" | "100to200" | "200to300" | "over300";

export interface WeddingPreferences {
  weddingStyle: WeddingStyle | null;
  priorities: PriorityItem[];
  budgetTendency: BudgetTendency | null;
  guestCount: GuestCount | null;
}

export interface OnboardingState {
  currentStep: number;
  totalSteps: 4;
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
}

export const ONBOARDING_STEPS = [
  { step: 1, title: "역할 선택", description: "신랑/신부 중 선택해주세요" },
  { step: 2, title: "커플 연동", description: "파트너와 연결하세요" },
  { step: 3, title: "웨딩 정보", description: "결혼식 기본 정보를 입력하세요" },
  { step: 4, title: "웨딩 스타일", description: "취향과 스타일을 알려주세요" },
] as const;
