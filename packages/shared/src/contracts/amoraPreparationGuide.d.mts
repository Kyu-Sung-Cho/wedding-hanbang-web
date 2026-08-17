export declare const AMORA_PREPARATION_GUIDE_CONTRACT_VERSION: 1;

export type AmoraPreparationGuideModule = Readonly<{
  version: 1;
  moduleId: string;
  topicKey: "meeting" | "venue" | "studio" | "makeup" | "mc";
  title: string;
  whyShown: Readonly<{
    kind: "unfinished_checklist_item";
    checklistItemId: string;
    label: string;
  }>;
  decisions: readonly string[];
  exceptions: readonly string[];
  dialogueLines: readonly Readonly<{
    say: string;
    note?: string;
  }>[];
  completionEvidence: readonly string[];
  provenance: Readonly<{
    sourceKind: "independent_reviewed_guidance";
    contentRevision: 1;
    reviewedAt: string;
    reviewDueAt: string;
    applicabilityScope: string;
    limitations: readonly string[];
  }>;
}>;

export type AmoraPreparationGuideValidationResult =
  | Readonly<{ ok: true; value: AmoraPreparationGuideModule }>
  | Readonly<{
      ok: false;
      reason: "module" | "version" | "identity" | "why_shown" | "content" | "provenance";
    }>;

export declare function validateAmoraPreparationGuideModule(
  value: unknown,
  expectedTopicKey?: string,
): AmoraPreparationGuideValidationResult;

export declare function buildAmoraPreparationGuideModules(input?: Readonly<{
  topicKey?: unknown;
  applicability?: unknown;
  status?: unknown;
  asOfDate?: unknown;
  checklistItems?: readonly unknown[];
}>): readonly AmoraPreparationGuideModule[];
