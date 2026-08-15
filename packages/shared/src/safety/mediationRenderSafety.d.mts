export type StoredMediationRenderSafetyViolationKind =
  | "demeaning_label"
  | "hidden_motive"
  | "moral_verdict"
  | "one_sided_priority"
  | "unilateral_demand";

export declare const MEDIATION_RENDER_SAFETY_FALLBACK: string;

export declare function findStoredMediationRenderSafetyViolations(
  value: unknown,
): StoredMediationRenderSafetyViolationKind[];

export declare function hasUnsafeStoredMediationRenderContent(
  value: unknown,
): boolean;
