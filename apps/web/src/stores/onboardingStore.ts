"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  findPreparationStageOption,
  type PlanningCategoryKey,
  type PreparationStageValue,
} from "@hanbang/shared";
import type { UserRole } from "@/types/database.types";
import {
  PROGRESS_CHECKLIST_ITEMS,
  type ProgressChecklistItem,
  type ChecklistStatus,
  type WeddingPreferences,
  type WeddingStyle,
  type PriorityItem,
  type BudgetTendency,
  type GuestCount,
} from "@/types/onboarding.types";

interface OnboardingStoreState {
  ownerUserId: string | null;
  currentStep: number;
  role: UserRole | null;
  coupleAction: "create" | "join" | null;
  inviteCode: string;
  partnerInviteCode: string;
  weddingDate: string | null;
  weddingDateUndecided: boolean;
  venue: string | null;
  venueUndecided: boolean;
  sanggyeonryeDate: string | null;
  sanggyeonryeUndecided: boolean;
  approximateBudget: number;
  preferences: WeddingPreferences;
  preparationStage: PreparationStageValue | null;
  progressChecklist: ProgressChecklistItem[];

  setStep: (step: number) => void;
  bindOwner: (userId: string) => void;
  clearOwner: () => void;
  nextStep: () => void;
  prevStep: () => void;
  setRole: (role: UserRole) => void;
  setCoupleAction: (action: "create" | "join") => void;
  setInviteCode: (code: string) => void;
  setPartnerInviteCode: (code: string) => void;
  setWeddingDate: (date: string | null) => void;
  setWeddingDateUndecided: (value: boolean) => void;
  setVenue: (venue: string | null) => void;
  setVenueUndecided: (value: boolean) => void;
  setSanggyeonryeDate: (date: string | null) => void;
  setSanggyeonryeUndecided: (value: boolean) => void;
  setBudget: (budget: number) => void;
  setWeddingStyle: (style: WeddingStyle) => void;
  togglePriority: (item: PriorityItem) => void;
  setBudgetTendency: (tendency: BudgetTendency) => void;
  setGuestCount: (count: GuestCount) => void;
  setPreparationStage: (stage: PreparationStageValue) => void;
  setChecklistItemStatus: (key: string, status: ChecklistStatus) => void;
  setChecklistItemCost: (key: string, cost: number | undefined) => void;
  setChecklist: (items: ProgressChecklistItem[]) => void;
  reset: () => void;
}

const initialPreferences: WeddingPreferences = {
  weddingStyle: null,
  priorities: [],
  budgetTendency: null,
  guestCount: null,
};

const freshChecklist = (): ProgressChecklistItem[] =>
  PROGRESS_CHECKLIST_ITEMS.map((item) => ({ ...item }));

/**
 * 고른 준비 단계의 제안값으로 19항목 화면을 미리 채운다.
 *
 * 여기서 만든 상태는 **화면에 보여줄 초깃값**이지 저장 대상이 아니다. 사용자가
 * 그 화면을 보고 저장을 눌러야만 서버로 간다 — 건너뛰면 단계만 저장한다.
 * 직접 말하지 않은 것을 준비 완료 사실로 만들지 않기 위해서다.
 *
 * 매번 기본 목록에서 다시 만든다. 무거운 단계에서 가벼운 단계로 바꿨을 때 앞
 * 단계의 제안이 남아 있으면, 사용자는 고른 적 없는 상태를 자기가 고른 것처럼
 * 보게 된다.
 */
function checklistWithStageSuggestion(
  stage: PreparationStageValue | null,
): ProgressChecklistItem[] {
  const suggested = findPreparationStageOption(stage)?.suggested ?? {};
  return PROGRESS_CHECKLIST_ITEMS.map((item) => {
    const status = suggested[item.key as PlanningCategoryKey];
    return status ? { ...item, status } : { ...item };
  });
}

const initialState = {
  ownerUserId: null as string | null,
  currentStep: 1,
  role: null as UserRole | null,
  coupleAction: null as "create" | "join" | null,
  inviteCode: "",
  partnerInviteCode: "",
  weddingDate: null as string | null,
  weddingDateUndecided: false,
  venue: null as string | null,
  venueUndecided: false,
  sanggyeonryeDate: null as string | null,
  sanggyeonryeUndecided: false,
  approximateBudget: 0,
  preferences: { ...initialPreferences },
  preparationStage: null as PreparationStageValue | null,
  progressChecklist: freshChecklist(),
};

