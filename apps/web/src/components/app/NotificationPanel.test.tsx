import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NotificationPanel from "./NotificationPanel";
import type { ComputedNotification } from "@/hooks/useNotifications";
import { useAuthStore } from "@/stores/authStore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PARTNER_NOTIFICATION: ComputedNotification = {
  id: "10000000-0000-4000-8000-000000000001",
  type: "partner",
  title: "예산이 변경됐어요",
  message: "공동 예산 변경이 반영됐어요.",
  priority: "medium",
  href: "/budget",
  createdAt: "2026-07-30T01:00:00.000Z",
  isNew: true,
};

const PLAN_APPROVAL_NOTIFICATION: ComputedNotification = {
  ...PARTNER_NOTIFICATION,
  id: "10000000-0000-4000-8000-000000000002",
  actionId: "20000000-0000-4000-8000-000000000001",
  eventKind: "approval_requested",
  toolName: "manual_plan_change",
};

const PLAN_PENDING_NOTIFICATION: ComputedNotification = {
  ...PARTNER_NOTIFICATION,
  id: "10000000-0000-4000-8000-000000000003",
  title: "파트너 확인을 기다리고 있어요",
  message: "총예산: 30000000원 → 40000000원",
  actionId: "20000000-0000-4000-8000-000000000002",
  eventKind: "approval_pending",
  toolName: "manual_plan_change",
};

