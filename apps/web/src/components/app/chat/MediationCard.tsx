"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CircleHelp,
  Heart,
  Lock,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Send,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import {
  getExpectedMediationRevision,
  isRequesterSummaryMediationV2,
  type MediationBlock,
} from "./mediationBlock";
import {
  hasUnsafeStoredMediationRenderContent,
  MEDIATION_DISCLOSURE_VERIFYING_COPY,
  MEDIATION_DISCLOSURE_WITHHELD_COPY,
  MEDIATION_RENDER_SAFETY_FALLBACK,
  resolveMediationDisclosureState,
} from "@hanbang/shared/mediation-render-safety";
import type { AmoraPrivateMediationDraftMetadata } from "@hanbang/shared/mediation-provenance";

export type { MediationBlock } from "./mediationBlock";

type AcceptanceState = {
  accepted: boolean;
  acceptedCount: number;
  requiredCount: number;
  completed: boolean;
  partnerLinked?: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MediationCardProps {
  block: MediationBlock;
  messageId?: string;
  privateDraft?: AmoraPrivateMediationDraftMetadata | null;
  onDraftShared?: (draftMessageId: string, sharedMessageId: string) => void;
  onDraftDiscarded?: (draftMessageId: string) => void;
  onOpenShared?: () => void;
}

export default function MediationCard({
  block,
  messageId,
  privateDraft = null,
  onDraftShared,
  onDraftDiscarded,
  onOpenShared,
}: MediationCardProps) {
  const [acceptance, setAcceptance] = useState<AcceptanceState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"accept" | "revoke" | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState<"share" | "discard" | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [locallySharedMessageId, setLocallySharedMessageId] = useState<string | null>(null);
  const expectedRevision = getExpectedMediationRevision(block);
  const renderSafetyFallback = block.renderSafetyFallback === true
    || hasUnsafeStoredMediationRenderContent(block);
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
  const disclosureState = resolveMediationDisclosureState({
    hasExactRevision: canConfirm,
    verificationState: acceptance
      ? "verified"
      : loading
        ? "verifying"
        : statusError
          ? "error"
          : "idle",
  });

  const refreshAcceptance = useCallback(async () => {
    if (
      !canConfirm
      || !messageId
      || !expectedProposalVersion
      || !expectedRosterFingerprint
    ) return;
    setAcceptance(null);
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

  async function mutatePrivateDraft(action: "share" | "discard") {
    if (!messageId || !UUID_PATTERN.test(messageId) || draftSaving) return;
    setDraftSaving(action);
    setDraftError(null);
    try {
      const response = await fetch("/api/amora/mediation/draft", {
        method: action === "share" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : action === "share"
              ? "초안을 함께 보내지 못했어요."
              : "초안을 버리지 못했어요.",
        );
      }
      if (action === "share") {
        const sharedMessageId = payload.sharedMessageId;
        if (
          typeof sharedMessageId !== "string"
          || !UUID_PATTERN.test(sharedMessageId)
          || typeof payload.reused !== "boolean"
        ) throw new Error("초안 공유 결과를 안전하게 확인하지 못했어요.");
        setLocallySharedMessageId(sharedMessageId.toLowerCase());
        onDraftShared?.(messageId, sharedMessageId.toLowerCase());
      } else {
        if (typeof payload.discarded !== "boolean") {
          throw new Error("초안 폐기 결과를 안전하게 확인하지 못했어요.");
        }
        onDraftDiscarded?.(messageId);
      }
    } catch (error) {
      setDraftError(
        error instanceof Error
          ? error.message
          : action === "share"
            ? "초안을 함께 보내지 못했어요."
            : "초안을 버리지 못했어요.",
      );
    } finally {
      setDraftSaving(null);
    }
  }

  if (renderSafetyFallback) {
    return (
      <section
        aria-label="표시가 제한된 조율 초안"
        className="mt-3 overflow-hidden rounded-2xl border border-[#E2D3C8] bg-[#FFFDF9] px-4 py-4"
      >
        <p role="alert" className="text-sm leading-relaxed text-[#6D625B]">
          {MEDIATION_RENDER_SAFETY_FALLBACK}
        </p>
      </section>
    );
  }

  if (privateDraft) {
    const sections = [
      { key: "empathy", title: "내가 전한 감정", Icon: Heart, text: block.empathy },
      { key: "translation", title: "내가 전한 상황", Icon: MessagesSquare, text: block.translation },
      { key: "data", title: "상대방에게 확인할 점", Icon: CircleHelp, text: block.data },
      { key: "resolution", title: "함께 검토할 선택안", Icon: Users, text: block.resolution },
    ].filter((section) => Boolean(section.text?.trim()));
    if (sections.length === 0) return null;
    const sharedMessageId = locallySharedMessageId ?? privateDraft.sharedMessageId;
    const sent = privateDraft.state === "sent" || sharedMessageId !== null;
    const actionable = Boolean(messageId && UUID_PATTERN.test(messageId));

    return (
      <section
        aria-label="나만 보는 조율 초안"
        className="mt-3 overflow-hidden rounded-2xl border border-[#C9D2CC] bg-[#FFFDF9]"
      >
        <div className="border-b border-[#E4E9E6] bg-[#F6F8F7] px-4 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#36534E]">
            <Lock className="h-4 w-4" aria-hidden="true" />
            나만 보는 조율 초안
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#6D625B]">
            {sent
              ? "직접 확인해 함께 대화로 보냈어요. 이 초안의 AI 산문은 상대방에게 복사되지 않아요."
              : "직접 보내기 전에는 상대방에게 보이지 않아요. 내용을 읽고 보내거나 버릴 수 있어요."}
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
        <div className="border-t border-[#E2D3C8] bg-white px-4 py-3.5" aria-live="polite">
          {draftError && <p role="alert" className="mb-2 text-xs text-red-700">{draftError}</p>}
          {sent ? (
            <div>
              <p className="flex min-h-12 items-center gap-2 text-sm font-medium text-[#2E6B50]">
                <Check className="h-4 w-4" aria-hidden="true" />
                함께 보냈고 내 확인도 남겼어요
              </p>
              {onOpenShared && (
                <button
                  type="button"
                  onClick={onOpenShared}
                  className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl border border-[#C9D2CC] px-4 text-sm font-semibold text-[#36534E]"
                >
                  함께 대화에서 보기
                </button>
              )}
            </div>
          ) : actionable ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <button
                type="button"
                onClick={() => void mutatePrivateDraft("share")}
                disabled={draftSaving !== null}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#36534E] px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {draftSaving === "share" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                함께 보내고 내 확인 남기기
              </button>
              <button
                type="button"
                onClick={() => void mutatePrivateDraft("discard")}
                disabled={draftSaving !== null}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium text-[#795252] ring-1 ring-[#D8C7BB] disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                초안 버리기
              </button>
            </div>
          ) : (
            <p role="alert" className="text-sm text-[#6D625B]">이 초안의 식별자를 안전하게 확인하지 못했어요.</p>
          )}
        </div>
      </section>
    );
  }

  if (disclosureState !== "verified") {
    const verifying = disclosureState === "verifying";
    return (
      <section
        aria-label={verifying ? "조율 초안 공개 범위 확인 중" : "표시가 제한된 조율 초안"}
        className="mt-3 overflow-hidden rounded-2xl border border-[#E2D3C8] bg-[#FFFDF9] px-4 py-4"
      >
        <p
          role={verifying ? "status" : "alert"}
          className="flex items-center justify-center gap-2 text-sm leading-relaxed text-[#6D625B]"
        >
          {verifying && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {verifying
            ? MEDIATION_DISCLOSURE_VERIFYING_COPY
            : MEDIATION_DISCLOSURE_WITHHELD_COPY}
        </p>
        {!verifying && canConfirm && (
          <button
            type="button"
            onClick={() => void refreshAcceptance()}
            className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-[#566A61] ring-1 ring-[#C9D2CC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#566A61]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            다시 확인
          </button>
        )}
      </section>
    );
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
      className="mt-3 overflow-hidden rounded-2xl border border-[#E2D3C8] bg-[#FFFDF9]"
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
                className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-[#566A61] ring-1 ring-[#C9D2CC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#566A61]"
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
              <p className="flex min-h-12 items-center gap-2 text-sm font-medium text-[#795252]">
                <Users className="h-4 w-4" aria-hidden="true" />
                내가 확인했어요 · 상대방 확인을 기다리고 있어요
              </p>
              <button
                type="button"
                disabled={saving !== null}
                onClick={() => void updateAcceptance("DELETE")}
                className="mt-1 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-[#6D625B] ring-1 ring-[#D8CEC6] hover:bg-[#F8F4F1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795252] disabled:opacity-50"
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
                className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium text-[#566A61] ring-1 ring-[#C9D2CC] hover:bg-[#F4F7F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#566A61] disabled:opacity-50"
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
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#795252] px-4 text-sm font-medium text-white transition-colors hover:bg-[#8F6662] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#795252] focus-visible:ring-offset-2 disabled:opacity-50"
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
