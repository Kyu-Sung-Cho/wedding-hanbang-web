import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");
const readRepo = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("community comment vote retirement contract", () => {
  it("keeps the mutation endpoint physically retired", () => {
    const route = readRepo("apps/web/src/app/api/community/comments/[id]/vote/route.ts");

    expect(route).toContain('code: "community_comment_votes_retired"');
    expect(route).toContain("status: 410");
    expect(route).toContain('"Cache-Control": "no-store"');
    expect(route).not.toMatch(/createClient|checkRateLimit|community_vote_comment|\.rpc\(/);
  });

  it("renders historical web counts without a vote control or client mutation", () => {
    const item = readRepo("apps/web/src/components/community/CommentItem.tsx");
    const section = readRepo("apps/web/src/components/community/CommentSection.tsx");
    const store = readRepo("apps/web/src/stores/communityStore.ts");
    const commentsRoute = readRepo("apps/web/src/app/api/community/comments/route.ts");

    expect(item).toContain("좋아요 {comment.upvote_count}");
    expect(item).not.toMatch(/onVote|handleVote|comment\.user_vote|댓글 좋아요/);
    expect(section).not.toContain("voteComment");
    expect(store).not.toMatch(/voteComment|\/api\/community\/comments\/\$\{commentId\}\/vote/);
    expect(commentsRoute).not.toMatch(/community_votes|user_vote/);
  });

  it("shows mobile historical counts as text and exposes no comment vote request", () => {
    const detail = readRepo("apps/mobile/app/community/post/[id].tsx");

    expect(detail).toContain("styles.commentVoteCount");
    expect(detail).toContain('좋아요 {typeof c.upvote_count === "number" ? c.upvote_count : 0}');
    expect(detail).not.toMatch(/\/api\/community\/comments\/[^\s"'`]+\/vote/);
  });

  it("does not subscribe browsers to raw comment rows after comment publishing retirement", () => {
    const detail = readRepo("apps/web/src/app/(community)/community/post/[id]/page.tsx");

    expect(detail).not.toContain("useCommentsRealtime");
    expect(
      existsSync(resolve(repoRoot, "apps/web/src/hooks/useCommentsRealtime.ts")),
    ).toBe(false);
  });
});
