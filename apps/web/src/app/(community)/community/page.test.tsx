import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInitialCommunityFeed: vi.fn(),
}));

vi.mock("@/lib/community/initialFeed", () => ({
  getInitialCommunityFeed: mocks.getInitialCommunityFeed,
}));

vi.mock("@/components/community/CommunityLandingClient", () => ({
  default: () => <div>community</div>,
}));

import CommunityFeedPage from "./page";

describe("CommunityFeedPage preview stub", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("does not attempt a server Supabase feed query", async () => {
    vi.stubEnv("NEXT_PUBLIC_PREVIEW_STUB_MODE", "true");

    await CommunityFeedPage({ searchParams: Promise.resolve({}) });

    expect(mocks.getInitialCommunityFeed).not.toHaveBeenCalled();
  });
});
