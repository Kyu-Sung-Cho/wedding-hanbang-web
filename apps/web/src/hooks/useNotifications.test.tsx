import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressItem } from "@/types/database.types";

const mocks = vi.hoisted(() => {
  const authState = {
    user: {
      id: "40000000-0000-4000-8000-000000000001",
      email: "user@example.com",
    },
    isDemo: false,
    isInitialized: true,
  };
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);

  return {
    authState,
    channel,
    channelFactory: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn(),
    refreshJourney: vi.fn().mockResolvedValue(true),
  };
});

vi.mock("@/stores/authStore", () => {
  const useAuthStore = Object.assign((
    selector: (state: typeof mocks.authState) => unknown,
  ) => selector(mocks.authState), {
    getState: () => ({
      ...mocks.authState,
      refreshJourney: mocks.refreshJourney,
    }),
  });
  return { useAuthStore };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: mocks.channelFactory,
    removeChannel: mocks.removeChannel,
  }),
}));

import {
  parseDismissedNotificationIds,
  parseNotificationPrefs,
  useNotifications,
  type ComputedNotification,
  type NotificationPrefs,
} from "./useNotifications";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PREFS_OFF: NotificationPrefs = {
  schedule: false,
  budget: false,
};

describe("parseNotificationPrefs", () => {
  it("keeps valid choices and ignores retired or malformed fields", () => {
    expect(parseNotificationPrefs({
      schedule: false,
      budget: true,
      marketing: true,
    })).toEqual({
      schedule: false,
      budget: true,
    });
    expect(parseNotificationPrefs({ schedule: "yes" })).toEqual({
      schedule: true,
      budget: true,
    });
    expect(parseNotificationPrefs(null)).toEqual({
      schedule: true,
      budget: true,
    });
  });
});

describe("parseDismissedNotificationIds", () => {
  it("keeps only bounded unique string IDs", () => {
    expect(parseDismissedNotificationIds([
      "first",
      "first",
      "",
      42,
      "x".repeat(129),
      "second",
    ])).toEqual(["first", "second"]);
    expect(parseDismissedNotificationIds({ ids: ["first"] })).toEqual([]);
  });
});

let latest:
  | ReturnType<typeof useNotifications>
  | undefined;
let serverNotifications: Array<Record<string, unknown>>;

function captureLatest(value: ReturnType<typeof useNotifications>) {
  latest = value;
}

function Harness({
  weddingDate = null,
  progress = {},
  prefs = PREFS_OFF,
}: {
  weddingDate?: Date | null;
  progress?: Record<string, ProgressItem>;
  prefs?: NotificationPrefs;
}) {
  const value = useNotifications(weddingDate, progress, prefs);
  useEffect(() => {
    captureLatest(value);
  }, [value]);
  return (
    <div>
      {value.notifications.map((notification: ComputedNotification) => (
        <p key={notification.id}>
          {notification.type}:{notification.title}:{String(notification.isNew)}
        </p>
      ))}
    </div>
  );
}

