import {
  describeCoupleInviteCodeProblem,
  normalizeCoupleInviteCode,
} from "@hanbang/shared";

import { getAuthRedirectPath } from "@/lib/auth/safeRedirect";

type NeutralPreparationSpaceSubmission = Readonly<{
  membershipMode: "neutral_preparation_space";
  coupleAction: "create" | "join";
  partnerInviteCode?: string;
  weddingDate: null;
  venue: null;
  totalBudget: null;
  progress: Readonly<Record<string, never>>;
}>;

export function parseNeutralPreparationSpaceCapability(
  value: unknown,
): boolean {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>).neutralPreparationSpace === true;
}

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

export function resolveNeutralPreparationSpaceRedirect(input: {
  search: string;
  origin: string;
}): string {
  const requested = new URLSearchParams(input.search).get("redirect");
  if (requested === null) {
    return "/wedding/chat?source=neutral_onboarding";
  }
  const resolved = getAuthRedirectPath(input.search, input.origin);
  if (resolved === "/wedding/lounge" && requested !== "/wedding/lounge") {
    return "/wedding/chat?source=neutral_onboarding";
  }
  return resolved;
}
