import type { AmoraCoreCriterion } from "@hanbang/shared/amora-core-criterion";

export interface AmoraCoreCriterionLoadResult {
  readonly loaded: boolean;
  readonly criterion: AmoraCoreCriterion | null;
}

export function loadOwnerAmoraCoreCriterion(
  ownerUserId: string,
  fetchForExpectedUser: (
    expectedUserId: string,
    path: string,
    options: {
      method: "GET";
      headers: { Accept: "application/json" };
    },
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
): Promise<Readonly<AmoraCoreCriterionLoadResult>>;
