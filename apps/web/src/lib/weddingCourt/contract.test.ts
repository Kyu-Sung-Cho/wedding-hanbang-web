import { describe, expect, it } from "vitest";

import {
  parseWeddingCourtVoteInput,
  serializeWeddingCourtCase,
  weddingCourtCaseRowSchema,
  weddingCourtVoteRowSchema,
} from "./contract";

const CASE_ID = "11111111-1111-4111-8111-111111111901";

const weddingCase = weddingCourtCaseRowSchema.parse({
  id: CASE_ID,
  slug: "safe-case",
  docket_label: "합성 사건 01",
  title: "모바일 청첩장 대표 사진",
  question: "어떤 사진을 모바일 청첩장 첫 화면에 두면 좋을까요?",
  opening: "두 선택 모두 이유가 있어 전달 목적을 먼저 생각해보는 합성 사건이에요.",
  initial_facts: ["자연스러운 사진이 있어요.", "단정한 사진도 있어요."],
  choice_a_label: "자연스러운 사진",
  choice_b_label: "단정한 사진",
  reason_chips: [
    { id: "couple_style", label: "두 사람다운 분위기" },
    { id: "first_impression", label: "첫인상" },
    { id: "family_sharing", label: "가족 공유" },
    { id: "information_clarity", label: "정보 전달" },
  ],
  new_evidence_title: "새 단서",
  new_evidence: "부모님도 같은 링크를 친척에게 공유할 예정이에요.",
  choice_a_perspective:
    "두 사람의 이야기와 분위기가 잘 보이는 것을 중요하게 생각해요.",
  choice_b_perspective:
    "처음 보는 사람도 편하게 이해할 수 있는 전달력을 중요하게 생각해요.",
  ending:
    "첫 화면 목적을 합의하고 다른 사진을 다음 장에 두는 방식도 가능해요.",
  status: "active",
  sort_order: 1,
  is_synthetic: true,
});

function vote(
  overrides: Partial<{
    case_id: string;
    round: 1 | 2;
    choice: "a" | "b";
    reason_chip: string;
    predicted_majority: "a" | "b" | null;
  }> = {},
) {
  return weddingCourtVoteRowSchema.parse({
    case_id: CASE_ID,
    round: 1,
    choice: "a",
    reason_chip: "couple_style",
    predicted_majority: "a",
    ...overrides,
  });
}

describe("wedding court result reveal contract", () => {
  it("omits evidence, perspectives, and every aggregate before the user's first vote", () => {
    const aggregateVotes = [
      vote(),
      vote({ choice: "b", reason_chip: "first_impression" }),
      vote({ choice: "b", reason_chip: "information_clarity" }),
    ];

    const state = serializeWeddingCourtCase(
      weddingCase,
      [],
      aggregateVotes,
    );

    expect(state.stage).toBe("first_vote");
    expect(state).not.toHaveProperty("firstRound");
    expect(state).not.toHaveProperty("newEvidence");
    expect(state).not.toHaveProperty("appealRound");
    expect(state).not.toHaveProperty("ending");
    expect(JSON.stringify(state)).not.toContain("부모님도 같은 링크");
    expect(JSON.stringify(state)).not.toContain("처음 보는 사람도");
  });

  it("reveals only first-round distribution and new evidence after first vote", () => {
    const ownFirst = vote({ predicted_majority: "b" });
    const state = serializeWeddingCourtCase(
      weddingCase,
      [ownFirst],
      [
        ownFirst,
        vote({ choice: "b", reason_chip: "first_impression" }),
        vote({ choice: "b", reason_chip: "information_clarity" }),
        vote({
          round: 2,
          choice: "a",
          reason_chip: "couple_style",
          predicted_majority: null,
        }),
      ],
    );

    expect(state.stage).toBe("appeal_vote");
    expect(state.firstRound?.distribution).toMatchObject({
      totalVotes: 3,
      lean: "b",
      a: { count: 1, percent: 33 },
      b: { count: 2, percent: 67 },
    });
    expect(state.firstRound?.predictionMatchesCurrentLean).toBe(true);
    expect(state.newEvidence?.detail).toContain("부모님");
    expect(state).not.toHaveProperty("appealRound");
    expect(state).not.toHaveProperty("ending");
  });

  it("reveals the appeal distribution and neutral ending only after appeal", () => {
    const ownFirst = vote();
    const ownAppeal = vote({
      round: 2,
      choice: "b",
      reason_chip: "family_sharing",
      predicted_majority: null,
    });

    const state = serializeWeddingCourtCase(
      weddingCase,
      [ownFirst, ownAppeal],
      [ownFirst, ownAppeal],
    );

    expect(state.stage).toBe("complete");
    expect(state.appealRound?.distribution).toMatchObject({
      totalVotes: 1,
      lean: "b",
    });
    expect(state.ending).toContain("방식도 가능");
    expect(JSON.stringify(state)).not.toMatch(/유죄|승자|정답은 [ab12]/u);
    expect(state.safetyNotice).toContain("정답이나 판결이 아니");
  });
});

describe("wedding court input contract", () => {
  it("strips caller-supplied identity and accepts only bounded chips", () => {
    expect(
      parseWeddingCourtVoteInput({
        user_id: "99999999-9999-4999-8999-999999999999",
        round: 1,
        choice: "a",
        reason_chip: "couple_style",
        predicted_majority: "b",
      }),
    ).toEqual({
      ok: true,
      value: {
        round: 1,
        choice: "a",
        reasonChip: "couple_style",
        predictedMajority: "b",
      },
    });
  });

  it.each([
    { round: 1, choice: "a", reason_chip: "free text!", predicted_majority: "a" },
    { round: 1, choice: "guilty", reason_chip: "couple_style", predicted_majority: "a" },
    { round: 1, choice: "a", reason_chip: "couple_style" },
    { round: 2, choice: "a", reason_chip: "couple_style", predicted_majority: "b" },
  ])("rejects invalid or free-form input %#", (input) => {
    expect(parseWeddingCourtVoteInput(input).ok).toBe(false);
  });
});
