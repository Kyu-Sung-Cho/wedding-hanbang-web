import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityStore } from "../communityStore";

const pending: Array<(response: Response) => void> = [];
const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));

function respond(index: number, id: string, status = 200) {
  pending[index](new Response(JSON.stringify({
    posts: [{ id }], total: 1, hasMore: false,
  }), { status }));
}

describe("community feed request ownership", () => {
  beforeEach(() => {
    useCommunityStore.getState().reset();
    sessionStorage.clear();
    pending.length = 0;
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("retains the new category when the old category finishes last", async () => {
    useCommunityStore.getState().setCategory("free");
    const oldRequest = useCommunityStore.getState().fetchPosts();
    useCommunityStore.getState().setCategory("is_normal");
    const newRequest = useCommunityStore.getState().fetchPosts();
    respond(1, "new-category");
    await newRequest;
    respond(0, "old-category");
    await oldRequest;

    expect(useCommunityStore.getState().posts).toEqual([{ id: "new-category" }]);
    expect(useCommunityStore.getState().currentCategory).toBe("is_normal");
  });

  it("invalidates a request as soon as filters change, before the next fetch starts", async () => {
    const oldRequest = useCommunityStore.getState().fetchPosts();
    useCommunityStore.getState().setTag("new-tag");
    respond(0, "old-tag");
    await oldRequest;

    expect(useCommunityStore.getState().posts).toEqual([]);
  });

  it("keeps the latest refresh even when both requests have identical filters", async () => {
    const oldRequest = useCommunityStore.getState().fetchPosts();
    const newRequest = useCommunityStore.getState().fetchPosts();
    respond(1, "newer");
    await newRequest;
    respond(0, "older");
    await oldRequest;

    expect(useCommunityStore.getState().posts).toEqual([{ id: "newer" }]);
  });

  it("does not overwrite a successful refresh with an obsolete failure", async () => {
    const oldRequest = useCommunityStore.getState().fetchPosts();
    const newRequest = useCommunityStore.getState().fetchPosts();
    respond(1, "newer");
    await newRequest;
    respond(0, "error", 503);
    await oldRequest;

    expect(useCommunityStore.getState().errorMessage).toBeNull();
    expect(useCommunityStore.getState().isLoading).toBe(false);
  });

  it("does not append an old category's next page to the new category", async () => {
    useCommunityStore.setState({ isLoading: false, hasMore: true });
    const oldPage = useCommunityStore.getState().fetchMorePosts();
    useCommunityStore.getState().setCategory("is_normal");
    const newFeed = useCommunityStore.getState().fetchPosts();
    respond(1, "new-category");
    await newFeed;
    respond(0, "old-page-two");
    await oldPage;

    expect(useCommunityStore.getState().posts).toEqual([{ id: "new-category" }]);
    expect(useCommunityStore.getState().currentPage).toBe(1);
  });

  it("does not append a page from before a same-filter refresh", async () => {
    useCommunityStore.setState({ isLoading: false, hasMore: true });
    const oldPage = useCommunityStore.getState().fetchMorePosts();
    const newFeed = useCommunityStore.getState().fetchPosts();
    respond(1, "refreshed");
    await newFeed;
    respond(0, "old-page-two");
    await oldPage;

    expect(useCommunityStore.getState().posts).toEqual([{ id: "refreshed" }]);
    expect(useCommunityStore.getState().currentPage).toBe(1);
  });
});
