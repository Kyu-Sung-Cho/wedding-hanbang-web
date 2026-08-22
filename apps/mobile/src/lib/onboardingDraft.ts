/**
 * 온보딩 도중 앱이 내려가도 적은 것이 남아 있게 한다.
 *
 * ## 왜 필요한가
 *
 * 모바일 온보딩 6단계는 전부 화면 안의 useState였다. 절반쯤 걷다 전화를 받거나 OS가 앱을
 * 회수하면 역할·날짜·식장·예산·취향·단계·19항목이 통째로 사라지고 1단계부터 다시였다.
 * 웹은 같은 데이터를 sessionStorage에 두고 새로고침을 견딘다 — 두 플랫폼이 같은 화면을
 * 두고 한쪽만 견디면 안 된다.
 *
 * ## 초대 코드는 저장하지 않는다
 *
 * 초대 코드는 커플 공간의 열쇠다. 기기에 남겨두면 앱을 넘겨받은 다음 사람이 남의 커플에
 * 합류하려 시도할 수 있고, 링크로 받은 코드는 이미 `pendingCoupleInvite`가 **한 번만**
 * 쓰이도록 따로 들고 있다. 웹도 같은 이유로 partialize에서 빼고, 읽는 쪽에서 한 번 더
 * 버린다 — 여기서도 타입에 없고 파싱에서도 버린다.
 *
 * ## 왜 실패가 조용한가
 *
 * 이 저장은 편의 장치다. 저장소가 막힌 기기에서 초안을 못 적었다고 온보딩이 멈추면,
 * 얻는 것 없이 가입 자체를 잃는다. 그래서 모든 실패는 삼키고 "초안이 없다"로 떨어진다.
 */

import {
  PREPARATION_PROGRESS_CATEGORY_KEYS,
  PREPARATION_STAGE_VALUES,
  WEDDING_BUDGET_TENDENCY_OPTIONS,
  WEDDING_GUEST_COUNT_OPTIONS,
  WEDDING_PRIORITY_OPTIONS,
  WEDDING_STYLE_OPTIONS,
  isPreparationProgressStatus,
  type PreparationProgressCategoryKey,
  type PreparationProgressStatus,
  type PreparationStageValue,
  type WeddingBudgetTendencyValue,
  type WeddingGuestCountValue,
  type WeddingPriorityValue,
  type WeddingStyleValue,
} from "@hanbang/shared";

export const ONBOARDING_DRAFT_KEY = "@hanbang/onboarding_draft";

/**
 * 이보다 오래된 초안은 없는 것으로 본다.
 *
 * 몇 달 전에 하다 만 입력을 아무 설명 없이 되살리면, 사람은 자기가 적은 적 없는 예산과
 * 식장을 보게 된다. 웹은 탭을 닫으면 사라지는 sessionStorage라 이 문제가 없다.
 */
export const ONBOARDING_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 되살릴 수 있는 마지막 단계.
 *
 * 6단계는 서버가 방금 발급한 초대 코드를 보여주는 완료 화면이라, 코드 없이 그 화면으로
 * 되돌아가면 빈 카드만 남는다. 저장도 복원도 5단계까지만 한다.
 */
export const ONBOARDING_DRAFT_LAST_RESUMABLE_STEP = 5;

/** 자유 입력이 통째로 되살아나지 않도록 화면의 maxLength와 같은 상한을 둔다. */
const MAX_WEDDING_DATE_LENGTH = 10;
const MAX_VENUE_LENGTH = 120;
const MAX_BUDGET_LENGTH = 12;

export type OnboardingDraftRole = "bride" | "groom";
export type OnboardingDraftCoupleAction = "create" | "join";
export type OnboardingDraftStagePhase = "stage" | "detail";

export interface OnboardingDraft {
  step: number;
  role: OnboardingDraftRole | null;
  coupleAction: OnboardingDraftCoupleAction;
  weddingDate: string;
  weddingDateUndecided: boolean;
  venue: string;
  budget: string;
  weddingStyle: WeddingStyleValue | null;
  priorities: WeddingPriorityValue[];
  budgetTendency: WeddingBudgetTendencyValue | null;
  guestCount: WeddingGuestCountValue | null;
  preparationStage: PreparationStageValue | null;
  categoryStatuses: Partial<
    Record<PreparationProgressCategoryKey, PreparationProgressStatus>
  >;
  stagePhase: OnboardingDraftStagePhase;
}

/** AsyncStorage와 같은 모양. 이 모듈은 저장소를 직접 import하지 않는다. */
export interface OnboardingDraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

function readMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

const STYLE_VALUES = WEDDING_STYLE_OPTIONS.map((option) => option.value);
const PRIORITY_VALUES = WEDDING_PRIORITY_OPTIONS.map((option) => option.value);
const BUDGET_TENDENCY_VALUES = WEDDING_BUDGET_TENDENCY_OPTIONS.map(
  (option) => option.value,
);
const GUEST_COUNT_VALUES = WEDDING_GUEST_COUNT_OPTIONS.map(
  (option) => option.value,
);

