export interface ChecklistApprovalTemplate {
  key: string;
  label: string;
  items: ReadonlyArray<{ id: string; label: string }>;
}

export interface ChecklistSituationProposal {
  kind: "checklist_situation";
  baseRevision: number;
  progressPatch: Record<string, unknown>;
}

export interface ChecklistApprovalQuestionChange {
  key: string;
  label: string;
  before: string;
  after: string;
}

export interface ChecklistApprovalItemChange {
  categoryKey: string;
  categoryLabel: string;
  itemId: string;
  label: string;
  completionEvidenceCleared: boolean;
}

export interface ChecklistApprovalCategoryChange {
  categoryKey: string;
  categoryLabel: string;
  beforeStatus: "not_started" | "in_progress" | "completed" | "not_applicable";
  afterStatus: "not_started" | "in_progress" | "completed" | "not_applicable";
  statusChanged: boolean;
  excludedCount: number;
  restoredCount: number;
  beforeApplicable: boolean;
  afterApplicable: boolean;
  applicabilityChanged: boolean;
  reviewChanged: boolean;
  reviewChangeKind: "unchanged" | "added" | "cleared";
  addedCount: number;
  renamedCount: number;
}

export interface ChecklistApprovalStructuralChange {
  categoryKey: string;
  categoryLabel: string;
  addedCount: number;
  renamedCount: number;
}

export type ChecklistApprovalDisclosure =
  | {
      status: "unsafe";
      reason: string;
    }
  | {
      status: "ready";
      baseRevision: number;
      questionChanges: ChecklistApprovalQuestionChange[];
      categories: ChecklistApprovalCategoryChange[];
      excludedItems: ChecklistApprovalItemChange[];
      restoredItems: ChecklistApprovalItemChange[];
      structuralChanges: ChecklistApprovalStructuralChange[];
      automaticExclusionTotal: number;
    };

export function buildChecklistApprovalDisclosure(input: {
  currentProgress: Record<string, unknown>;
  currentRevision: number;
  proposal: unknown;
  templates: ReadonlyArray<ChecklistApprovalTemplate>;
}): ChecklistApprovalDisclosure;

export function isChecklistSituationProposal(
  value: unknown,
): value is ChecklistSituationProposal;
