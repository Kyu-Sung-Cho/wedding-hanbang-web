import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  serializeWeddingCourtCase,
  weddingCourtCaseRowSchema,
  weddingCourtVoteRowSchema,
} from "./contract";
import type {
  WeddingCourtCaseState,
  WeddingCourtVoteInput,
  WeddingCourtVoteReceipt,
} from "./types";

const caseRowsSchema = z.array(weddingCourtCaseRowSchema);
const voteRowsSchema = z.array(weddingCourtVoteRowSchema);
const rpcReceiptSchema = z.object({
  ok: z.literal(true),
  action: z.enum(["created", "existing"]),
});

export type WeddingCourtRepositoryErrorCode =
  | "case_not_found"
  | "first_round_required"
  | "invalid_vote"
  | "vote_locked"
  | "unavailable";

export class WeddingCourtRepositoryError extends Error {
  constructor(public readonly code: WeddingCourtRepositoryErrorCode) {
    super(code);
    this.name = "WeddingCourtRepositoryError";
  }
}

function repositoryErrorFromMessage(message: string): WeddingCourtRepositoryError {
  if (message.includes("case_not_found")) {
    return new WeddingCourtRepositoryError("case_not_found");
  }
  if (message.includes("first_round_required")) {
    return new WeddingCourtRepositoryError("first_round_required");
  }
  if (message.includes("vote_locked")) {
    return new WeddingCourtRepositoryError("vote_locked");
  }
  if (
    [
      "invalid_user",
      "invalid_round",
      "invalid_choice",
      "invalid_reason_chip",
      "prediction_required",
      "prediction_not_allowed",
    ].some((code) => message.includes(code))
  ) {
    return new WeddingCourtRepositoryError("invalid_vote");
  }
  return new WeddingCourtRepositoryError("unavailable");
}

export async function loadWeddingCourtCasesForUser(
  userId: string,
  onlyCaseId?: string,
): Promise<WeddingCourtCaseState[]> {
  const serviceClient = createAdminClient();
  let casesQuery = serviceClient
    .from("wedding_court_cases")
    .select(
      "id, slug, docket_label, title, question, opening, initial_facts, "
        + "choice_a_label, choice_b_label, reason_chips, new_evidence_title, "
        + "new_evidence, choice_a_perspective, choice_b_perspective, ending, "
        + "status, sort_order, is_synthetic",
    )
    .eq("status", "active")
    .order("sort_order", { ascending: true });

  if (onlyCaseId) {
    casesQuery = casesQuery.eq("id", onlyCaseId);
  }

  const { data: rawCases, error: casesError } = await casesQuery;
  if (casesError) throw new WeddingCourtRepositoryError("unavailable");

  const parsedCases = caseRowsSchema.safeParse(rawCases ?? []);
  if (!parsedCases.success) {
    throw new WeddingCourtRepositoryError("unavailable");
  }
  if (onlyCaseId && parsedCases.data.length === 0) {
    throw new WeddingCourtRepositoryError("case_not_found");
  }
  if (parsedCases.data.length === 0) return [];

  const caseIds = parsedCases.data.map((weddingCase) => weddingCase.id);
  const { data: rawOwnVotes, error: ownVotesError } = await serviceClient
    .from("wedding_court_votes")
    .select("case_id, round, choice, reason_chip, predicted_majority")
    .eq("user_id", userId)
    .in("case_id", caseIds);
  if (ownVotesError) throw new WeddingCourtRepositoryError("unavailable");

  const parsedOwnVotes = voteRowsSchema.safeParse(rawOwnVotes ?? []);
  if (!parsedOwnVotes.success) {
    throw new WeddingCourtRepositoryError("unavailable");
  }

  const revealedCaseIds = new Set(
    parsedOwnVotes.data
      .filter((vote) => vote.round === 1)
      .map((vote) => vote.case_id),
  );

  let aggregateVotes: z.infer<typeof voteRowsSchema> = [];
  if (revealedCaseIds.size > 0) {
    const { data: rawAggregateVotes, error: aggregateError } = await serviceClient
      .from("wedding_court_votes")
      .select("case_id, round, choice, reason_chip, predicted_majority")
      .in("case_id", [...revealedCaseIds]);
    if (aggregateError) throw new WeddingCourtRepositoryError("unavailable");

    const parsedAggregateVotes = voteRowsSchema.safeParse(rawAggregateVotes ?? []);
    if (!parsedAggregateVotes.success) {
      throw new WeddingCourtRepositoryError("unavailable");
    }
    aggregateVotes = parsedAggregateVotes.data;
  }

  return parsedCases.data.map((weddingCase) =>
    serializeWeddingCourtCase(
      weddingCase,
      parsedOwnVotes.data,
      aggregateVotes,
    ),
  );
}

export async function castWeddingCourtVote(
  userId: string,
  caseId: string,
  input: WeddingCourtVoteInput,
): Promise<WeddingCourtVoteReceipt> {
  const serviceClient = createAdminClient();
  const { data: rawReceipt, error } = await serviceClient.rpc(
    "wedding_court_cast_vote",
    {
      p_user_id: userId,
      p_case_id: caseId,
      p_round: input.round,
      p_choice: input.choice,
      p_reason_chip: input.reasonChip,
      p_predicted_majority: input.predictedMajority,
    },
  );

  if (error) throw repositoryErrorFromMessage(error.message);

  const receipt = rpcReceiptSchema.safeParse(rawReceipt);
  if (!receipt.success) throw new WeddingCourtRepositoryError("unavailable");

  const cases = await loadWeddingCourtCasesForUser(userId, caseId);
  const courtCase = cases[0];
  if (!courtCase) throw new WeddingCourtRepositoryError("unavailable");

  return {
    action: receipt.data.action,
    courtCase,
  };
}
