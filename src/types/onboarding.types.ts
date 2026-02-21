import type { UserRole } from "./database.types";

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
  progressChecklist: ProgressChecklistItem[];
}

export interface ProgressChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

export const ONBOARDING_STEPS = [
  { step: 1, title: "역할 선택", description: "신랑/신부 중 선택해주세요" },
  { step: 2, title: "커플 연동", description: "파트너와 연결하세요" },
  { step: 3, title: "웨딩 정보", description: "결혼식 기본 정보를 입력하세요" },
  { step: 4, title: "준비 현황", description: "현재 준비 상태를 알려주세요" },
] as const;

export const PROGRESS_CHECKLIST_ITEMS: ProgressChecklistItem[] = [
  { key: "meeting", label: "상견례", done: false },
  { key: "venue", label: "예식장", done: false },
  { key: "studio", label: "스튜디오", done: false },
  { key: "dress", label: "드레스/턱시도", done: false },
  { key: "makeup", label: "메이크업", done: false },
  { key: "ring", label: "예물(반지)", done: false },
  { key: "hanbok", label: "한복", done: false },
  { key: "yedan", label: "예단", done: false },
  { key: "honeymoon", label: "신혼여행", done: false },
  { key: "houseware", label: "혼수(가전/가구)", done: false },
  { key: "housing", label: "신혼집", done: false },
  { key: "invitation", label: "청첩장", done: false },
  { key: "snap", label: "본식스냅/영상", done: false },
  { key: "shoes", label: "웨딩구두", done: false },
  { key: "bouquet", label: "부케/꽃장식", done: false },
  { key: "gift", label: "답례품", done: false },
  { key: "mc", label: "사회/축가", done: false },
  { key: "ham", label: "함", done: false },
  { key: "pyebaek", label: "폐백", done: false },
];
