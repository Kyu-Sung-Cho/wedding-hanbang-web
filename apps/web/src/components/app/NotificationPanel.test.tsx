import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NotificationPanel from "./NotificationPanel";
import { CATEGORY_CHECKLISTS } from "@hanbang/shared/constants";
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

const SITUATION_APPROVAL_NOTIFICATION: ComputedNotification = {
  ...PLAN_APPROVAL_NOTIFICATION,
  id: "10000000-0000-4000-8000-000000000004",
  href: "/schedule",
  message: "상황: 질문 2개 · 분야 제외 1/복원 0 · 상세 확인",
};
const DISCLOSURE_RECEIPT = "d".repeat(64);
const RECOVERY_DISCLOSURE_RECEIPT = "e".repeat(64);
const RELOADED_DISCLOSURE_RECEIPT = "f".repeat(64);

const CURRENT_PROFILE = {
  version: 1,
  reviewedAt: "2026-08-12T10:00:00.000Z",
  answers: {
    ceremony: "yes",
    legalMarriage: "undecided",
    travel: "undecided",
    housing: "undecided",
    internationalMarriage: null,
    religiousCeremony: null,
    remarriage: null,
    childrenParticipating: null,
    accessibilitySupport: null,
    healthSupport: null,
    petParticipation: null,
    familyTradition: null,
  },
  autoExcludedItemIds: [],
};

const VENUE_TEMPLATE = CATEGORY_CHECKLISTS.find((category) => category.key === "venue");
if (!VENUE_TEMPLATE) throw new Error("venue checklist template is required");

