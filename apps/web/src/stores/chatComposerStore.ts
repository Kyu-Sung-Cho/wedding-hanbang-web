"use client";

import { create } from "zustand";
import type { AmoraPreparationDraft } from "@/lib/amora/preparationHandoff";

export interface ChatComposerAttachment {
  base64: string;
  mediaType: string;
  previewUrl: string;
  fileName: string;
}
export type ChatComposerLane = "shared_ai" | "shared_partner" | "private_ai";
export interface PrivateSafetyRecovery { input: string; clientRequestId: string | null; localOnly?: boolean }
export interface ChatComposerDraft {
  input: string;
  preparation: { source: string; draft: AmoraPreparationDraft } | null;
  attachments: ChatComposerAttachment[];
  retryClientRequestId: string | null;
  pendingAttachmentReads: number;
  tasteHandoffNonce?: string;
  tasteHandoffOriginalText?: string;
  safetyRecovery?: PrivateSafetyRecovery;
}
export type ChatComposerDrafts = Record<ChatComposerLane, ChatComposerDraft>;
export type ComposerLease = { identity: string; generation: number };

export function createEmptyComposerDrafts(): ChatComposerDrafts {
  const empty = (): ChatComposerDraft => ({
    input: "", preparation: null, attachments: [], retryClientRequestId: null, pendingAttachmentReads: 0,
  });
  return { shared_ai: empty(), shared_partner: empty(), private_ai: empty() };
}

function release(drafts: ChatComposerDrafts) {
  Object.values(drafts).forEach(draft => draft.attachments.forEach(attachment => {
    if (attachment.previewUrl.startsWith("blob:")) URL.revokeObjectURL(attachment.previewUrl);
  }));
}

// 원문·첨부·재시도 키는 프로세스 메모리에만 둔다. persist/devtools 미들웨어 금지.
export const useChatComposerStore = create<{
  identity: string | null;
  generation: number;
  drafts: ChatComposerDrafts;
  activeLane: ChatComposerLane;
}>(() => ({ identity: null, generation: 0, drafts: createEmptyComposerDrafts(), activeLane: "shared_ai" }));

export const chatComposerEpoch = {
  get current() { return useChatComposerStore.getState().generation; },
};

interface ComposerSubmissionSnapshot {
  lane: ChatComposerLane;
  draft: ChatComposerDraft;
  safetyRecovery?: PrivateSafetyRecovery;
}
interface ComposerSubmissionClaim {
  generation: number;
  requestId: string;
  snapshot?: ComposerSubmissionSnapshot;
  attachmentsTransferred: boolean;
}
let activeSubmission: ComposerSubmissionClaim | null = null;
export function claimComposerSubmission(generation: number, requestId: string, snapshot?: ComposerSubmissionSnapshot): ComposerSubmissionClaim | null {
  if (generation !== chatComposerEpoch.current || activeSubmission?.generation === generation) return null;
  activeSubmission = { generation, requestId, snapshot, attachmentsTransferred: false };
  return activeSubmission;
}
export function releaseComposerSubmission(generation: number, requestId: string) {
  if (activeSubmission?.generation === generation && activeSubmission.requestId === requestId) activeSubmission = null;
}

export function resetChatComposerSession() {
  const current = useChatComposerStore.getState();
  release(current.drafts);
  discardSubmission();
  useChatComposerStore.setState({ identity: null, generation: current.generation + 1, drafts: createEmptyComposerDrafts(), activeLane: "shared_ai" });
}

function discardSubmission() {
  if (activeSubmission?.snapshot) {
    release({ ...createEmptyComposerDrafts(), [activeSubmission.snapshot.lane]: activeSubmission.snapshot.draft });
  }
  activeSubmission = null;
}

