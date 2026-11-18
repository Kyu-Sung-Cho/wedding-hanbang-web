"use client";

import { AnimatePresence } from "framer-motion";
import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import NotificationPanel from "@/components/app/NotificationPanel";
import Button from "@/components/ui/Button";
import { useNotificationPrefs, useNotifications, type ComputedNotification } from "@/hooks/useNotifications";
import { weddingPath } from "@/lib/weddingPaths";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";

const NO_PROGRESS: Record<string, ProgressItem> = {};

/** 상대가 낸 계획 변경 요청처럼 읽었어도 내가 눌러야 끝나는 알림. */
export function isPendingPlanDecision(notification: ComputedNotification): boolean {
  return notification.type === "partner"
    && (notification.eventKind === "approval_requested" || notification.eventKind === "approval_pending")
    && notification.toolName === "manual_plan_change"
    && Boolean(notification.actionId);
}

/**
 * 상대가 바꾼 것과 준비 알림(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해). 옛 상단 바의 알림 종이
 * 하던 일을 청첩장 홈의 알림 자리로 옮겼다 — 새 화면 틀에는 상단 바가 없다. 새 알림이나 내가 답해야 할 변경 요청이
 * 있을 때만 한 줄로 뜨고, 누르면 옛 종과 같은 알림창(`NotificationPanel`)이 열린다. 읽음·확인·거절·내용 보기는 그 창이
 * 옛 종과 같은 경로로 한다(문구도 서버가 준 그대로다).
 */
export default function LiveNotificationsNotice() {
  const router = useRouter();
  const weddingDate = useAuthStore((state) => state.journey?.wedding_date ?? null);
  const progress = useAuthStore((state) => state.journey?.progress ?? NO_PROGRESS);
  const { prefs } = useNotificationPrefs();
  const { notifications, newCount, dismiss, dismissAll } = useNotifications(weddingDate, progress, prefs);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 알림창이 열려 있는 동안 Esc 로 닫고 초점을 단추로 돌려준다(옛 종과 같다).
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const waitingOnMe = notifications.some(isPendingPlanDecision);
  if (newCount === 0 && !waitingOnMe && !open) return null;

  return (
    <div className="relative" data-live-notifications>
      <Button
        ref={buttonRef}
        variant="outline"
        size="pill-38"
        className="px-3.5"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell className="size-4" aria-hidden="true" />
        {newCount > 0 ? `새 알림 ${newCount}개` : "알림"}
      </Button>
      <AnimatePresence>
        {open ? (
          <NotificationPanel
            notifications={notifications}
            onDismiss={dismiss}
            onDismissAll={dismissAll}
            onCategoryClick={(categoryKey) => {
              setOpen(false);
              router.push(weddingPath(`/checklist?category=${encodeURIComponent(categoryKey)}`));
            }}
            onOpen={(notification) => {
              if (!isPendingPlanDecision(notification)) dismiss(notification.id);
              setOpen(false);
              if (notification.href) router.push(weddingPath(notification.href));
            }}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
