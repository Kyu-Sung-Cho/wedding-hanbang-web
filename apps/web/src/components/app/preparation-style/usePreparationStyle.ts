"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import {
  parsePreparationStyleSnapshot,
  type PreparationStyleSnapshot,
} from "@/lib/weddingCode/preparationStyle";

export type PreparationStyleBinding = Readonly<{
  ownerUserId: string;
  coupleId: string | null;
  partnerUserId: string | null;
}>;

export function preparationStyleBindingKey(binding: PreparationStyleBinding): string {
  return [binding.ownerUserId, binding.coupleId ?? "", binding.partnerUserId ?? ""].join(":");
}

function currentBindingKey(): string {
  const { user, profile, couple, partner } = useAuthStore.getState();
  return preparationStyleBindingKey({
    ownerUserId: user?.id ?? "",
    coupleId: profile?.couple_id === couple?.id ? couple?.id ?? null : null,
    partnerUserId: partner?.couple_id === couple?.id ? partner?.id ?? null : null,
  });
}

const API = "/api/wedding-code/preparation-style";

/** 응답은 이 화면의 메모리에만 둔다. 계정·연결 변경 뒤 도착한 요청은 버린다. */
export default function usePreparationStyle(binding: PreparationStyleBinding, demo: boolean) {
  const [snapshot, setSnapshot] = useState<PreparationStyleSnapshot | null>(null);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const bindingKey = preparationStyleBindingKey(binding);
  const stillCurrent = useCallback(() => mounted.current && currentBindingKey() === bindingKey, [bindingKey]);

  const readResponse = useCallback(async (response: Response) => {
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error("답이나 연결 정보가 바뀌었어요. 새로 불러온 뒤 다시 확인해 주세요.");
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("로그인과 연결 상태를 확인해 주세요. 다시 불러와도 안 되면 로그인 후 다시 열어 주세요.");
      }
      if (response.status === 503) throw new Error("지금은 저장한 답을 불러오거나 바꿀 수 없어요. 잠시 후 다시 시도해 주세요.");
      throw new Error("요청을 확인하지 못했어요. 저장됐다고 표시하지 않았으니 다시 불러와 확인해 주세요.");
    }
    const body: unknown = await response.json();
    const next = parsePreparationStyleSnapshot(
      typeof body === "object" && body !== null && "snapshot" in body ? body.snapshot : null,
    );
    if (!next || next.ownerUserId !== binding.ownerUserId || next.coupleId !== binding.coupleId || next.partnerUserId !== binding.partnerUserId) {
      throw new Error("연결 정보가 바뀌었어요. 화면을 다시 열어 확인해 주세요.");
    }
    return next;
  }, [binding.ownerUserId, binding.coupleId, binding.partnerUserId]);

  const refresh = useCallback(async () => {
    if (demo || pending.current || !stillCurrent()) return;
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API, {
        cache: "no-store", credentials: "same-origin",
        headers: { "X-Wedding-Style-Expected-Owner": binding.ownerUserId },
      });
      if (!stillCurrent() || request !== sequence.current) return;
      const next = await readResponse(response);
      if (stillCurrent() && request === sequence.current) setSnapshot(next);
    } catch (cause) {
      if (stillCurrent() && request === sequence.current) {
        // 이전 파트너 답을 새로 확인한 결과처럼 계속 보여 주지 않는다.
        setSnapshot(null);
        setError(cause instanceof Error ? cause.message : "불러오지 못했어요. 다시 시도해 주세요.");
      }
    } finally {
      if (stillCurrent() && request === sequence.current) setLoading(false);
    }
  }, [binding.ownerUserId, demo, readResponse, stillCurrent]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function mutate(method: "PUT" | "DELETE", body: Record<string, unknown>, share = false): Promise<PreparationStyleSnapshot | null> {
    if (demo || pending.current || !stillCurrent()) return null;
    pending.current = true;
    const request = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API}${share ? "/share" : ""}`, {
        method, credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, expectedOwnerUserId: binding.ownerUserId }),
      });
      if (!stillCurrent() || request !== sequence.current) return null;
      const next = await readResponse(response);
      if (!stillCurrent() || request !== sequence.current) return null;
      const reflected = share
        ? method === "PUT"
          ? next.own !== null && next.own.revision > Number(body.expectedRevision) && next.sharing?.responseRevision === next.own.revision
          : next.stateRevision !== null && next.stateRevision > Number(body.expectedRevision) && next.sharing === null && next.partner === null
        : method === "PUT"
          ? next.own !== null && next.own.answerCode === body.answerCode && next.own.sceneVersion === body.sceneVersion
          : next.own === null && next.stateRevision !== null && next.stateRevision > Number(body.expectedRevision) && next.sharing === null && next.partner === null;
      if (!reflected) throw new Error("변경된 내용을 확인하지 못했어요. 다시 불러와 확인해 주세요.");
      setSnapshot(next);
      return next;
    } catch (cause) {
      if (stillCurrent() && request === sequence.current) {
        setSnapshot(null);
        setError(cause instanceof Error ? cause.message : "요청을 확인하지 못했어요. 다시 불러와 주세요.");
      }
      return null;
    } finally {
      pending.current = false;
      if (stillCurrent()) { setBusy(false); setLoading(false); }
    }
  }

  return { snapshot, loading, busy, error, refresh, mutate };
}