function preserveOppositeSubmission(scope: "shared" | "private", drafts: ChatComposerDrafts): ChatComposerDrafts {
  const claim = activeSubmission;
  const snapshot = claim?.snapshot;
  if (!claim || claim.generation !== chatComposerEpoch.current || !snapshot) return drafts;
  if ((snapshot.lane === "private_ai") === (scope === "private")) {
    discardSubmission();
    return drafts;
  }
  const draft = drafts[snapshot.lane];
  // 삭제하지 않은 범위의 전송 원본만 유지한다. 안전 전환은 텍스트만 private에 남긴다.
  const recovered = snapshot.safetyRecovery && (draft.input || draft.attachments.length || draft.preparation || draft.safetyRecovery)
    ? { ...draft, safetyRecovery: snapshot.safetyRecovery }
    : { ...snapshot.draft, ...(snapshot.safetyRecovery ? {
      input: snapshot.safetyRecovery.input,
      retryClientRequestId: snapshot.safetyRecovery.clientRequestId,
      safetyRecovery: undefined,
    } : {}) };
  claim.attachmentsTransferred = true;
  activeSubmission = null;
  return { ...drafts, [snapshot.lane]: recovered };
}

export function bindChatComposerSession(identity: string): ComposerLease {
  let current = useChatComposerStore.getState();
  if (current.identity !== identity) {
    if (current.identity !== null) resetChatComposerSession();
    useChatComposerStore.setState({ identity });
    current = useChatComposerStore.getState();
  }
  return { identity, generation: current.generation };
}

export function isChatComposerLeaseCurrent(lease: ComposerLease): boolean {
  const current = useChatComposerStore.getState();
  return current.identity === lease.identity && current.generation === lease.generation;
}

export function updateChatComposerDrafts(
  lease: ComposerLease,
  update: ChatComposerDrafts | ((current: ChatComposerDrafts) => ChatComposerDrafts),
) {
  if (!isChatComposerLeaseCurrent(lease)) return;
  const current = useChatComposerStore.getState().drafts;
  const drafts = typeof update === "function" ? update(current) : update;
  if (drafts !== current) useChatComposerStore.setState({ drafts });
}

export function invalidateComposerScope(scope: "shared" | "private") {
  const current = useChatComposerStore.getState();
  const empty = createEmptyComposerDrafts();
  const cleared = scope === "shared"
    ? { ...current.drafts, private_ai: empty.private_ai }
    : { ...empty, private_ai: current.drafts.private_ai };
  release(cleared);
  const drafts = scope === "shared"
    ? { ...empty, private_ai: { ...current.drafts.private_ai, pendingAttachmentReads: 0 } }
    : { ...current.drafts, shared_ai: { ...current.drafts.shared_ai, pendingAttachmentReads: 0 },
      shared_partner: { ...current.drafts.shared_partner, pendingAttachmentReads: 0 }, private_ai: empty.private_ai };
  // 전환 전 읽기/전송 콜백은 모두 만료된다. 유지한 레인의 읽기 카운터도 잠그지 않는다.
  useChatComposerStore.setState({
    generation: current.generation + 1,
    drafts: preserveOppositeSubmission(scope, drafts),
    ...(scope === "shared" && current.activeLane === "shared_partner" ? { activeLane: "shared_ai" as const } : {}),
  });
}

export function invalidateSharedComposerDrafts() { invalidateComposerScope("shared"); }

export function forgetComposerRecovery(scope: "shared" | "private") {
  const current = useChatComposerStore.getState();
  const empty = createEmptyComposerDrafts();
  const drafts = { ...current.drafts };
  for (const lane of ["shared_ai", "shared_partner", "private_ai"] as const) {
    const matches = scope === "private" ? lane === "private_ai" : lane !== "private_ai";
    const draft = drafts[lane];
    if (matches && draft.retryClientRequestId) {
      release({ ...empty, [lane]: draft });
      drafts[lane] = empty[lane];
    } else {
      drafts[lane] = { ...draft, pendingAttachmentReads: 0, ...(matches ? { safetyRecovery: undefined } : {}) };
    }
  }
  useChatComposerStore.setState({ generation: current.generation + 1, drafts: preserveOppositeSubmission(scope, drafts) });
}

export function getRememberedComposerLane(identity: string): ChatComposerLane {
  const current = useChatComposerStore.getState();
  return current.identity === identity ? current.activeLane : "shared_ai";
}

export function rememberComposerLane(identity: string, activeLane: ChatComposerLane) {
  const current = useChatComposerStore.getState();
  if (current.identity === identity && current.activeLane !== activeLane) useChatComposerStore.setState({ activeLane });
}
