import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCommunityStore } from "../communityStore";

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe("community comments retain current reads and completed writes", () => {
  beforeEach(() => useCommunityStore.getState().reset());
  afterEach(() => vi.unstubAllGlobals());

  it("does not switch back to the submitted post after the reader moves to another post", async () => {
    const submitted = deferred();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return submitted.promise;
      const postId = new URL(url, "https://hanbang.ai").searchParams.get("postId");
      return Promise.resolve(response({ comments: [{ id: `${postId}-comment`, post_id: postId }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await useCommunityStore.getState().fetchComments("post-a");
    const writing = useCommunityStore.getState().createComment({ post_id: "post-a", content: "A의 답변" });
    await useCommunityStore.getState().fetchComments("post-b");
    submitted.resolve(response({ post_comment_count: 2 }));

    expect(await writing).toBe(true);
    expect(useCommunityStore.getState().commentsPostId).toBe("post-b");
    expect(useCommunityStore.getState().comments.map(comment => comment.id)).toEqual(["post-b-comment"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the latest refresh of the same post when an older read finishes last", async () => {
    const oldRead = deferred();
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(response({ comments: [{ id: "new-comment" }] })));

    const reading = useCommunityStore.getState().fetchComments("post-a");
    await useCommunityStore.getState().fetchComments("post-a");
    oldRead.resolve(response({ comments: [{ id: "old-comment" }] }));
    await reading;

    expect(useCommunityStore.getState().comments.map(comment => comment.id)).toEqual(["new-comment"]);
  });

  it.each(["update", "delete"] as const)("an old read cannot undo a successful comment %s", async (mutation) => {
    const oldRead = deferred();
    const original = { id: "comment-a", content: "이전 내용", is_deleted: false };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response({ comments: [original] }))
      .mockReturnValueOnce(oldRead.promise)
      .mockResolvedValueOnce(response({ comment: { content: "수정한 내용" } })));
    await useCommunityStore.getState().fetchComments("post-a");
    const reading = useCommunityStore.getState().fetchComments("post-a");
    const result = mutation === "update"
      ? await useCommunityStore.getState().updateComment("comment-a", "수정한 내용")
      : await useCommunityStore.getState().deleteComment("comment-a");
    expect(result).toEqual({ ok: true });
    oldRead.resolve(response({ comments: [original] }));
    await reading;

    expect(useCommunityStore.getState().comments[0]).toMatchObject(mutation === "update"
      ? { content: "수정한 내용" }
      : { is_deleted: true, content: "삭제된 댓글입니다." });
    expect(useCommunityStore.getState().commentsLoading).toBe(false);
  });
});
