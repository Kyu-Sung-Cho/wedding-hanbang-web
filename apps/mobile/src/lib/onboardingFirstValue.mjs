import { parseAmoraPreparationCatchUpDraftSubmission } from "@hanbang/shared/amora-preparation-catch-up";

/**
 * 온보딩에서 사람이 처음 입력하는 값들을, 서버에 보내기 전에 이 기기에서 먼저
 * 판정한다.
 *
 * 날짜와 준비 현황은 둘 다 "틀리면 나중에 알게 되는" 값이었다. 날짜는 자유 텍스트라
 * 마지막 화면에서 제출한 뒤에야 서버가 400을 돌려줬고, 그때는 무엇이 틀렸는지
 * 화면에 남아 있지 않았다. 준비 현황은 반대로 너무 쉽게 저장될 수 있었다 —
 * 단계별 제안값을 그대로 보내면 사용자가 확인한 적 없는 "완료"가 기록된다.
 *
 * 그래서 UI가 아니라 여기서 두 가지를 정한다. ①입력이 실제 날짜인가 ②서버로
 * 보낼 자격이 있는 값은 무엇인가. 화면 코드에서 분리해 둔 이유는 이 판정이
 * 렌더링 없이 테스트되어야 하기 때문이다.
 */

const DIGITS_ONLY = /[^0-9]/g;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

/**
 * 숫자만 받아 `YYYY-MM-DD` 모양으로 되돌린다.
 *
 * 네이티브 날짜 피커를 쓰지 않기로 했기 때문에(새 빌드를 강제한다) 사람이 직접
 * 친다. 하이픈을 사람에게 맡기면 "2026/10/15", "2026.10.15"가 섞여 들어오므로
 * 하이픈은 이쪽이 넣는다. 뒤에 숫자가 없을 때는 하이픈을 붙이지 않는다 —
 * 지우는 도중에 하이픈이 살아남으면 지워지지 않는 것처럼 보인다.
 */
export function formatWeddingDateInput(raw) {
  const digits = String(raw ?? "").replace(DIGITS_ONLY, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/**
 * 화면에 그대로 붙일 수 있는 판정 결과를 돌려준다.
 *
 * `message`는 어떤 상태에서도 비어 있지 않다. "다음"이 막혔는데 이유가 없으면
 * 사람은 앱이 고장 났다고 생각하고, 실제로 그 자리에서 이탈한다.
 */
export function evaluateWeddingDateInput(value) {
  const text = String(value ?? "").trim();
  if (text === "") {
    return {
      status: "empty",
      requestDate: null,
      message: "숫자만 입력하면 하이픈은 자동으로 들어가요. 예: 20261015",
    };
  }

  const digits = text.replace(DIGITS_ONLY, "");
  if (digits.length < 8) {
    return {
      status: "incomplete",
      requestDate: null,
      message: "연도 4자리, 월 2자리, 일 2자리를 모두 입력해주세요. 예: 20261015",
    };
  }

  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));

  if (month < 1 || month > 12) {
    return {
      status: "invalid",
      requestDate: null,
      message: "월은 01~12 사이여야 해요. 입력한 월을 다시 확인해주세요.",
    };
  }
  const lastDay = daysInMonth(year, month);
  if (day < 1 || day > lastDay) {
    return {
      status: "invalid",
      requestDate: null,
      // 2월 30일처럼 "그 달에는 없는 날"인지 사람이 바로 알 수 있게 마지막 날을 함께 말한다.
      message: `${year}년 ${month}월은 ${lastDay}일까지예요. 날짜를 다시 확인해주세요.`,
    };
  }
  // 서버(validDate)와 같은 왕복 검증. 연도가 0026처럼 두 자리로 접히는 입력을 여기서 걸러
  // 제출 뒤 400을 받는 대신 이 화면에서 알게 한다.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    return {
      status: "invalid",
      requestDate: null,
      message: "연도를 다시 확인해주세요. 예: 20261015",
    };
  }

  const requestDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    status: "valid",
    requestDate,
    message: `${year}년 ${month}월 ${day}일로 저장돼요.`,
  };
}

/**
 * `couples.progress`로 보낼 값을 조립한다.
 *
 * 규칙은 하나다 — **사용자가 화면에서 확인한 것만 넣는다.** 준비 단계 선택지에
 * 붙은 제안값(suggested)은 19항목 화면의 초깃값일 뿐이라, 그 화면을 보지 않고
 * 넘어간 사람의 항목은 `categoryStatuses`로 들어오지 않고 따라서 저장되지 않는다.
 *
 * `not_started`도 보내지 않는다. 아직 시작하지 않았다는 건 새로 생긴 사실이
 * 아니라 기본 상태이고, 파트너가 이미 채워 둔 항목을 이쪽 기본값으로 덮을
 * 이유가 없다.
 */
