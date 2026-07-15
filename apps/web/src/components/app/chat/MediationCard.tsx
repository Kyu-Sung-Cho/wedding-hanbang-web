"use client";

import { useEffect, useState } from "react";
import { Heart, MessagesSquare, BarChart3, Scale, Check, Loader2, Users } from "lucide-react";

export interface MediationBlock {
  empathy?: string;        // 공감 — 감정 인정
  translation?: string;    // 통역 — 실제 표현 → 확인된 요구
  data?: string;           // 데이터 — 확인된 근거, 없으면 부족함을 명시
  resolution?: string;     // 합의안 — 중립적 타협 제안
}

/**
 * 커플 갈등 중재 응답 시각화.
 * 시스템 프롬프트가 [mediation]...[/mediation] 마커로 4단계를 구조화해서 응답하면,
 * 백엔드가 추출해서 ChatMessage.metadata.mediation에 저장.
 * 4개 필드 중 일부만 있어도 graceful — 있는 것만 렌더.
 */
type AcceptanceState = {
  accepted: boolean;
  acceptedCount: number;
  requiredCount: number;
  completed: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function MediationCard({ block, messageId }: { block: MediationBlock; messageId?: string }) {
  const [acceptance, setAcceptance] = useState<AcceptanceState | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const canConfirm = Boolean(block.resolution?.trim() && messageId && UUID_PATTERN.test(messageId));

  useEffect(() => {
    if (!canConfirm || !messageId) return;
    let cancelled = false;
    fetch(`/api/amora/mediation/accept?messageId=${encodeURIComponent(messageId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<AcceptanceState>;
      })
      .then((payload) => { if (!cancelled && payload) setAcceptance(payload); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [canConfirm, messageId]);

  async function acceptResolution() {
    if (!messageId || accepting || acceptance?.accepted) return;
    setAccepting(true);
    setAcceptError(null);
    try {
      const response = await fetch("/api/amora/mediation/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const payload = await response.json() as AcceptanceState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "동의를 저장하지 못했어요.");
      setAcceptance(payload);
    } catch (error) {
      setAcceptError(error instanceof Error ? error.message : "동의를 저장하지 못했어요.");
    } finally {
      setAccepting(false);
    }
  }

  const blocks = [
    {
      key: "empathy" as const,
      title: "공감",
      Icon: Heart,
      color: "#A16207",
      bg: "#FEFCE8",
      border: "#FDE68A",
      text: block.empathy,
    },
    {
      key: "translation" as const,
      title: "양쪽 입장 통역",
      Icon: MessagesSquare,
      color: "#0284C7",
      bg: "#F0F9FF",
      border: "#BAE6FD",
      text: block.translation,
    },
    {
      key: "data" as const,
      title: "객관적 근거",
      Icon: BarChart3,
      color: "#334155",
      bg: "#F1F5F9",
      border: "#CBD5E1",
      text: block.data,
    },
    {
      key: "resolution" as const,
      title: "합의안",
      Icon: Scale,
      color: "#795252",
      bg: "#fffdfb",
      border: "#d9c8c8",
      text: block.resolution,
    },
  ].filter((b) => Boolean(b.text?.trim()));

  if (blocks.length === 0) return null;

  return (
    <div className="mt-3 animate-fade-in">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {blocks.map((b, i) => (
        <div
          key={b.key}
          className="rounded-xl border p-3.5 sm:p-4 animate-fade-in"
          style={{
            backgroundColor: b.bg,
            borderColor: b.border,
            animationDelay: `${i * 120}ms`,
          }}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "#ffffff", color: b.color, border: `1px solid ${b.border}` }}
            >
              <b.Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
            <span
              className="text-xs font-semibold tracking-wide"
              style={{ color: b.color }}
            >
              {b.title}
            </span>
          </div>
          <p
            className="text-sm leading-relaxed whitespace-pre-wrap"
            style={{ color: "#1b1c1c" }}
          >
            {b.text}
          </p>
        </div>
        ))}
      </div>
      {canConfirm && (
        <div className="mt-2.5 rounded-xl border border-[#E2D3C8] bg-white p-3.5">
          {acceptance?.completed ? (
            <p className="flex min-h-11 items-center gap-2 text-sm font-medium text-[#6D806E]">
              <Check className="h-4 w-4" />
              {acceptance.requiredCount > 1 ? "둘 다 확인한 합의로 기억했어요" : "확인한 합의로 기억했어요"}
            </p>
          ) : acceptance?.accepted ? (
            <p className="flex min-h-11 items-center gap-2 text-sm font-medium text-[#8F6662]">
              <Users className="h-4 w-4" /> 내 동의 저장됨 · 상대방 확인을 기다리고 있어요
            </p>
          ) : (
            <button
              type="button"
              disabled={accepting}
              onClick={() => void acceptResolution()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#8F6662] px-4 text-sm font-medium text-white transition-colors hover:bg-[#A77B74] disabled:opacity-50"
            >
              {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              이 합의안에 나는 동의해요
            </button>
          )}
          {acceptance && !acceptance.completed && acceptance.requiredCount > 1 && (
            <p className="mt-1 text-center text-xs text-[#6D806E]">
              {acceptance.acceptedCount}/{acceptance.requiredCount}명 확인 · 두 분 모두 눌러야 공동 기억에 저장돼요
            </p>
          )}
          {acceptError && <p role="alert" className="mt-2 text-center text-xs text-red-600">{acceptError}</p>}
        </div>
      )}
    </div>
  );
}
