"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Bell,
  Check,
  AlertTriangle,
  Info,
  Users,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
import {
  buildChecklistApprovalDisclosure,
  type ChecklistApprovalCategoryChange,
  type ChecklistApprovalDisclosure,
  type ChecklistApprovalItemChange,
  type ChecklistSituationProposal,
} from "@hanbang/shared/checklist-approval-disclosure";
import type { ComputedNotification } from "@/hooks/useNotifications";
import { useAuthStore } from "@/stores/authStore";

const PRIORITY_STYLES: Record<string, { icon: React.ElementType; accent: string; bg: string }> = {
  high: { icon: AlertTriangle, accent: "text-red-500", bg: "bg-red-50" },
  medium: { icon: Bell, accent: "text-[#C4967E]", bg: "bg-[#C4967E]/5" },
  low: { icon: Info, accent: "text-[#928980]", bg: "bg-[#FAF8F5]" },
};
const PARTNER_STYLE = {
  icon: Users,
  accent: "text-[#36534E]",
  bg: "bg-[#36534E]/8",
};
const DISCLOSURE_RECEIPT_PATTERN = /^[a-f0-9]{64}$/;

const CHECKLIST_STATUS_LABELS: Record<
  ChecklistApprovalCategoryChange["beforeStatus"],
  string
> = {
  not_started: "준비 전",
  in_progress: "진행 중",
  completed: "완료",
  not_applicable: "해당 없음",
};

function describeCategoryImpact(category: ChecklistApprovalCategoryChange): string {
  return [
    `${category.categoryLabel} · 제외 ${category.excludedCount} · 복원 ${category.restoredCount}`,
    category.applicabilityChanged ? `분야 ${category.afterApplicable ? "복원" : "제외"}` : "",
    category.statusChanged && !category.applicabilityChanged
      ? `상태 ${CHECKLIST_STATUS_LABELS[category.beforeStatus]} → ${CHECKLIST_STATUS_LABELS[category.afterStatus]}`
      : "",
    category.reviewChangeKind === "added"
      ? "검토 기록 추가"
      : category.reviewChangeKind === "cleared"
        ? "검토 기록 해제"
        : "",
    category.addedCount > 0 || category.renamedCount > 0
      ? `목록 추가 ${category.addedCount}/문구 갱신 ${category.renamedCount}`
      : "",
  ].filter(Boolean).join(" · ");
}

function describeExcludedItem(item: ChecklistApprovalItemChange): string {
  return [
    `${item.categoryLabel} · ${item.label}`,
    item.completionEvidenceCleared
      ? "자동 제외되며 기존 완료 기록(완료 일시·완료자)이 해제돼요"
      : "",
  ].filter(Boolean).join(" · ");
}

function DisclosureSection({ title, rows }: { title: string; rows: string[] }) {
  return (
    <section>
      <h4 className="font-semibold text-[#8F6662]">{title}</h4>
      {rows.length > 0 ? (
        <ul className="mt-0.5 space-y-0.5">
          {rows.map((row, index) => <li key={`${title}:${index}`}>· {row}</li>)}
        </ul>
      ) : (
        <p className="mt-0.5 text-[#6D806E]">없음</p>
      )}
    </section>
  );
}

