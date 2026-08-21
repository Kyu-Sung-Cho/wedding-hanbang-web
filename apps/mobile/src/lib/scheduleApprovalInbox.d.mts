export type ScheduleApprovalRole = "reviewer" | "requester";
export type ScheduleApprovalAction = "approve" | "reject" | "withdraw";

export interface ScheduleApprovalNotificationCandidate {
  requestId: string;
  role: ScheduleApprovalRole;
  createdAt: string;
}

export interface ScheduleApprovalRequest extends ScheduleApprovalNotificationCandidate {
  summary: string;
}

export type ScheduleApprovalStatus = {
  requestId: string;
  status: "applied" | "pending_partner" | "stale" | "rejected";
  summary: string;
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
  /** 사라진 요청이 어떻게 끝났는지. 화면이 사용자에게 말하는 근거. */
  resolvedOutcomes: Array<{
    requestId: string;
    status: ScheduleApprovalStatus["status"];
    summary: string;
    role: ScheduleApprovalRequest["role"];
  }>;
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
  request: Pick<ScheduleApprovalRequest, "requestId" | "role">;
  action: ScheduleApprovalAction;
}): Promise<ScheduleApprovalActionResult>;
