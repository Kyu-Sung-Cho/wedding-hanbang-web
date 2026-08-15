import type { TodayOneCareCard } from "@hanbang/shared";
import type {
  AmoraScheduleCareActionDraft,
  AmoraScheduleCareFollowUpBinding,
} from "@hanbang/shared/amora-schedule-care-follow-up";

export const SCHEDULE_CARE_FOLLOW_UP_PREVIEW_TIMEOUT_MS: 8000;

export function buildScheduleCarePrivateFollowUpPrompt(
  card: Pick<TodayOneCareCard, "kind" | "confirmed" | "care">,
): string | null;

export function verifyScheduleCarePrivateFollowUpIdentity(input: {
  expectedOwnerUserId: string | null | undefined;
  recipientUserId: string | null | undefined;
  expectedCoupleId: string | null | undefined;
  verifiedOwnerUserId: string | null | undefined;
  verifiedCoupleId: string | null | undefined;
}): { ownerUserId: string; coupleId: string } | null;

export function buildScheduleCareFollowUpBinding(
  card: Pick<TodayOneCareCard, "id" | "revision" | "sourceRevision" | "kind" | "confirmed" | "care">,
): AmoraScheduleCareFollowUpBinding | null;

export function parseScheduleCareFollowUpRouteBinding(
  value: unknown,
): AmoraScheduleCareFollowUpBinding | null;

export type ScheduleCareFollowUpPreviewStatus =
  | "timeout"
  | "unavailable"
  | "identity_changed"
  | "stale";

export type ScheduleCareFollowUpPreview =
  | Readonly<{ status: ScheduleCareFollowUpPreviewStatus }>
  | Readonly<{
      status: "ready";
      ownerUserId: string;
      coupleId: string;
      binding: AmoraScheduleCareFollowUpBinding;
      expiresAt: string;
      prompt: string;
    }>;

export function loadScheduleCareFollowUpPreview(input: {
  expectedOwnerUserId: unknown;
  expectedCoupleId: unknown;
  binding: unknown;
  fetchForExpectedUser: (
    expectedUserId: string,
    path: string,
    options: {
      method: "GET";
      headers: { Accept: "application/json" };
      signal: AbortSignal;
    },
  ) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  signal?: AbortSignal;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<ScheduleCareFollowUpPreview>;

export interface ScheduleCareFollowUpOperation {
  readonly binding: AmoraScheduleCareFollowUpBinding;
  readonly sessionGeneration: number;
  readonly controller: AbortController;
}

export interface ScheduleCareFollowUpOperationGuard {
  start(
    binding: unknown,
    sessionGeneration: unknown,
  ): ScheduleCareFollowUpOperation | null;
  cancel(operation: ScheduleCareFollowUpOperation | null): boolean;
  isCurrent(operation: ScheduleCareFollowUpOperation | null): boolean;
  finish(operation: ScheduleCareFollowUpOperation | null): boolean;
  current(): ScheduleCareFollowUpOperation | null;
}

export function createScheduleCareFollowUpOperationGuard(): ScheduleCareFollowUpOperationGuard;

export interface ScheduleCareFollowUpComposerBinding {
  readonly ownerUserId: string;
  readonly coupleId: string;
  readonly binding: AmoraScheduleCareFollowUpBinding;
  readonly prompt: string;
}

export function createScheduleCareFollowUpComposerBinding(
  preview: unknown,
): Readonly<ScheduleCareFollowUpComposerBinding> | null;

export interface ScheduleCareFollowUpComposerContext {
  ownerUserId: unknown;
  coupleId: unknown;
  lane: unknown;
  privateText: unknown;
}

export type ScheduleCareFollowUpComposerIssue =
  | "answer_required"
  | "answer_invalid"
  | "source_changed"
  | "identity_changed";

export function getScheduleCareFollowUpComposerIssue(
  binding: unknown,
  context: ScheduleCareFollowUpComposerContext,
): ScheduleCareFollowUpComposerIssue | null;

export interface ScheduleCareFollowUpFailureRecovery {
  readonly status: "answer_invalid" | "stale" | "identity_changed" | "unavailable";
  readonly action: "restart_from_home" | "retry_same_request";
  readonly actionLabel: string;
  readonly message: string;
}

export function getScheduleCareFollowUpFailureRecovery(
  input?: unknown,
): Readonly<ScheduleCareFollowUpFailureRecovery> | null;

export function resolveScheduleCareFollowUpBindingForSend(
  binding: unknown,
  context: ScheduleCareFollowUpComposerContext,
): AmoraScheduleCareFollowUpBinding | null;

export function reconcileScheduleCareFollowUpComposerBinding(
  binding: ScheduleCareFollowUpComposerBinding | null,
  context: ScheduleCareFollowUpComposerContext,
): ScheduleCareFollowUpComposerBinding | null;

export function validateScheduleCareFollowUpIngestReceipt(input: {
  requestedBinding: unknown;
  messageMetadata: unknown;
}): boolean;

export function readScheduleCareFollowUpBindingFromMetadata(
  messageMetadata: unknown,
): AmoraScheduleCareFollowUpBinding | null;

export function getScheduleCareFollowUpActionDraft(
  metadata: unknown,
): AmoraScheduleCareActionDraft | null;

export function buildScheduleCareSharedActionDraft(
  value: unknown,
): string | null;

export type ScheduleCareSharedDraftPreparation =
  | Readonly<{ status: ScheduleCareFollowUpPreviewStatus }>
  | Readonly<{ status: "ready"; sharedDraft: string }>;

export function prepareScheduleCareSharedDraft(input: {
  expectedOwnerUserId: unknown;
  expectedCoupleId: unknown;
  expectedSessionGeneration: unknown;
  sourceMessageId: unknown;
  sourceMetadata: unknown;
  fetchForExpectedUser: (
    expectedUserId: string,
    path: string,
    options: {
      method: "GET";
      headers: { Accept: "application/json" };
      signal: AbortSignal;
    },
  ) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  readCurrentContext: () => Promise<unknown> | unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  nowMs?: number;
}): Promise<ScheduleCareSharedDraftPreparation>;