const CURRENT_COMPLETED_VENUE = {
  category: "venue",
  label: VENUE_TEMPLATE.label,
  status: "completed",
  checklist: VENUE_TEMPLATE.items.map((item) => item.id === "venue_01"
    ? {
        ...item,
        done: true,
        state: "completed",
        completedAt: "2026-08-11T09:00:00.000Z",
        completedByProfileId: "30000000-0000-4000-8000-000000000001",
      }
    : { ...item, done: false, state: "todo" }),
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

    expect(container.querySelector(".text-red-500")).toBeNull();
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

  it.each(["transport failure", "non-OK response"])(
    "recovers an applied approval after a %s using one status GET without replay",
    async (failureKind) => {
      const onDismiss = vi.fn();
      const refreshJourney = vi.fn().mockResolvedValue(true);
      const fetchMock = vi.fn();
      if (failureKind === "transport failure") {
        fetchMock.mockRejectedValueOnce(new Error("connection closed"));
      } else {
        fetchMock.mockResolvedValueOnce({
          ok: false,
          json: vi.fn().mockResolvedValue({ error: "response lost" }),
        });
      }
      fetchMock.mockResolvedValueOnce({
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
            onClose={vi.fn()}
          />,
        );
      });

      const acceptButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.trim() === "확인하고 반영",
      );
      await act(async () => acceptButton?.click());

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
      expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("method");
      expect(refreshJourney).toHaveBeenCalledTimes(1);
      expect(onDismiss).toHaveBeenCalledWith(PLAN_APPROVAL_NOTIFICATION.id);
    },
  );

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

  it("requires the complete structured situation diff before partner approval", async () => {
    const onDismiss = vi.fn();
    const refreshJourney = vi.fn().mockResolvedValue(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          requestId: SITUATION_APPROVAL_NOTIFICATION.actionId,
          status: "pending_partner",
          requiredCount: 2,
          acceptedCount: 1,
          baseRevision: 7,
          summary: SITUATION_APPROVAL_NOTIFICATION.message,
          surface: "/schedule",
          disclosureReceipt: DISCLOSURE_RECEIPT,
          proposal: {
            kind: "checklist_situation",
            baseRevision: 7,
            progressPatch: {
              __checklist_profile: {
                ...CURRENT_PROFILE,
                reviewedAt: "2026-08-12T12:00:00.000Z",
                answers: { ...CURRENT_PROFILE.answers, ceremony: "no" },
              },
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: "applied" }),
      });
    useAuthStore.setState({ refreshJourney });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[SITUATION_APPROVAL_NOTIFICATION]}
          currentProgress={{ __checklist_profile: CURRENT_PROFILE }}
          currentRevision={7}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const beforeLoad = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "변경 전체 보기 후 동의",
    );
    expect(beforeLoad).toBeDefined();

    await act(async () => beforeLoad?.click());

    expect(container.textContent).toContain("바뀌는 질문");
    expect(container.textContent).toContain("예식: 진행 → 진행 안 함");
    expect(container.textContent).toContain("영향 받는 분야");
    expect(container.textContent).toContain("제외되는 항목");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const approve = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "확인하고 반영",
    );
    expect(approve).toBeDefined();
    await act(async () => approve?.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ disclosureReceipt: DISCLOSURE_RECEIPT }),
    });
    expect(onDismiss).toHaveBeenCalledWith(SITUATION_APPROVAL_NOTIFICATION.id);
  });

  it("discards an expired checklist receipt when recovery still finds the proposal pending", async () => {
    const onDismiss = vi.fn();
    const refreshJourney = vi.fn().mockResolvedValue(true);
    const proposal = {
      kind: "checklist_situation",
      baseRevision: 7,
      progressPatch: {
        __checklist_profile: {
          ...CURRENT_PROFILE,
          reviewedAt: "2026-08-12T12:00:00.000Z",
          answers: { ...CURRENT_PROFILE.answers, ceremony: "no" },
        },
      },
    };
    const pending = (disclosureReceipt: string) => ({
      requestId: SITUATION_APPROVAL_NOTIFICATION.actionId,
      status: "pending_partner",
      requiredCount: 2,
      acceptedCount: 1,
      baseRevision: 7,
      summary: SITUATION_APPROVAL_NOTIFICATION.message,
      surface: "/schedule",
      disclosureReceipt,
      proposal,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(pending(DISCLOSURE_RECEIPT)),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: "receipt expired" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(pending(RECOVERY_DISCLOSURE_RECEIPT)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(pending(RELOADED_DISCLOSURE_RECEIPT)),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: "applied" }),
      });
    useAuthStore.setState({ refreshJourney });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[SITUATION_APPROVAL_NOTIFICATION]}
          currentProgress={{ __checklist_profile: CURRENT_PROFILE }}
          currentRevision={7}
          onDismiss={onDismiss}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const disclosureLoadButton = () => Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.className.includes("border-[#C7D1C2]"));
    const approveButton = () => Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.className.includes("bg-[#36534E]"));

    await act(async () => disclosureLoadButton()?.click());
    expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();

    await act(async () => approveButton()?.click());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ disclosureReceipt: DISCLOSURE_RECEIPT }),
    });
    expect(fetchMock.mock.calls[2][1]).not.toHaveProperty("method");
    expect(container.querySelector("button[aria-expanded]")).toBeNull();
    expect(disclosureLoadButton()).toBeDefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "최신 변경 전체를 다시 확인",
    );
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => disclosureLoadButton()?.click());
    expect(container.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    await act(async () => approveButton()?.click());

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ disclosureReceipt: RELOADED_DISCLOSURE_RECEIPT }),
    });
    expect(refreshJourney).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith(SITUATION_APPROVAL_NOTIFICATION.id);
  });

  it("explains a non-N/A category status change and cleared completion evidence", async () => {
    const nextProfile = {
      ...CURRENT_PROFILE,
      reviewedAt: "2026-08-12T12:00:00.000Z",
      answers: { ...CURRENT_PROFILE.answers, ceremony: "no" },
      autoExcludedItemIds: ["venue_01"],
    };
    const nextVenue = {
      ...CURRENT_COMPLETED_VENUE,
      status: "in_progress",
      checklist: VENUE_TEMPLATE.items.map((item) => item.id === "venue_01"
        ? {
            ...item,
            done: false,
            state: "not_applicable",
            completedAt: null,
            completedByProfileId: null,
          }
        : { ...item, done: false, state: "todo" }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestId: SITUATION_APPROVAL_NOTIFICATION.actionId,
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        baseRevision: 7,
        summary: SITUATION_APPROVAL_NOTIFICATION.message,
        surface: "/schedule",
        disclosureReceipt: DISCLOSURE_RECEIPT,
        proposal: {
          kind: "checklist_situation",
          baseRevision: 7,
          progressPatch: {
            __checklist_profile: nextProfile,
            venue: nextVenue,
          },
        },
      }),
    }));

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[SITUATION_APPROVAL_NOTIFICATION]}
          currentProgress={{
            __checklist_profile: CURRENT_PROFILE,
            venue: CURRENT_COMPLETED_VENUE,
          }}
          currentRevision={7}
          onDismiss={vi.fn()}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const load = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "변경 전체 보기 후 동의",
    );
    await act(async () => load?.click());

    expect(container.textContent).toContain(
      "결혼식장 · 제외 1 · 복원 0 · 상태 완료 → 진행 중",
    );
    expect(container.textContent).toContain(
      "결혼식장 · 원하는 결혼식장 형태 정하기 · 자동 제외되며 기존 완료 기록(완료 일시·완료자)이 해제돼요",
    );
  });

  it("fails closed when the situation proposal does not match the current revision", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestId: SITUATION_APPROVAL_NOTIFICATION.actionId,
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        baseRevision: 6,
        summary: SITUATION_APPROVAL_NOTIFICATION.message,
        surface: "/schedule",
        disclosureReceipt: DISCLOSURE_RECEIPT,
        proposal: {
          kind: "checklist_situation",
          baseRevision: 6,
          progressPatch: {
            __checklist_profile: CURRENT_PROFILE,
          },
        },
      }),
    }));

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[SITUATION_APPROVAL_NOTIFICATION]}
          currentProgress={{ __checklist_profile: CURRENT_PROFILE }}
          currentRevision={7}
          onDismiss={vi.fn()}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const load = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "변경 전체 보기 후 동의",
    );
    await act(async () => load?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "안전하게 비교하지 못해 동의를 막았어요",
    );
    expect(Array.from(container.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "확인하고 반영",
    )).toBe(false);
  });

  it("fails closed when the server omits the checklist disclosure receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        requestId: SITUATION_APPROVAL_NOTIFICATION.actionId,
        status: "pending_partner",
        requiredCount: 2,
        acceptedCount: 1,
        baseRevision: 7,
        summary: SITUATION_APPROVAL_NOTIFICATION.message,
        surface: "/schedule",
        proposal: {
          kind: "checklist_situation",
          baseRevision: 7,
          progressPatch: {
            __checklist_profile: CURRENT_PROFILE,
          },
        },
      }),
    }));

    await act(async () => {
      root.render(
        <NotificationPanel
          notifications={[SITUATION_APPROVAL_NOTIFICATION]}
          currentProgress={{ __checklist_profile: CURRENT_PROFILE }}
          currentRevision={7}
          onDismiss={vi.fn()}
          onDismissAll={vi.fn()}
          onCategoryClick={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    const load = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "변경 전체 보기 후 동의",
    );
    await act(async () => load?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "변경 전체를 다시 불러와 주세요",
    );
    expect(Array.from(container.querySelectorAll("button")).some(
      (button) => button.textContent?.trim() === "확인하고 반영",
    )).toBe(false);
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
