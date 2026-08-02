import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAdminSessionBoundary } from "./useAdminSessionBoundary";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  currentUser: { id: "admin-a", email: "a@example.com" } as {
    id: string;
    email: string;
  } | null,
  authCallback: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  unsubscribe: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      onAuthStateChange: (callback: typeof mocks.authCallback) => {
        mocks.authCallback = callback;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      },
    },
  }),
}));

const fetchMock = vi.fn();

function Harness() {
  const session = useAdminSessionBoundary();
  return (
    <div>
      <span>status:{session.status}</span>
      {session.status === "admin" && (
        <span>secret:{session.userId}:{session.email}</span>
      )}
    </div>
  );
}

describe("useAdminSessionBoundary", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.currentUser = { id: "admin-a", email: "a@example.com" };
    mocks.authCallback = null;
    mocks.unsubscribe.mockReset();
    mocks.getUser.mockReset();
    mocks.getUser.mockImplementation(async () => ({ data: { user: mocks.currentUser } }));
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ isAdmin: true, email: mocks.currentUser?.email }),
    });
    global.fetch = fetchMock;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function renderVerifiedAdmin() {
    await act(async () => {
      root.render(<Harness />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("secret:admin-a:a@example.com");
  }

  it("unmounts administrator PII immediately while an identity switch is verified", async () => {
    await renderVerifiedAdmin();

    let resolveVerification: ((value: unknown) => void) | undefined;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveVerification = resolve;
    }));
    mocks.currentUser = { id: "admin-b", email: "b@example.com" };

    await act(async () => {
      mocks.authCallback?.("SIGNED_IN", { user: { id: "admin-b" } });
      await Promise.resolve();
    });

    expect(container.textContent).toContain("status:checking");
    expect(container.textContent).not.toContain("secret:");

    await act(async () => {
      resolveVerification?.({
        ok: true,
        json: async () => ({ isAdmin: true, email: "b@example.com" }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("secret:admin-b:b@example.com");
  });

  it("blanks administrator PII during foreground revalidation", async () => {
    await renderVerifiedAdmin();

    let resolveVerification: ((value: unknown) => void) | undefined;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveVerification = resolve;
    }));

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("status:checking");
    expect(container.textContent).not.toContain("secret:");

    await act(async () => {
      resolveVerification?.({
        ok: true,
        json: async () => ({ isAdmin: true, email: "a@example.com" }),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("secret:admin-a:a@example.com");
  });
});
