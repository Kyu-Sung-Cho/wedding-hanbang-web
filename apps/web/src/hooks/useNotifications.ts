"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { NOTIFICATION_TEMPLATES } from "@/constants/notifications";
import { createClient } from "@/lib/supabase/client";
import { daysUntilWedding } from "@/lib/utils/weddingDate";
import { useAuthStore } from "@/stores/authStore";
import type { ProgressItem } from "@/types/database.types";

export interface ComputedNotification {
  id: string;
  type: "schedule" | "budget" | "ai" | "partner";
  title: string;
  message: string;
  priority: "high" | "medium" | "low";
  categoryKey?: string;
  href?: string;
  createdAt?: string;
  actionId?: string;
  eventKind?: string;
  toolName?: string;
  isNew: boolean;
}

const DISMISSED_KEY = "hanbang_dismissed_notifications";
const PREFS_KEY = "hanbang_notification_prefs";
const PARTNER_REFRESH_INTERVAL_MS = 60_000;

interface PartnerNotificationRow {
  id: string;
  event_kind: string;
  action_id: string | null;
  tool_name: string | null;
  title: string;
  message: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

interface PartnerNotificationState {
  ownerId: string | null;
  rows: PartnerNotificationRow[];
}

const EMPTY_PARTNER_ROWS: PartnerNotificationRow[] = [];

function isSafeAppHref(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.startsWith("/")
    && !value.startsWith("//")
  );
}

function isPartnerNotificationRow(
  value: unknown,
): value is PartnerNotificationRow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string"
    && typeof row.event_kind === "string"
    && (typeof row.action_id === "string" || row.action_id === null)
    && (typeof row.tool_name === "string" || row.tool_name === null)
    && typeof row.title === "string"
    && typeof row.message === "string"
    && (typeof row.href === "string" || row.href === null)
    && (typeof row.read_at === "string" || row.read_at === null)
    && typeof row.created_at === "string"
  );
}

export interface NotificationPrefs {
  schedule: boolean;
  budget: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  schedule: true,
  budget: true,
};

export function parseNotificationPrefs(value: unknown): NotificationPrefs {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_PREFS;
  }

  const candidate = value as Record<string, unknown>;
  return {
    schedule:
      typeof candidate.schedule === "boolean"
        ? candidate.schedule
        : DEFAULT_PREFS.schedule,
    budget:
      typeof candidate.budget === "boolean"
        ? candidate.budget
        : DEFAULT_PREFS.budget,
  };
}

export function parseDismissedNotificationIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value.filter(
      (item): item is string =>
        typeof item === "string" && item.length > 0 && item.length <= 128,
    ),
  )].slice(-500);
}

export function useNotificationPrefs() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem(PREFS_KEY);
        if (stored) setPrefs(parseNotificationPrefs(JSON.parse(stored)));
      } catch {
        // Invalid or unavailable local preferences fall back to safe defaults.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const togglePref = useCallback((key: keyof NotificationPrefs) => {
    setPrefs((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(updated));
      } catch {
        // The in-memory choice still applies when browser storage is blocked.
      }
      return updated;
    });
  }, []);

  return { prefs, togglePref };
}

