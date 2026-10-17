// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const sink = vi.hoisted(() => ({ reportClientError: vi.fn() }));
vi.mock("@/lib/observability/clientErrorReport", () => sink);
vi.mock("next/link", () => ({
  default: ({ children, href, className }: ComponentProps<"a">) => <a href={href} className={className}>{children}</a>,
}));

import AppError from "./error";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/**
 * 로그인한 화면의 에러 경계.
 *
 * (app) 안에 경계가 없으면 루트 `app/error.tsx` 가 받아 사이드바와 상단 바까지 통째로 사라진다.
 * 홈 버튼도 `/wedding` 이라 로그인한 사람의 첫 화면(웨딩 라운지)이 아니라 커뮤니티로 간다.
 */
describe("(app) error boundary", () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: MockInstance;

  beforeEach(() => {
    sink.reportClientError.mockClear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  const renderError = async (error: Error & { digest?: string }, reset = vi.fn()) => {
    await act(async () => root.render(<AppError error={error} reset={reset} />));
    return reset;
  };

  it("reports the caught error once and logs only its digest", async () => {
    const error = Object.assign(new Error("원문 메시지"), { digest: "abc123" });
    await renderError(error);
    expect(sink.reportClientError).toHaveBeenCalledTimes(1);
    expect(sink.reportClientError).toHaveBeenCalledWith(error);
    expect(consoleError).toHaveBeenCalledWith("[app-error]", "abc123");
  });

  it("retries through reset when the person asks to try again", async () => {
    const reset = await renderError(new Error("x"));
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "다시 시도하기");
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("sends the person to the wedding lounge, not the community", async () => {
    await renderError(new Error("x"));
    const home = Array.from(container.querySelectorAll("a")).find((link) => link.textContent === "웨딩 라운지로");
    expect(home?.getAttribute("href")).toBe("/wedding/lounge");
  });

  it("never prints the error text on screen", async () => {
    await renderError(new Error("secret-token-leaked-in-message"));
    expect(container.textContent).not.toContain("secret-token-leaked-in-message");
    expect(container.textContent).toContain("화면을 불러오지 못했어요");
    expect(container.textContent).toContain("저장된 일정·예산·대화 내용은 그대로예요.");
  });

  it("lives inside the app frame instead of replacing it", async () => {
    await renderError(new Error("x"));
    // 틀의 `<main>` 안에 들어가므로 자기 main 이나 전체 화면 높이를 쓰지 않는다.
    expect(container.querySelector("main")).toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.className).not.toContain("min-h-screen");
    // 채팅 틀은 main 이 overflow-hidden 이라 카드가 잘리면 스크롤할 수 없다.
    expect(alert?.className).toContain("overflow-y-auto");
    // amora/planning 틀에는 전역 h1 크기 보정이 안 걸려 본문 크기로 떨어진다. `!` 가 붙은 크기만 이긴다.
    expect(container.querySelector("h1")?.className).toContain("!text-[24px]");
  });
});
