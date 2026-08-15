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
