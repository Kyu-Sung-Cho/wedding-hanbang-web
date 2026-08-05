import { describe, expect, it } from "vitest";
import {
  evaluateCommandLease,
  normalizeDecisionPacket,
  type DecisionPacketDraft,
} from "@hanbang/shared";
import { computeProposalDigest } from "../decisionPacketDigest";
import { mintCommandLease } from "../commandLeaseMint";
import { computeCoupleRosterFingerprint } from "../coupleRosterFingerprint";

// 두 계약이 실제로 맞물리는지 확인한다. 따로 있으면 각각 그럴듯해 보이지만, 값이
// 이어지지 않으면 설계 문서 두 장일 뿐이다. 이어지는 지점은 `proposalDigest` 하나다.

const ACTOR = "50000000-0000-4000-8000-0000000000a1";
const PARTNER = "50000000-0000-4000-8000-0000000000b2";
const COUPLE = "60000000-0000-4000-8000-0000000000c3";
const LEASE_ID = "70000000-0000-4000-8000-0000000000d4";
const NOW = 1_800_000_000_000;
/** 제안 시점: 아직 혼자다. */
const SOLO_ROSTER = computeCoupleRosterFingerprint(ACTOR, null);
/** 커밋 시점: 파트너가 합류했다. */
const JOINED_ROSTER = computeCoupleRosterFingerprint(ACTOR, PARTNER);

function draft(overrides: Partial<DecisionPacketDraft> = {}): DecisionPacketDraft {
  return {
    topic: "venue_contract",
    scope: "couple_shared",
    ownerUserId: ACTOR,
    facts: [{ key: "total_budget_won", value: "30000000", evidence: "confirmed_user" }],
    unknowns: [],
    ...overrides,
  };
}

function mint(packetDraft: DecisionPacketDraft = draft()) {
  return mintCommandLease({
    packet: normalizeDecisionPacket(packetDraft)!,
    coupleId: COUPLE,
    actorUserId: ACTOR,
    rosterFingerprint: SOLO_ROSTER,
    sessionEpoch: 7,
    now: NOW,
    leaseId: LEASE_ID,
  });
}

function present(overrides: Record<string, unknown> = {}) {
  return {
    actorUserId: ACTOR,
    coupleId: COUPLE,
    proposalDigest: computeProposalDigest(normalizeDecisionPacket(draft())!),
    rosterFingerprint: SOLO_ROSTER,
    sessionEpoch: 7,
    now: NOW + 1_000,
    redeemed: false,
    ...overrides,
  };
}

describe("decision packet + command lease join", () => {
  it("mints a lease carrying the digest of the packet it was minted from", () => {
    const minted = mint();
    expect(minted.ok).toBe(true);

    const packet = normalizeDecisionPacket(draft())!;
    expect(minted.ok && minted.lease.proposalDigest).toBe(computeProposalDigest(packet));
  });

  it("refuses to mint while something material is still unknown", () => {
    // 승인 게이트가 발급보다 먼저다. 모르는 채로는 증서 자체가 나가지 않는다.
    const minted = mint(draft({
      unknowns: [{ key: "housing_included", question: "신혼집도 포함할까요?" }],
    }));

    expect(minted).toEqual({ ok: false, reason: "unresolved_unknowns" });
  });

  it("refuses to mint when only an amora proposal backs the decision", () => {
    const minted = mint(draft({
      facts: [{ key: "venue_region", value: "seoul", evidence: "amora_proposal" }],
    }));

    expect(minted).toEqual({ ok: false, reason: "no_confirmed_facts" });
  });

  it("invalidates the old approval when the proposal content changes", () => {
    // 이 검사가 이 설계의 핵심이다. 사용자가 3,000만원 안을 승인한 뒤 내용이 4,000만원
    // 으로 바뀌면, 그 승인은 새 내용을 덮지 않아야 한다.
    const minted = mint();
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    const changed = normalizeDecisionPacket(draft({
      facts: [{ key: "total_budget_won", value: "40000000", evidence: "confirmed_user" }],
    }))!;

    const verdict = evaluateCommandLease(
      minted.lease,
      present({ proposalDigest: computeProposalDigest(changed) }),
    );

    expect(verdict).toEqual({ ok: false, reason: "digest_mismatch" });
  });

  it("keeps the approval valid when nothing about the proposal changed", () => {
    const minted = mint();
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    expect(evaluateCommandLease(minted.lease, present())).toEqual({ ok: true });
  });

  it("invalidates a solo-era lease once the partner has joined", () => {
    // 혼자 쓰던 사람이 제안을 띄워 둔 채 파트너가 합류하면, 그 제안은 이제 둘의
    // 결정이다. 예전 증서로 그대로 실행되면 상대는 자기도 모르게 반영된 결과를 본다.
    const minted = mint();
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    expect(evaluateCommandLease(minted.lease, present({
      rosterFingerprint: JOINED_ROSTER,
    }))).toEqual({ ok: false, reason: "roster_changed" });
  });

  it("records the server-resolved actor, not whoever presents the lease later", () => {
    const minted = mint();
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.lease.actorUserId).toBe(ACTOR);

    const verdict = evaluateCommandLease(
      minted.lease,
      present({ actorUserId: PARTNER }),
    );

    expect(verdict).toEqual({ ok: false, reason: "actor_mismatch" });
  });

  it("ignores a caller-supplied digest and recomputes it from the packet", () => {
    // digest를 인자로 받아들이는 순간, "내가 본 것은 이거였다"는 주장을 호출자가
    // 하게 된다. 증서의 의미가 거기서 사라진다.
    const forged = "c".repeat(64);
    const minted = mintCommandLease({
      packet: normalizeDecisionPacket(draft())!,
      coupleId: COUPLE,
      actorUserId: ACTOR,
      rosterFingerprint: SOLO_ROSTER,
      sessionEpoch: 7,
      now: NOW,
      leaseId: LEASE_ID,
      proposalDigest: forged,
    } as never);

    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.lease.proposalDigest).not.toBe(forged);
    expect(minted.lease.proposalDigest).toBe(
      computeProposalDigest(normalizeDecisionPacket(draft())!),
    );
  });

  it("scopes the lease to the packet's own scope rather than widening it", () => {
    const minted = mint(draft({ scope: "owner_private" }));
    expect(minted.ok && minted.lease.scope).toBe("owner_private");
  });
});
