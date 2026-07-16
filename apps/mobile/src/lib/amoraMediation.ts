import { apiJson } from "./api";

export interface MediationBlock {
  empathy?: string;
  translation?: string;
  data?: string;
  resolution?: string;
}

export interface MediationAcceptanceState {
  accepted: boolean;
  acceptedCount: number;
  requiredCount: number;
  completed: boolean;
}

const MAX_FIELD_LENGTH = 2_000;
const MAX_RESOLUTION_LENGTH = 500;

function normalizedField(value: unknown, maxLength = MAX_FIELD_LENGTH): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return undefined;
  return normalized;
}

export function normalizeMediationBlock(value: unknown): MediationBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const block: MediationBlock = {
    empathy: normalizedField(candidate.empathy),
    translation: normalizedField(candidate.translation),
    data: normalizedField(candidate.data),
    resolution: normalizedField(candidate.resolution, MAX_RESOLUTION_LENGTH),
  };

  return Object.values(block).some(Boolean) ? block : null;
}

export function parseMediationAcceptanceState(value: unknown): MediationAcceptanceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("동의 상태 응답이 올바르지 않습니다.");
  }

  const candidate = value as Record<string, unknown>;
  const acceptedCount = candidate.acceptedCount;
  const requiredCount = candidate.requiredCount;
  const validCounts = Number.isInteger(acceptedCount)
    && Number.isInteger(requiredCount)
    && (acceptedCount as number) >= 0
    && (requiredCount as number) > 0
    && (acceptedCount as number) <= (requiredCount as number);
  const validBooleans = typeof candidate.accepted === "boolean"
    && typeof candidate.completed === "boolean";
  const validRelationship = validCounts
    && (!candidate.accepted || (acceptedCount as number) > 0)
    && (!candidate.completed || (
      candidate.accepted === true
      && acceptedCount === requiredCount
    ));

  if (!validBooleans || !validRelationship) {
    throw new Error("동의 상태 응답이 올바르지 않습니다.");
  }

  return {
    accepted: candidate.accepted as boolean,
    acceptedCount: acceptedCount as number,
    requiredCount: requiredCount as number,
    completed: candidate.completed as boolean,
  };
}

export function canWithdrawMediationAcceptance(
  state: MediationAcceptanceState | null,
): boolean {
  return Boolean(state?.accepted && !state.completed);
}

export async function getMediationAcceptance(
  messageId: string,
): Promise<MediationAcceptanceState> {
  const payload = await apiJson<unknown>(
    `/api/amora/mediation/accept?messageId=${encodeURIComponent(messageId)}`,
    { cache: "no-store" },
  );
  return parseMediationAcceptanceState(payload);
}

export async function acceptMediationResolution(
  messageId: string,
): Promise<MediationAcceptanceState> {
  const payload = await apiJson<unknown>("/api/amora/mediation/accept", {
    method: "POST",
    body: JSON.stringify({ messageId }),
  });
  return parseMediationAcceptanceState(payload);
}

export async function withdrawMediationAcceptance(
  messageId: string,
): Promise<MediationAcceptanceState> {
  const payload = await apiJson<unknown>("/api/amora/mediation/accept", {
    method: "DELETE",
    body: JSON.stringify({ messageId }),
  });
  const state = parseMediationAcceptanceState(payload);
  if (state.accepted || state.completed) {
    throw new Error("확인 취소 응답이 올바르지 않습니다.");
  }
  return state;
}
