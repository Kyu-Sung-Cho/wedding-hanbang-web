import { describe, expect, it } from "vitest";
import {
  evaluateCommandLease,
  type CommandLease,
  type CommandLeasePresentation,
} from "@hanbang/shared";

// Command lease — "이 사람이, 이 내용을, 지금 실행해도 되는가"에 대한 서버의 증서.
//
// P0-2가 남긴 교훈이 이 계약의 이유다. 커밋 시점에 현재 bearer를 행위자로 삼으면,
// 제안을 시작한 사람과 실행되는 사람이 갈라질 수 있다. 그래서 행위자는 제안 시점에
// 서버가 적어 두고, 커밋 시점에는 그 기록과 대조만 한다. 현재 세션을 기본값으로
// 끌어다 쓰는 경로를 만들지 않는다.
//
// 모바일에 넣은 `assertSharedActionActor`는 클라이언트 봉쇄이고, §8.6에 따라 그것만으로는
// P0가 닫히지 않는다. 이 계약은 그 서버 쪽 짝이다.

const ACTOR = "50000000-0000-4000-8000-0000000000a1";
const OTHER_ACTOR = "50000000-0000-4000-8000-0000000000b2";
const COUPLE = "60000000-0000-4000-8000-0000000000c3";
const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const ROSTER = "c".repeat(32);
const OTHER_ROSTER = "d".repeat(32);
const NOW = 1_800_000_000_000;

function lease(overrides: Partial<CommandLease> = {}): CommandLease {
  return {
    version: 1,
    leaseId: "70000000-0000-4000-8000-0000000000d4",
    actorUserId: ACTOR,
    coupleId: COUPLE,
    scope: "couple_shared",
    proposalDigest: DIGEST,
    rosterFingerprint: ROSTER,
    sessionEpoch: 7,
    issuedAt: NOW - 60_000,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

function presented(overrides: Partial<CommandLeasePresentation> = {}): CommandLeasePresentation {
  return {
    actorUserId: ACTOR,
    coupleId: COUPLE,
    proposalDigest: DIGEST,
    rosterFingerprint: ROSTER,
    sessionEpoch: 7,
    now: NOW,
    redeemed: false,
    ...overrides,
  };
}

describe("evaluateCommandLease", () => {
  it("admits the actor who started the proposal, for the exact content they saw", () => {
    expect(evaluateCommandLease(lease(), presented())).toEqual({ ok: true });
  });

  it("rejects a different account committing a lease it did not start", () => {
    // 승인 화면을 A가 열어 두고 B가 로그인해도, 실행 주체가 A로 기록되면 안 된다.
    expect(evaluateCommandLease(lease(), presented({ actorUserId: OTHER_ACTOR })))
      .toEqual({ ok: false, reason: "actor_mismatch" });
  });

  it("rejects content that changed after the lease was minted", () => {
    // 사용자가 본 제안과 실행될 제안이 다르면, 그 승인은 이 실행을 덮지 않는다.
    expect(evaluateCommandLease(lease(), presented({ proposalDigest: OTHER_DIGEST })))
      .toEqual({ ok: false, reason: "digest_mismatch" });
  });

  it("rejects a lease minted under a different couple roster", () => {
    // 제안과 실행 사이에 파트너가 합류하면, 혼자 정해도 되던 일이 둘이 정해야 하는
    // 일이 된다. 같은 내용이라도 그 승인은 새 구성을 덮지 않는다.
    expect(evaluateCommandLease(lease(), presented({ rosterFingerprint: OTHER_ROSTER })))
      .toEqual({ ok: false, reason: "roster_changed" });
  });

  it("rejects a lease left over from before an account switch", () => {
    expect(evaluateCommandLease(lease(), presented({ sessionEpoch: 8 })))
      .toEqual({ ok: false, reason: "epoch_superseded" });
  });

  it("rejects a lease presented for another couple", () => {
    expect(evaluateCommandLease(lease(), presented({
      coupleId: "60000000-0000-4000-8000-0000000000ff",
    }))).toEqual({ ok: false, reason: "couple_mismatch" });
  });

  it("rejects an expired lease", () => {
    expect(evaluateCommandLease(lease(), presented({ now: NOW + 120_000 })))
      .toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a lease that was already redeemed", () => {
    // 재시도의 멱등성은 기존 application claim이 담당한다. lease는 1회용이다.
    expect(evaluateCommandLease(lease(), presented({ redeemed: true })))
      .toEqual({ ok: false, reason: "already_redeemed" });
  });

  it("rejects a malformed lease instead of filling in defaults", () => {
    for (const broken of [
      null,
      undefined,
      {},
      lease({ actorUserId: "not-a-uuid" }),
      lease({ proposalDigest: "short" }),
      lease({ rosterFingerprint: "not-a-fingerprint" }),
      lease({ sessionEpoch: -1 }),
      lease({ version: 2 as never }),
      lease({ expiresAt: NOW - 120_000 }), // 발급보다 이른 만료
    ]) {
      const verdict = evaluateCommandLease(broken as never, presented());
      expect(verdict.ok).toBe(false);
    }
  });

  it("never falls back to the presented actor when the lease has none", () => {
    // 가장 위험한 회귀는 `lease.actorUserId ?? presented.actorUserId`다.
    const verdict = evaluateCommandLease(
      lease({ actorUserId: undefined as never }),
      presented(),
    );
    expect(verdict).toEqual({ ok: false, reason: "malformed_lease" });
  });

  it("survives hostile presentation shapes without throwing", () => {
    for (const hostile of [null, undefined, 42, "presented", []]) {
      expect(() => evaluateCommandLease(lease(), hostile as never)).not.toThrow();
      expect(evaluateCommandLease(lease(), hostile as never).ok).toBe(false);
    }
  });

  it("compares actor identity case-insensitively but never loosely", () => {
    // uuid 대소문자는 같은 사람이지만, 앞자리만 같은 다른 uuid는 다른 사람이다.
    expect(evaluateCommandLease(lease(), presented({ actorUserId: ACTOR.toUpperCase() })))
      .toEqual({ ok: true });
    expect(evaluateCommandLease(lease(), presented({
      actorUserId: `${ACTOR.slice(0, -1)}f`,
    }))).toEqual({ ok: false, reason: "actor_mismatch" });
  });
});
