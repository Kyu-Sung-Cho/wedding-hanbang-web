export type CoupleRole = "bride" | "groom";
export type MembershipAction = "create" | "join";

type MembershipRpcSuccess = {
  ok: true;
  coupleId: string;
  inviteCode: string;
  changed: boolean;
  idempotent: boolean;
  role: CoupleRole;
};

type MembershipRpcFailure = {
  ok: false;
  status: number;
  message: string;
  errorCode: string;
};

export type MembershipRpcOutcome = MembershipRpcSuccess | MembershipRpcFailure;

type MembershipRpcPayload = {
  success?: unknown;
  error_code?: unknown;
  error?: unknown;
  couple_id?: unknown;
  invite_code?: unknown;
  created?: unknown;
  joined?: unknown;
  idempotent?: unknown;
  role?: unknown;
  actor_user_id?: unknown;
};

type MembershipRpcTransportError = {
  code?: string;
  message?: string;
} | null;

export type MembershipRpcTransportResponse = {
  data: unknown;
  error: MembershipRpcTransportError;
};

type MembershipRpcClient = {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<MembershipRpcTransportResponse>;
};

export const JOIN_COUPLE_SERVER_RPC = "join_couple_server";
export const COUPLE_INVITE_EXPAND_REQUIRED_CODE =
  "COUPLE_INVITE_EXPAND_REQUIRED";

export function isJoinCoupleServerRpcMissing(error: unknown): boolean {
  if (!error || typeof error !== "object" || Array.isArray(error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "PGRST202" || code === "42883";
}

export async function joinCoupleThroughServerRpc(
  client: MembershipRpcClient,
  input: {
    actorUserId: string;
    inviteCode: string;
    role: CoupleRole;
  },
): Promise<MembershipRpcTransportResponse> {
  return client.rpc(JOIN_COUPLE_SERVER_RPC, {
    p_actor_user_id: input.actorUserId,
    p_invite_code: input.inviteCode,
    p_role: input.role,
  });
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEGACY_ERROR_CODES: Record<string, string> = {
  "Unauthenticated.": "UNAUTHENTICATED",
  "Invalid role.": "INVALID_ROLE",
  "Invalid invite code.": "INVALID_INVITE_CODE",
  "Profile not found.": "PROFILE_NOT_FOUND",
  "Account membership is inconsistent.": "MEMBERSHIP_INCONSISTENT",
  "This account is already linked to another couple.": "ALREADY_LINKED_TO_ANOTHER_COUPLE",
  "Bride slot is already linked.": "BRIDE_SLOT_ALREADY_LINKED",
  "Groom slot is already linked.": "GROOM_SLOT_ALREADY_LINKED",
};

const ERROR_RESPONSES: Record<string, { status: number; message: string }> = {
  AUTH_REQUIRED: { status: 401, message: "로그인이 필요합니다." },
  UNAUTHENTICATED: { status: 401, message: "로그인이 필요합니다." },
  INVALID_ROLE: { status: 400, message: "역할 정보가 올바르지 않습니다." },
  INVALID_INVITE_CODE: {
    status: 404,
    message: "초대 코드가 올바르지 않습니다. 코드를 다시 확인해주세요.",
  },
  INVITE_CODE_EXHAUSTED: {
    status: 503,
    message: "초대 코드를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.",
  },
  PROFILE_NOT_FOUND: {
    status: 409,
    message: "프로필 준비가 완료되지 않았습니다. 잠시 후 다시 시도해주세요.",
  },
  ALREADY_LINKED_TO_ANOTHER_COUPLE: {
    status: 409,
    message: "이미 다른 커플에 연결된 계정입니다.",
  },
  ACCOUNT_ALREADY_LINKED: {
    status: 409,
    message: "이미 다른 커플에 연결된 계정입니다.",
  },
  ALREADY_LINKED: {
    status: 409,
    message: "이미 다른 커플에 연결된 계정입니다.",
  },
  MEMBERSHIP_INCONSISTENT: {
    status: 409,
    message: "커플 연결 상태를 확인할 수 없습니다. 고객 지원에 문의해주세요.",
  },
  BRIDE_SLOT_ALREADY_LINKED: {
    status: 409,
    message: "이미 신부 역할이 연결되어 있습니다.",
  },
  GROOM_SLOT_ALREADY_LINKED: {
    status: 409,
    message: "이미 신랑 역할이 연결되어 있습니다.",
  },
  SLOT_ALREADY_LINKED: {
    status: 409,
    message: "이미 해당 역할이 연결되어 있습니다.",
  },
  BRIDE_SLOT_OCCUPIED: {
    status: 409,
    message: "이미 신부 역할이 연결되어 있습니다.",
  },
  GROOM_SLOT_OCCUPIED: {
    status: 409,
    message: "이미 신랑 역할이 연결되어 있습니다.",
  },
  MEMBERSHIP_CONFLICT: {
    status: 409,
    message: "커플 연결 상태가 변경되었습니다. 다시 시도해주세요.",
  },
  ROLE_MISMATCH: {
    status: 409,
    message: "파트너가 만든 커플과 반대 역할을 선택해 주세요.",
  },
  RATE_LIMITED: {
    status: 429,
    message: "초대 코드 확인을 너무 많이 시도했어요. 잠시 후 다시 시도해 주세요.",
  },
};

function failureFor(errorCode: string): MembershipRpcFailure {
  const normalizedCode = errorCode.trim().toUpperCase();
  const response = ERROR_RESPONSES[normalizedCode];

  if (response) {
    return { ok: false, errorCode: normalizedCode, ...response };
  }

  return {
    ok: false,
    status: 500,
    message: "커플 연결을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    errorCode: normalizedCode || "INVALID_RPC_RESPONSE",
  };
}

/**
 * Validates the trust boundary between an authenticated route and the
 * SECURITY DEFINER membership RPCs. Unknown/contradictory payloads fail closed
 * and legacy `error` strings are accepted only through an explicit allow-list.
 */
export function parseMembershipRpcResponse(
  value: unknown,
  expectedRole: CoupleRole,
  action: MembershipAction,
  expectedActorUserId?: string,
): MembershipRpcOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failureFor("INVALID_RPC_RESPONSE");
  }

  const payload = value as MembershipRpcPayload;
  const errorCode =
    typeof payload.error_code === "string" && payload.error_code.trim()
      ? payload.error_code.trim()
      : typeof payload.error === "string" && payload.error.trim()
        ? LEGACY_ERROR_CODES[payload.error.trim()] ?? "UNKNOWN_RPC_ERROR"
        : null;

  if (errorCode) {
    return failureFor(errorCode);
  }

  const changed = action === "create" ? payload.created : payload.joined;

  if (
    payload.success !== true ||
    typeof payload.couple_id !== "string" ||
    !UUID_PATTERN.test(payload.couple_id) ||
    typeof payload.invite_code !== "string" ||
    !/^WH-[A-Z0-9]{6,12}$/.test(payload.invite_code) ||
    typeof changed !== "boolean" ||
    typeof payload.idempotent !== "boolean" ||
    payload.idempotent === changed ||
    payload.role !== expectedRole ||
    (
      expectedActorUserId !== undefined
      && payload.actor_user_id !== expectedActorUserId
    )
  ) {
    return failureFor("INVALID_RPC_RESPONSE");
  }

  return {
    ok: true,
    coupleId: payload.couple_id,
    inviteCode: payload.invite_code,
    changed,
    idempotent: payload.idempotent,
    role: expectedRole,
  };
}
