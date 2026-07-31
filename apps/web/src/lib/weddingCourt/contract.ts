import { z } from "zod";

import type {
  WeddingCourtCaseState,
  WeddingCourtChoice,
  WeddingCourtDistribution,
  WeddingCourtOwnVote,
  WeddingCourtPerspective,
  WeddingCourtVoteInput,
} from "./types";

export const WEDDING_COURT_SAFETY_NOTICE =
  "이 사건은 실제 커플 사연이 아닌 합성 사례예요. 의견 분포는 정답이나 판결이 아니며, 준비 계획에는 자동 반영되지 않아요.";

const choiceSchema = z.enum(["a", "b"]);
const roundSchema = z.union([z.literal(1), z.literal(2)]);
const reasonChipSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/u),
  label: z.string().min(1).max(32),
});

const ownVoteSchema = z.object({
  round: roundSchema,
  choice: choiceSchema,
  reasonChip: z.string().regex(/^[a-z0-9_]{1,40}$/u),
  predictedMajority: choiceSchema.nullable(),
});

const distributionSideSchema = z.object({
  count: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
});

const reasonCountSchema = reasonChipSchema.extend({
  count: z.number().int().positive(),
});

const distributionSchema = z.object({
  totalVotes: z.number().int().nonnegative(),
  lean: z.enum(["a", "b", "tie"]),
  a: distributionSideSchema,
  b: distributionSideSchema,
  reasons: z.object({
    a: z.array(reasonCountSchema),
    b: z.array(reasonCountSchema),
  }),
});

const perspectiveSchema = z.object({
  choice: choiceSchema,
  label: z.string().min(2).max(64),
  text: z.string().min(8).max(280),
  signal: z.enum(["more_selected", "less_selected", "same"]),
});

const roundResultSchema = z.object({
  distribution: distributionSchema,
  perspectives: z.tuple([perspectiveSchema, perspectiveSchema]),
});

export const weddingCourtCaseStateSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string().regex(/^[a-z0-9-]{3,48}$/u),
    docketLabel: z.string().min(2).max(32),
    title: z.string().min(4).max(80),
    question: z.string().min(8).max(160),
    opening: z.string().min(8).max(280),
    initialFacts: z.array(z.string().min(1).max(180)).min(2).max(5),
    choices: z.object({
      a: z.string().min(2).max(64),
      b: z.string().min(2).max(64),
    }),
    reasonChips: z.array(reasonChipSchema).min(4).max(8),
    synthetic: z.literal(true),
    stage: z.enum(["first_vote", "appeal_vote", "complete"]),
    ownVotes: z.object({
      first: ownVoteSchema.optional(),
      appeal: ownVoteSchema.optional(),
    }),
    firstRound: roundResultSchema
      .extend({
        predictionMatchesCurrentLean: z.boolean().nullable(),
      })
      .optional(),
    newEvidence: z
      .object({
        title: z.string().min(2).max(64),
        detail: z.string().min(8).max(280),
      })
      .optional(),
    appealRound: roundResultSchema.optional(),
    ending: z.string().min(8).max(320).optional(),
    safetyNotice: z.string().min(8).max(240),
  })
  .strict()
  .superRefine((value, context) => {
    const hasFirstReveal = Boolean(
      value.ownVotes.first && value.firstRound && value.newEvidence,
    );
    const hasFinalReveal = Boolean(
      value.ownVotes.appeal && value.appealRound && value.ending,
    );

    if (value.stage === "first_vote" && (hasFirstReveal || hasFinalReveal)) {
      context.addIssue({
        code: "custom",
        message: "1심 전에는 결과나 새 단서를 공개할 수 없어요.",
      });
    }
    if (
      value.stage === "appeal_vote"
      && (!hasFirstReveal || hasFinalReveal)
    ) {
      context.addIssue({
        code: "custom",
        message: "항소심 전 공개 단계가 올바르지 않아요.",
      });
    }
    if (value.stage === "complete" && (!hasFirstReveal || !hasFinalReveal)) {
      context.addIssue({
        code: "custom",
        message: "완료 단계의 공개 데이터가 부족해요.",
      });
    }
  });