describe("NotificationPanel partner history", () => {
  let root: Root;
  let container: HTMLDivElement;
  const originalRefreshJourney = useAuthStore.getState().refreshJourney;
  const originalUser = useAuthStore.getState().user;
  const decisionUser = {
    id: "30000000-0000-4000-8000-000000000001",
    email: "decision@example.com",
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useAuthStore.setState({ user: decisionUser });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    useAuthStore.setState({
      refreshJourney: originalRefreshJourney,
      user: originalUser,
    });
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("offers the partner notification destination through the onOpen callback", async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PARTNER_NOTIFICATION]}
          onDismiss={vi.fn()}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onOpen={onOpen}
          onClose={vi.fn()}
        />,
      );
    });

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "내용 보기",
    );
    expect(openButton).toBeDefined();

    await act(async () => openButton?.click());

    expect(onOpen).toHaveBeenCalledWith(PARTNER_NOTIFICATION);
  });

  it("shows partner activity with a neutral couple icon and its timestamp", async () => {
    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PARTNER_NOTIFICATION]}
          onDismiss={vi.fn()}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.querySelector(".text-danger-700")).toBeNull();
    expect(
      container.querySelector(
        'time[datetime="2026-07-30T01:00:00.000Z"]',
      ),
    ).not.toBeNull();
  });

  it("applies a partner-approved plan change inline and refreshes the journey", async () => {
    const onDismiss = vi.fn();
    const onOpen = vi.fn();
    const refreshJourney = vi.fn().mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "applied" }),
    });
    useAuthStore.setState({ refreshJourney });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PLAN_APPROVAL_NOTIFICATION]}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onOpen={onOpen}
          onClose={vi.fn()}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    const acceptButton = buttons.find(
      (button) => button.textContent?.trim() === "확인하고 반영",
    );
    expect(acceptButton).toBeDefined();
    const detailsButton = buttons.find(
      (button) => button.textContent?.trim() === "변경 내용 확인",
    );
    expect(detailsButton).toBeDefined();

    await act(async () => detailsButton?.click());
    expect(onOpen).toHaveBeenCalledWith(PLAN_APPROVAL_NOTIFICATION);

    await act(async () => {
      acceptButton?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/couple-plan-changes/${PLAN_APPROVAL_NOTIFICATION.actionId}`,
      expect.objectContaining({
        method: "POST",
        body: "{}",
      }),
    );
    expect(refreshJourney).toHaveBeenCalledWith(decisionUser.id);
    expect(onDismiss).toHaveBeenCalledWith(PLAN_APPROVAL_NOTIFICATION.id);
  });

  it("rejects a plan change without mutating the journey", async () => {
    const onDismiss = vi.fn();
    const refreshJourney = vi.fn().mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "rejected" }),
    });
    useAuthStore.setState({ refreshJourney });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PLAN_APPROVAL_NOTIFICATION]}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const rejectButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "이번 요청 거절",
    );
    expect(rejectButton).toBeDefined();

    await act(async () => {
      rejectButton?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/couple-plan-changes/${PLAN_APPROVAL_NOTIFICATION.actionId}`,
      expect.objectContaining({
        method: "DELETE",
        body: "{}",
      }),
    );
    expect(refreshJourney).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledWith(PLAN_APPROVAL_NOTIFICATION.id);
  });

  it("lets the initiator cancel a durable pending request after reload without offering self-approval", async () => {
    const onDismiss = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "rejected" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PLAN_PENDING_NOTIFICATION]}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onOpen={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(
      buttons.find((button) => button.textContent?.trim() === "확인하고 반영"),
    ).toBeUndefined();
    expect(
      buttons.find((button) => button.textContent?.trim() === "이번 요청 거절"),
    ).toBeUndefined();

    const cancelButton = buttons.find(
      (button) => button.textContent?.trim() === "요청 취소",
    );
    expect(cancelButton).toBeDefined();

    await act(async () => {
      cancelButton?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/couple-plan-changes/${PLAN_PENDING_NOTIFICATION.actionId}`,
      expect.objectContaining({
        method: "DELETE",
        body: "{}",
      }),
    );
    expect(onDismiss).toHaveBeenCalledWith(PLAN_PENDING_NOTIFICATION.id);
  });

  it("keeps a failed approval visible and explains that it was not applied", async () => {
    const onDismiss = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        error: "최신 화면을 다시 불러온 뒤 확인해 주세요.",
      }),
    }));

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PLAN_APPROVAL_NOTIFICATION]}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const acceptButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "확인하고 반영",
    );
    await act(async () => {
      acceptButton?.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "최신 화면을 다시 불러온 뒤 확인해 주세요.",
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps an applied approval visible until the latest journey is synchronized", async () => {
    const onDismiss = vi.fn();
    const refreshJourney = vi.fn().mockImplementation(async () => {
      useAuthStore.setState({
        user: {
          id: "30000000-0000-4000-8000-000000000002",
          email: "next-account@example.com",
        },
      });
      return false;
    });
    useAuthStore.setState({ refreshJourney });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "applied" }),
    }));

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PLAN_APPROVAL_NOTIFICATION]}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const acceptButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "확인하고 반영",
    );
    await act(async () => {
      acceptButton?.click();
    });

    expect(refreshJourney).toHaveBeenCalledWith(decisionUser.id);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "변경은 반영됐지만 최신 내용을 불러오지 못했어요.",
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("fails closed when a successful response has an unexpected status", async () => {
    const onDismiss = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: "pending_partner" }),
    }));

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[PLAN_APPROVAL_NOTIFICATION]}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const acceptButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "확인하고 반영",
    );
    await act(async () => {
      acceptButton?.click();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "변경 반영 상태를 확인하지 못했어요.",
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("NotificationPanel read state", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  const renderPanel = async (notification: ComputedNotification) => {
    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[notification]}
          onDismiss={vi.fn()}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onOpen={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });
  };

  it("dims only the icon of a read notification and keeps its text at full strength", async () => {
    await renderPanel({ ...PARTNER_NOTIFICATION, isNew: false });

    // 읽은 알림은 파트너가 무엇을 바꿨는지 남는 기록이다. 글자에 불투명도를 걸면 4.5:1 아래로 내려간다.
    const message = Array.from(container.querySelectorAll("p")).find(
      (paragraph) => paragraph.textContent === "공동 예산 변경이 반영됐어요.",
    );
    const title = Array.from(container.querySelectorAll("p")).find(
      (paragraph) => paragraph.textContent === "예산이 변경됐어요",
    );
    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "내용 보기",
    );
    const time = container.querySelector("time");
    for (const element of [message, title, openButton, time]) {
      expect(element).toBeDefined();
      expect(element?.closest('[class*="opacity-"]')).toBeNull();
    }

    // 읽음 구분은 아이콘 칸의 흐림으로 남는다.
    const dimmed = container.querySelectorAll('[class*="opacity-"]');
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0].className).toContain("opacity-60");
    expect(dimmed[0].querySelector("svg")).not.toBeNull();
    expect(dimmed[0].textContent).toBe("");
  });

  it("leaves an unread notification undimmed and offers to mark it read", async () => {
    await renderPanel({ ...PARTNER_NOTIFICATION, isNew: true });

    expect(container.querySelector('[class*="opacity-"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="예산이 변경됐어요 읽음으로 표시"]'),
    ).not.toBeNull();
  });
});
