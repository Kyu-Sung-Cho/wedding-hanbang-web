export declare const AMORA_REQUESTER_SUMMARY_MEDIATION: {
  readonly origin: "user_requested";
  readonly evidenceScope: "requester_summary_only";
  readonly schemaVersion: 2;
};

export declare function isRequesterSummaryMediationProvenance(value: unknown): boolean;

export interface AmoraPrivateMediationDraftMetadata {
  state: "draft" | "sent";
  rosterFingerprint: string;
  sharedMessageId: string | null;
}

export declare function readAmoraPrivateMediationDraftMetadata(
  metadata: unknown,
  visibility: unknown,
): AmoraPrivateMediationDraftMetadata | null;
