import type { AmoraCoreCriterion } from "@hanbang/shared/amora-core-criterion";
import type { AmoraCoupleCriterionResponse } from "@hanbang/shared/amora-couple-criterion";
import type { AmoraPersonalizationPreferences } from "./amoraPersonalization.mjs";
import type { DashboardActionOutcomeFeedback } from "./amoraActionFeedback.mjs";

export function loadLoungeActionFeedback(
  ownerUserId: string,
  coupleId: string,
): Promise<DashboardActionOutcomeFeedback | null>;
export function loadLoungePersonalization(
  ownerUserId: string,
): Promise<Readonly<AmoraPersonalizationPreferences> | null>;
export function loadLoungeCoupleCriterion(
  ownerUserId: string,
  coupleId: string,
): Promise<{ loaded: boolean; value: Readonly<AmoraCoupleCriterionResponse> | null }>;
export function loadLoungeCoreCriterion(
  ownerUserId: string,
): Promise<{ loaded: boolean; criterion: Readonly<AmoraCoreCriterion> | null }>;
