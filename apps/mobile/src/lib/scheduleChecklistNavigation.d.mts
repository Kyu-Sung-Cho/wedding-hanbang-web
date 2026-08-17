export interface VerifiedChecklistIdentity {
  ownerId: string;
  coupleId: string;
}

export function buildChecklistDeepLinkParams(input: Readonly<{
  categoryKey: string;
  actionId?: string;
  actionRevision?: number | null;
}>): Readonly<{
  category: string;
  action?: string;
  actionRevision?: string;
}> | null;

export interface VerifiedChecklistDeepLinkInput {
  checklistOnly: boolean;
  requestedCategoryKey?: string;
  requestedActionId?: string;
  requestedActionRevision?: string;
  availableCategoryKeys: string[];
  availableActions?: readonly Readonly<{
    id: string;
    categoryKey: string | null;
    sourceRevision: number | null;
  }>[];
  verifiedIdentity: VerifiedChecklistIdentity | null;
}

export interface VerifiedChecklistDeepLink {
  categoryKey: string;
  actionId?: string;
  actionRevision?: number | null;
  handledKey: string;
}

export function buildVerifiedChecklistDeepLink(
  input: VerifiedChecklistDeepLinkInput,
): VerifiedChecklistDeepLink | null;

export interface VerifiedChecklistDeepLinkFocusTargetInput {
  deepLink: VerifiedChecklistDeepLink | null;
  laidOutCategoryKey: string;
  layoutY: number;
  focusedHandledKey: string | null;
}

export interface VerifiedChecklistDeepLinkFocusTarget {
  categoryKey: string;
  handledKey: string;
  scrollY: number;
}

export function buildVerifiedChecklistDeepLinkFocusTarget(
  input: VerifiedChecklistDeepLinkFocusTargetInput,
): VerifiedChecklistDeepLinkFocusTarget | null;
