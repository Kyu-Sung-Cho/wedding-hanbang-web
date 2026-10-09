import { act, StrictMode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/wedding/community/quote-check",
  search: "",
  replace: vi.fn<(destination: string) => void>(),
}));
const router = { replace: mocks.replace };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => mocks.pathname,
  useSearchParams: () => new URLSearchParams(mocks.search),
}));

import ConsentReturnGate from "./ConsentReturnGate";
import { DEFAULT_CONSENT_RETURN_PATH } from "@/lib/auth/consentReturnPath";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("community consent return gate", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/wedding/community/quote-check";
    mocks.search = "category=dress&from=landing";
    window.history.replaceState({}, "", `${mocks.pathname}?${mocks.search}#questions`);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("continues to consent and preserves the actual requested tool", async () => {
    await act(async () => root.render(<ConsentReturnGate />));
    const target = new URL(mocks.replace.mock.calls[0]?.[0] ?? "", window.location.origin);

    expect(mocks.replace).toHaveBeenCalledOnce();
    expect(target.pathname).toBe("/consent");
    expect(target.searchParams.get("redirect"))
      .toBe("/wedding/community/quote-check?category=dress&from=landing#questions");
    expect(container.querySelector("a")?.getAttribute("href"))
      .toBe(`${target.pathname}${target.search}`);
  });

  it("retains a usable ordinary link when automatic navigation fails", async () => {
    mocks.replace.mockImplementationOnce(() => { throw new Error("navigation unavailable"); });
    await act(async () => root.render(<ConsentReturnGate />));

    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.textContent).toBe("약관 동의로 계속하기");
    expect(new URL(link?.href ?? "", window.location.origin).searchParams.get("redirect"))
      .toBe("/wedding/community/quote-check?category=dress&from=landing#questions");
    expect(container.textContent).toContain("이동하지 않으면 위 링크를 눌러 주세요.");
  });

  it("includes a working fallback link and no-JavaScript instructions in the server HTML", () => {
    const html = renderToStaticMarkup(<ConsentReturnGate />);
    expect(html).toContain(`href="${DEFAULT_CONSENT_RETURN_PATH}"`);
    expect(html).toContain("<noscript>");
    expect(html).toContain("JavaScript가 꺼져 있어 자동으로 이동할 수 없어요.");
    expect(html).toContain("JavaScript를 켜고 이 페이지를 새로고침해 주세요.");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("cancels navigation when unmounted before the scheduled effect continues", async () => {
    act(() => root.render(<ConsentReturnGate />));
    act(() => root.unmount());
    await act(async () => { await Promise.resolve(); });

    expect(mocks.replace).not.toHaveBeenCalled();
    root = createRoot(container);
  });

  it("does not repeat the cancelled Strict Mode effect", async () => {
    await act(async () => root.render(<StrictMode><ConsentReturnGate /></StrictMode>));
    expect(mocks.replace).toHaveBeenCalledOnce();
  });

  it("reads a new destination when the same layout is entered again", async () => {
    await act(async () => root.render(<ConsentReturnGate />));
    mocks.pathname = "/wedding/community/post/write";
    mocks.search = "source=quote";
    window.history.replaceState({}, "", `${mocks.pathname}?${mocks.search}#draft`);
    await act(async () => root.render(<ConsentReturnGate />));

    const target = new URL(mocks.replace.mock.calls.at(-1)?.[0] ?? "", window.location.origin);
    expect(target.searchParams.get("redirect"))
      .toBe("/wedding/community/post/write?source=quote#draft");
  });
});
