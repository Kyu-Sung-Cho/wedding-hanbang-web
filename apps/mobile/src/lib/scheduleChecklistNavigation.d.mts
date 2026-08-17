export interface VerifiedChecklistIdentity {
  ownerId: string;
  coupleId: string;
}

export interface VerifiedChecklistDeepLinkInput {
  checklistOnly: boolean;
  requestedCategoryKey?: string;
  availableCategoryKeys: string[];
  verifiedIdentity: VerifiedChecklistIdentity | null;
}

export interface VerifiedChecklistDeepLink {
  categoryKey: string;
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
