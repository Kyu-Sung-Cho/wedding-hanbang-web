import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TurnstileWidget from "../TurnstileWidget";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("TurnstileWidget", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubEnv(
      "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
      "0x4AAAAAAABBBBBBBBCCCCCCCC"
    );
    delete window.turnstile;
    document
      .querySelectorAll('script[data-hanbang-turnstile-script="true"]')
      .forEach((script) => script.remove());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete window.turnstile;
    document
      .querySelectorAll('script[data-hanbang-turnstile-script="true"]')
      .forEach((script) => script.remove());
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses Cloudflare's explicit SPA contract and refreshes a spent token", () => {
    let options: Parameters<NonNullable<Window["turnstile"]>["render"]>[1] | null = null;
    const api: NonNullable<Window["turnstile"]> = {
      render: (_element, nextOptions) => {
        options = nextOptions;
        return "widget-1";
      },
      remove: vi.fn(),
    };
    const renderSpy = vi.spyOn(api, "render");
    window.turnstile = api;
    const onVerify = vi.fn();
    const onError = vi.fn();

    act(() => {
      root.render(
        <TurnstileWidget
          action="forgot_password"
          onVerify={onVerify}
          onError={onError}
        />
      );
    });

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(options).toMatchObject({
      action: "forgot_password",
      language: "ko",
      size: "flexible",
      retry: "auto",
      "refresh-expired": "auto",
      "refresh-timeout": "auto",
    });

    act(() => options?.callback("single-use-token"));
    expect(onVerify).toHaveBeenLastCalledWith("single-use-token");
    expect(container.textContent).toContain("보안 확인이 완료됐어요");

    act(() => options?.["expired-callback"]?.());
    expect(onVerify).toHaveBeenLastCalledWith("");
    expect(onError).toHaveBeenLastCalledWith("expired");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "보안 확인 시간이 지났어요"
    );

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("다시 시도")
    );
    expect(retryButton).toBeDefined();
    act(() => retryButton?.click());
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(renderSpy).toHaveBeenCalledTimes(2);
  });

  it("loads the exact explicit-render script and exposes a recoverable error", () => {
    const onVerify = vi.fn();
    const onError = vi.fn();

    act(() => {
      root.render(
        <TurnstileWidget
          action="signup"
          onVerify={onVerify}
          onError={onError}
        />
      );
    });

    const script = document.querySelector<HTMLScriptElement>(
      'script[data-hanbang-turnstile-script="true"]'
    );
    expect(script?.src).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    );

    act(() => script?.dispatchEvent(new Event("error")));
    expect(onVerify).toHaveBeenLastCalledWith("");
    expect(onError).toHaveBeenLastCalledWith("error");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "보안 확인을 불러오지 못했어요"
    );
    expect(container.querySelector("button")?.textContent).toContain("다시 시도");
  });
});
