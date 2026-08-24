// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DailyAmoraFocusBridge, {
  DAILY_AMORA_COUPLE_PROMPT,
  DAILY_AMORA_SOLO_PROMPT,
} from "@/components/app/DailyAmoraFocusBridge";
import { captureEvent } from "@/lib/analytics";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    as,
    onClick,
    prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    as?: string;
    prefetch?: boolean;
  }) => {
    void prefetch;
    return (
      <a
        href={as ?? (typeof href === "string" ? href : "")}
        onClick={(event) => {
          event.preventDefault();
          onClick?.(event);
        }}
        {...props}
      >
        {children}
      </a>
    );
  },
}));

vi.mock("@/lib/analytics", () => ({
  captureEvent: vi.fn(),
}));

function readPrefill(anchor: HTMLAnchorElement): string | null {
  const url = new URL(anchor.href);
  return url.searchParams.get("prefill");
}

describe("DailyAmoraFocusBridge", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("lets a solo user start one action without sending or writing automatically", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await act(async () => {
      root.render(
        <DailyAmoraFocusBridge
          partnerLinked={false}
          focusTitle="예식장 후보 확인"
        />,
      );
    });

    expect(container.textContent).toContain("혼자");
    expect(container.textContent).toContain("파트너는 원할 때 초대");
    expect(container.textContent).toContain(
      "파트너가 나중에 합류하면 같이 볼 수 있어요",
    );
    expect(container.textContent).toContain("나만 상담");
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.textContent).toContain("오늘 한 가지 시작하기");
    expect(link ? readPrefill(link) : null).toBe(DAILY_AMORA_SOLO_PROMPT);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the couple prompt neutral and never assigns an owner", async () => {
    await act(async () => {
      root.render(<DailyAmoraFocusBridge partnerLinked />);
    });

    expect(container.textContent).toContain("담당자는 두 분이 정하고");
    expect(container.textContent).toContain("두 사람이 함께 보는 대화");
    expect(container.textContent).toContain("나만 상담");
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link ? readPrefill(link) : null).toBe(DAILY_AMORA_COUPLE_PROMPT);
    expect(DAILY_AMORA_COUPLE_PROMPT).toContain("담당자는 정하지 말고");
    // 2026-08-23 에 두 사람 승인이 없어졌다. 이 지시문은 아모라가 사용자에게
    // 말하는 내용이라, 낡은 규칙이 남으면 일어나지 않는 일을 약속하게 된다.
    expect(DAILY_AMORA_COUPLE_PROMPT).not.toContain("둘 다 확인");
  });

  it("uses the focus title only on screen, not in the URL or analytics", async () => {
    const privateTitle = "부모님 일정과 3천만원 예산";
    await act(async () => {
      root.render(
        <DailyAmoraFocusBridge
          partnerLinked={false}
          focusTitle={privateTitle}
        />,
      );
    });

    expect(container.textContent).toContain(privateTitle);
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.href).not.toContain(encodeURIComponent(privateTitle));
    await act(async () => link?.click());
    expect(captureEvent).toHaveBeenCalledWith("daily_amora_focus_open", {
      mode: "solo",
    });
    expect(JSON.stringify(vi.mocked(captureEvent).mock.calls)).not.toContain(
      privateTitle,
    );
  });
});
