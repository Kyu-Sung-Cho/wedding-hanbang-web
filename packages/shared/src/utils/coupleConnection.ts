export type CoupleConnectionPhase =
  | "awaiting_partner"
  | "linked"
  | "sealed_single"
  | "unavailable";

export type CoupleConnectionState = {
  phase: CoupleConnectionPhase;
  inviteCode: string | null;
  canInvite: boolean;
};

export type CoupleConnectionContext = {
  partnerPresent?: boolean;
  membershipSealedAt?: unknown;
};

const INVITE_CODE_PATTERN = /^WH-[A-Z0-9]{6,12}$/;

const UNAVAILABLE: CoupleConnectionState = {
  phase: "unavailable",
  inviteCode: null,
  canInvite: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyStoredSeal(value: unknown): "unsealed" | "sealed" | "invalid" {
  if (value === undefined || value === null) return "unsealed";
  if (typeof value === "string" && value.trim().length > 0) return "sealed";
  return "invalid";
}

/**
 * Normalizes the privileged couple-code API into mutually exclusive UI states.
 * Unknown or contradictory payloads fail closed so no retained invite code is
 * shown after the first roster epoch has been sealed.
 */
export function resolveCoupleConnectionState(
  payload: unknown,
  context: CoupleConnectionContext = {},
): CoupleConnectionState {
  if (context.partnerPresent === true) {
    return { phase: "linked", inviteCode: null, canInvite: false };
  }

  const storedSeal = classifyStoredSeal(context.membershipSealedAt);
  if (storedSeal === "sealed") {
    return { phase: "sealed_single", inviteCode: null, canInvite: false };
  }
  if (storedSeal === "invalid") return UNAVAILABLE;

  if (!isRecord(payload)
      || typeof payload.isFullyLinked !== "boolean"
      || typeof payload.isMembershipSealed !== "boolean") {
    return UNAVAILABLE;
  }

  if (payload.isFullyLinked) {
    return { phase: "linked", inviteCode: null, canInvite: false };
  }

  if (payload.isMembershipSealed) {
    return { phase: "sealed_single", inviteCode: null, canInvite: false };
  }

  if (typeof payload.inviteCode === "string"
      && INVITE_CODE_PATTERN.test(payload.inviteCode)) {
    return {
      phase: "awaiting_partner",
      inviteCode: payload.inviteCode,
      canInvite: true,
    };
  }

  return UNAVAILABLE;
}