/**
 * 저장할 모양으로 다듬는다. 화면 상태를 그대로 넘겨도 여기서 아는 값만 남는다.
 *
 * 초대 코드는 인자에도 없다 — 넘길 자리가 없어야 실수로 넘어가지 않는다.
 */
export function normalizeOnboardingDraft(
  input: Readonly<Partial<OnboardingDraft>>,
): OnboardingDraft {
  const rawStep = typeof input.step === "number" && Number.isFinite(input.step)
    ? Math.trunc(input.step)
    : 1;
  const categoryStatuses: Partial<
    Record<PreparationProgressCategoryKey, PreparationProgressStatus>
  > = {};
  const rawStatuses = input.categoryStatuses;
  if (rawStatuses && typeof rawStatuses === "object") {
    for (const key of PREPARATION_PROGRESS_CATEGORY_KEYS) {
      const status = (rawStatuses as Record<string, unknown>)[key];
      // 19항목의 키와 상태 어휘는 정본이 따로 있다. 모르는 키나 상태가 초안으로
      // 되살아나면 서버가 온보딩 요청 전체를 거절한다.
      if (isPreparationProgressStatus(status)) categoryStatuses[key] = status;
    }
  }

  return {
    step: Math.min(Math.max(rawStep, 1), ONBOARDING_DRAFT_LAST_RESUMABLE_STEP),
    role: readMember(input.role, ["bride", "groom"] as const),
    coupleAction:
      readMember(input.coupleAction, ["create", "join"] as const) ?? "create",
    weddingDate: readText(input.weddingDate, MAX_WEDDING_DATE_LENGTH),
    weddingDateUndecided: input.weddingDateUndecided === true,
    venue: readText(input.venue, MAX_VENUE_LENGTH),
    budget: readText(input.budget, MAX_BUDGET_LENGTH),
    weddingStyle: readMember(input.weddingStyle, STYLE_VALUES),
    // 화면의 토글은 같은 항목을 두 번 담지 않고 셋을 넘기지도 않는다. 초안이 그 규칙을
    // 우회하면, 되살아난 화면에서 사용자가 만들 수 없는 상태가 서버로 간다.
    priorities: Array.isArray(input.priorities)
      ? [
        ...new Set(
          input.priorities
            .map((item) => readMember(item, PRIORITY_VALUES))
            .filter((item): item is WeddingPriorityValue => item !== null),
        ),
      ].slice(0, 3)
      : [],
    budgetTendency: readMember(input.budgetTendency, BUDGET_TENDENCY_VALUES),
    guestCount: readMember(input.guestCount, GUEST_COUNT_VALUES),
    preparationStage: readMember(input.preparationStage, PREPARATION_STAGE_VALUES),
    categoryStatuses,
    stagePhase:
      readMember(input.stagePhase, ["stage", "detail"] as const) ?? "stage",
  };
}

/**
 * 저장된 문자열을 초안으로 되돌린다. 형식이 아니거나 오래됐으면 null.
 *
 * 이 값은 기기에서 왔지만 앱 밖에서 온 문자열과 똑같이 다룬다 — 다른 판의 앱이 남긴 값도,
 * 손으로 고쳐진 값도 여기로 들어온다.
 */
export function parseOnboardingDraft(
  raw: unknown,
  now: number = Date.now(),
): OnboardingDraft | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const savedAt = record.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  // 기기 시계가 뒤로 돌아가 저장 시각이 미래로 잡히면 영영 만료되지 않는다.
  if (savedAt > now) return null;
  if (now - savedAt > ONBOARDING_DRAFT_MAX_AGE_MS) return null;

  const draft = record.draft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return null;
  return normalizeOnboardingDraft(draft as Partial<OnboardingDraft>);
}

export function serializeOnboardingDraft(
  draft: Readonly<Partial<OnboardingDraft>>,
  now: number = Date.now(),
): string {
  return JSON.stringify({ savedAt: now, draft: normalizeOnboardingDraft(draft) });
}

export async function saveOnboardingDraft(
  storage: OnboardingDraftStorage | null,
  draft: Readonly<Partial<OnboardingDraft>>,
  now: number = Date.now(),
): Promise<void> {
  if (!storage) return;
  try {
    await storage.setItem(ONBOARDING_DRAFT_KEY, serializeOnboardingDraft(draft, now));
  } catch {
    // 저장 실패가 온보딩을 막지 않는다. 못 적었을 뿐 화면은 그대로 걸어간다.
  }
}

export async function loadOnboardingDraft(
  storage: OnboardingDraftStorage | null,
  now: number = Date.now(),
): Promise<OnboardingDraft | null> {
  if (!storage) return null;
  try {
    return parseOnboardingDraft(await storage.getItem(ONBOARDING_DRAFT_KEY), now);
  } catch {
    return null;
  }
}

/** 온보딩을 마쳤으면 지운다. 서버에 저장된 뒤에도 기기에 남아 있을 이유가 없다. */
export async function clearOnboardingDraft(
  storage: OnboardingDraftStorage | null,
): Promise<void> {
  if (!storage) return;
  try {
    await storage.removeItem(ONBOARDING_DRAFT_KEY);
  } catch {
    // 지우지 못해도 만료(7일)가 뒤를 받친다.
  }
}
