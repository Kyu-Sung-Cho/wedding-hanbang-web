import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AmoraStyleSettingsPage from "./page";
import {
  DEFAULT_AMORA_PERSONALIZATION,
  type AmoraPersonalizationProfile,
  type AmoraPersonalizationPreferences,
} from "@/lib/amora/personalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  isDemo: false,
  status: "ready" as "idle" | "loading" | "ready" | "error",
  profile: null as AmoraPersonalizationProfile | null,
  saving: false,
  error: null as string | null,
  load: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    prefetch?: boolean;
  }) => {
    void prefetch;
    return (
      <a href={typeof href === "string" ? href : ""} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: { isDemo: boolean }) => unknown) =>
    selector({ isDemo: mocks.isDemo }),
}));

vi.mock("@/hooks/useAmoraPersonalization", () => ({
  useAmoraPersonalization: () => ({
    profile: mocks.profile,
    status: mocks.status,
    saving: mocks.saving,
    error: mocks.error,
    load: mocks.load,
    save: mocks.save,
    reset: mocks.reset,
  }),
}));

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.includes(text));
}

describe("Amora help-style settings", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemo = false;
    mocks.status = "ready";
    mocks.saving = false;
    mocks.error = null;
    mocks.profile = {
      preferences: {
        ...DEFAULT_AMORA_PERSONALIZATION,
        decisionStart: "recommend_first",
      },
      revision: 1,
      confirmedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    };
    mocks.save.mockImplementation(async (
      preferences: AmoraPersonalizationPreferences,
    ) => ({
      preferences,
      revision: 2,
      confirmedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:01.000Z",
    }));
    mocks.reset.mockResolvedValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("edits an explicit field and saves the complete visible state", async () => {
    await act(async () => {
      root.render(<AmoraStyleSettingsPage />);
      await Promise.resolve();
    });

    await act(async () => {
      buttonByText(container, "비교 먼저")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonByText(container, "변경 저장")?.click();
      await Promise.resolve();
    });

    expect(mocks.save).toHaveBeenCalledWith({
      ...DEFAULT_AMORA_PERSONALIZATION,
      decisionStart: "compare_first",
    });
    expect(container.textContent).toContain("내 도움 방식으로 저장했어요.");
  });

  it("offers four natural polite tone choices and saves the selected tone", async () => {
    await act(async () => {
      root.render(<AmoraStyleSettingsPage />);
      await Promise.resolve();
    });

    for (const label of [
      "상황에 맞게",
      "다정하고 편안하게",
      "차분하고 또렷하게",
      "친근하고 솔직하게",
    ]) {
      expect(buttonByText(container, label)).toBeDefined();
    }
    expect(container.textContent).toContain("모두 존댓말로 답해요");

    await act(async () => {
      buttonByText(container, "친근하고 솔직하게")?.click();
      await Promise.resolve();
    });
    await act(async () => {
      buttonByText(container, "변경 저장")?.click();
      await Promise.resolve();
    });

    expect(mocks.save).toHaveBeenCalledWith({
      ...mocks.profile?.preferences,
      toneStyle: "friendly_honest",
    });
  });

  it("requires a second click before deleting all personal settings", async () => {
    await act(async () => {
      root.render(<AmoraStyleSettingsPage />);
      await Promise.resolve();
    });
    await act(async () => {
      buttonByText(container, "저장한 도움 방식 모두 지우기")?.click();
      await Promise.resolve();
    });
    expect(mocks.reset).not.toHaveBeenCalled();

    await act(async () => {
      buttonByText(container, "모두 지우기")?.click();
      await Promise.resolve();
    });
    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });

  it("does not render editable defaults after a failed read", async () => {
    mocks.status = "error";
    mocks.error = "설정을 안전하게 읽지 못했어요.";

    await act(async () => {
      root.render(<AmoraStyleSettingsPage />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("설정을 안전하게 읽지 못했어요.");
    expect(buttonByText(container, "변경 저장")).toBeUndefined();
    await act(async () => {
      buttonByText(container, "다시 불러오기")?.click();
      await Promise.resolve();
    });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
});
