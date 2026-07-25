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
  { step: 2, title: "커플 연동", description: "파트너와 연결하세요" },
  { step: 3, title: "웨딩 정보", description: "결혼식 기본 정보를 입력하세요" },
  { step: 4, title: "웨딩 스타일", description: "취향과 스타일을 알려주세요" },
  { step: 5, title: "준비 현황", description: "현재 준비 상태를 알려주세요" },
] as const;

export const PROGRESS_CHECKLIST_ITEMS: ProgressChecklistItem[] = [
  { key: "meeting", label: "상견례", status: "not_started" },
  { key: "venue", label: "예식장", status: "not_started" },
  { key: "studio", label: "스튜디오", status: "not_started" },
  { key: "dress", label: "드레스/턱시도", status: "not_started" },
  { key: "makeup", label: "메이크업", status: "not_started" },
  { key: "ring", label: "예물(반지)", status: "not_started" },
  { key: "hanbok", label: "한복", status: "not_started" },
  { key: "yedan", label: "예단", status: "not_started" },
  { key: "honeymoon", label: "신혼여행", status: "not_started" },
  { key: "houseware", label: "혼수(가전/가구)", status: "not_started" },
  { key: "housing", label: "신혼집", status: "not_started" },
  { key: "invitation", label: "청첩장", status: "not_started" },
  { key: "snap", label: "본식스냅/영상", status: "not_started" },
  { key: "shoes", label: "웨딩구두", status: "not_started" },
  { key: "bouquet", label: "부케/꽃장식", status: "not_started" },
  { key: "gift", label: "답례품", status: "not_started" },
  { key: "mc", label: "사회/축가", status: "not_started" },
  { key: "ham", label: "함", status: "not_started" },
  { key: "pyebaek", label: "폐백", status: "not_started" },
];
