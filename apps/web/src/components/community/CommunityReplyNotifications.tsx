"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { isAllowedCommunityReplyWebHref } from "@hanbang/shared/community-notification";

/** 로그인하지 않아서 못 읽는 것. 네트워크 실패와 **다르게** 다뤄야 한다. */
class SignedOutError extends Error {
  constructor() {
    super("signed out");
    this.name = "SignedOutError";
  }
}

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

const NOTIFICATION_REFRESH_MS = 60_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNotification(value: unknown): value is CommunityReplyNotification {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isUuid(row.id)
    && isUuid(row.actor_id)
    && typeof row.actor_nickname === "string"
    && row.actor_nickname.length > 0
    && Array.from(row.actor_nickname).length <= 40
    && isUuid(row.post_id)
    && isUuid(row.comment_id)
    && (row.parent_comment_id === null || isUuid(row.parent_comment_id))
    && (row.kind === "post_reply" || row.kind === "comment_reply")
    && (row.read_at === null || isTimestamp(row.read_at))
    && isTimestamp(row.created_at)
    && typeof row.title === "string"
    && Array.from(row.title).length <= 120
    && typeof row.message === "string"
    && Array.from(row.message).length <= 200
    && typeof row.href === "string"
    && isAllowedCommunityReplyWebHref(row.href)
  );
}

type NotificationState = {
  ownerId: string | null;
  rows: CommunityReplyNotification[];
};

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