export const weddingCourtCasesResponseSchema = z.object({
  cases: z.array(weddingCourtCaseStateSchema),
});

export const weddingCourtVoteResponseSchema = z.object({
  action: z.enum(["created", "existing"]),
  case: weddingCourtCaseStateSchema,
});

export const weddingCourtCaseRowSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]{3,48}$/u),
  docket_label: z.string().min(2).max(32),
  title: z.string().min(4).max(80),
  question: z.string().min(8).max(160),
  opening: z.string().min(8).max(280),
  initial_facts: z.array(z.string().min(1).max(180)).min(2).max(5),
  choice_a_label: z.string().min(2).max(64),
  choice_b_label: z.string().min(2).max(64),
  reason_chips: z.array(reasonChipSchema).min(4).max(8),
  new_evidence_title: z.string().min(2).max(64),
  new_evidence: z.string().min(8).max(280),
  choice_a_perspective: z.string().min(8).max(280),
  choice_b_perspective: z.string().min(8).max(280),
  ending: z.string().min(8).max(320),
  status: z.literal("active"),
  sort_order: z.number().int().min(1).max(99),
  is_synthetic: z.literal(true),
});

export const weddingCourtVoteRowSchema = z.object({
  case_id: z.string().uuid(),
  round: roundSchema,
  choice: choiceSchema,
  reason_chip: z.string().regex(/^[a-z0-9_]{1,40}$/u),
  predicted_majority: choiceSchema.nullable(),
});

export type WeddingCourtCaseRow = z.infer<typeof weddingCourtCaseRowSchema>;
export type WeddingCourtVoteRow = z.infer<typeof weddingCourtVoteRowSchema>;

const voteRequestSchema = z
  .object({
    round: roundSchema,
    choice: choiceSchema,
    reason_chip: z.string().regex(/^[a-z0-9_]{1,40}$/u),
    predicted_majority: choiceSchema.nullish(),
  })
  .strip()
  .superRefine((value, context) => {
    if (value.round === 1 && !value.predicted_majority) {
      context.addIssue({
        code: "custom",
        path: ["predicted_majority"],
        message: "1심에서는 다수 예상을 골라주세요.",
      });
    }
    if (value.round === 2 && value.predicted_majority) {
      context.addIssue({
        code: "custom",
        path: ["predicted_majority"],
        message: "항소심에는 다수 예상을 받지 않아요.",
      });
    }
  });

export function parseWeddingCourtVoteInput(
  value: unknown,
):
  | { ok: true; value: WeddingCourtVoteInput }
  | { ok: false; message: string } {
  const parsed = voteRequestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "선택 내용을 확인해주세요.",
    };
  }

  return {
    ok: true,
    value: {
      round: parsed.data.round,
      choice: parsed.data.choice,
      reasonChip: parsed.data.reason_chip,
      predictedMajority:
        parsed.data.round === 1
          ? (parsed.data.predicted_majority ?? null)
          : null,
    },
  };
}

function toOwnVote(row: WeddingCourtVoteRow): WeddingCourtOwnVote {
  return {
    round: row.round,
    choice: row.choice,
    reasonChip: row.reason_chip,
    predictedMajority: row.predicted_majority,
  };
}

