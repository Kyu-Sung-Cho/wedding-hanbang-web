import {
  canRequestApproval,
  COMMAND_LEASE_VERSION,
  COUPLE_APPROVAL_PENDING_ACTION_TTL_MS,
  SINGLE_APPROVAL_PENDING_ACTION_TTL_MS,
  type CommandLease,
  type DecisionPacket,
} from "@hanbang/shared";
import { computeProposalDigest } from "./decisionPacketDigest";

/**
 * command lease 발급 — 서버 전용.
 *
 * 여기가 Decision Packet(의미)과 lease(행위)가 하나로 묶이는 지점이다. 발급기가
 * 지키는 것은 세 가지다.
 *
 *  1. digest를 인자로 받지 않는다. 패킷에서 직접 계산한다. 인자로 받는 순간
 *     "사용자가 본 것은 이거였다"는 주장을 호출자가 하게 되고, 증서의 의미가 사라진다.
 *  2. 행위자를 서버가 이미 확인한 principal로 적는다. 이후 커밋 시점에는 이 기록과
 *     대조만 하고, 그때의 세션을 기본값으로 끌어오지 않는다(P0-2가 났던 모양).
 *  3. 승인 게이트를 먼저 통과해야 발급한다. 모르는 것이 남아 있으면 증서 자체가
 *     나가지 않으므로, "모르는 채로 승인" 상태가 아예 만들어지지 않는다.
 */

export interface MintCommandLeaseInput {
  readonly packet: DecisionPacket;
  readonly coupleId: string;
  /** 서버가 이미 확인한 principal. 클라이언트가 보낸 값을 그대로 넘기지 않는다. */
  readonly actorUserId: string;
  /** `computeCoupleRosterFingerprint`로 서버가 방금 읽은 커플 구성. */
  readonly rosterFingerprint: string;
  readonly sessionEpoch: number;
  readonly now: number;
  readonly leaseId: string;
}

export type MintCommandLeaseResult =
  | { ok: true; lease: CommandLease }
  | { ok: false; reason: "unresolved_unknowns" | "no_confirmed_facts" };

export function mintCommandLease(input: MintCommandLeaseInput): MintCommandLeaseResult {
  const gate = canRequestApproval(input.packet);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  // 커플 결정은 상대의 확인을 기다려야 하므로 창을 길게, 혼자 결정은 짧게 잡는다.
  // 기존 pending action TTL과 같은 값을 쓴다 — 두 벌로 갈라지면 한쪽만 고쳐진다.
  const ttlMs = input.packet.scope === "couple_shared"
    ? COUPLE_APPROVAL_PENDING_ACTION_TTL_MS
    : SINGLE_APPROVAL_PENDING_ACTION_TTL_MS;

  return {
    ok: true,
    lease: {
      version: COMMAND_LEASE_VERSION,
      leaseId: input.leaseId,
      actorUserId: input.actorUserId.toLowerCase(),
      coupleId: input.coupleId.toLowerCase(),
      scope: input.packet.scope,
      proposalDigest: computeProposalDigest(input.packet),
      rosterFingerprint: input.rosterFingerprint.toLowerCase(),
      sessionEpoch: input.sessionEpoch,
      issuedAt: input.now,
      expiresAt: input.now + ttlMs,
    },
  };
}
