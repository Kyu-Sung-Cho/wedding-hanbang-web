import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInitialCommunityFeed: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/community/initialFeed", () => ({
  getInitialCommunityFeed: mocks.getInitialCommunityFeed,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (loader: () => unknown) => loader,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("@/lib/price/landingAgencySpread", () => ({
  loadLandingAgencySpread: vi.fn(async () => undefined),
}));

vi.mock("@/components/community/CommunityLandingClient", () => ({
  default: ({
    initialFeed,
  }: {
    initialFeed?: { posts?: Array<{ title?: string }> };
  }) => <div>{initialFeed?.posts?.[0]?.title ?? "community"}</div>,
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

  it("withholds the shared anonymous feed from signed-in server HTML", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000001" } },
      error: null,
    });
    mocks.getInitialCommunityFeed.mockResolvedValue({
      posts: [{ title: "blocked author private-to-viewer title" }],
      total: 1,
      hasMore: false,
      fetchedAt: "2026-08-04T00:00:00.000Z",
    });

    const element = await CommunityFeedPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("blocked author private-to-viewer title");
    expect(mocks.getInitialCommunityFeed).not.toHaveBeenCalled();
  });

  it("keeps the shared public feed only for a confirmed anonymous request", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mocks.getInitialCommunityFeed.mockResolvedValue({
      posts: [{ title: "confirmed anonymous public title" }],
      total: 1,
      hasMore: false,
      fetchedAt: "2026-08-04T00:00:00.000Z",
    });

    const element = await CommunityFeedPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("confirmed anonymous public title");
    expect(mocks.getInitialCommunityFeed).toHaveBeenCalledTimes(1);
  });

  it("fails closed when server authentication cannot confirm the viewer", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "auth unavailable" },
    });
    mocks.getInitialCommunityFeed.mockResolvedValue({
      posts: [{ title: "must not render during auth uncertainty" }],
      total: 1,
      hasMore: false,
      fetchedAt: "2026-08-04T00:00:00.000Z",
    });

    const element = await CommunityFeedPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element);

    expect(html).not.toContain("must not render during auth uncertainty");
    expect(mocks.getInitialCommunityFeed).not.toHaveBeenCalled();
  });
});