function buildReasonCounts(
  votes: WeddingCourtVoteRow[],
  choice: WeddingCourtChoice,
  weddingCase: WeddingCourtCaseRow,
) {
  const counts = new Map<string, number>();
  for (const vote of votes) {
    if (vote.choice !== choice) continue;
    counts.set(vote.reason_chip, (counts.get(vote.reason_chip) ?? 0) + 1);
  }

  return weddingCase.reason_chips
    .map((chip) => ({
      id: chip.id,
      label: chip.label,
      count: counts.get(chip.id) ?? 0,
    }))
    .filter((chip) => chip.count > 0)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function buildDistribution(
  votes: WeddingCourtVoteRow[],
  weddingCase: WeddingCourtCaseRow,
  round: 1 | 2,
): WeddingCourtDistribution {
  const roundVotes = votes.filter(
    (vote) => vote.case_id === weddingCase.id && vote.round === round,
  );
  const aCount = roundVotes.filter((vote) => vote.choice === "a").length;
  const bCount = roundVotes.length - aCount;
  const aPercent =
    roundVotes.length === 0 ? 0 : Math.round((aCount / roundVotes.length) * 100);

  return {
    totalVotes: roundVotes.length,
    lean: aCount === bCount ? "tie" : aCount > bCount ? "a" : "b",
    a: { count: aCount, percent: aPercent },
    b: {
      count: bCount,
      percent: roundVotes.length === 0 ? 0 : 100 - aPercent,
    },
    reasons: {
      a: buildReasonCounts(roundVotes, "a", weddingCase),
      b: buildReasonCounts(roundVotes, "b", weddingCase),
    },
  };
}

function perspectiveSignal(
  choice: WeddingCourtChoice,
  lean: WeddingCourtDistribution["lean"],
): WeddingCourtPerspective["signal"] {
  if (lean === "tie") return "same";
  return choice === lean ? "more_selected" : "less_selected";
}

function buildPerspectives(
  weddingCase: WeddingCourtCaseRow,
  distribution: WeddingCourtDistribution,
): [WeddingCourtPerspective, WeddingCourtPerspective] {
  return [
    {
      choice: "a",
      label: weddingCase.choice_a_label,
      text: weddingCase.choice_a_perspective,
      signal: perspectiveSignal("a", distribution.lean),
    },
    {
      choice: "b",
      label: weddingCase.choice_b_label,
      text: weddingCase.choice_b_perspective,
      signal: perspectiveSignal("b", distribution.lean),
    },
  ];
}

/**
 * 결과와 새 단서의 공개 경계다. 호출자가 실수로 전체 사건 행과 전체 투표를
 * 넘겨도 본인 1심/항소심 영수증이 없으면 해당 필드를 응답 객체에 만들지 않는다.
 */
export function serializeWeddingCourtCase(
  weddingCase: WeddingCourtCaseRow,
  ownVotes: WeddingCourtVoteRow[],
  aggregateVotes: WeddingCourtVoteRow[],
): WeddingCourtCaseState {
  const ownFirst = ownVotes.find(
    (vote) => vote.case_id === weddingCase.id && vote.round === 1,
  );
  const ownAppeal = ownVotes.find(
    (vote) => vote.case_id === weddingCase.id && vote.round === 2,
  );

  const base: WeddingCourtCaseState = {
    id: weddingCase.id,
    slug: weddingCase.slug,
    docketLabel: weddingCase.docket_label,
    title: weddingCase.title,
    question: weddingCase.question,
    opening: weddingCase.opening,
    initialFacts: weddingCase.initial_facts,
    choices: {
      a: weddingCase.choice_a_label,
      b: weddingCase.choice_b_label,
    },
    reasonChips: weddingCase.reason_chips,
    synthetic: true,
    stage: ownAppeal ? "complete" : ownFirst ? "appeal_vote" : "first_vote",
    ownVotes: {
      ...(ownFirst ? { first: toOwnVote(ownFirst) } : {}),
      ...(ownAppeal ? { appeal: toOwnVote(ownAppeal) } : {}),
    },
    safetyNotice: WEDDING_COURT_SAFETY_NOTICE,
  };

  if (!ownFirst) return base;

  const firstDistribution = buildDistribution(aggregateVotes, weddingCase, 1);
  const withFirstRound: WeddingCourtCaseState = {
    ...base,
    firstRound: {
      distribution: firstDistribution,
      predictionMatchesCurrentLean:
        firstDistribution.lean === "tie"
          ? null
          : ownFirst.predicted_majority === firstDistribution.lean,
      perspectives: buildPerspectives(weddingCase, firstDistribution),
    },
    newEvidence: {
      title: weddingCase.new_evidence_title,
      detail: weddingCase.new_evidence,
    },
  };

  if (!ownAppeal) return withFirstRound;

  const appealDistribution = buildDistribution(aggregateVotes, weddingCase, 2);
  return {
    ...withFirstRound,
    appealRound: {
      distribution: appealDistribution,
      perspectives: buildPerspectives(weddingCase, appealDistribution),
    },
    ending: weddingCase.ending,
  };
}