export function buildOnboardingProgress({
  stage = null,
  preferences,
  categoryStatuses = null,
} = {}) {
  const progress = { __preferences: preferences };
  if (typeof stage === "string" && stage !== "") {
    progress.__stage = stage;
  }
  if (categoryStatuses) {
    for (const [key, status] of Object.entries(categoryStatuses)) {
      if (typeof status !== "string" || status === "not_started") continue;
      progress[key] = { status };
    }
  }
  return progress;
}


export function getOnboardingCoupleStepActions() {
  return {
    primary: {
      intent: "quick_start",
      label: "아모라와 지금 시작하기",
      accessibilityHint:
        "예식일·장소·예산·취향은 나중에 채우고, 나만 상담에서 지금 상황부터 정리합니다.",
    },
    secondary: {
      intent: "continue_details",
      label: "정보를 먼저 입력할게요",
    },
  };
}

export function buildOnboardingSubmissionPayload(input, mode = "detailed") {
  if (mode !== "detailed" && mode !== "quick_start") {
    throw new Error("Unsupported onboarding submission mode");
  }

  const requiredPayload = {
    role: input.role,
    coupleAction: input.coupleAction,
    partnerInviteCode: input.coupleAction === "join" ? input.inviteCode : undefined,
  };

  // 빠른 시작은 이전 화면으로 돌아오기 전에 적었던 선택 초안도 보내지 않는다.
  // 특히 join 경로에서 보이지 않는 개인 입력이 파트너의 정본 계획에 섞이면 안 된다.
  if (mode === "quick_start") {
    return {
      ...requiredPayload,
      weddingDate: null,
      venue: null,
      totalBudget: null,
      progress: {},
    };
  }

  return {
    ...requiredPayload,
    weddingDate: input.weddingDateUndecided ? null : input.weddingDate || null,
    venue: input.venue || null,
    totalBudget: input.totalBudget,
    progress: {
      __preferences: {
        weddingStyle: input.weddingStyle,
        priorities: input.priorities,
        budgetTendency: input.budgetTendency,
        guestCount: input.guestCount,
      },
    },
  };
}

const NEUTRAL_PREPARATION_STAGES = new Set([
  "starting",
  "already_preparing",
  "unknown",
  "later",
]);
const COUPLE_INVITE_CODE_PATTERN = /^WH-[A-Z0-9]{6,12}$/u;

export function buildNeutralPreparationSpaceSubmissionPayload({
  coupleAction,
  inviteCode,
  preparationCatchUp,
  // 공유 구현이 만든 본문. 날짜 검증과 관심사 매핑은 shared 한 곳에만 둔다.
  // 넘기지 않으면 반환값은 예전과 한 글자도 다르지 않다.
  base = null,
}) {
  if (coupleAction !== "create" && coupleAction !== "join") {
    throw new Error("Unsupported neutral preparation space action");
  }
  const normalizedInviteCode = typeof inviteCode === "string"
    ? inviteCode.trim().toUpperCase()
    : "";
  if (
    coupleAction === "join"
    && !COUPLE_INVITE_CODE_PATTERN.test(normalizedInviteCode)
  ) {
    throw new Error("Invalid neutral preparation space invite code");
  }
  const parsedCatchUp = preparationCatchUp === undefined
    ? null
    : parseAmoraPreparationCatchUpDraftSubmission(preparationCatchUp);
  if (preparationCatchUp !== undefined && parsedCatchUp === null) {
    throw new Error("Invalid preparation catch-up");
  }

  return {
    membershipMode: "neutral_preparation_space",
    coupleAction,
    ...(coupleAction === "join"
      ? { partnerInviteCode: normalizedInviteCode }
      : {}),
    weddingDate: base ? base.weddingDate ?? null : null,
    venue: null,
    totalBudget: null,
    progress: base ? base.progress ?? {} : {},
    ...(parsedCatchUp === null ? {} : { preparationCatchUp: parsedCatchUp }),
  };
}

export function resolveNeutralPreparationSpaceCompletion({ foundationStage }) {
  if (!NEUTRAL_PREPARATION_STAGES.has(foundationStage)) {
    throw new Error("Unsupported planning foundation stage");
  }
  return {
    kind: "route",
    pathname: "/(tabs)/chat",
    params: {
      entry: "first_use",
      foundationStage,
    },
  };
}

export function resolveOnboardingCompletion({ mode, coupleAction, inviteCode }) {
  if (mode === "quick_start") {
    return {
      kind: "route",
      pathname: "/(tabs)/chat",
      params: { entry: "first_use" },
    };
  }

  if (mode === "detailed" && coupleAction === "create" && inviteCode) {
    return { kind: "invite_code", inviteCode };
  }

  return { kind: "route", pathname: "/(tabs)/dashboard" };
}
