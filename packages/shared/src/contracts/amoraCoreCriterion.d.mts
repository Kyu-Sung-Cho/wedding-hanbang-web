export const AMORA_CORE_CRITERION_CONTRACT_VERSION: 1;
export const AMORA_CORE_CRITERION_MAX_LENGTH: 120;

export function normalizeAmoraCoreCriterionText(value: unknown): string | null;

export interface AmoraCoreCriterion {
  id: string;
  value: string;
  updatedAt: string;
}

export interface AmoraCoreCriterionResponse {
  version: 1;
  criterion: AmoraCoreCriterion | null;
}

export function parseAmoraCoreCriterionResponse(
  value: unknown,
): AmoraCoreCriterionResponse | null;

export interface AmoraCoreCriterionSaveRequest {
  version: 1;
  expectedCriterionId: string | null;
  requestId: string;
  value: string;
}

export function parseAmoraCoreCriterionSaveRequest(
  value: unknown,
): AmoraCoreCriterionSaveRequest | null;

export function buildAmoraCoreCriterionSaveRequest(input: {
  expectedCriterionId: string | null;
  requestId: string;
  value: unknown;
}): AmoraCoreCriterionSaveRequest | null;

export interface AmoraCoreCriterionDeleteRequest {
  version: 1;
  expectedCriterionId: string;
  requestId: string;
}

export function parseAmoraCoreCriterionDeleteRequest(
  value: unknown,
): AmoraCoreCriterionDeleteRequest | null;

export function buildAmoraCoreCriterionDeleteRequest(input: {
  expectedCriterionId: string;
  requestId: string;
}): AmoraCoreCriterionDeleteRequest | null;