/**
 * 저장 이름에 버전을 붙인다. 저장 모양이 바뀐 뒤에 옛 값이 그대로 살아나면
 * 사용자는 자기가 입력한 적 없는 화면을 보게 된다.
 */
export const ONBOARDING_STORAGE_KEY = "hanbang-onboarding-v1";

/**
 * 서버 렌더 중에는 `sessionStorage`가 없다. 접근하는 순간 페이지 전체가 죽으므로
 * 아무 데도 쓰지 않는 저장소를 대신 넘긴다 — 서버에서는 저장할 것도, 복원할
 * 것도 없다.
 */
const serverSideNoopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * 브라우저에 남길 필드. 빼는 목록이 아니라 담는 목록으로 적는다 — 나중에 필드가
 * 늘어나도 기본값이 "저장하지 않음"이어야 안전한 쪽으로 틀린다.
 *
 * `inviteCode`와 `partnerInviteCode`는 여기 넣지 않는다. 초대 코드는 커플 공간을
 * 여는 열쇠라, 공용 PC의 브라우저 저장소에 남으면 그 자체로 남의 준비 기록에
 * 들어갈 수 있는 값이 된다. 온보딩 중 한 번 쓰고 사라져야 한다.
 */
type PersistedOnboardingState = Pick<
  OnboardingStoreState,
  // 소유자를 함께 남긴다. 없으면 새로고침 뒤 `bindOwner`가 "주인이 바뀌었다"로 읽어
  // 방금 복원한 값을 즉시 지운다 — 저장 자체가 무의미해진다.
  | "ownerUserId"
  | "currentStep"
  | "role"
  | "coupleAction"
  | "weddingDate"
  | "weddingDateUndecided"
  | "venue"
  | "venueUndecided"
  | "sanggyeonryeDate"
  | "sanggyeonryeUndecided"
  | "approximateBudget"
  | "preferences"
  | "preparationStage"
  | "progressChecklist"
>;