export function useNotifications(
  weddingDate: string | null | undefined,
  progress: Record<string, ProgressItem>,
  prefs: NotificationPrefs,
) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [partnerState, setPartnerState] = useState<PartnerNotificationState>({
    ownerId: null,
    rows: EMPTY_PARTNER_ROWS,
  });
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const isDemo = useAuthStore((state) => state.isDemo);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  const partnerRows =
    partnerState.ownerId === userId
      ? partnerState.rows
      : EMPTY_PARTNER_ROWS;
  const fetchSequenceRef = useRef(0);
  const readSequenceRef = useRef(0);
  const partnerStateRef = useRef<PartnerNotificationState>({
    ownerId: null,
    rows: EMPTY_PARTNER_ROWS,
  });
  const seenAppliedNotificationIdsRef = useRef(new Set<string>());
  const currentIdentityRef = useRef({ userId, isDemo });
  currentIdentityRef.current = { userId, isDemo };

  const replacePartnerRows = useCallback((
    ownerId: string | null,
    rows: PartnerNotificationRow[],
  ) => {
    const next = { ownerId, rows };
    partnerStateRef.current = next;
    setPartnerState(next);
  }, []);

  const refreshPartnerNotifications = useCallback(async () => {
    if (!isInitialized || !userId || isDemo) {
      replacePartnerRows(null, EMPTY_PARTNER_ROWS);
      return false;
    }

    const sequence = ++fetchSequenceRef.current;
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return false;

      const payload = await response.json() as unknown;
      const rawRows =
        typeof payload === "object" && payload !== null
          ? (payload as { notifications?: unknown }).notifications
          : undefined;
      const responseOwnerId =
        typeof payload === "object"
        && payload !== null
        && "ownerId" in payload
        && typeof payload.ownerId === "string"
          ? payload.ownerId
          : null;
      if (responseOwnerId !== userId || !Array.isArray(rawRows)) return false;

      const rows = rawRows.filter(isPartnerNotificationRow);
      const currentIdentity = currentIdentityRef.current;
      if (
        sequence === fetchSequenceRef.current
        && currentIdentity.userId === userId
        && !currentIdentity.isDemo
      ) {
        const newlyAppliedIds = rows
          .filter(
            (row) =>
              row.event_kind === "change_applied"
              && !seenAppliedNotificationIdsRef.current.has(row.id),
          )
          .map((row) => row.id);
        replacePartnerRows(userId, rows);
        if (newlyAppliedIds.length > 0) {
          try {
            void useAuthStore.getState().refreshJourney(userId).then((synchronized) => {
              const identity = currentIdentityRef.current;
              if (
                !synchronized
                || identity.userId !== userId
                || identity.isDemo
              ) return;
              for (const id of newlyAppliedIds) {
                seenAppliedNotificationIdsRef.current.add(id);
              }
            }).catch(() => {
              // Leave the IDs unseen so focus/online/polling retries the sync.
            });
          } catch {
            // Leave the IDs unseen so focus/online/polling retries the sync.
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }, [isDemo, isInitialized, replacePartnerRows, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem(DISMISSED_KEY);
        if (stored) {
          setDismissedIds(
            parseDismissedNotificationIds(JSON.parse(stored)),
          );
        }
      } catch {
        // A damaged local read marker must not hide durable partner history.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    seenAppliedNotificationIdsRef.current.clear();
  }, [userId]);

  useEffect(() => {
    if (!isInitialized || !userId || isDemo) {
      fetchSequenceRef.current += 1;
      replacePartnerRows(null, EMPTY_PARTNER_ROWS);
      return;
    }

    void refreshPartnerNotifications();

    const recover = () => {
      if (typeof navigator === "undefined" || navigator.onLine !== false) {
        void refreshPartnerNotifications();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recover();
    };
    const interval = window.setInterval(
      recover,
      PARTNER_REFRESH_INTERVAL_MS,
    );
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    isDemo,
    isInitialized,
    refreshPartnerNotifications,
    replacePartnerRows,
    userId,
  ]);

  useEffect(() => {
    if (!isInitialized || !userId || isDemo) return;

    try {
      const supabase = createClient();
      const channel = supabase
        .channel(`couple-change-notifications:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "couple_change_notifications",
            filter: `recipient_user_id=eq.${userId}`,
          },
          () => {
            void refreshPartnerNotifications();
          },
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    } catch {
      // Focus, online and bounded polling recovery remain active.
      return;
    }
  }, [isDemo, isInitialized, refreshPartnerNotifications, userId]);

  // 상단바 D-day 알약과 같은 도우미로 센다(예식일·오늘을 둘 다 한국 자정으로 맞춘다).
  // 손으로 `new Date("YYYY-MM-DD")` 와 지금의 차를 올림하면 한국 0~9시에 하루가 크게 나왔다.
  // 렌더마다 다시 계산하므로 날짜가 바뀐 뒤 다시 그려질 때 알약과 같이 움직인다.
  const dday = daysUntilWedding(weddingDate);

  const localNotifications = useMemo<ComputedNotification[]>(() => {
    if (dday === null || dday <= 0) return [];

    return NOTIFICATION_TEMPLATES
      .filter((template) => {
        if (dday > template.ddayTrigger) return false;

        if (template.categoryKey) {
          const item = progress[template.categoryKey];
          if (item?.status === "completed" || item?.status === "not_applicable") return false;
        }

        if (template.type === "schedule" && !prefs.schedule) return false;
        if (template.type === "budget" && !prefs.budget) return false;
        return true;
      })
      .map((template) => ({
        id: template.id,
        type: template.type,
        title: template.title,
        message: template.message,
        priority: template.priority,
        categoryKey: template.categoryKey,
        isNew: !dismissedIds.includes(template.id),
      }))
      .sort((left, right) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[left.priority] - order[right.priority];
      });
  }, [dday, dismissedIds, prefs, progress]);

  const partnerNotifications = useMemo<ComputedNotification[]>(
    () => {
      const seenActionIds = new Set<string>();
      return partnerRows
        .filter((row) => {
          if (row.action_id === null) return true;
          if (seenActionIds.has(row.action_id)) return false;
          seenActionIds.add(row.action_id);
          return true;
        })
        .map((row) => ({
          id: row.id,
          type: "partner",
          title: row.title,
          message: row.message,
          // A request to decide together is activity, not a danger signal.
          priority: "medium",
          href: isSafeAppHref(row.href) ? row.href : undefined,
          createdAt: row.created_at,
          actionId: row.action_id ?? undefined,
          eventKind: row.event_kind,
          toolName: row.tool_name ?? undefined,
          isNew: row.read_at === null,
        }));
    },
    [partnerRows],
  );

  const notifications = useMemo<ComputedNotification[]>(() => {
    const ids = new Set<string>();
    return [...partnerNotifications, ...localNotifications].filter(
      (notification) => {
        if (ids.has(notification.id)) return false;
        ids.add(notification.id);
        return true;
      },
    );
  }, [localNotifications, partnerNotifications]);

  const markPartnerRead = useCallback(async (
    selection: { ids: string[] } | { all: true },
  ) => {
    if (!userId || isDemo) return;

    const previous =
      partnerStateRef.current.ownerId === userId
        ? partnerStateRef.current.rows
        : EMPTY_PARTNER_ROWS;
    const selectedIds = "ids" in selection
      ? new Set(selection.ids)
      : null;
    const readAt = new Date().toISOString();
    const optimistic = previous.map((row) => (
      (selectedIds === null || selectedIds.has(row.id)) && row.read_at === null
        ? { ...row, read_at: readAt }
        : row
    ));
    const sequence = ++readSequenceRef.current;
    replacePartnerRows(userId, optimistic);

    try {
      const response = await fetch("/api/notifications", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selection),
      });
      if (!response.ok) throw new Error("notification read failed");
    } catch {
      const currentIdentity = currentIdentityRef.current;
      if (
        sequence === readSequenceRef.current
        && currentIdentity.userId === userId
        && !currentIdentity.isDemo
      ) {
        replacePartnerRows(userId, previous);
      }
      void refreshPartnerNotifications();
    }
  }, [
    isDemo,
    refreshPartnerNotifications,
    replacePartnerRows,
    userId,
  ]);

  const partnerIds = useMemo(
    () => new Set(partnerRows.map((row) => row.id)),
    [partnerRows],
  );

  const dismiss = useCallback((id: string) => {
    if (partnerIds.has(id)) {
      void markPartnerRead({ ids: [id] });
      return;
    }

    setDismissedIds((previous) => {
      const updated = previous.includes(id)
        ? previous
        : [...previous, id];
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
      } catch {
        // Dismissal still applies for the current session.
      }
      return updated;
    });
  }, [markPartnerRead, partnerIds]);

  const dismissAll = useCallback(() => {
    const localIds = localNotifications.map((notification) => notification.id);
    setDismissedIds((previous) => {
      const updated = [...new Set([...previous, ...localIds])];
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
      } catch {
        // Dismissal still applies for the current session.
      }
      return updated;
    });

    if (partnerRows.some((row) => row.read_at === null)) {
      void markPartnerRead({ all: true });
    }
  }, [localNotifications, markPartnerRead, partnerRows]);

  const newCount = notifications.filter((notification) => notification.isNew)
    .length;

  return {
    notifications,
    newCount,
    dismiss,
    dismissAll,
    refresh: refreshPartnerNotifications,
  };
}
