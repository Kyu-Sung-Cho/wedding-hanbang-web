"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { dateLikeToYmdInKst, ymdInKst } from "@/lib/utils/kstDate";
import { getEvents } from "@/utils/scheduleEvents";

export interface ComputedNotification {
  id: string;
  type: "schedule";
  title: string;
  message: string;
  priority: "low";
  isNew: boolean;
}

const DISMISSED_KEY = "hanbang_dismissed_notifications";
const PREFS_KEY = "hanbang_notification_prefs";

export interface NotificationPrefs {
  schedule: boolean;
  // Legacy keys remain readable so an existing local value cannot break parsing.
  // There is no producer or UI for these unverified notification types.
  budget: boolean;
  ai: boolean;
  marketing: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  schedule: true,
  budget: false,
  ai: false,
  marketing: false,
};

interface OwnerScopedState<T> {
  ownerId: string | null;
  value: T;
}

export function notificationStorageKey(baseKey: string, ownerId: string | null): string | null {
  const normalizedOwnerId = ownerId?.trim();
  return normalizedOwnerId ? `${baseKey}:${normalizedOwnerId}` : null;
}

function clearLegacyUnscopedState() {
  localStorage.removeItem(PREFS_KEY);
  localStorage.removeItem(DISMISSED_KEY);
}

function readStoredPrefs(storageKey: string): NotificationPrefs {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return DEFAULT_PREFS;
    const parsed = JSON.parse(stored) as Partial<NotificationPrefs>;
    return {
      ...DEFAULT_PREFS,
      schedule: parsed.schedule !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function readStoredDismissedIds(storageKey: string): string[] {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

export function useNotificationPrefs(ownerId: string | null) {
  const storageKey = useMemo(() => notificationStorageKey(PREFS_KEY, ownerId), [ownerId]);
  const [state, setState] = useState<OwnerScopedState<NotificationPrefs>>({
    ownerId: null,
    value: DEFAULT_PREFS,
  });
  const prefs = state.ownerId === ownerId ? state.value : DEFAULT_PREFS;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        clearLegacyUnscopedState();
      } catch {
        // Storage cleanup is best-effort; scoped state remains fail-closed below.
      }
      setState({
        ownerId,
        value: storageKey ? readStoredPrefs(storageKey) : DEFAULT_PREFS,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ownerId, storageKey]);

  const togglePref = useCallback((key: keyof NotificationPrefs) => {
    // Only schedule notifications have an implemented, factual producer.
    if (key !== "schedule") return;
    setState((previous) => {
      const current = previous.ownerId === ownerId ? previous.value : DEFAULT_PREFS;
      const updated = { ...current, schedule: !current.schedule };
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch {
          // The current session still reflects the explicit user choice.
        }
      }
      return { ownerId, value: updated };
    });
  }, [ownerId, storageKey]);

  return { prefs, togglePref };
}

function formatEventMessage(date: string, time?: string): string {
  const [year, month, day] = date.split("-");
  const formattedDate = `${year}년 ${Number(month)}월 ${Number(day)}일`;
  return time ? `${formattedDate} ${time}` : formattedDate;
}

export function useNotifications(
  progress: Record<string, unknown>,
  prefs: NotificationPrefs,
  ownerId: string | null
) {
  const storageKey = useMemo(() => notificationStorageKey(DISMISSED_KEY, ownerId), [ownerId]);
  const [dismissedState, setDismissedState] = useState<OwnerScopedState<string[]>>({
    ownerId: null,
    value: [],
  });
  const dismissedIds = useMemo(
    () => (dismissedState.ownerId === ownerId ? dismissedState.value : []),
    [dismissedState, ownerId]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        clearLegacyUnscopedState();
      } catch {
        // Storage cleanup is best-effort; scoped state remains fail-closed below.
      }
      setDismissedState({
        ownerId,
        value: storageKey ? readStoredDismissedIds(storageKey) : [],
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ownerId, storageKey]);

  const notifications = useMemo<ComputedNotification[]>(() => {
    if (!ownerId || !prefs.schedule) return [];

    const today = ymdInKst();
    return getEvents(progress)
      .flatMap((event) => {
        const date = dateLikeToYmdInKst(event.date);
        if (!date || date < today || typeof event.id !== "string" || !event.id) return [];
        const title = typeof event.title === "string" ? event.title.trim() : "";
        if (!title) return [];

        const version = typeof event.updatedAt === "string" ? event.updatedAt : "recorded";
        const id = `schedule:${event.id}:${version}`;
        return [{
          id,
          type: "schedule" as const,
          title,
          message: formatEventMessage(date, typeof event.time === "string" ? event.time : undefined),
          priority: "low" as const,
          isNew: !dismissedIds.includes(id),
          sortKey: `${date}T${event.time ?? "23:59"}`,
        }];
      })
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
      .slice(0, 10)
      .map(({ id, type, title, message, priority, isNew }) => ({
        id,
        type,
        title,
        message,
        priority,
        isNew,
      }));
  }, [progress, prefs.schedule, dismissedIds, ownerId]);

  const dismiss = useCallback((id: string) => {
    setDismissedState((previous) => {
      const current = previous.ownerId === ownerId ? previous.value : [];
      const updated = [...new Set([...current, id])];
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch {
          // Keep the read state for this session when storage is unavailable.
        }
      }
      return { ownerId, value: updated };
    });
  }, [ownerId, storageKey]);

  const dismissAll = useCallback(() => {
    setDismissedState((previous) => {
      const current = previous.ownerId === ownerId ? previous.value : [];
      const updated = [...new Set([...current, ...notifications.map((item) => item.id)])];
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify(updated));
        } catch {
          // Keep the read state for this session when storage is unavailable.
        }
      }
      return { ownerId, value: updated };
    });
  }, [notifications, ownerId, storageKey]);

  const newCount = notifications.filter((notification) => notification.isNew).length;

  return { notifications, newCount, dismiss, dismissAll };
}