function formatNotificationTime(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

interface Props {
  notifications: ComputedNotification[];
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onCategoryClick: (categoryKey: string) => void;
  onOpen?: (notification: ComputedNotification) => void;
  onClose: () => void;
  currentProgress?: Record<string, unknown>;
  currentRevision?: number | null;
}

type ReadyChecklistApprovalDisclosure = Extract<
  ChecklistApprovalDisclosure,
  { status: "ready" }
>;
type PlanDisclosureState =
  | Exclude<ChecklistApprovalDisclosure, { status: "ready" }>
  | (ReadyChecklistApprovalDisclosure & { disclosureReceipt: string })
  | { status: "other" };

export default function NotificationPanel({
  notifications,
  onDismiss,
  onDismissAll,
  onCategoryClick,
  onOpen,
  onClose,
  currentProgress = {},
  currentRevision = null,
}: Props) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<{
    notificationId: string;
    message: string;
  } | null>(null);
  const [disclosures, setDisclosures] = useState<Record<string, PlanDisclosureState>>({});
  const [expandedDisclosureIds, setExpandedDisclosureIds] = useState<Set<string>>(new Set());
  const [loadingDisclosureId, setLoadingDisclosureId] = useState<string | null>(null);

  const clearDisclosureReview = (notificationId: string) => {
    setDisclosures((current) => {
      const next = { ...current };
      delete next[notificationId];
      return next;
    });
    setExpandedDisclosureIds((current) => {
      const next = new Set(current);
      next.delete(notificationId);
      return next;
    });
  };

  const loadDisclosure = async (
    notification: ComputedNotification,
  ): Promise<PlanDisclosureState | null> => {
    if (!notification.actionId || loadingDisclosureId) return null;
    setLoadingDisclosureId(notification.id);
    setDecisionError(null);
    try {
      const response = await fetch(
        `/api/couple-plan-changes/${encodeURIComponent(notification.actionId)}`,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof payload !== "object" || payload === null) {
        throw new Error("변경 원본을 불러오지 못했어요. 기존 계획은 그대로 유지돼요.");
      }
      const record = payload as Record<string, unknown>;
      if (record.status !== "pending_partner" || record.surface !== "/schedule") {
        throw new Error("요청 상태가 바뀌었어요. 최신 알림을 다시 확인해 주세요.");
      }
      if (
        typeof record.proposal === "object"
        && record.proposal !== null
        && (record.proposal as Record<string, unknown>).kind === "other"
        && Object.keys(record.proposal).length === 1
      ) {
        const other = { status: "other" } as const;
        setDisclosures((current) => ({ ...current, [notification.id]: other }));
        return other;
      }
      const proposal = record.proposal as ChecklistSituationProposal | undefined;
      const disclosureReceipt = record.disclosureReceipt;
      if (
        typeof disclosureReceipt !== "string"
        || !DISCLOSURE_RECEIPT_PATTERN.test(disclosureReceipt)
      ) {
        throw new Error("변경 전체를 다시 불러와 주세요. 확인 영수증이 없어 동의하지 않았어요.");
      }
      const disclosure = currentRevision === null
        ? { status: "unsafe", reason: "missing_revision" } as const
        : buildChecklistApprovalDisclosure({
            currentProgress,
            currentRevision,
            proposal,
            templates: CATEGORY_CHECKLISTS,
          });
      if (disclosure.status !== "ready") {
        setDisclosures((current) => ({ ...current, [notification.id]: disclosure }));
        throw new Error("현재 체크리스트와 요청 전체를 안전하게 비교하지 못해 동의를 막았어요.");
      }
      const readyDisclosure = { ...disclosure, disclosureReceipt };
      setDisclosures((current) => ({
        ...current,
        [notification.id]: readyDisclosure,
      }));
      setExpandedDisclosureIds((current) => new Set(current).add(notification.id));
      return readyDisclosure;
    } catch (error) {
      setDecisionError({
        notificationId: notification.id,
        message: error instanceof Error ? error.message : "변경 전체를 확인하지 못했어요.",
      });
      return null;
    } finally {
      setLoadingDisclosureId(null);
    }
  };

  const resolvePlanChange = async (
    notification: ComputedNotification,
    decision: "accept" | "reject" | "cancel",
  ) => {
    if (!notification.actionId || resolvingId) return;
    let disclosureReceipt: string | undefined;
    if (decision === "accept" && notification.href === "/schedule") {
      let disclosure: PlanDisclosureState | null | undefined = disclosures[notification.id];
      if (!disclosure) {
        disclosure = await loadDisclosure(notification);
      }
      if (!disclosure || disclosure.status === "unsafe") return;
      if (disclosure.status === "ready" && !expandedDisclosureIds.has(notification.id)) {
        setExpandedDisclosureIds((current) => new Set(current).add(notification.id));
        return;
      }
      if (disclosure.status === "ready" && disclosure.baseRevision !== currentRevision) {
        setDecisionError({
          notificationId: notification.id,
          message: "그 사이 준비 정보가 바뀌어 동의하지 않았어요. 최신 변경 내용을 다시 확인해 주세요.",
        });
        clearDisclosureReview(notification.id);
        return;
      }
      if (disclosure.status === "ready") {
        disclosureReceipt = disclosure.disclosureReceipt;
      }
    }
    const decisionUserId = useAuthStore.getState().user?.id;
    if (!decisionUserId) {
      setDecisionError({
        notificationId: notification.id,
        message: "로그인 정보를 다시 확인한 뒤 처리해 주세요.",
      });
      return;
    }
    setResolvingId(notification.id);
    setDecisionError(null);
    try {
      const response = await fetch(
        `/api/couple-plan-changes/${encodeURIComponent(notification.actionId)}`,
        {
          method: decision === "accept" ? "POST" : "DELETE",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            disclosureReceipt ? { disclosureReceipt } : {},
          ),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | { status?: unknown; error?: unknown }
        | null;
      if (!response.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : "변경 요청을 처리하지 못했습니다.",
        );
      }
      const expectedStatus = decision === "accept" ? "applied" : "rejected";
      if (payload?.status !== expectedStatus) {
        throw new Error(
          decision === "accept"
            ? "변경 반영 상태를 확인하지 못했어요. 최신 화면에서 다시 확인해 주세요."
            : decision === "cancel"
              ? "취소 처리 상태를 확인하지 못했어요. 최신 화면에서 다시 확인해 주세요."
              : "거절 처리 상태를 확인하지 못했어요. 최신 화면에서 다시 확인해 주세요.",
        );
      }
      if (decision === "accept") {
        const synchronized = await useAuthStore
          .getState()
          .refreshJourney(decisionUserId);
        if (!synchronized) {
          throw new Error(
            "변경은 반영됐지만 최신 내용을 불러오지 못했어요. 화면을 새로고침해 주세요.",
          );
        }
      }
      onDismiss(notification.id);
    } catch (error) {
      const expectedStatus = decision === "accept" ? "applied" : "rejected";
      let needsLatestDisclosureReview = false;
      try {
        const recoveryResponse = await fetch(
          `/api/couple-plan-changes/${encodeURIComponent(notification.actionId)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          },
        );
        const recovered = (await recoveryResponse.json().catch(() => null)) as
          | { status?: unknown }
          | null;
        if (recoveryResponse.ok && recovered?.status === expectedStatus) {
          if (decision === "accept") {
            const synchronized = await useAuthStore
              .getState()
              .refreshJourney(decisionUserId);
            if (!synchronized) {
              throw new Error(
                "변경은 반영됐지만 최신 내용을 불러오지 못했어요. 화면을 새로고침해 주세요.",
              );
            }
          }
          onDismiss(notification.id);
          return;
        }
        if (
          recoveryResponse.ok
          && recovered?.status === "pending_partner"
          && decision === "accept"
          && notification.href === "/schedule"
          && disclosureReceipt !== undefined
        ) {
          clearDisclosureReview(notification.id);
          needsLatestDisclosureReview = true;
        }
      } catch {
        // A read-only recovery must never replay an uncertain decision.
      }
      setDecisionError({
        notificationId: notification.id,
        message: needsLatestDisclosureReview
          ? "최신 변경 전체를 다시 확인한 뒤 동의해 주세요."
          : error instanceof Error
            ? error.message
            : "변경 요청을 처리하지 못했습니다.",
      });
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <>
      {/* 오버레이 */}
      <div onClick={onClose} className="fixed inset-0 z-40" />

      {/* 패널 */}
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.97 }}
        transition={{ duration: 0.2 }}
        className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] bg-white rounded-2xl border border-black/[0.06] shadow-xl z-50 overflow-hidden flex flex-col max-md:w-[calc(100vw-32px)] max-md:right-[-8px]"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
          <h3 className="text-[15px] font-medium text-[#1A1A1F]">알림</h3>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={onDismissAll}
                className="text-[11px] text-[#928980] hover:text-[#C4967E] transition-colors"
              >
                모두 읽음
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="알림 닫기"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[#B5ADA3] hover:bg-[#FAF8F5] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 알림 목록 */}
        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <div className="w-12 h-12 rounded-full bg-[#2E7D5A]/10 flex items-center justify-center mb-3">
                <Check className="w-6 h-6 text-[#2E7D5A]" />
              </div>
              <p className="text-[14px] text-[#928980] font-medium">
                모든 알림을 확인했습니다
              </p>
              <p className="text-[12px] text-[#B5ADA3] mt-1">
                새로운 알림이 오면 여기에 표시됩니다
              </p>
            </div>
          ) : (
            <div className="py-2">
              <AnimatePresence>
                {notifications.map((n) => {
                  const style = n.type === "partner"
                    ? PARTNER_STYLE
                    : PRIORITY_STYLES[n.priority] ?? PRIORITY_STYLES.low;
                  const Icon = style.icon;
                  const createdAt = formatNotificationTime(n.createdAt);
                  const isPlanApproval =
                    n.type === "partner"
                    && n.eventKind === "approval_requested"
                    && n.toolName === "manual_plan_change"
                    && Boolean(n.actionId);
                  const isPlanPending =
                    n.type === "partner"
                    && n.eventKind === "approval_pending"
                    && n.toolName === "manual_plan_change"
                    && Boolean(n.actionId);
                  const isResolving = resolvingId === n.id;
                  const disclosure = disclosures[n.id];
                  const disclosureExpanded = expandedDisclosureIds.has(n.id);
                  const needsProposalClassification = isPlanApproval
                    && n.href === "/schedule";

                  return (
                    <motion.div
                      key={n.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      className={`px-5 py-3 hover:bg-[#FDFCFA] transition-colors ${
                        n.isNew ? "" : "opacity-60"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-8 h-8 rounded-lg ${style.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}
                        >
                          <Icon className={`w-4 h-4 ${style.accent}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-medium text-[#1A1A1F]">
                              {n.title}
                            </p>
                            {n.isNew && (
                              <div className="w-1.5 h-1.5 rounded-full bg-[#C4967E] flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-[12px] text-[#928980] font-light mt-0.5 leading-relaxed">
                            {n.message}
                          </p>
                          {createdAt && n.createdAt && (
                            <time
                              dateTime={n.createdAt}
                              className="block text-[10px] text-[#B5ADA3] mt-1"
                            >
                              {createdAt}
                            </time>
                          )}
                          {needsProposalClassification && disclosure?.status !== "other" && (
                            <div className="mt-2 border-t border-[#E2D3C8] pt-2">
                              {disclosure?.status === "ready" ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setExpandedDisclosureIds((current) => {
                                      const next = new Set(current);
                                      if (next.has(n.id)) next.delete(n.id);
                                      else next.add(n.id);
                                      return next;
                                    })}
                                    aria-expanded={disclosureExpanded}
                                    className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-[#F7F1E8] px-3 py-2 text-left"
                                  >
                                    <span>
                                      <span className="block text-[12px] font-semibold text-[#243832]">상황 설정 변경 전체 보기</span>
                                      <span className="mt-0.5 block text-[10px] leading-4 text-[#6D806E]">
                                        질문 {disclosure.questionChanges.length} · 분야 {disclosure.categories.length} · 제외 {disclosure.excludedItems.length} · 복원 {disclosure.restoredItems.length}
                                      </span>
                                    </span>
                                    {disclosureExpanded
                                      ? <ChevronUp className="h-4 w-4 shrink-0 text-[#36534E]" />
                                      : <ChevronDown className="h-4 w-4 shrink-0 text-[#36534E]" />}
                                  </button>
                                  {disclosureExpanded && (
                                    <div className="mt-2 space-y-3 rounded-lg border border-[#E2D3C8] bg-[#FBF8F2] p-3 text-[11px] leading-5 text-[#243832]">
                                      <p className="rounded-md bg-white px-2 py-1.5 text-[#36534E]">
                                        짧은 요약이 아니라 저장될 제안 원본을 현재 체크리스트와 직접 비교했어요.
                                      </p>
                                      <DisclosureSection
                                        title="바뀌는 질문"
                                        rows={disclosure.questionChanges.map((change) => `${change.label}: ${change.before} → ${change.after}`)}
                                      />
                                      <DisclosureSection
                                        title="영향 받는 분야"
                                        rows={disclosure.categories.map(describeCategoryImpact)}
                                      />
                                      <DisclosureSection
                                        title="제외되는 항목"
                                        rows={disclosure.excludedItems.map(describeExcludedItem)}
                                      />
                                      <DisclosureSection
                                        title="다시 준비 목록에 넣는 항목"
                                        rows={disclosure.restoredItems.map((item) => `${item.categoryLabel} · ${item.label}`)}
                                      />
                                      <p className="text-[10px] text-[#6D806E]">반영 후 자동 제외로 관리되는 항목 총 {disclosure.automaticExclusionTotal}개</p>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={loadingDisclosureId !== null}
                                  onClick={() => void loadDisclosure(n)}
                                  className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-[#C7D1C2] px-3 py-2 text-[11px] font-semibold text-[#36534E] disabled:opacity-50"
                                >
                                  {loadingDisclosureId === n.id && <Loader2 className="h-3 w-3 animate-spin" />}
                                  변경 전체 불러오기
                                </button>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            {isPlanApproval && (
                              <>
                                <button
                                  type="button"
                                  disabled={Boolean(resolvingId)}
                                  onClick={() => void resolvePlanChange(n, "accept")}
                                  className="inline-flex items-center gap-1 rounded-md bg-[#36534E] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                                >
                                  {isResolving && (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  )}
                                  {needsProposalClassification
                                    && (disclosure?.status !== "ready" || !disclosureExpanded)
                                    ? "변경 전체 보기 후 동의"
                                    : "확인하고 반영"}
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(resolvingId)}
                                  onClick={() => void resolvePlanChange(n, "reject")}
                                  className="rounded-md border border-[#D8C7BB] px-2.5 py-1.5 text-[11px] text-[#795252] disabled:opacity-50"
                                >
                                  이번 요청 거절
                                </button>
                              </>
                            )}
                            {isPlanPending && (
                              <button
                                type="button"
                                disabled={Boolean(resolvingId)}
                                onClick={() => void resolvePlanChange(n, "cancel")}
                                className="inline-flex items-center gap-1 rounded-md border border-[#D8C7BB] px-2.5 py-1.5 text-[11px] text-[#795252] disabled:opacity-50"
                              >
                                {isResolving && (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                )}
                                요청 취소
                              </button>
                            )}
                            {n.categoryKey && (
                              <button
                                type="button"
                                onClick={() => onCategoryClick(n.categoryKey!)}
                                className="text-[11px] text-[#C4967E] hover:underline"
                              >
                                체크리스트 보기
                              </button>
                            )}
                            {n.type === "partner" && n.href && onOpen && (
                              <button
                                type="button"
                                onClick={() => onOpen(n)}
                                className="text-[11px] text-[#36534E] hover:underline"
                              >
                                {isPlanApproval || isPlanPending
                                  ? "변경 내용 확인"
                                  : "내용 보기"}
                              </button>
                            )}
                            {n.isNew && (
                              <button
                                type="button"
                                onClick={() => onDismiss(n.id)}
                                aria-label={`${n.title} 읽음으로 표시`}
                                className="text-[11px] text-[#B5ADA3] hover:text-[#928980]"
                              >
                                읽음
                              </button>
                            )}
                          </div>
                          {decisionError?.notificationId === n.id && (
                            <p role="alert" className="mt-2 text-[11px] leading-5 text-[#9A3F3F]">
                              {decisionError.message}
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}
