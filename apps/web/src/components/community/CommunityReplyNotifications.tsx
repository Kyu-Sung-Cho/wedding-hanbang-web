"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";

type CommunityReplyNotification = {
  id: string;
  actor_id: string;
  actor_nickname: string;
  post_id: string;
  comment_id: string;
  parent_comment_id: string | null;
  kind: "post_reply" | "comment_reply";
  read_at: string | null;
  created_at: string;
  title: string;
  message: string;
  href: string;
};

const COMMUNITY_NOTIFICATION_HREF =
  /^\/wedding\/community\/post\/[0-9a-f-]{36}#comment-[0-9a-f-]{36}$/i;
const NOTIFICATION_REFRESH_MS = 60_000;

function isNotification(value: unknown): value is CommunityReplyNotification {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string"
    && typeof row.actor_id === "string"
    && typeof row.actor_nickname === "string"
    && typeof row.post_id === "string"
    && typeof row.comment_id === "string"
    && (row.parent_comment_id === null || typeof row.parent_comment_id === "string")
    && (row.kind === "post_reply" || row.kind === "comment_reply")
    && (row.read_at === null || typeof row.read_at === "string")
    && typeof row.created_at === "string"
    && typeof row.title === "string"
    && typeof row.message === "string"
    && typeof row.href === "string"
    && COMMUNITY_NOTIFICATION_HREF.test(row.href)
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function CommunityReplyNotifications() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<
    CommunityReplyNotification[]
  >([]);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/community/notifications", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json().catch(() => null)) as
        | { notifications?: unknown }
        | null;
      if (!response.ok || !Array.isArray(payload?.notifications)) {
        throw new Error("notification load failed");
      }
      setNotifications(payload.notifications.filter(isNotification));
    } catch {
      setError("새 답변을 불러오지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const recover = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(recover, NOTIFICATION_REFRESH_MS);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current
        && !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const unreadCount = notifications.filter(
    (notification) => notification.read_at === null,
  ).length;

  const markRead = useCallback(async (ids: string[]) => {
    const response = await fetch("/api/community/notifications", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error("notification read failed");
  }, []);

  const openNotification = async (
    notification: CommunityReplyNotification,
  ) => {
    if (notification.read_at === null) {
      const previous = notifications;
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, read_at: readAt } : item,
        ),
      );
      try {
        await markRead([notification.id]);
      } catch {
        setNotifications(previous);
      }
    }
    setOpen(false);
    router.push(notification.href);
  };

  const markAllRead = async () => {
    const unreadIds = notifications
      .filter((notification) => notification.read_at === null)
      .map((notification) => notification.id);
    if (unreadIds.length === 0) return;

    const previous = notifications;
    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => (
        notification.read_at === null
          ? { ...notification, read_at: readAt }
          : notification
      )),
    );
    try {
      const response = await fetch("/api/community/notifications", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ all: true }),
      });
      if (!response.ok) throw new Error("notification read failed");
    } catch {
      setNotifications(previous);
      setError("읽음 상태를 저장하지 못했어요.");
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={
          unreadCount > 0 ? `새 답변 알림 ${unreadCount}개` : "새 답변 알림"
        }
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-[#6D806E] transition-colors hover:bg-[#F7F1E8] hover:text-[#36534E]"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute right-0 top-0 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-[#8F6662] px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="새 답변 알림"
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(460px,70vh)] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[#EDE4D8] bg-white shadow-[0_18px_48px_rgba(36,56,50,0.16)]"
        >
          <div className="flex items-center justify-between border-b border-[#F0EFED] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#243832]">새 답변</p>
              <p className="mt-0.5 text-[11px] text-[#928980]">
                내 고민과 답변에 이어진 이야기를 확인하세요.
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[#6D806E] hover:bg-[#F7F1E8]"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                모두 읽음
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-[#928980]">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                불러오는 중
              </div>
            ) : error && notifications.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-[#8F6662]">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoading(true);
                    void refresh();
                  }}
                  className="mt-3 min-h-10 rounded-lg border border-[#C7D1C2] px-4 text-sm font-medium text-[#36534E]"
                >
                  다시 시도
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-[#36534E]">
                  아직 새 답변이 없어요
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#928980]">
                  누군가 내 고민이나 답변에 이어 쓰면 여기에 알려드려요.
                </p>
              </div>
            ) : (
              <ul>
                {notifications.map((notification) => (
                  <li
                    key={notification.id}
                    className="border-b border-[#F0EFED] last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => void openNotification(notification)}
                      className="flex min-h-[76px] w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#FBF8F2]"
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          notification.read_at === null
                            ? "bg-[#8F6662]"
                            : "bg-transparent"
                        }`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium leading-snug text-[#243832]">
                          {notification.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-[#746C65]">
                          {notification.message}
                        </span>
                        <time
                          dateTime={notification.created_at}
                          className="mt-1 block text-[11px] text-[#A39A91]"
                        >
                          {formatTime(notification.created_at)}
                        </time>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {error && notifications.length > 0 && (
            <p
              role="status"
              className="border-t border-[#F0EFED] bg-[#FBF8F2] px-4 py-2 text-xs text-[#8F6662]"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
