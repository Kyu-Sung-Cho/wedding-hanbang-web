import type { PlanningFoundationSelfReportedStage } from "@hanbang/shared";

export type PlanningFoundationDraftHandoffOwner = {
  ownerUserId: string;
  coupleId: string;
};

export type PlanningFoundationDraftHandoffInput =
  PlanningFoundationDraftHandoffOwner & {
    stage: PlanningFoundationSelfReportedStage;
  };

export function planningFoundationDraftHandoffDigestInput(
  ownerUserId: unknown,
  coupleId: unknown,
): string | null;

export function planningFoundationDraftHandoffPersistentKey(
  digest: unknown,
): string | null;

export function createPlanningFoundationDraftHandoffRecord(input: {
  ownerUserId: string;
  coupleId: string;
  stage: PlanningFoundationSelfReportedStage;
  nowMs: number;
  ttlMs?: number;
}): string;

export function parsePlanningFoundationDraftHandoffRecord(
  raw: unknown,
  expected: PlanningFoundationDraftHandoffOwner & { nowMs: number },
): PlanningFoundationSelfReportedStage | null;

export function createPlanningFoundationDraftHandoffRuntime(
  adapters: {
    digestSha256(input: string): Promise<string> | string;
    readSecure(key: string): Promise<string | null> | string | null;
    writeSecure(key: string, value: string): Promise<void> | void;
    deleteSecure(key: string): Promise<void> | void;
  },
  options?: {
    timeoutMs?: number;
    ttlMs?: number;
    now?: () => number;
  },
): {
  stage(input: PlanningFoundationDraftHandoffInput): Promise<void>;
  read(owner: PlanningFoundationDraftHandoffOwner): Promise<PlanningFoundationSelfReportedStage | null>;
  clear(owner: PlanningFoundationDraftHandoffOwner): Promise<boolean>;
};
