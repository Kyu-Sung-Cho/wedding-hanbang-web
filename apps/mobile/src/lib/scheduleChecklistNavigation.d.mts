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
