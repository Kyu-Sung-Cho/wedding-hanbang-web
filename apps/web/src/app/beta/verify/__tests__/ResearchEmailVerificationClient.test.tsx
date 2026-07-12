import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ResearchEmailVerificationClient, {
  consumeVerificationFragment,
  postResearchEmailVerification,
} from "../ResearchEmailVerificationClient";

const TOKEN = `payload.${"a".repeat(43)}`;

describe("research email verification client", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.history.replaceState(null, "", `/beta/verify#token=${TOKEN}`);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("clears the fragment before returning the in-memory capability", () => {
    const clear = vi.fn();

    expect(consumeVerificationFragment(`#token=${TOKEN}`, clear)).toBe(TOKEN);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(consumeVerificationFragment(`#token=${TOKEN}&next=/admin`, clear)).toBeNull();
  });

  it("does not POST until the person explicitly clicks the confirmation button", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ status: "verified" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<ResearchEmailVerificationClient />);
    });

    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    const button = container.querySelector("button");
    expect(button?.textContent).toContain("내 이메일 주소 확인하기");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/preregister/verify",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ token: TOKEN }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Research-Email-Verification": "1",
        }),
      })
    );
    expect(container.textContent).toContain("이메일 주소를 확인했어요");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?status=verified");
  });

  it.each([
    [
      "an HTML 502",
      () => new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    ],
    [
      "a JSON 504",
      () => new Response(JSON.stringify({ status: "unavailable" }), {
        status: 504,
        headers: { "Content-Type": "application/json" },
      }),
    ],
  ])("rejects %s so the caller can retain the capability", async (_name, responseFactory) => {
    const fetchMock = vi.fn(async () => responseFactory()) as unknown as typeof fetch;

    await expect(postResearchEmailVerification(TOKEN, fetchMock)).rejects.toThrow(
      "VERIFICATION_RESPONSE_UNAVAILABLE"
    );
  });

  it("rejects a network failure so the caller can retain the capability", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;

    await expect(postResearchEmailVerification(TOKEN, fetchMock)).rejects.toThrow("offline");
  });

  it("keeps the in-memory capability after a transient response and retries in place", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: "verified" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      ));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<ResearchEmailVerificationClient />);
    });
    const button = container.querySelector("button");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("네트워크 연결을 확인한 뒤 다시 눌러주세요.");
    expect(container.textContent).toContain("내 이메일 주소 확인하기");
    expect(window.location.search).toBe("");

    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("이메일 주소를 확인했어요");
    expect(window.location.search).toBe("?status=verified");
  });
});
