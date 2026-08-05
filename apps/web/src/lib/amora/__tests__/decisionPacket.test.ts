import { describe, expect, it } from "vitest";
import {
  canRequestApproval,
  normalizeDecisionPacket,
  type DecisionPacketDraft,
} from "@hanbang/shared";
// digest 발급은 서버 전용이라 공유 패키지가 아니라 웹 서버 모듈에 있다 —
// 클라이언트가 digest를 만들 수 있으면 승인 증거의 의미가 사라진다.
import { computeProposalDigest } from "../decisionPacketDigest";

// Decision Packet — 하나의 준비 건을 담는 의미 단위. 예산·할 일·일정은 그 투영이다
// (`AMORA_INTEGRATED_CARE_PRODUCT_SPEC_2026-07-30.md` §D3, §5.2).
//
// 저장소에는 이미 실행 축이 있다: `StoredAmoraPendingAction`의 `inputDigest`,
// `operationKey`, `amora_shared_action_acceptances`의 `proposal_digest`·
// `roster_fingerprint`, 그리고 mutation receipt. 비어 있는 것은 **의미 축**이다 —
// 무엇이 확인됐고 무엇을 아직 모르는지, 근거가 무엇인지.
//
// 이 계약은 그 의미 축을 digest에 포함시킨다. 그러면 두 가지가 따라온다.
//   1. 내용이 바뀌면 digest가 바뀌고, 사용자가 보지 않은 버전의 승인은 자동으로 무효다.
//   2. 모르는 것이 남아 있으면 승인 요청 자체를 막을 수 있다.
//
// 실제 사용자 문장 대신 합성 표식만 쓴다.

const OWNER = "50000000-0000-4000-8000-0000000000a1";

function draft(overrides: Partial<DecisionPacketDraft> = {}): DecisionPacketDraft {
  return {
    topic: "venue_contract",
    scope: "couple_shared",
    ownerUserId: OWNER,
    facts: [{ key: "total_budget_won", value: "30000000", evidence: "confirmed_user" }],
    unknowns: [],
    ...overrides,
  };
}

describe("normalizeDecisionPacket", () => {
  it("keeps a well-formed packet and sorts its facts deterministically", () => {
    const packet = normalizeDecisionPacket(draft({
      facts: [
        { key: "venue_region", value: "seoul", evidence: "confirmed_user" },
        { key: "total_budget_won", value: "30000000", evidence: "confirmed_user" },
      ],
    }));

    expect(packet).not.toBeNull();
    expect(packet!.facts.map((fact) => fact.key)).toEqual([
      "total_budget_won",
      "venue_region",
    ]);
  });

  it("refuses a fact whose evidence grade is not one we can explain to the user", () => {
    // §5.4: 확인된 사실 / 관행 / 제안 / 확인 필요를 섞지 않는다.
    expect(normalizeDecisionPacket(draft({
      facts: [{ key: "k", value: "v", evidence: "probably_true" as never }],
    }))).toBeNull();
  });

  it("refuses an unknown scope instead of defaulting to the wider one", () => {
    expect(normalizeDecisionPacket(draft({ scope: "everyone" as never }))).toBeNull();
  });

  it("survives hostile shapes without throwing", () => {
    for (const hostile of [null, undefined, 42, "packet", []]) {
      expect(() => normalizeDecisionPacket(hostile as never)).not.toThrow();
      expect(normalizeDecisionPacket(hostile as never)).toBeNull();
    }
  });
});

describe("computeProposalDigest", () => {
  it("gives the same digest for the same meaning regardless of key order", () => {
    const a = computeProposalDigest(normalizeDecisionPacket(draft({
      facts: [
        { key: "a_key", value: "1", evidence: "confirmed_user" },
        { key: "b_key", value: "2", evidence: "confirmed_user" },
      ],
    }))!);
    const b = computeProposalDigest(normalizeDecisionPacket(draft({
      facts: [
        { key: "b_key", value: "2", evidence: "confirmed_user" },
        { key: "a_key", value: "1", evidence: "confirmed_user" },
      ],
    }))!);

    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("changes when a fact changes, so an old approval cannot cover new content", () => {
    const before = computeProposalDigest(normalizeDecisionPacket(draft())!);
    const after = computeProposalDigest(normalizeDecisionPacket(draft({
      facts: [{ key: "total_budget_won", value: "40000000", evidence: "confirmed_user" }],
    }))!);

    expect(after).not.toBe(before);
  });

  it("canonicalizes text that the validator accepts, including a broken emoji half", () => {
    // 적대적 검토에서 실제로 재현된 결함이다. `encodeURIComponent`는 짝 없는
    // 서로게이트에 URIError를 던지는데, 그 문자열은 정규화를 통과한다. 검증기가
    // 통과시킨 값을 정규화기가 처리하지 못하면 그 결정은 영영 승인받을 수 없다.
    const packet = normalizeDecisionPacket(draft({
      facts: [{ key: "venue_note", value: "\uD83D", evidence: "confirmed_user" }],
    }));

    expect(packet).not.toBeNull();
    expect(() => computeProposalDigest(packet!)).not.toThrow();
    expect(computeProposalDigest(packet!)).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps values distinct when they contain the separators used to join them", () => {
    // 값 안의 `:`와 `,`가 구분자와 섞여 서로 다른 패킷이 같은 문자열이 되면,
    // 바뀐 내용이 예전 승인을 그대로 물려받는다.
    const left = computeProposalDigest(normalizeDecisionPacket(draft({
      facts: [
        { key: "a_key", value: "x", evidence: "confirmed_user" },
        { key: "b_key", value: "y", evidence: "confirmed_user" },
      ],
    }))!);
    const right = computeProposalDigest(normalizeDecisionPacket(draft({
      facts: [
        { key: "a_key", value: "x\",\"b_key\":\"y", evidence: "confirmed_user" },
      ],
    }))!);

    expect(left).not.toBe(right);
  });

  it("changes when an unknown is resolved, because the user is approving a different thing", () => {
    const withUnknown = computeProposalDigest(normalizeDecisionPacket(draft({
      unknowns: [{ key: "housing_included", question: "신혼집도 포함할까요?" }],
    }))!);
    const resolved = computeProposalDigest(normalizeDecisionPacket(draft())!);

    expect(withUnknown).not.toBe(resolved);
  });
});

describe("canRequestApproval", () => {
  it("allows approval once nothing material is unknown", () => {
    expect(canRequestApproval(normalizeDecisionPacket(draft())!)).toEqual({ ok: true });
  });

  it("blocks approval while a material unknown remains", () => {
    // 모르는 채로 승인받는 것이 가장 흔한 신뢰 위반이다.
    const packet = normalizeDecisionPacket(draft({
      unknowns: [{ key: "housing_included", question: "신혼집도 포함할까요?" }],
    }))!;

    expect(canRequestApproval(packet)).toEqual({
      ok: false,
      reason: "unresolved_unknowns",
      unknownKeys: ["housing_included"],
    });
  });

  it("blocks approval when no confirmed fact backs the decision", () => {
    const packet = normalizeDecisionPacket(draft({ facts: [] }))!;
    expect(canRequestApproval(packet)).toEqual({ ok: false, reason: "no_confirmed_facts" });
  });

  it("does not count an amora proposal as a confirmed fact", () => {
    // 아모라가 제안한 값은 사용자가 확인한 사실이 아니다.
    const packet = normalizeDecisionPacket(draft({
      facts: [{ key: "venue_region", value: "seoul", evidence: "amora_proposal" }],
    }))!;

    expect(canRequestApproval(packet)).toEqual({ ok: false, reason: "no_confirmed_facts" });
  });
});
