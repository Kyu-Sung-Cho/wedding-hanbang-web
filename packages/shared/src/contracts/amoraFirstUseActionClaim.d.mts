import type { AmoraFirstUseGrounding } from "./amoraFirstUseGrounding.mjs";

export interface AmoraFirstUseActionClaimDraft {
  action: string;
  reason: string;
  completionCriterion: string;
}

export function guardAmoraFirstUseActionClaim(input: {
  action: unknown;
  reason: unknown;
  completionCriterion: unknown;
  grounding: unknown;
}): Readonly<AmoraFirstUseActionClaimDraft> | null;

export type { AmoraFirstUseGrounding };
