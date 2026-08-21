// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { consumePendingCoupleInviteCode } from "@/lib/couples/pendingInvite";
import InviteLandingClient from "./InviteLandingClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ pushed: [] as string[] }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      mocks.pushed.push(href);
    },
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const CODE = "WH-A3F91B2C7D40";

describe("초대 링크로 온 사람은 코드를 손으로 옮겨 적지 않는다", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.pushed.length = 0;
    window.localStorage.clear();
    window.history.replaceState(null, "", `/invite#${CODE}`);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function render() {
    await act(async () => {
      root.render(<InviteLandingClient />);
      await Promise.resolve();
    });
  }

  it("웹에서 계속하면 코드를 보관에 넣고 주소에는 남기지 않는다", async () => {
    // 온보딩은 보호 경로다. 미인증이면 미들웨어가 **서버 307**로 /login에 보내므로
    // 온보딩 화면은 마운트조차 되지 않는다 — 주소의 '#'를 읽을 기회가 없다.
    await render();

    const link = container.querySelector<HTMLAnchorElement>(
      '[data-testid="invite-continue-on-web"]',
    );
    expect(link).not.toBeNull();

    await act(async () => link?.click());

    // 코드 없는 깨끗한 주소로 보낸다.
    expect(mocks.pushed).toEqual(["/wedding/onboarding"]);

    // 그리고 온보딩이 마운트되면 그 코드를 그대로 꺼낸다.
    expect(consumePendingCoupleInviteCode()).toBe(CODE);
  });

  it("보관을 쓰지 못하면 옛 경로(#)를 그대로 남긴다", async () => {
    // 이미 로그인한 사람은 307을 안 맞고 온보딩에 바로 도착한다. 저장소가 막힌
    // 환경에서 그 길까지 끊으면 링크가 아무 데도 닿지 않는다.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    try {
      await render();
      const link = container.querySelector<HTMLAnchorElement>(
        '[data-testid="invite-continue-on-web"]',
      );
      expect(link?.getAttribute("href")).toBe(`/wedding/onboarding#${CODE}`);

      await act(async () => link?.click());
      expect(mocks.pushed).toEqual([]);
    } finally {
      setItem.mockRestore();
    }
  });

  it("코드가 없는 링크에서는 보관에 아무것도 넣지 않는다", async () => {
    window.history.replaceState(null, "", "/invite");
    await render();

    expect(
      container.querySelector('[data-testid="invite-continue-on-web"]'),
    ).toBeNull();
    expect(consumePendingCoupleInviteCode()).toBeNull();
  });
});
