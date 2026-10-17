import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BlockUserButton from "./BlockUserButton";
import { useCommunityStore } from "@/stores/communityStore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const TARGET_ID = "10000000-0000-4000-8000-000000000002";

describe("BlockUserButton", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useCommunityStore.getState().reset();
    sessionStorage.clear();
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function render(onBlocked = vi.fn()) {
    await act(async () => {
      root.render(
        <BlockUserButton
          userId={TARGET_ID}
          nickname="준비친구"
          onBlocked={onBlocked}
        />,
      );
    });
    return onBlocked;
  }

  it("explains the authenticated boundary and keeps reporting separate", async () => {
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="준비친구님 차단"]',
      )?.click();
    });

    expect(container.textContent).toContain("로그아웃한 공개 주소");
    expect(container.textContent).toContain("차단과 별도로");
    expect(container.textContent).toContain("상대에게 차단 알림");
  });

  it("closes an idle confirmation with Escape without blocking anyone", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="준비친구님 차단"]')?.click();
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sets explicit block intent and reports success only after the server receipt", async () => {
    useCommunityStore.getState().bindViewer("viewer-a");
    useCommunityStore.setState({ posts: [{ id: "blocked-author-post" } as never] });
    sessionStorage.setItem("community:viewer:viewer-a:landing", "stale");
    localStorage.setItem("community:post-draft:v2:viewer-a", "draft");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        ok: true,
        blocked_user_id: TARGET_ID,
        blocked: true,
        changed: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onBlocked = await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="준비친구님 차단"]',
      )?.click();
    });

    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("차단하기"),
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/community/blocks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          blocked_user_id: TARGET_ID,
          blocked: true,
        }),
      }),
    );
    expect(onBlocked).toHaveBeenCalledWith(TARGET_ID);
    expect(useCommunityStore.getState()).toMatchObject({
      viewerId: "viewer-a",
      posts: [],
    });
    expect(sessionStorage.getItem("community:viewer:viewer-a:landing")).toBeNull();
    expect(localStorage.getItem("community:post-draft:v2:viewer-a")).toBeNull();
    expect(container.textContent).toContain("차단했어요");
    expect(container.textContent).toContain("차단 관리");
  });

  it("keeps the dialog open with a recoverable error on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "지금은 저장할 수 없어요." }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    const onBlocked = await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="준비친구님 차단"]',
      )?.click();
    });
    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("차단하기"),
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "지금은 저장할 수 없어요",
    );
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
