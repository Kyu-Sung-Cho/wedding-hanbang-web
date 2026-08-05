import { isRequesterSummaryMediationProvenance } from "@hanbang/shared/mediation-provenance";
import { apiJson } from "./api";

export interface MediationBlock {
  empathy?: string;
  translation?: string;
  data?: string;
  resolution?: string;
  proposalVersion?: string;
  rosterFingerprint?: string;
  /**
   * 이 초안이 "요청자가 쓴 요약만" 계약으로 만들어졌는지. 화면 문구가 그 말을 누가
   * 했는지 정직하게 쓰려면 이 값이 필요하다. 예전에는 여기서 버려서, 앱이 한 사람의
   * 일방적 진술을 "두 분의 대화"라고 부르고 있었다.
   */
  requesterSummaryOnly?: boolean;
}

export interface MediationAcceptanceState {
  accepted: boolean;
  acceptedCount: number;
  requiredCount: number;
  completed: boolean;
  partnerLinked?: boolean;
}

export interface ExpectedMediationRevision {
  expectedProposalVersion: string;
  expectedRosterFingerprint: string;
}

const MAX_FIELD_LENGTH = 2_000;
const MAX_RESOLUTION_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROSTER_FINGERPRINT_PATTERN = /^[a-f0-9]{32}$/;

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
    proposalVersion: typeof candidate.proposalVersion === "string"
      && UUID_PATTERN.test(candidate.proposalVersion)
      ? candidate.proposalVersion.toLowerCase()
      : undefined,
    rosterFingerprint: typeof candidate.rosterFingerprint === "string"
      && ROSTER_FINGERPRINT_PATTERN.test(candidate.rosterFingerprint)
      ? candidate.rosterFingerprint
      : undefined,
  };

  // 출처는 내용이 아니다. 표식만 있고 본문이 없는 값을 카드로 만들지 않도록,
  // 내용 유무를 먼저 판단한 다음에 붙인다.
  if (!Object.values(block).some(Boolean)) return null;

  block.requesterSummaryOnly = isRequesterSummaryMediationProvenance(candidate);
  return block;
}

export function getExpectedMediationRevision(
  block: MediationBlock,
): ExpectedMediationRevision | null {
  if (
    typeof block.proposalVersion !== "string"
    || !UUID_PATTERN.test(block.proposalVersion)
    || typeof block.rosterFingerprint !== "string"
    || !ROSTER_FINGERPRINT_PATTERN.test(block.rosterFingerprint)
  ) return null;

  return {
    expectedProposalVersion: block.proposalVersion.toLowerCase(),
    expectedRosterFingerprint: block.rosterFingerprint,
  };
}

function requireExpectedMediationRevision(
  revision: ExpectedMediationRevision,
): ExpectedMediationRevision {
  const expectedProposalVersion = revision?.expectedProposalVersion;
  const expectedRosterFingerprint = revision?.expectedRosterFingerprint;
  if (
    typeof expectedProposalVersion !== "string"
    || !UUID_PATTERN.test(expectedProposalVersion)
    || typeof expectedRosterFingerprint !== "string"
    || !ROSTER_FINGERPRINT_PATTERN.test(expectedRosterFingerprint)
  ) {
    throw new Error("표시된 선택안의 정확한 버전을 확인할 수 없습니다.");
  }
  return {
    expectedProposalVersion: expectedProposalVersion.toLowerCase(),
    expectedRosterFingerprint,
  };
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
    && typeof candidate.completed === "boolean"
    && (
      candidate.partnerLinked === undefined
      || typeof candidate.partnerLinked === "boolean"
    );
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
    ...(typeof candidate.partnerLinked === "boolean"
      ? { partnerLinked: candidate.partnerLinked }
      : {}),
  };
}

export function canWithdrawMediationAcceptance(
  state: MediationAcceptanceState | null,
): boolean {
  return Boolean(state?.accepted && !state.completed);
}

export function canAcceptMediationResolution(
  state: MediationAcceptanceState | null,
): boolean {
  return Boolean(
    state
    && state.partnerLinked === true
    && !state.accepted
    && !state.completed,
  );
}

export async function getMediationAcceptance(
  messageId: string,
  revision: ExpectedMediationRevision,
): Promise<MediationAcceptanceState> {
  const exactRevision = requireExpectedMediationRevision(revision);
  const payload = await apiJson<unknown>(
    `/api/amora/mediation/accept?messageId=${encodeURIComponent(messageId)}`
      + `&expectedProposalVersion=${encodeURIComponent(exactRevision.expectedProposalVersion)}`
      + `&expectedRosterFingerprint=${encodeURIComponent(exactRevision.expectedRosterFingerprint)}`,
    { cache: "no-store" },
  );
  return parseMediationAcceptanceState(payload);
}

export async function acceptMediationResolution(
  messageId: string,
  revision: ExpectedMediationRevision,
): Promise<MediationAcceptanceState> {
  const exactRevision = requireExpectedMediationRevision(revision);
  const payload = await apiJson<unknown>("/api/amora/mediation/accept", {
    method: "POST",
    body: JSON.stringify({ messageId, ...exactRevision }),
  });
  return parseMediationAcceptanceState(payload);
}

export async function withdrawMediationAcceptance(
  messageId: string,
  revision: ExpectedMediationRevision,
): Promise<MediationAcceptanceState> {
  const exactRevision = requireExpectedMediationRevision(revision);
  const payload = await apiJson<unknown>("/api/amora/mediation/accept", {
    method: "DELETE",
    body: JSON.stringify({ messageId, ...exactRevision }),
  });
  const state = parseMediationAcceptanceState(payload);
  if (state.accepted || state.completed) {
    throw new Error("확인 취소 응답이 올바르지 않습니다.");
  }
  return state;
}