export const useOnboardingStore = create<OnboardingStoreState>()(
  persist(
    (set) => ({
      ...initialState,

      setStep: (step) => set({ currentStep: step }),
      // 계정이 바뀌면 앞사람의 온보딩 입력을 그대로 두지 않는다. 저장소는 세션
      // 단위라 같은 브라우저에서 계정을 갈아타면 남의 값이 복원될 수 있다.
      bindOwner: (userId) => set((state) => (
        state.ownerUserId === userId
          ? state
          : {
              ...initialState,
              ownerUserId: userId,
              preferences: { ...initialPreferences },
              progressChecklist: freshChecklist(),
            }
      )),
      clearOwner: () => set({
        ...initialState,
        ownerUserId: null,
        preferences: { ...initialPreferences },
        progressChecklist: freshChecklist(),
      }),
      nextStep: () => set((s) => ({ currentStep: Math.min(s.currentStep + 1, 5) })),
      prevStep: () => set((s) => ({ currentStep: Math.max(s.currentStep - 1, 1) })),
      setRole: (role) => set({ role }),
      setCoupleAction: (action) => set({ coupleAction: action }),
      setInviteCode: (code) => set({ inviteCode: code }),
      setPartnerInviteCode: (code) => set({ partnerInviteCode: code }),
      setWeddingDate: (date) => set({ weddingDate: date }),
      setWeddingDateUndecided: (value) =>
        set({ weddingDateUndecided: value, weddingDate: value ? null : undefined }),
      setVenue: (venue) => set({ venue }),
      setVenueUndecided: (value) =>
        set({ venueUndecided: value, venue: value ? null : undefined }),
      setSanggyeonryeDate: (date) => set({ sanggyeonryeDate: date }),
      setSanggyeonryeUndecided: (value) =>
        set(value ? { sanggyeonryeUndecided: true, sanggyeonryeDate: null } : { sanggyeonryeUndecided: false }),
      setBudget: (budget) => set({ approximateBudget: budget }),
      setWeddingStyle: (style) =>
        set((s) => ({ preferences: { ...s.preferences, weddingStyle: style } })),
      togglePriority: (item) =>
        set((s) => {
          const current = s.preferences.priorities;
          const exists = current.includes(item);
          const updated = exists
            ? current.filter((p) => p !== item)
            : current.length < 3
              ? [...current, item]
              : current;
          return { preferences: { ...s.preferences, priorities: updated } };
        }),
      setBudgetTendency: (tendency) =>
        set((s) => ({ preferences: { ...s.preferences, budgetTendency: tendency } })),
      setGuestCount: (count) =>
        set((s) => ({ preferences: { ...s.preferences, guestCount: count } })),
      // 단계를 고르면 다음 화면의 초깃값까지 함께 바꾼다. 고른 직후에 19항목이
      // 이미 자기 상황에 가깝게 채워져 있어야, 남는 일이 확인과 수정뿐이 된다.
      //
      // 단, 같은 단계를 다시 누른 것은 아무 말도 하지 않은 것이다. 새로고침하면
      // 화면은 단계 선택으로 돌아오는데 고른 단계는 선택된 채 보이므로, 사용자가
      // 그 카드를 한 번 더 누르는 일이 실제로 일어난다. 그때 다시 채우면 19항목에
      // 직접 적어둔 손입력이 제안값으로 덮인다 — 단계가 바뀔 때만 다시 채운다.
      setPreparationStage: (stage) =>
        set((s) =>
          s.preparationStage === stage
            ? {}
            : {
                preparationStage: stage,
                progressChecklist: checklistWithStageSuggestion(stage),
              },
        ),
      setChecklistItemStatus: (key, status) =>
        set((s) => ({
          progressChecklist: s.progressChecklist.map((item) =>
            item.key === key
              ? { ...item, status, cost: status === "completed" ? item.cost : undefined }
              : item
          ),
        })),
      setChecklistItemCost: (key, cost) =>
        set((s) => ({
          progressChecklist: s.progressChecklist.map((item) =>
            item.key === key ? { ...item, cost } : item
          ),
        })),
      setChecklist: (items) => set({ progressChecklist: items }),
      reset: () => set((state) => ({
        ...initialState,
        ownerUserId: state.ownerUserId,
        preferences: { ...initialPreferences },
        progressChecklist: freshChecklist(),
      })),
    }),
    {
      name: ONBOARDING_STORAGE_KEY,
      // 결혼 준비 정보를 브라우저에 오래 남기지 않는다. 새로고침 한 번에 19항목이
      // 날아가는 것만 막으면 되고, 탭을 닫으면 함께 사라지는 편이 맞다.
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? serverSideNoopStorage : window.sessionStorage,
      ),
      // 서버 HTML은 항상 초기 상태로 그려진다. 저장값을 모듈 로드 시점에 넣으면
      // 첫 렌더가 서버와 어긋나므로, 화면이 마운트된 뒤 명시적으로 복원한다.
      skipHydration: true,
      // 쓰는 쪽만 막으면, 옛 버전이나 다른 코드가 남긴 값이 복원 경로로 들어올 수
      // 있다. 초대 코드는 읽는 쪽에서도 한 번 더 버린다.
      merge: (persisted, current) => {
        const restored: Record<string, unknown> = {
          ...(persisted as Record<string, unknown> | undefined),
        };
        delete restored.inviteCode;
        delete restored.partnerInviteCode;
        return { ...current, ...restored } as OnboardingStoreState;
      },
      partialize: (state): PersistedOnboardingState => ({
        ownerUserId: state.ownerUserId,
        currentStep: state.currentStep,
        role: state.role,
        coupleAction: state.coupleAction,
        weddingDate: state.weddingDate,
        weddingDateUndecided: state.weddingDateUndecided,
        venue: state.venue,
        venueUndecided: state.venueUndecided,
        sanggyeonryeDate: state.sanggyeonryeDate,
        sanggyeonryeUndecided: state.sanggyeonryeUndecided,
        approximateBudget: state.approximateBudget,
        preferences: state.preferences,
        preparationStage: state.preparationStage,
        progressChecklist: state.progressChecklist,
      }),
    },
  ),
);
