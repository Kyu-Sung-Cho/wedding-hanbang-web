import type {
  AmoraActionOutcomeFeedback,
} from "@hanbang/shared/amora-action-outcome-feedback";

export type AmoraActionFeedbackFetch = (
  expectedUserId: string,
  path: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function loadOwnerAmoraActionOutcomeFeedback(
  ownerUserId: string,
  coupleId: string,
  fetchForExpectedUser: AmoraActionFeedbackFetch,
  nowMs?: number,
): Promise<Readonly<AmoraActionOutcomeFeedback> | null>;
