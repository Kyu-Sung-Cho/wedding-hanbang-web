// 중립 준비 공간 — 온보딩에서 신부/신랑 역할을 묻지 않고 시작하는 경로.
//
// 웹과 모바일이 각자 구현하면 한쪽만 고쳐지고 다른 쪽이 성별을 계속 묻는다.
// 실제로 그런 상태가 있었다(웹만 중립, 모바일은 5단계 역할 강제). 그래서
// 판정과 요청 본문 조립을 여기 한 곳에 둔다.
import {
  describeCoupleInviteCodeProblem,
  normalizeCoupleInviteCode,
} from "./coupleInviteCode";

export type NeutralPreparationSpaceSubmission = Readonly<{
  membershipMode: "neutral_preparation_space";
  coupleAction: "create" | "join";
  partnerInviteCode?: string;
  weddingDate: null;
  venue: null;
  totalBudget: null;
  progress: Readonly<Record<string, never>>;
}>;

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
 * 중립 경로의 /api/onboarding 요청 본문. 역할·예식일·예산·스타일을 담지
 * 않는다 — 넷 다 각자의 화면에서 언제든 입력할 수 있는 값이다.
 */
export function buildNeutralPreparationSpaceSubmission(input: {
  coupleAction: "create" | "join";
  partnerInviteCode: string;
}): NeutralPreparationSpaceSubmission {
  if (input.coupleAction === "create") {
    return {
      membershipMode: "neutral_preparation_space",
      coupleAction: "create",
      weddingDate: null,
      venue: null,
      totalBudget: null,
      progress: {},
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
    weddingDate: null,
    venue: null,
    totalBudget: null,
    progress: {},
  };
}
