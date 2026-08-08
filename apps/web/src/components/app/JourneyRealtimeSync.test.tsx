import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);

  return {
    channel,
    createChannel: vi.fn(() => channel),
    removeChannel: vi.fn(),
    refreshJourney: vi.fn(),
    state: {
      user: { id: "user-a" },
      journey: { couple_id: "couple-a" },
      isDemo: false,
    },
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    channel: mocks.createChannel,
    removeChannel: mocks.removeChannel,
  }),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    ...mocks.state,
    refreshJourney: mocks.refreshJourney,
  }),
}));

import JourneyRealtimeSync from "./JourneyRealtimeSync";

describe("JourneyRealtimeSync", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.channel.on.mockReturnValue(mocks.channel);
    mocks.channel.subscribe.mockReturnValue(mocks.channel);
    mocks.state.user = { id: "user-a" };
    mocks.state.journey = { couple_id: "couple-a" };
    mocks.state.isDemo = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("refreshes the open web experience when the shared journey changes", async () => {
    await act(async () => root.render(<JourneyRealtimeSync />));

    expect(mocks.createChannel).toHaveBeenCalledWith(
      "web-journey-sync:couple-a:user-a",
    );
    expect(mocks.channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "wedding_journeys",
        filter: "couple_id=eq.couple-a",
      },
      expect.any(Function),
    );

    const realtimeHandler = mocks.channel.on.mock.calls[0]?.[2] as (() => void);
    await act(async () => realtimeHandler());

    expect(mocks.refreshJourney).toHaveBeenCalledWith("user-a");
  });

  it("removes the exact subscription on unmount", async () => {
    await act(async () => root.render(<JourneyRealtimeSync />));
    await act(async () => root.unmount());

    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channel);
    root = createRoot(container);
  });
});
