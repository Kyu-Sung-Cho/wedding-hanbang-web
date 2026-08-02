"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { NOTIFICATION_TEMPLATES } from "@/constants/notifications";
import type { ProgressItem } from "@/types/database.types";

export interface ComputedNotification {
  id: string;
  type: "schedule" | "budget" | "ai";
  title: string;
  message: string;
  priority: "high" | "medium" | "low";
  categoryKey?: string;
  isNew: boolean;
}

const DISMISSED_KEY = "hanbang_dismissed_notifications";
const PREFS_KEY = "hanbang_notification_prefs";

/** Local notification UI state must not carry over to the next signed-in actor. */
export function clearNotificationClientState(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(DISMISSED_KEY);
  localStorage.removeItem(PREFS_KEY);
}

export interface NotificationPrefs {
  schedule: boolean;
  budget: boolean;
  ai: boolean;
  marketing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  schedule: true,
  budget: true,
  ai: false,
  marketing: false,
};

export function useNotificationPrefs() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      if (stored) setPrefs(JSON.parse(stored));
    } catch { /* ignore */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const togglePref = useCallback((key: keyof NotificationPrefs) => {
    setPrefs((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      localStorage.setItem(PREFS_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  return { prefs, togglePref };
}

export function useNotifications(
  weddingDate: Date | null,
  progress: Record<string, ProgressItem>,
  prefs: NotificationPrefs
) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      if (stored) setDismissedIds(JSON.parse(stored));
    } catch { /* ignore */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const dismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const updated = [...prev, id];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const dismissAll = useCallback(() => {
    const allIds = notifications.map((n) => n.id);
    setDismissedIds((prev) => {
      const updated = [...new Set([...prev, ...allIds])];
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
      return updated;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifications = useMemo<ComputedNotification[]>(() => {
    if (!weddingDate) return [];

    const today = new Date();
    const dday = Math.ceil(
      (weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (dday <= 0) return [];

    return NOTIFICATION_TEMPLATES
      .filter((t) => {
        // D-day 범위 체크
        if (dday > t.ddayTrigger) return false;

        // 카테고리 완료 시 해당 알림 숨김
        if (t.categoryKey) {
          const item = progress[t.categoryKey];
          if (item?.status === "completed") return false;
        }

        // 설정에서 비활성화된 타입 필터
        if (t.type === "schedule" && !prefs.schedule) return false;
        if (t.type === "budget" && !prefs.budget) return false;
        if (t.type === "ai" && !prefs.ai) return false;

        return true;
      })
      .map((t) => ({
        id: t.id,
        type: t.type,
        title: t.title,
        message: t.message,
        priority: t.priority,
        categoryKey: t.categoryKey,
        isNew: !dismissedIds.includes(t.id),
      }))
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
      });
  }, [weddingDate, progress, prefs, dismissedIds]);

  const newCount = notifications.filter((n) => n.isNew).length;

  return { notifications, newCount, dismiss, dismissAll };
}
