import type { DashboardOpenAction } from "./dashboardExperience.mjs";

export function stageActionReceiptHomeHandoff(input: {
  handoffId: string;
  ownerUserId: string;
  coupleId: string;
  actionId: string;
  nowMs?: number;
}): string | null;

export function consumeActionReceiptHomeHandoff(
  handoffId: string,
  expectedOwnerUserId: string,
  expectedCoupleId: string,
  nowMs?: number,
): { actionId: string } | null;

export type ActionReceiptHomeHandoffReadResult =
  | { ok: true; value: unknown }
  | { ok: false };

export type ActionReceiptHomeHandoffResolution =
  | { state: "focused"; action: DashboardOpenAction }
  | { state: "retry" }
  | { state: "rejected" };

export function resolveActionReceiptHomeHandoff(input: {
  handoffId: string;
  expectedOwnerUserId: string;
  expectedCoupleId: string;
  isResolutionCurrent: () => boolean;
  readCurrentOpenAction: (identity: {
    actionId: string;
    coupleId: string;
  }) => Promise<ActionReceiptHomeHandoffReadResult>;
  nowMs?: number;
}): Promise<ActionReceiptHomeHandoffResolution>;
