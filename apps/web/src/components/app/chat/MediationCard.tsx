"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CircleHelp,
  Heart,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Undo2,
  Users,
} from "lucide-react";
import {
  getExpectedMediationRevision,
  isRequesterSummaryMediationV2,
  type MediationBlock,
} from "./mediationBlock";

export type { MediationBlock } from "./mediationBlock";

type AcceptanceState = {
  accepted: boolean;
  acceptedCount: number;
  requiredCount: number;
  completed: boolean;
  partnerLinked?: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function MediationCard({ block, messageId }: { block: MediationBlock; messageId?: string }) {
  const [acceptance, setAcceptance] = useState<AcceptanceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"accept" | "revoke" | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const expectedRevision = getExpectedMediationRevision(block);
  const isRequesterSummaryV2 = isRequesterSummaryMediationV2(block);
  const expectedProposalVersion = expectedRevision?.expectedProposalVersion;
  const expectedRosterFingerprint = expectedRevision?.expectedRosterFingerprint;
  const canConfirm = Boolean(
    block.resolution?.trim()
    && messageId
    && UUID_PATTERN.test(messageId)
    && expectedProposalVersion
    && expectedRosterFingerprint,
  );

  const refreshAcceptance = useCallback(async () => {
    if (
      !canConfirm
      || !messageId
      || !expectedProposalVersion
      || !expectedRosterFingerprint
    ) return;
    setLoading(true);
    setStatusError(null);
    try {
      const searchParams = new URLSearchParams({
        messageId,
        expectedProposalVersion,
        expectedRosterFingerprint,
      });
      const response = await fetch(
        `/api/amora/mediation/accept?${searchParams.toString()}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as AcceptanceState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "확인 상태를 불러오지 못했어요.");
      setAcceptance(payload);
    } catch (error) {
      setAcceptance(null);
      setStatusError(error instanceof Error ? error.message : "확인 상태를 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, [
    canConfirm,
    expectedProposalVersion,
    expectedRosterFingerprint,
    messageId,
  ]);

  useEffect(() => {
    void refreshAcceptance();
  }, [
    expectedProposalVersion,
    expectedRosterFingerprint,
    refreshAcceptance,
  ]);

  async function updateAcceptance(method: "POST" | "DELETE") {
    if (
      !messageId
      || !expectedProposalVersion
      || !expectedRosterFingerprint
      || saving
    ) return;
    const exactRevision = { expectedProposalVersion, expectedRosterFingerprint };
    setSaving(method === "POST" ? "accept" : "revoke");
    setStatusError(null);
    try {
      const response = await fetch("/api/amora/mediation/accept", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId, ...exactRevision }),
      });
      const payload = await response.json() as AcceptanceState & { error?: string };
      if (!response.ok) {
        const responseError = new Error(
          payload.error ?? (method === "POST" ? "내 확인을 저장하지 못했어요." : "내 확인을 취소하지 못했어요."),
        );
        if (response.status === 409) {
          await refreshAcceptance();
        }
        throw responseError;
      }
      setAcceptance(payload);
    } catch (error) {
      setStatusError(
        error instanceof Error
          ? error.message
          : method === "POST"
            ? "내 확인을 저장하지 못했어요."
            : "내 확인을 취소하지 못했어요.",
      );
    } finally {
      setSaving(null);
    }
  }

  const sections = (isRequesterSummaryV2
    ? [
        { key: "empathy", title: "요청자가 전한 감정", Icon: Heart, text: block.empathy },
        { key: "translation", title: "요청자가 전한 상황", Icon: MessagesSquare, text: block.translation },
        { key: "data", title: "상대방에게 확인할 점", Icon: CircleHelp, text: block.data },
        { key: "resolution", title: "같이 검토할 선택안", Icon: Users, text: block.resolution },
      ]
    : [
        { key: "empathy", title: "전해진 감정", Icon: Heart, text: block.empathy },
        { key: "translation", title: "상황 정리", Icon: MessagesSquare, text: block.translation },
        { key: "data", title: "확인할 내용", Icon: CircleHelp, text: block.data },
        { key: "resolution", title: "같이 검토할 선택안", Icon: Users, text: block.resolution },
      ]).filter((section) => Boolean(section.text?.trim()));

  if (sections.length === 0) return null;

  return (
    <section
      aria-label="요청자 요약 기반 조율 초안"
      className="mt-3 overflow-hidden rounded-[6px] border border-[#E2D3C8] bg-[#FFFDF9]"
    >
      <div className="border-b border-[#EEE6DF] px-4 py-3.5">
        <p className="text-xs leading-relaxed text-[#6D625B]">
          {isRequesterSummaryV2
            ? "요청자가 직접 적은 요약을 바탕으로 만든 조율 초안이에요. 상대방의 생각은 아직 확인되지 않았어요."
            : "확인 출처가 없는 이전 조율 초안이에요. 내용은 참고만 하고 새 공동 결정으로 확인하려면 조율 초안을 다시 요청해 주세요."}
        </p>
      </div>

      <div className="divide-y divide-[#EEE6DF]">
        {sections.map((section) => (
          <div key={section.key} className="px-4 py-3.5">
            <div className="flex items-center gap-2 text-[#566A61]">
              <section.Icon className="h-4 w-4" aria-hidden="true" />
              <h3 className="text-xs font-semibold">{section.title}</h3>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[#2B2A29]">
              {section.text}
            </p>
          </div>
        ))}
      </div>

      {canConfirm && (
        <div className="border-t border-[#E2D3C8] bg-white px-4 py-3.5" aria-live="polite">
          {loading ? (
            <p className="flex min-h-12 items-center justify-center gap-2 text-sm text-[#6D625B]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              확인 상태를 불러오는 중
            </p>
          ) : statusError && !acceptance ? (
            <div className="text-center">
              <p role="alert" className="text-xs text-red-700">{statusError}</p>
              <button
                type="button"
                onClick={() => void refreshAcceptance()}
                className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-[6px] px-4 text-sm font-medium text-[#566A61] ring-1 ring-[#C9D2CC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#566A61]"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                다시 확인
              </button>
            </div>
          ) : acceptance?.completed ? (
            <p className="flex min-h-12 items-center gap-2 text-sm font-medium text-[#2E6B50]">
              <Check className="h-4 w-4" aria-hidden="true" />
              두 분이 각각 확인해 공동 결정으로 저장했어요
            </p>
          ) : acceptance?.accepted ? (
            <div>
              <p className="flex min-h-12 items-center gap-2 text-sm font-medium text-[var(--hb-accent-hover)]">
                <Users className="h-4 w-4" aria-hidden="true" />
                내가 확인했어요 · 상대방 확인을 기다리고 있어요
              </p>
              <button
                type="button"
                disabled={saving !== null}
                onClick={() => void updateAcceptance("DELETE")}
                className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-[6px] px-4 text-sm font-medium text-[#6D625B] ring-1 ring-[#D8CEC6] hover:bg-[#F8F4F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795252] disabled:opacity-50"
              >
                {saving === "revoke"
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <Undo2 className="h-4 w-4" aria-hidden="true" />}
                내 확인 취소
              </button>
              <button
                type="button"
                disabled={saving !== null || loading}
                onClick={() => void refreshAcceptance()}
                className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-[6px] px-4 text-sm font-medium text-[#566A61] ring-1 ring-[#C9D2CC] hover:bg-[#F4F7F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#566A61] disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                확인 상태 새로고침
              </button>
            </div>
          ) : acceptance?.partnerLinked === false ? (
            <p className="flex min-h-12 items-center gap-2 text-sm text-[#6D625B]">
              <Users className="h-4 w-4" aria-hidden="true" />
              파트너가 연결된 뒤 두 분이 각각 확인할 수 있어요
            </p>
          ) : (
            <button
              type="button"
              disabled={saving !== null}
              onClick={() => void updateAcceptance("POST")}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-4 text-sm font-medium text-white transition-colors hover:bg-[#8F6662] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795252] focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {saving === "accept"
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                : <Check className="h-4 w-4" aria-hidden="true" />}
              이 선택안을 나는 확인했어요
            </button>
          )}

          {acceptance && !acceptance.completed && acceptance.partnerLinked !== false && (
            <p className="mt-2 text-center text-xs text-[#6D806E]">
              {acceptance.acceptedCount}/{acceptance.requiredCount}명 확인 · 두 분 모두 확인해야 공동 결정으로 저장돼요
            </p>
          )}
          {statusError && acceptance && (
            <p role="alert" className="mt-2 text-center text-xs text-red-700">{statusError}</p>
          )}
        </div>
      )}
    </section>
  );
}
