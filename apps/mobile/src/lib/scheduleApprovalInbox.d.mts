export type ScheduleApprovalRole = "reviewer" | "requester";
export type ScheduleApprovalAction = "approve" | "reject" | "withdraw";

export interface ScheduleApprovalNotificationCandidate {
  requestId: string;
  role: ScheduleApprovalRole;
  createdAt: string;
}

export interface ScheduleApprovalRequest extends ScheduleApprovalNotificationCandidate {
  summary: string;
  proposal: ScheduleApprovalProposal;
  disclosureReceipt?: string;
}

export type ScheduleApprovalProposal =
  | { kind: "other" }
  | { kind: "unavailable" }
  | {
      kind: "checklist_situation";
      baseRevision: number;
      progressPatch: Record<string, unknown>;
    };

export type ScheduleApprovalStatus = {
  requestId: string;
  status: "applied" | "pending_partner" | "stale" | "rejected";
  summary: string;
  proposal: ScheduleApprovalProposal;
  disclosureReceipt?: string;
};

export type ScheduleMutationSubmission =
  | { status: "applied" }
  | { status: "pending_partner"; requestId: string; summary: string };

export type ScheduleApprovalActionResult =
  | { status: "applied" | "rejected" | "withdrawn" | "conflict" }
  | {
      status: "terminal";
      terminalStatus: "applied" | "stale" | "rejected";
    };

type AuthenticatedApiFetch = (
  path: string,
  options?: RequestInit,
) => Promise<Response>;

export function parseScheduleMutationSubmission(
  value: unknown,
): ScheduleMutationSubmission;

export function parseScheduleApprovalNotifications(
  value: unknown,
  expectedOwnerId: string,
): ScheduleApprovalNotificationCandidate[];

export function parseScheduleActiveApprovalInbox(
  value: unknown,
  expectedOwnerId: string,
  expectedCoupleId: string,
): ScheduleApprovalNotificationCandidate[];

export function parseScheduleApprovalStatus(
  value: unknown,
  expectedRequestId: string,
  expectedCoupleId: string,
): ScheduleApprovalStatus;

export function fetchScheduleApprovalInbox(input: {
  apiFetch: AuthenticatedApiFetch;
  ownerId: string;
  coupleId: string;
}): Promise<{
  requests: ScheduleApprovalRequest[];
  definitivelyRemovedIds: string[];
  partial: boolean;
}>;

export function mergeScheduleApprovalInbox(
  current: ScheduleApprovalRequest[],
  result: {
    requests: ScheduleApprovalRequest[];
    definitivelyRemovedIds: string[];
    partial: boolean;
  },
): ScheduleApprovalRequest[];

export function actOnScheduleApproval(input: {
  apiFetch: AuthenticatedApiFetch;
  coupleId: string;
  request: Pick<
    ScheduleApprovalRequest,
    "requestId" | "role" | "proposal" | "disclosureReceipt"
  >;
  action: ScheduleApprovalAction;
  reviewedBaseRevision?: number;
}): Promise<ScheduleApprovalActionResult>;
