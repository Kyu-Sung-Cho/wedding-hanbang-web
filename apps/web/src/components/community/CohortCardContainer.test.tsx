// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actorMock = vi.hoisted(() => ({
  current: {
    status: "ready" as "verifying" | "ready" | "error",
    actorKey: "user:a" as string | null,
    kind: "user" as "user" | "guest" | "demo" | "native" | null,
    userId: "a" as string | null,
    generation: 1,
  },
}));

vi.mock("@/components/common/UserScopedClientStateBoundary", () => ({
  useUserScopedClientActor: () => actorMock.current,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./CohortCard", () => ({
  default: ({ room }: { room: { id: string } | null }) => (
    <div data-testid="cohort-room">{room?.id ?? "none"}</div>
  ),
}));

import CohortCardContainer from "./CohortCardContainer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("CohortCardContainer actor boundary", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    actorMock.current = {
      status: "ready",
      actorKey: "user:a",
      kind: "user",
      userId: "a",
      generation: 1,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("does not auto-assign account B from account A's late empty-room response", async () => {
    const accountAResponse = deferred<Response>();
    let accountASignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: string | URL | Request, init?: RequestInit) => {
        accountASignal = init?.signal as AbortSignal | undefined;
        return accountAResponse.promise;
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ room: { id: "room-b" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<CohortCardContainer />);
      await Promise.resolve();
    });

    actorMock.current = {
      status: "ready",
      actorKey: "user:b",
      kind: "user",
      userId: "b",
      generation: 2,
    };
    await act(async () => {
      root.render(<CohortCardContainer />);
      await flushAsyncWork();
    });

    expect((accountASignal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(container.textContent).toBe("room-b");

    await act(async () => {
      accountAResponse.resolve(new Response(JSON.stringify({ room: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
      await flushAsyncWork();
    });

    expect(fetchMock.mock.calls.filter(([, init]) => (
      (init as RequestInit | undefined)?.method === "POST"
    ))).toHaveLength(0);
    expect(container.textContent).toBe("room-b");
  });
});
