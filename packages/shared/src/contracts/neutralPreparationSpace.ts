// 중립 준비 공간 — 온보딩에서 신부/신랑 역할을 묻지 않고 시작하는 경로.
//
// 웹과 모바일이 각자 구현하면 한쪽만 고쳐지고 다른 쪽이 성별을 계속 묻는다.
// 실제로 그런 상태가 있었다(웹만 중립, 모바일은 5단계 역할 강제). 그래서
// 판정과 요청 본문 조립을 여기 한 곳에 둔다.
//
// ## 무엇을 받고 무엇을 안 받나
//
// 운영 실측(52건)과 코드 소비처를 대조해 정했다.
//
// - 예식일 87% 응답. 없으면 가드레일 엔진 전체(lifecycle.ts의 D-day 블록),
//   알림 템플릿 15개, "이번 주 할 일"이 통째로 비고, 라운지 상단이 "날짜를
//   먼저 입력해 주세요"로 덮인다. 그런데 아모라가 대신 받아낼 수 없다 —
//   먼저 묻지 않도록 프롬프트가 막고 있고, 도구 게이트가 "내년 5월 20일에
//   결혼해" 같은 자족 확정문만 통과시킨다. **그래서 여기서 받는다.**
// - 장소 17%: 소비처가 표시 문자열뿐이고 이 화면의 유일한 자유 타이핑이었다.
// - 예산 44%: 빈 값이 아무 화면도 깨지 않고, 아모라가 대화로 받아낼 수 있다.
// - 스타일·성향·인원 10%: 소비처가 프롬프트 한 줄씩, 판정 0건.
//
// 셋 다 여기서 묻지 않는다. 값은 계속 null 로 보낸다.
import {
  describeCoupleInviteCodeProblem,
  normalizeCoupleInviteCode,
} from "./coupleInviteCode";
import type { WeddingPriorityValue } from "../constants/weddingPreferences";
import { WEDDING_PRIORITY_OPTIONS } from "../constants/weddingPreferences";

export type NeutralPreparationSpaceSubmission = Readonly<{
  membershipMode: "neutral_preparation_space";
  coupleAction: "create" | "join";
  partnerInviteCode?: string;
  /** 사용자가 고른 예식일. 고르지 않았으면 null 이고, 그 사실은 저장하지 않는다. */
  weddingDate: string | null;
  venue: null;
  totalBudget: null;
  progress: Readonly<Record<string, unknown>>;
}>;

/** 서버(api/onboarding)와 같은 규칙. 정규식을 화면에 복제하지 않는다. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * 형식이 맞고 실재하는 날짜인가. 2027-02-30 같은 값은 Date 가 조용히
 * 3월로 굴러가므로 되돌려 비교해야 잡힌다.
 */
export function isValidWeddingDateInput(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

const PRIORITY_VALUES: ReadonlySet<string> = new Set(
  WEDDING_PRIORITY_OPTIONS.map((option) => option.value),
);

export function isWeddingPriorityValue(
  value: unknown,
): value is WeddingPriorityValue {
  return typeof value === "string" && PRIORITY_VALUES.has(value);
}

/**
 * /api/auth/me 의 capabilities 를 읽는다. 플래그 판정은 서버가 하고,
 * 클라이언트는 내려온 값만 본다 — 앱이 자기 환경변수로 정하지 않는다.
 */
export function parseNeutralPreparationSpaceCapability(value: unknown): boolean {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>).neutralPreparationSpace === true;
}

/**
 * 중립 경로의 /api/onboarding 요청 본문.
 *
 * 날짜가 형식에 안 맞으면 **던지지 않고 null 로 떨어뜨린다.** 사용자는
 * 시작 버튼을 눌렀을 뿐인데 날짜 하나 때문에 가입 자체가 막히면 안 된다.
 * 날짜는 나중에 설정 화면에서 언제든 넣을 수 있다.
 */
export function buildNeutralPreparationSpaceSubmission(input: {
  coupleAction: "create" | "join";
  partnerInviteCode: string;
  weddingDate?: string | null;
  focusPriority?: WeddingPriorityValue | null;
}): NeutralPreparationSpaceSubmission {
  const weddingDate =
    typeof input.weddingDate === "string" && isValidWeddingDateInput(input.weddingDate)
      ? input.weddingDate
      : null;

  // 고른 관심사는 progress.__preferences.priorities 로 간다 — 이미 서버가
  // 받는 자리이고 아모라 프롬프트가 "먼저 챙길 범위"로 읽는다.
  const progress: Record<string, unknown> = isWeddingPriorityValue(input.focusPriority)
    ? { __preferences: { priorities: [input.focusPriority] } }
    : {};

  if (input.coupleAction === "create") {
    return {
      membershipMode: "neutral_preparation_space",
      coupleAction: "create",
      weddingDate,
      venue: null,
      totalBudget: null,
      progress,
    };
  }

  const partnerInviteCode = normalizeCoupleInviteCode(input.partnerInviteCode);
  if (describeCoupleInviteCodeProblem(partnerInviteCode) !== null) {
    throw new Error("INVALID_NEUTRAL_PREPARATION_INVITE_CODE");
  }
  return {
    membershipMode: "neutral_preparation_space",
    coupleAction: "join",
    partnerInviteCode,
    weddingDate,
    venue: null,
    totalBudget: null,
    progress,
  };
}

/**
 * 첫 대화 입력창에 채울 초안.
 *
 * 저장이 아니라 **초안**이다. 사용자가 보내기를 눌러야 나가므로 "확인한 것만
 * 저장" 원칙을 지키고, 동시에 사용자 발화가 되어 아모라의 첫 턴 범위
 * (W3_social_care — 저장된 정보를 먼저 꺼내지 못함)를 벗어난다. 관심사를
 * 저장만 하면 첫 턴에서 아무 일도 일어나지 않는 이유가 그것이다.
 *
 * **날짜는 넣지 않는다.** 넣으면 방금 저장한 값의 확인 카드가 또 뜬다.
 */
export function buildNeutralPreparationPrefill(input: {
  weddingDate: string | null;
  focusPriority?: WeddingPriorityValue | null;
}): string | null {
  const option = isWeddingPriorityValue(input.focusPriority)
    ? WEDDING_PRIORITY_OPTIONS.find((entry) => entry.value === input.focusPriority)
    : undefined;

  if (option && input.weddingDate) {
    return `${option.label}부터 먼저 정리하고 싶어요. 이번 주에 할 한 가지만 골라주세요.`;
  }
  if (option) {
    return `결혼식 날짜를 아직 못 정했어요. ${option.label}도 신경 쓰이는데, 뭐부터 정하면 좋을까요?`;
  }
  if (input.weddingDate) {
    return "이번 주에 할 한 가지만 골라주세요.";
  }
  return null;
}
