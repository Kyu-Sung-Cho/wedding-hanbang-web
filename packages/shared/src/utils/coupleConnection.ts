export type CoupleConnectionPhase =
  | "awaiting_partner"
  | "linked"
  | "sealed_single"
  | "unavailable";

export type CoupleConnectionState = {
  phase: CoupleConnectionPhase;
  inviteCode: string | null;
  canInvite: boolean;
  /** 초대 코드가 닫히는 시각(ISO). 서버가 알려주지 않으면 null. */
  inviteExpiresAt: string | null;
  /**
   * 방금 이 응답에서 코드가 새로 발급됐는가. 서버가 만료된 코드를 회전시켰거나
   * 사용자가 재발급을 눌렀을 때만 참이다. 이때 초대한 쪽이 이미 보낸 코드는
   * 죽어 있으므로 화면이 먼저 말해줘야 한다.
   *
   * 저장된 타임스탬프로 "예전에 바뀐 적 있나"를 추측하지 않는다 — 20260812030000
   * 은 코드를 그대로 둔 채 issued_at 만 찍은 행도 만들었고, 그걸 재발급으로 읽으면
   * 멀쩡한 코드를 쓰는 사람에게 "예전 코드는 못 쓴다"는 거짓말을 하게 된다.
   */
  inviteReissued: boolean;
};

export type CoupleConnectionContext = {
  partnerPresent?: boolean;
  membershipSealedAt?: unknown;
};

const INVITE_CODE_PATTERN = /^WH-[A-Z0-9]{6,12}$/;

const CLOSED = {
  inviteCode: null,
  canInvite: false,
  inviteExpiresAt: null,
  inviteReissued: false,
} as const;

const UNAVAILABLE: CoupleConnectionState = { phase: "unavailable", ...CLOSED };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifyStoredSeal(value: unknown): "unsealed" | "sealed" | "invalid" {
  if (value === undefined || value === null) return "unsealed";
  if (typeof value === "string" && value.trim().length > 0) return "sealed";
  return "invalid";
}

/** 모르는 값은 "만료 아님"이 아니라 "모름"이다 — 없는 마감일을 지어내지 않는다. */
function readTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
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
    return { phase: "linked", ...CLOSED };
  }

  const storedSeal = classifyStoredSeal(context.membershipSealedAt);
  if (storedSeal === "sealed") {
    return { phase: "sealed_single", ...CLOSED };
  }
  if (storedSeal === "invalid") return UNAVAILABLE;

  if (!isRecord(payload)
      || typeof payload.isFullyLinked !== "boolean"
      || typeof payload.isMembershipSealed !== "boolean") {
    return UNAVAILABLE;
  }

  if (payload.isFullyLinked) {
    return { phase: "linked", ...CLOSED };
  }

  if (payload.isMembershipSealed) {
    return { phase: "sealed_single", ...CLOSED };
  }

  if (typeof payload.inviteCode === "string"
      && INVITE_CODE_PATTERN.test(payload.inviteCode)) {
    // 만료 판정을 여기서 하지 않는다. 서버는 만료된 코드를 응답에 싣지 않고
    // (회전시킨 뒤 새 코드를 준다), 기기 시계로 다시 판정하면 시계가 앞선
    // 사용자에게 멀쩡한 코드를 "만료됐다"고 말하게 된다.
    return {
      phase: "awaiting_partner",
      inviteCode: payload.inviteCode,
      canInvite: true,
      inviteExpiresAt: readTimestamp(payload.inviteCodeExpiresAt),
      inviteReissued: payload.inviteCodeReissued === true,
    };
  }

  return UNAVAILABLE;
}

export type CoupleInviteWindowNotice = {
  tone: "reissued" | "active";
  message: string;
};

/**
 * 마감을 KST 로 못박아 직접 만든다. 이유가 둘이다.
 * 1. 창은 발급 '시각' + 7일이라 날짜만 찍으면 마지막 날 하루를 통째로 약속하게
 *    된다 - 15시에 죽는 코드를 "27일까지"라고 말하면 그것도 거짓말이다.
 * 2. toLocale* 는 뷰어의 타임존과 런타임(Hermes 등) 구현에 따라 갈린다.
 *    이 제품은 KST 하나만 쓰므로 직접 계산하는 편이 틀릴 구석이 없다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function formatInviteDeadline(isoTimestamp: string): string {
  const kst = new Date(Date.parse(isoTimestamp) + KST_OFFSET_MS);
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const hour = kst.getUTCHours();
  const minute = kst.getUTCMinutes();
  const clock = minute === 0
    ? `${hour}시`
    : `${hour}시 ${String(minute).padStart(2, "0")}분`;
  return `${kst.getUTCFullYear()}년 ${month}월 ${day}일 ${clock}`;
}

/**
 * 코드를 막 받아 파트너에게 보내려는 화면용 한 줄. 창을 모르면 null 이다 —
 * 마이그레이션이 아직 안 간 DB 에서 없는 기한을 지어내지 않는다.
 */
export function describeInviteDeadline(isoTimestamp: unknown): string | null {
  const iso = readTimestamp(isoTimestamp);
  return iso === null ? null : `이 코드는 ${formatInviteDeadline(iso)}까지 쓸 수 있어요.`;
}

/**
 * 초대한 쪽이 자기 코드의 상태를 알게 하는 한 줄. 창을 모르면 아무 말도 하지
 * 않는다 — "언제까지"를 지어내면 그것도 거짓말이다.
 *
 * 만료를 상대에게만 알리면 부족하다. 상대 화면에는 "만료됐다"가 뜨는데 초대한
 * 쪽은 자기 코드가 살아 있다고 믿으면, 두 사람은 서로 다른 사실을 붙들고
 * 같은 코드를 다시 주고받는다.
 */
export function describeCoupleInviteWindow(
  state: CoupleConnectionState,
): CoupleInviteWindowNotice | null {
  if (state.phase !== "awaiting_partner") return null;

  if (state.inviteReissued) {
    return {
      tone: "reissued",
      message: state.inviteExpiresAt
        ? `코드가 새로 발급됐어요. 예전에 보낸 코드는 더 이상 쓸 수 없으니 이 코드를 파트너에게 다시 보내 주세요. (${formatInviteDeadline(state.inviteExpiresAt)}까지)`
        : "코드가 새로 발급됐어요. 예전에 보낸 코드는 더 이상 쓸 수 없으니 이 코드를 파트너에게 다시 보내 주세요.",
    };
  }

  if (state.inviteExpiresAt) {
    return {
      tone: "active",
      message: `이 코드는 ${formatInviteDeadline(state.inviteExpiresAt)}까지 쓸 수 있어요.`,
    };
  }

  return null;
}
