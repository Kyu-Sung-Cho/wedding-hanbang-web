"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { hasAmoraSafetySignal } from "@/lib/ai/amoraQuestionScope";
import { AMORA_TEXT_DRAFT_KEYS, AMORA_TEXT_DRAFT_RECOVERY_TTL_MS as TTL_MS, getAmoraTextDraftRecoveryEpoch } from "@/lib/chat/textDraftRecoveryStorage";

const LANES = ["shared_ai", "shared_partner", "private_ai"] as const;
type Lane = typeof LANES[number];
type RecoveryLane = { input: string; retryClientRequestId: string | null; savedAt: number };
const NO_PENDING_READS: Record<Lane, number> = { shared_ai: 0, shared_partner: 0, private_ai: 0 };
interface TextDraft {
  input: string;
  attachments: readonly unknown[];
  retryClientRequestId: string | null;
  pendingAttachmentReads?: number;
  preparation?: unknown;
  tasteHandoffNonce?: string;
  expandHandoffNonce?: string;
}
const MAX_LENGTH = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// 서버 기억이 아니다. 같은 탭의 짧은 미전송 텍스트만 복구하고 파일·민감한 전달 맥락은 저장하지 않는다.
export function useAmoraTextDraftRecovery<T extends TextDraft>({
  surface, owner, partnerId, enabled, drafts, setDrafts, privateHandoffPending = false, pendingAttachmentReads = NO_PENDING_READS,
}: {
  surface: "conversation" | "panel";
  owner: string | null;
  partnerId: string | null;
  enabled: boolean;
  privateHandoffPending?: boolean;
  pendingAttachmentReads?: Record<Lane, number>;
  drafts: Record<Lane, T>;
  setDrafts: Dispatch<SetStateAction<Record<Lane, T>>>;
}) {
  const key = AMORA_TEXT_DRAFT_KEYS[surface];
  const identity = enabled && owner ? `${owner}:${partnerId ?? "no-partner"}` : null;
  const [hydratedIdentity, setHydratedIdentity] = useState<string | null>(null);
  const [hydratedRecoveryEpoch, setHydratedRecoveryEpoch] = useState<number | null>(null);
  const previousOwner = useRef<string | null>(null);
  const lastCopy = useRef<{ identity: string; lanes: Partial<Record<Lane, RecoveryLane>> } | null>(null);
  const hydratedEpoch = useRef<number | null>(null);
  const writer = useRef<{ owner: string; epoch: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const effectEpoch = getAmoraTextDraftRecoveryEpoch();
    const completeHydration = (value: string | null) => queueMicrotask(() => {
      if (!cancelled && effectEpoch === getAmoraTextDraftRecoveryEpoch()) {
        setHydratedIdentity(value); setHydratedRecoveryEpoch(effectEpoch);
      }
    });
    if (!identity || !owner) {
      if (previousOwner.current !== null) {
        try { sessionStorage.removeItem(key); } catch { /* 저장소가 막혀도 상담은 계속한다. */ }
        previousOwner.current = null;
      }
      completeHydration(null);
      hydratedEpoch.current = null;
      writer.current = null;
      return () => { cancelled = true; };
    }
    // 다른 effect 의존성이 바뀌어도 종료된 계정의 writer를 새 epoch로 재무장하지 않는다.
    if (writer.current?.owner === owner && writer.current.epoch !== effectEpoch) {
      hydratedEpoch.current = null;
      completeHydration(null);
      return () => { cancelled = true; };
    }
    writer.current = { owner, epoch: effectEpoch };
    hydratedEpoch.current = effectEpoch;
    try {
      if (previousOwner.current !== null && previousOwner.current !== owner) sessionStorage.removeItem(key);
      const raw = sessionStorage.getItem(key);
      const value: unknown = raw && raw.length <= MAX_LENGTH * 20 ? JSON.parse(raw) : null;
      if (record(value) && value.version === 1 && value.owner === owner
        && typeof value.savedAt === "number" && value.savedAt <= Date.now()
        && Date.now() - value.savedAt < TTL_MS && record(value.lanes)) {
        const savedLanes = value.lanes;
        const recoverable: Partial<Record<Lane, RecoveryLane>> = {};
        for (const lane of LANES) {
          const saved = savedLanes[lane];
          if (record(saved) && typeof saved.input === "string" && saved.input.trim()
            && saved.input.length <= MAX_LENGTH && typeof saved.savedAt === "number" && saved.savedAt <= Date.now()
            && Date.now() - saved.savedAt < TTL_MS && (saved.retryClientRequestId === null
              || typeof saved.retryClientRequestId === "string" && UUID.test(saved.retryClientRequestId))) {
            recoverable[lane] = { input: saved.input, retryClientRequestId: saved.retryClientRequestId, savedAt: saved.savedAt };
          }
        }
        lastCopy.current = { identity, lanes: recoverable };
        setDrafts(current => {
          if (effectEpoch !== getAmoraTextDraftRecoveryEpoch()) return current;
          const next = { ...current };
          for (const lane of LANES) {
            if (lane === "private_ai" && privateHandoffPending) continue;
            const saved = recoverable[lane];
            if (lane === "shared_partner" && value.partnerId !== partnerId) continue;
            if (!saved) continue;
            if (hasAmoraSafetySignal(saved.input, "chat") || current[lane].input || current[lane].attachments.length
              || current[lane].pendingAttachmentReads || pendingAttachmentReads[lane] || current[lane].preparation || current[lane].tasteHandoffNonce || current[lane].expandHandoffNonce) continue;
            next[lane] = { ...current[lane], input: saved.input, retryClientRequestId: saved.retryClientRequestId };
          }
          return next;
        });
      } else if (raw) sessionStorage.removeItem(key);
    } catch {
      try { sessionStorage.removeItem(key); } catch { /* 손상된 초안을 전송하지 않는다. */ }
    }
    previousOwner.current = owner;
    completeHydration(identity);
    return () => { cancelled = true; };
  }, [identity, key, owner, partnerId, privateHandoffPending, pendingAttachmentReads, setDrafts]);

  useEffect(() => {
    if (!identity || hydratedIdentity !== identity || !owner) return;
    const persist = () => {
      // 로그아웃 시 삭제된 사본은 아직 정리되지 않은 이전 화면이 다시 쓰지 못한다.
      if (hydratedEpoch.current !== getAmoraTextDraftRecoveryEpoch()) return;
      const lanes: Partial<Record<Lane, RecoveryLane>> = {};
      const previous = lastCopy.current?.identity === identity ? lastCopy.current.lanes : {};
      for (const lane of LANES) {
        if (lane === "private_ai" && privateHandoffPending) continue;
        const draft = drafts[lane];
        // 첨부나 별도 전달 맥락을 잃은 부분 요청을 같은 재시도 키로 전송하지 않는다.
        if (draft.input.trim() && draft.input.length <= MAX_LENGTH && !hasAmoraSafetySignal(draft.input, "chat") && !draft.attachments.length
          && !draft.pendingAttachmentReads && !pendingAttachmentReads[lane] && !draft.preparation && !draft.tasteHandoffNonce && !draft.expandHandoffNonce) {
          const prior = previous[lane];
          const savedAt = prior?.input === draft.input && prior.retryClientRequestId === draft.retryClientRequestId ? prior.savedAt : Date.now();
          lanes[lane] = { input: draft.input, retryClientRequestId: draft.retryClientRequestId, savedAt };
        }
      }
      try {
        lastCopy.current = { identity, lanes };
        const liveLanes = Object.fromEntries(Object.entries(lanes).filter(([, lane]) => Date.now() - lane.savedAt < TTL_MS));
        const savedAt = Math.max(...Object.values(liveLanes).map(lane => lane.savedAt));
        if (Object.keys(liveLanes).length) sessionStorage.setItem(key, JSON.stringify({ version: 1, owner, partnerId, savedAt, lanes: liveLanes }));
        else sessionStorage.removeItem(key);
      } catch { /* 저장 용량·브라우저 설정 때문에 전송 기능을 막지 않는다. */ }
    };
    persist();
    window.addEventListener("pagehide", persist);
    return () => window.removeEventListener("pagehide", persist);
  }, [drafts, hydratedIdentity, identity, key, owner, partnerId, privateHandoffPending, pendingAttachmentReads]);
  return Boolean(identity && hydratedIdentity === identity && hydratedRecoveryEpoch === getAmoraTextDraftRecoveryEpoch());
}
