"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/authStore";
import { CONTACT } from "@/lib/constants/contact";
import Button from "@/components/ui/Button";

interface SupportProof {
  proof: string;
  reference: string;
  expiresAt: string;
  ownerId: string;
}

function parseProof(value: unknown, ownerId: string): SupportProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.ownerId !== ownerId || typeof row.proof !== "string" || row.proof.length > 2048
    || !/^HBDEL1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(row.proof)
    || typeof row.reference !== "string" || !/^[0-9a-f-]{36}$/.test(row.reference)
    || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))
    || Date.parse(row.expiresAt) <= Date.now()) return null;
  return { proof: row.proof, reference: row.reference, expiresAt: row.expiresAt, ownerId };
}

function DeletionSupportProofSession({ ownerId }: { ownerId: string }) {
  const [proof, setProof] = useState<SupportProof | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const timeout = useRef<number | null>(null);
  useEffect(() => () => {
    generation.current += 1;
    pending.current?.abort();
    if (timeout.current !== null) window.clearTimeout(timeout.current);
  }, []);

  const expireProof = useCallback(() => {
    generation.current += 1;
    setProof(null); setCopied(false); setShowCode(false);
    setError("확인 코드의 유효 기한이 지났어요. 새 코드를 만들어 주세요.");
  }, []);
  useEffect(() => {
    if (!proof) return;
    const checkExpiry = () => {
      if (Date.parse(proof.expiresAt) <= Date.now()) expireProof();
    };
    const expiryTimer = window.setTimeout(checkExpiry, Math.max(0, Date.parse(proof.expiresAt) - Date.now()));
    window.addEventListener("focus", checkExpiry);
    document.addEventListener("visibilitychange", checkExpiry);
    return () => {
      window.clearTimeout(expiryTimer);
      window.removeEventListener("focus", checkExpiry);
      document.removeEventListener("visibilitychange", checkExpiry);
    };
  }, [proof, expireProof]);

  function sameOwner() {
    const auth = useAuthStore.getState();
    return auth.user?.id === ownerId && !auth.isDemo;
  }

  async function issue() {
    if (pending.current || !sameOwner()) return;
    const current = ++generation.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true); setError(""); setProof(null); setCopied(false); setShowCode(false);
    timeout.current = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/auth/delete/support-proof", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "support-identity-only" }), signal: controller.signal,
      });
      if (generation.current !== current || !sameOwner()) return;
      if (!response.ok) throw new Error("unavailable");
      const result = parseProof(await response.json(), ownerId);
      if (generation.current !== current || !sameOwner()) return;
      if (!result) throw new Error("invalid");
      setProof(result);
    } catch {
      if (generation.current === current && sameOwner()) {
        setError("확인 코드를 만들지 못했어요. 잠시 후 다시 시도하거나 이메일로 문의해 주세요.");
      }
    } finally {
      if (generation.current === current) {
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        timeout.current = null; pending.current = null;
        if (sameOwner()) setBusy(false);
      }
    }
  }

  async function copy() {
    if (!proof || !sameOwner()) return;
    if (Date.parse(proof.expiresAt) <= Date.now()) { expireProof(); return; }
    const current = generation.current;
    try {
      await navigator.clipboard.writeText(`웨딩한방 탈퇴 문의 본인 확인 코드\n${proof.proof}`);
      if (generation.current === current && sameOwner()) {
        if (Date.parse(proof.expiresAt) <= Date.now()) expireProof();
        else setCopied(true);
      }
    } catch {
      if (generation.current === current && sameOwner()) {
        if (Date.parse(proof.expiresAt) <= Date.now()) expireProof();
        else setShowCode(true);
      }
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--hb-border)] bg-[var(--hb-surface-hover)] p-3 text-sm">
      <p className="text-[var(--hb-text-body)]">문의할 계정을 확인하는 코드를 만들 수 있어요. 코드 발급만으로 계정이 삭제되거나 요청이 접수되지는 않아요.</p>
      {!proof ? (
        <Button variant="secondary" type="button" onClick={issue} disabled={busy}
          className="mt-2 w-full !rounded-lg !px-3">
          {busy ? "확인 코드 만드는 중…" : "탈퇴 문의용 확인 코드 만들기"}
        </Button>
      ) : (
        <>
          <p className="mt-2 text-[var(--hb-text-body)]">{CONTACT.email}에 탈퇴 요청과 함께 보내 주세요. 코드는 다른 곳에 공개하지 마세요.</p>
          <p className="mt-1 text-xs text-[var(--hb-text-muted)]">유효 기한: {new Date(proof.expiresAt).toLocaleString("ko-KR")}</p>
          <Button variant="secondary" type="button" onClick={copy}
            className="mt-2 w-full !rounded-lg !px-3">
            {copied ? "복사했어요" : "확인 코드 복사"}
          </Button>
          <p role="status" className="sr-only">{copied ? "확인 코드를 복사했어요." : "확인 코드가 만들어졌어요."}</p>
          {showCode && <label className="mt-2 block text-xs text-[var(--hb-text-body)]">복사가 어려우면 아래 코드를 직접 선택해 복사해 주세요.
            <textarea readOnly value={proof.proof} aria-label="탈퇴 문의 본인 확인 코드" className="mt-2 min-h-24 w-full rounded-lg border border-[var(--hb-border)] bg-white p-2 text-xs" />
          </label>}
        </>
      )}
      {error && <p role="alert" className="mt-2 text-[var(--hb-text-body)]">{error}</p>}
    </div>
  );
}

export default function DeletionSupportProofControl({ ownerId }: { ownerId: string }) {
  const currentOwnerId = useAuthStore(state => state.user?.id);
  const isDemo = useAuthStore(state => state.isDemo);
  if (currentOwnerId !== ownerId || isDemo) return null;
  return <DeletionSupportProofSession key={ownerId} ownerId={ownerId} />;
}
