import type { AmoraCoupleCriterionResponse } from "@hanbang/shared/amora-couple-criterion";

export type AmoraCoupleCriterionViewStatus =
  | "unlinked"
  | "empty"
  | "confirmed"
  | "waiting_partner"
  | "review_required";

export interface AmoraCoupleCriterionView {
  readonly status: AmoraCoupleCriterionViewStatus;
  readonly currentValue: string | null;
  readonly proposalValue: string | null;
  readonly canPropose: boolean;
  readonly canAccept: boolean;
  readonly canCancel: boolean;
}

export function getAmoraCoupleCriterionView(
  value: unknown,
  ownerUserId: string,
): Readonly<AmoraCoupleCriterionView> | null;

export interface AmoraCoupleCriterionLoadResult {
  readonly loaded: boolean;
  readonly value: AmoraCoupleCriterionResponse | null;
}

export function loadOwnerAmoraCoupleCriterion(
  ownerUserId: string,
  expectedCoupleId: string,
  fetchForExpectedUser: (
    expectedUserId: string,
    path: string,
    options: { method: "GET"; headers: { Accept: "application/json" } },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
): Promise<Readonly<AmoraCoupleCriterionLoadResult>>;
