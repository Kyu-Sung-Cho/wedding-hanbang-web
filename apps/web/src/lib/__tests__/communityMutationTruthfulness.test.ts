import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("community mutation truthfulness", () => {
  it("returns an explicit bookmark result and rolls optimistic UI back on failure", () => {
    const store = read("src/stores/communityStore.ts");
    const card = read("src/components/community/PostCard.tsx");
    const landing = read("src/components/community/CommunityLandingClient.tsx");

    expect(store).toContain(
      "toggleBookmark: (postId: string, bookmarked: boolean) => Promise<boolean>",
    );
    expect(store).toContain("body: JSON.stringify({ bookmarked })");
    expect(card).toContain("const ok = await toggleBookmark(post.id, !previous)");
    expect(card).toContain("if (!ok)");
    expect(landing).toContain("const ok = await toggleBookmark(post.id, !previous)");
    expect(landing).toContain("if (!ok)");
  });

  it("physically removes reply publishing while comment writes are retired", () => {
    const item = read("src/components/community/CommentItem.tsx");
    const section = read("src/components/community/CommentSection.tsx");
    const route = read("src/app/api/community/comments/route.ts");

    expect(item).not.toContain("onReply");
    expect(section).not.toContain("createComment");
    expect(route).toContain('code: "community_comment_writes_retired"');
    expect(route).toContain("{ status: 410");
  });

  it("separates comment-load failure from empty and offers an explicit retry", () => {
    const store = read("src/stores/communityStore.ts");
    const section = read("src/components/community/CommentSection.tsx");

    expect(store).toContain('commentsLoadStatus: "idle"');
    expect(store).toContain('commentsLoadStatus: "error"');
    expect(store).toContain("commentsLoadError");
    expect(section).toContain('commentsLoadStatus === "error"');
    expect(section).toContain("void fetchComments(postId)");
    expect(section).toContain('role="alert"');
  });

  it("shows the comment-write retirement instead of a misleading input", () => {
    const section = read("src/components/community/CommentSection.tsx");

    expect(section).not.toContain("setNewComment");
    expect(section).not.toContain("submitComment");
    expect(section).toContain("새 댓글과 답글 작성은 제공하지 않아요.");
    expect(section).toContain("기존 댓글은 계속 읽을 수 있고");
  });

  it("keeps edit drafts and the delete dialog open when their mutations fail", () => {
    const item = read("src/components/community/CommentItem.tsx");

    expect(item).toContain('const [editError, setEditError] = useState("")');
    expect(item).toContain('const [deleteError, setDeleteError] = useState("")');
    expect(item).toContain('const [deleting, setDeleting] = useState(false)');
    expect(item).toMatch(/if \(ok\) \{\s*setShowDeleteConfirm\(false\)/);
    expect(item).toContain("disabled={deleting}");
  });

  it("keeps search results on initial or pagination failure and exposes retry state", () => {
    const landing = read("src/components/community/CommunityLandingClient.tsx");

    expect(landing).toContain(
      "const [searchError, setSearchError] = useState<string | null>(null)",
    );
    expect(landing).toContain('"initial" | "more" | null');
    expect(landing).toContain("setSearchError(");
    expect(landing).not.toContain(".catch(() => {})");
    expect(landing).not.toMatch(
      /\.catch\(\(err\) => \{[\s\S]{0,180}setSearchResults\(\[\]\)/,
    );
  });
});
