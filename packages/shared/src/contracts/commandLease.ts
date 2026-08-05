import type { DecisionScope } from "./decisionPacket";

/**
 * Command lease — "이 사람이, 이 내용을, 지금 실행해도 되는가"에 대한 서버의 증서.
 *
 * Decision Packet이 의미 축("무엇을 정하는가")이라면 lease는 행위 축이다. 둘은
 * `proposalDigest` 하나로 묶인다. 패킷의 사실이나 미확인 항목이 하나라도 바뀌면
 * digest가 바뀌고, 그 순간 기존 lease는 새 내용을 덮지 못한다.
 *
 * 이 계약이 필요한 이유는 P0-2다. 커밋 시점에 현재 bearer를 행위자로 삼으면 제안을
 * 시작한 사람과 실행 주체가 갈라질 수 있다. 그래서 행위자는 제안 시점에 서버가 적어
 * 두고, 커밋 시점에는 대조만 한다. 현재 세션을 기본값으로 끌어다 쓰는 경로를 두지
 * 않는 것이 이 모듈의 전부다.
 *
 * 발급(mint)은 여기 없다. lease를 만들 수 있는 쪽이 곧 행위자를 정할 수 있는 쪽이므로
 * 발급은 서버 전용 경로에 둔다. 이 판정 함수는 앱도 부를 수 있지만, 앱에서의 호출은
 * 흐릿해진 버튼 같은 화면 처리를 위한 것이고 권한 판단은 언제나 서버가 다시 한다.
 */

export const COMMAND_LEASE_VERSION = 1;

export interface CommandLease {
  readonly version: typeof COMMAND_LEASE_VERSION;
  readonly leaseId: string;
  /** 제안을 시작한 사람. 서버가 그 시점에 기록하며 이후 갱신하지 않는다. */
  readonly actorUserId: string;
  readonly coupleId: string;
  readonly scope: DecisionScope;
  /** 이 증서가 덮는 정확한 제안 내용. */
  readonly proposalDigest: string;
  /**
   * 발급 시점의 커플 구성. 제안과 실행 사이에 파트너가 합류하거나 빠지면 같은
   * 문장이라도 승인의 의미가 달라진다 — 혼자 정해도 되던 일이 둘이 정해야 하는 일이
   * 된다. 기존 `amora_shared_action_acceptances`가 이미 같은 값을 붙잡고 있다.
   */
  readonly rosterFingerprint: string;
  /** 로그아웃·계정 전환 때 올라가는 세대 번호. */
  readonly sessionEpoch: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface CommandLeasePresentation {
  readonly actorUserId: string;
  readonly coupleId: string;
  readonly proposalDigest: string;
  /** 커밋 시점에 서버가 다시 읽은 현재 커플 구성. */
  readonly rosterFingerprint: string;
  readonly sessionEpoch: number;
  readonly now: number;
  /** 이미 사용된 증서인지. 재시도의 멱등성은 application claim이 따로 담당한다. */
  readonly redeemed: boolean;
}

export type CommandLeaseRejection =
  | "malformed_lease"
  | "malformed_presentation"
  | "actor_mismatch"
  | "couple_mismatch"
  | "digest_mismatch"
  | "roster_changed"
  | "epoch_superseded"
  | "already_redeemed"
  | "expired";

export type CommandLeaseVerdict =
  | { ok: true }
  | { ok: false; reason: CommandLeaseRejection };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/u;
// 저장된 승인 증거와 같은 형식이다 — `roster_fingerprint text CHECK (~ '^[a-f0-9]{32}$')`.
const ROSTER_FINGERPRINT_RE = /^[a-f0-9]{32}$/u;
const SCOPES: ReadonlySet<string> = new Set(["owner_private", "couple_shared"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function isEpoch(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sameIdentity(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isWellFormedLease(value: unknown): value is CommandLease {
  if (!isRecord(value)) return false;
  if (value.version !== COMMAND_LEASE_VERSION) return false;
  if (!isUuid(value.leaseId)) return false;
  if (!isUuid(value.actorUserId)) return false;
  if (!isUuid(value.coupleId)) return false;
  if (typeof value.scope !== "string" || !SCOPES.has(value.scope)) return false;
  if (typeof value.proposalDigest !== "string"
    || !SHA256_HEX_RE.test(value.proposalDigest)) {
    return false;
  }
  if (typeof value.rosterFingerprint !== "string"
    || !ROSTER_FINGERPRINT_RE.test(value.rosterFingerprint)) {
    return false;
  }
  if (!isEpoch(value.sessionEpoch)) return false;
  if (!isTimestamp(value.issuedAt) || !isTimestamp(value.expiresAt)) return false;
  // 만료가 발급보다 이르면 증서 자체가 앞뒤가 맞지 않는다.
  if (value.expiresAt <= value.issuedAt) return false;
  return true;
}

function isWellFormedPresentation(value: unknown): value is CommandLeasePresentation {
  if (!isRecord(value)) return false;
  if (!isUuid(value.actorUserId)) return false;
  if (!isUuid(value.coupleId)) return false;
  if (typeof value.proposalDigest !== "string"
    || !SHA256_HEX_RE.test(value.proposalDigest)) {
    return false;
  }
  if (typeof value.rosterFingerprint !== "string"
    || !ROSTER_FINGERPRINT_RE.test(value.rosterFingerprint)) {
    return false;
  }
  if (!isEpoch(value.sessionEpoch)) return false;
  if (!isTimestamp(value.now)) return false;
  if (typeof value.redeemed !== "boolean") return false;
  return true;
}

/**
 * 증서가 이 실행을 덮는지 판정한다.
 *
 * 어떤 항목이 빠져 있어도 현재 값으로 채우지 않는다. 가장 위험한 회귀는
 * `lease.actorUserId ?? currentUserId`이며, 그것이 정확히 P0-2가 났던 모양이다.
 * 채울 수 없으면 거절한다.
 */
export function evaluateCommandLease(
  lease: unknown,
  presentation: unknown,
): CommandLeaseVerdict {
  if (!isWellFormedLease(lease)) return { ok: false, reason: "malformed_lease" };
  if (!isWellFormedPresentation(presentation)) {
    return { ok: false, reason: "malformed_presentation" };
  }

  if (!sameIdentity(lease.actorUserId, presentation.actorUserId)) {
    return { ok: false, reason: "actor_mismatch" };
  }
  if (!sameIdentity(lease.coupleId, presentation.coupleId)) {
    return { ok: false, reason: "couple_mismatch" };
  }
  if (!sameIdentity(lease.proposalDigest, presentation.proposalDigest)) {
    return { ok: false, reason: "digest_mismatch" };
  }
  if (!sameIdentity(lease.rosterFingerprint, presentation.rosterFingerprint)) {
    return { ok: false, reason: "roster_changed" };
  }
  if (lease.sessionEpoch !== presentation.sessionEpoch) {
    return { ok: false, reason: "epoch_superseded" };
  }
  if (presentation.redeemed) return { ok: false, reason: "already_redeemed" };
  if (presentation.now >= lease.expiresAt) return { ok: false, reason: "expired" };

  return { ok: true };
}
