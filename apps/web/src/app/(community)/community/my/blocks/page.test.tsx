import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks,
}));

import BlockedUsersPage from "./page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const BLOCKED_USER_ID = "10000000-0000-4000-8000-000000000002";

describe("BlockedUsersPage", () => {
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
    vi.unstubAllGlobals();
  });

  it("keeps the list private in copy and removes only after an explicit server receipt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ownerId: "10000000-0000-4000-8000-000000000001",
        blocks: [{
          blocked_user_id: BLOCKED_USER_ID,
          reason_category: null,
          created_at: "2026-08-04T01:00:00.000Z",
          profile: {
            user_id: BLOCKED_USER_ID,
            nickname: "숨긴회원",
            avatar_url: null,
            rank: "sprout",
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        blocked_user_id: BLOCKED_USER_ID,
        blocked: false,
        changed: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<BlockedUsersPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("숨긴회원");
    expect(container.textContent).toContain("본인에게만 보이며");
    expect(container.textContent).toContain("파트너와도 공유하지 않아요");

    const startUnblock = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "차단 해제",
    );
    await act(async () => startUnblock?.click());
    expect(container.textContent).toContain("과거 알림은 다시 뜨지 않아요");

    const confirm = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "해제하기",
    );
    await act(async () => {
      confirm?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/community/blocks",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          blocked_user_id: BLOCKED_USER_ID,
          blocked: false,
        }),
      }),
    );
    expect(container.textContent).not.toContain("숨긴회원");
    expect(container.textContent).toContain("차단한 회원이 없어요");
  });
});