export default function CommunityReplyNotifications({
  ownerId,
}: {
  ownerId: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notificationState, setNotificationState] = useState<NotificationState>({
    ownerId: null,
    rows: [],
  });
  const requestSequenceRef = useRef(0);
  const currentOwnerRef = useRef(ownerId);
  currentOwnerRef.current = ownerId;
  const notifications =
    notificationState.ownerId === ownerId ? notificationState.rows : [];

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const expectedOwnerId = ownerId;
    const sequence = ++requestSequenceRef.current;
    if (currentOwnerRef.current === expectedOwnerId) {
      setError(null);
      setSignedOut(false);
    }
    try {
      const response = await fetch("/api/community/notifications", {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal,
      });
      const payload = await response.json().catch(() => null) as unknown;
      const rawNotifications =
        typeof payload === "object" && payload !== null && "notifications" in payload
          ? payload.notifications
          : null;
      const responseOwnerId =
        typeof payload === "object"
        && payload !== null
        && "ownerId" in payload
        && typeof payload.ownerId === "string"
          ? payload.ownerId
          : null;
      // **401 은 실패가 아니라 "아직 로그인하지 않았다" 이다.**
      //
      // 비로그인(체험 포함) 방문자가 커뮤니티 첫 화면에서 벨을 누르면 이 요청이
      // 401 을 주는데, 그것을 네트워크 실패와 같은 catch 로 묶어 "새 답변을 불러오지
      // 못했어요" + [다시 시도] 를 빨간 글씨로 띄웠다. 다시 눌러도 영원히 같은 401 이다.
      // 커뮤니티 첫 화면은 비로그인 유입의 착지점이라, 거기서 벨을 누른 사람은 전부
      // 고장난 서비스를 봤다.
      if (response.status === 401 || response.status === 403) {
        throw new SignedOutError();
      }
      if (
        !response.ok
        || responseOwnerId?.toLowerCase() !== expectedOwnerId.toLowerCase()
        || !Array.isArray(rawNotifications)
        || !rawNotifications.every(isNotification)
        || new Set(rawNotifications.map((notification) => notification.id)).size
          !== rawNotifications.length
      ) {
        throw new Error("notification load failed");
      }
      if (
        !signal?.aborted
        && sequence === requestSequenceRef.current
        && currentOwnerRef.current === expectedOwnerId
      ) {
        setNotificationState({
          ownerId: expectedOwnerId,
          rows: rawNotifications,
        });
      }
    } catch (caught) {
      if (
        !(caught instanceof DOMException && caught.name === "AbortError")
        && !signal?.aborted
        && sequence === requestSequenceRef.current
        && currentOwnerRef.current === expectedOwnerId
      ) {
        setError(
          caught instanceof SignedOutError
            ? "로그인하면 내 글에 달린 새 답변을 여기서 볼 수 있어요."
            : "새 답변을 불러오지 못했어요.",
        );
        setSignedOut(caught instanceof SignedOutError);
      }
    } finally {
      if (
        !signal?.aborted
        && sequence === requestSequenceRef.current
        && currentOwnerRef.current === expectedOwnerId
      ) {
        setLoading(false);
      }
    }
  }, [ownerId]);

  useEffect(() => {
    requestSequenceRef.current += 1;
    setNotificationState({ ownerId, rows: [] });
    setOpen(false);
    setError(null);
    setLoading(true);
    const controller = new AbortController();
    void refresh(controller.signal);
    const recover = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(recover, NOTIFICATION_REFRESH_MS);
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      controller.abort();
      requestSequenceRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [ownerId, refresh]);

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

  const markRead = useCallback(async (
    selection: { ids: string[] } | { all: true },
  ) => {
    const expectedOwnerId = ownerId;
    const response = await fetch("/api/community/notifications", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      keepalive: true,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ownerId: expectedOwnerId, ...selection }),
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (
      !response.ok
      || currentOwnerRef.current !== expectedOwnerId
      || typeof payload !== "object"
      || payload === null
      || !("ok" in payload)
      || payload.ok !== true
      || !("ownerId" in payload)
      || typeof payload.ownerId !== "string"
      || payload.ownerId.toLowerCase() !== expectedOwnerId.toLowerCase()
    ) {
      throw new Error("notification read failed");
    }
  }, [ownerId]);

  const openNotification = async (
    notification: CommunityReplyNotification,
  ) => {
    if (notification.read_at === null) {
      const previous = notifications;
      const readAt = new Date().toISOString();
      setNotificationState((current) => current.ownerId === ownerId
        ? {
            ownerId,
            rows: current.rows.map((item) =>
              item.id === notification.id ? { ...item, read_at: readAt } : item,
            ),
          }
        : current);
      try {
        await markRead({ ids: [notification.id] });
      } catch {
        if (currentOwnerRef.current === ownerId) {
          setNotificationState({ ownerId, rows: previous });
        }
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
    setNotificationState((current) => current.ownerId === ownerId
      ? {
          ownerId,
          rows: current.rows.map((notification) => (
            notification.read_at === null
              ? { ...notification, read_at: readAt }
              : notification
          )),
        }
      : current);
    try {
      await markRead({ all: true });
    } catch {
      if (currentOwnerRef.current === ownerId) {
        setNotificationState({ ownerId, rows: previous });
        setError("읽음 상태를 저장하지 못했어요.");
      }
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
        className="relative flex h-11 w-11 items-center justify-center rounded-full text-[var(--hb-success)] transition-colors hover:bg-[var(--hb-surface-hover)] hover:text-[var(--hb-text-strong)]"
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
          className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(460px,70vh)] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-[6px] border border-[#EDE4D8] bg-white shadow-[var(--shadow-overlay)]"
        >
          <div className="flex items-center justify-between border-b border-[#F0EFED] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[var(--hb-text-strong)]">새 답변</p>
              <p className="mt-0.5 text-[11px] text-[var(--hb-text-muted)]">
                내 고민과 답변에 이어진 이야기를 확인하세요.
              </p>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex min-h-9 items-center gap-1 rounded-[6px] px-2 text-xs font-medium text-[var(--hb-success)] hover:bg-[var(--hb-surface-hover)]"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                모두 읽음
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-[var(--hb-text-muted)]">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                불러오는 중
              </div>
            ) : error && notifications.length === 0 ? (
              <div className="px-5 py-8 text-center">
                {/* 로그인 안내는 오류색으로 쓰지 않는다 — 고장이 아니다. */}
                <p className={`text-sm ${signedOut ? "text-[var(--hb-text-body)]" : "text-[#8F6662]"}`}>{error}</p>
                {/* 버튼을 두 개로 나누지 않는다 — 손으로 만든 버튼은 늘리지 않기로
                    했고(`rawButtonRatchet.test.ts`), 같은 자리에 같은 모양으로 서는
                    버튼이라 하나면 된다. 로그인 안 한 경우엔 다시 눌러도 영원히 같은
                    401 이므로 [다시 시도] 대신 로그인으로 보낸다. */}
                <button
                  type="button"
                  onClick={() => {
                    if (signedOut) {
                      router.push("/login");
                      return;
                    }
                    setLoading(true);
                    void refresh();
                  }}
                  className="mt-3 min-h-10 rounded-[6px] border border-[#C7D1C2] px-4 text-sm font-medium text-[var(--hb-text-strong)]"
                >
                  {signedOut ? "로그인하기" : "다시 시도"}
                </button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-[var(--hb-text-strong)]">
                  아직 새 답변이 없어요
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--hb-text-muted)]">
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
                      className="flex min-h-[76px] w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--hb-surface-page)]"
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
                        <span className="block text-sm font-medium leading-snug text-[var(--hb-text-strong)]">
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
              className="border-t border-[#F0EFED] bg-[var(--hb-surface-page)] px-4 py-2 text-xs text-[var(--color-rose-700)]"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
