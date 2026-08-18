export type StoredMediationRenderSafetyViolationKind =
  | "demeaning_label"
  | "hidden_motive"
  | "moral_verdict"
  | "one_sided_priority"
  | "unilateral_demand";

export declare const MEDIATION_RENDER_SAFETY_FALLBACK: string;
export declare const MEDIATION_DISCLOSURE_VERIFYING_COPY: string;
export declare const MEDIATION_DISCLOSURE_WITHHELD_COPY: string;

export type MediationDisclosureState = "verifying" | "verified" | "withheld";
export type MediationVerificationState = "idle" | "verifying" | "verified" | "error";

export declare function resolveMediationDisclosureState(input: {
  hasExactRevision: boolean;
  verificationState: MediationVerificationState;
}): MediationDisclosureState;

export declare function findStoredMediationRenderSafetyViolations(
  value: unknown,
): StoredMediationRenderSafetyViolationKind[];

export declare function hasUnsafeStoredMediationRenderContent(
  value: unknown,
): boolean;
