import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PreregistrationConfirmClient from "./PreregistrationConfirmClient";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "A".repeat(43);

describe("preregistration confirmation UI", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  async function renderWithToken(token = TOKEN) {
    window.history.replaceState(null, "", `/preregister/confirm#token=${token}`);
    await act(async () => {
      root.render(<PreregistrationConfirmClient />);
      await Promise.resolve();
    });
  }

  it("clears the capability fragment without confirming on GET/render", async () => {
    await renderWithToken();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/preregister/confirm");
    expect(fetch).not.toHaveBeenCalled();
    expect(container.textContent).toContain("베타 신청을 직접 확인해주세요");
  });

  it("confirms only after an explicit button POST", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ success: true, status: "confirmed" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await renderWithToken();
    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.includes("베타 신청 확인"));

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith("/api/preregister/confirm", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: TOKEN, action: "confirm" }),
    }));
    expect(container.textContent).toContain("이메일 확인이 완료되었습니다");
  });

  it("offers an explicit pre-confirmation cancellation that consumes the intent", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(
      JSON.stringify({ success: true, status: "cancelled" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await renderWithToken();
    const button = [...container.querySelectorAll("button")]
      .find((candidate) => candidate.textContent?.includes("임시정보 삭제"));

    await act(async () => {
      button?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith("/api/preregister/confirm", expect.objectContaining({
      body: JSON.stringify({ token: TOKEN, action: "cancel" }),
    }));
    expect(container.textContent).toContain("임시 신청을 삭제했습니다");
  });

  it("rejects a malformed fragment locally and never sends it", async () => {
    await renderWithToken("too-short");
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("유효하지 않거나 만료");
  });
});
