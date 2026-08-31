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
} from "lucide-react";
import type { ComputedNotification } from "@/hooks/useNotifications";
import { useAuthStore } from "@/stores/authStore";

const PRIORITY_STYLES: Record<string, { icon: React.ElementType; accent: string; bg: string }> = {
  high: { icon: AlertTriangle, accent: "text-red-500", bg: "bg-red-50" },
  medium: { icon: Bell, accent: "text-[#C4967E]", bg: "bg-[#C4967E]/5" },
  low: { icon: Info, accent: "text-[var(--hb-text-muted)]", bg: "bg-[#FAF8F5]" },
};
const PARTNER_STYLE = {
  icon: Users,
  accent: "text-[var(--hb-text-strong)]",
  bg: "bg-[var(--hb-primary)]/8",
};

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
}

export default function NotificationPanel({
  notifications,
  onDismiss,
  onDismissAll,
  onCategoryClick,
  onOpen,
  onClose,
}: Props) {
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<{
    notificationId: string;
    message: string;
  } | null>(null);

  const resolvePlanChange = async (
    notification: ComputedNotification,
    decision: "accept" | "reject" | "cancel",
  ) => {
    if (!notification.actionId || resolvingId) return;
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
          body: "{}",
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
      setDecisionError({
        notificationId: notification.id,
        message:
          error instanceof Error
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
        className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] bg-white rounded-[6px] border border-black/[0.06] shadow-xl z-50 overflow-hidden flex flex-col max-md:w-[calc(100vw-32px)] max-md:right-[-8px]"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.04]">
          <h3 className="text-[var(--hb-text-strong)]">알림</h3>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={onDismissAll}
                className="text-[11px] text-[var(--hb-text-muted)] hover:text-[#C4967E] transition-colors"
              >
                모두 읽음
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="알림 닫기"
              className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[var(--hb-text-muted)] hover:bg-[#FAF8F5] transition-colors"
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
              <p className="text-[14px] text-[var(--hb-text-muted)] font-medium">
                모든 알림을 확인했습니다
              </p>
              <p className="text-[12px] text-[var(--hb-text-muted)] mt-1">
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
                          className={`w-8 h-8 rounded-[6px] ${style.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}
                        >
                          <Icon className={`w-4 h-4 ${style.accent}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[13px] font-medium text-[var(--hb-text-strong)]">
                              {n.title}
                            </p>
                            {n.isNew && (
                              <div className="w-1.5 h-1.5 rounded-full bg-[#C4967E] flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-[12px] text-[var(--hb-text-muted)] font-light mt-0.5 leading-relaxed">
                            {n.message}
                          </p>
                          {createdAt && n.createdAt && (
                            <time
                              dateTime={n.createdAt}
                              className="block text-[10px] text-[var(--hb-text-muted)] mt-1"
                            >
                              {createdAt}
                            </time>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            {isPlanApproval && (
                              <>
                                <button
                                  type="button"
                                  disabled={Boolean(resolvingId)}
                                  onClick={() => void resolvePlanChange(n, "accept")}
                                  className="inline-flex items-center gap-1 rounded-[6px] bg-[var(--hb-primary)] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                                >
                                  {isResolving && (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  )}
                                  확인하고 반영
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(resolvingId)}
                                  onClick={() => void resolvePlanChange(n, "reject")}
                                  className="rounded-[6px] border border-[#D8C7BB] px-2.5 py-1.5 text-[11px] text-[var(--hb-accent-hover)] disabled:opacity-50"
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
                                className="inline-flex items-center gap-1 rounded-[6px] border border-[#D8C7BB] px-2.5 py-1.5 text-[11px] text-[var(--hb-accent-hover)] disabled:opacity-50"
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
                                className="text-[11px] text-[var(--hb-text-strong)] hover:underline"
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
                                className="text-[11px] text-[var(--hb-text-muted)] hover:text-[var(--hb-text-muted)]"
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