describe("useNotifications checklist truth", () => {
  it("alerts reviewed legacy status-only work but not an unreviewed category", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const weddingDate = new Date(Date.now() + 30 * 86_400_000);

    await act(async () => {
      root.render(<Harness
        weddingDate={weddingDate}
        prefs={{ schedule: true, budget: false }}
        progress={{ venue: { status: "completed" } } as never}
      />);
    });

    expect(container.textContent).toContain("결혼식장 후보 확인하기");
    expect(container.textContent).not.toContain("사진 촬영 계획 확인하기");
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("useNotifications partner activity", () => {
  let root: Root;
  let container: HTMLDivElement;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshJourney.mockResolvedValue(true);
    mocks.channel.on.mockReturnValue(mocks.channel);
    mocks.channel.subscribe.mockReturnValue(mocks.channel);
    mocks.channelFactory.mockReturnValue(mocks.channel);
    mocks.authState.user = {
      id: "40000000-0000-4000-8000-000000000001",
      email: "user@example.com",
    };
    mocks.authState.isDemo = false;
    mocks.authState.isInitialized = true;
    serverNotifications = [
      {
        id: "10000000-0000-4000-8000-000000000001",
        event_kind: "change_applied",
        action_id: "action-1",
        tool_name: "update_budget",
        title: "예산이 변경됐어요",
        message: "공동 예산 변경이 반영됐어요.",
        href: "/budget",
        read_at: null,
        created_at: "2026-07-30T01:00:00.000Z",
      },
    ];
    fetchMock.mockImplementation(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          ownerId: mocks.authState.user?.id ?? null,
          notifications: serverNotifications,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    latest = undefined;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("shows a durable partner notification even without a wedding date or enabled local preferences", async () => {
    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
      }),
    );
    expect(container.textContent).toContain(
      "partner:예산이 변경됐어요:true",
    );
    expect(latest?.notifications[0]).toMatchObject({
      id: "10000000-0000-4000-8000-000000000001",
      type: "partner",
      href: "/budget",
      isNew: true,
    });
    expect(latest?.newCount).toBe(1);
    expect(mocks.channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        table: "couple_change_notifications",
        filter:
          "recipient_user_id=eq.40000000-0000-4000-8000-000000000001",
      }),
      expect.any(Function),
    );
    expect(mocks.refreshJourney).toHaveBeenCalledOnce();
  });

  it("rejects notifications authenticated for a different session owner", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ownerId: "40000000-0000-4000-8000-000000000099",
          notifications: serverNotifications,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(latest?.notifications).toEqual([]);
    expect(mocks.refreshJourney).not.toHaveBeenCalled();
  });

  it("keeps read partner activity visible as history instead of deleting it", async () => {
    serverNotifications[0] = {
      ...serverNotifications[0],
      read_at: "2026-07-30T02:00:00.000Z",
    };

    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain(
      "partner:예산이 변경됐어요:false",
    );
    expect(latest?.notifications).toHaveLength(1);
    expect(latest?.newCount).toBe(0);
  });

  it("shows only the newest state when one shared action has transitioned", async () => {
    serverNotifications = [
      {
        ...serverNotifications[0],
        id: "10000000-0000-4000-8000-000000000002",
        event_kind: "change_applied",
        title: "변경 완료",
        created_at: "2026-07-30T02:00:00.000Z",
      },
      {
        ...serverNotifications[0],
        event_kind: "approval_requested",
        title: "함께 확인해 주세요",
        created_at: "2026-07-30T01:00:00.000Z",
      },
    ];

    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(latest?.notifications).toHaveLength(1);
    expect(latest?.notifications[0]).toMatchObject({
      id: "10000000-0000-4000-8000-000000000002",
      title: "변경 완료",
      isNew: true,
    });
    expect(container.textContent).not.toContain("함께 확인해 주세요");
  });

  it("optimistically records a partner notification as read without hiding it", async () => {
    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await act(async () => {
      latest?.dismiss("10000000-0000-4000-8000-000000000001");
      await Promise.resolve();
    });

    const postCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(postCall?.[1]).toMatchObject({
      body: JSON.stringify({
        ids: ["10000000-0000-4000-8000-000000000001"],
      }),
      credentials: "same-origin",
    });
    expect(container.textContent).toContain(
      "partner:예산이 변경됐어요:false",
    );
    expect(latest?.notifications).toHaveLength(1);
    expect(latest?.newCount).toBe(0);
  });

  it("restores unread state when the durable read write fails", async () => {
    fetchMock.mockImplementation(async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ error: "unavailable" }), {
          status: 503,
        });
      }
      return new Response(
        JSON.stringify({
          ownerId: mocks.authState.user?.id ?? null,
          notifications: serverNotifications,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    await act(async () => {
      latest?.dismiss("10000000-0000-4000-8000-000000000001");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain(
      "partner:예산이 변경됐어요:true",
    );
    expect(latest?.newCount).toBe(1);
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method !== "POST"),
    ).toHaveLength(2);
  });

  it("uses focus recovery and skips all server activity in demo mode", async () => {
    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.refreshJourney).toHaveBeenCalledOnce();

    serverNotifications.unshift({
      ...serverNotifications[0],
      id: "10000000-0000-4000-8000-000000000002",
      created_at: "2026-07-30T02:00:00.000Z",
    });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mocks.refreshJourney).toHaveBeenCalledTimes(2);

    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock.mockClear();
    mocks.channelFactory.mockClear();
    mocks.authState.isDemo = true;

    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.channelFactory).not.toHaveBeenCalled();
  });

  it("retries journey synchronization until an applied notification is reflected", async () => {
    mocks.refreshJourney
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    await act(async () => {
      root.render(<Harness />);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(mocks.refreshJourney).toHaveBeenCalledOnce();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(mocks.refreshJourney).toHaveBeenCalledTimes(2);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(mocks.refreshJourney).toHaveBeenCalledTimes(2);
  });
});
