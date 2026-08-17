import type {
  AmoraPreparationCatchUpDraftSubmission,
} from "@hanbang/shared/amora-preparation-catch-up";

export type PreparationCatchUpDraft = Readonly<{
  phase: "edit" | "preview";
  requestId: string | null;
  requestLocked: boolean;
  items: AmoraPreparationCatchUpDraftSubmission["items"];
}>;

export function preparationCatchUpDraftDigestInput(ownerUserId: unknown): string | null;
export function preparationCatchUpDraftPersistentKey(digest: unknown): string | null;
export function createPreparationCatchUpDraftRecord(input: PreparationCatchUpDraft & {
  ownerUserId: string;
  nowMs: number;
  ttlMs?: number;
}): string;
export function parsePreparationCatchUpDraftRecord(
  raw: unknown,
  expected: { ownerUserId: string; nowMs: number },
): PreparationCatchUpDraft | null;

type SecureAdapters = {
  digestSha256(input: string): Promise<string>;
  readSecure(key: string): Promise<string | null>;
  writeSecure(key: string, value: string): Promise<void>;
  deleteSecure(key: string): Promise<void>;
};

export function createPreparationCatchUpDraftRuntime(
  adapters: SecureAdapters,
  options?: { timeoutMs?: number; ttlMs?: number; now?: () => number },
): {
  stage(input: PreparationCatchUpDraft & { ownerUserId: string }): Promise<void>;
  read(owner: { ownerUserId: string }): Promise<PreparationCatchUpDraft | null>;
  clear(owner: { ownerUserId: string }): Promise<boolean>;
};
