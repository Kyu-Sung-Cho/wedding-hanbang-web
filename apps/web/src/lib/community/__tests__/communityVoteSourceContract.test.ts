// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const migration = readWorkspaceFile(
  "../../supabase/migrations/20260802146000_harden_community_vote_rpc_serialization.sql",
);

function extractDollarQuotedBody(tag: string) {
  const delimiter = `$${tag}$`;
  const start = migration.indexOf(`AS ${delimiter}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = start + `AS ${delimiter}`.length;
  const end = migration.indexOf(delimiter, bodyStart);
  expect(end).toBeGreaterThan(bodyStart);
  return migration.slice(bodyStart, end);
}

describe("community vote source contracts", () => {
  it("locks targets before mutation and derives counters from stored vote rows", () => {
    const postBody = extractDollarQuotedBody("community_vote_post");
    const commentBody = extractDollarQuotedBody("community_vote_comment");

    const postActorLock = postBody.indexOf("FOR KEY SHARE;");
    const postLock = postBody.indexOf("FOR UPDATE;");
    const postMutation = postBody.indexOf("DELETE FROM public.community_votes");
    const postRecount = postBody.indexOf("SELECT pg_catalog.count(*)::integer");
    expect(postActorLock).toBeGreaterThanOrEqual(0);
    expect(postLock).toBeGreaterThan(postActorLock);
    expect(postMutation).toBeGreaterThan(postLock);
    expect(postRecount).toBeGreaterThan(postMutation);
    expect(postBody).not.toMatch(/old_vote|upvote_count\s*=\s*upvote_count\s*[+-]/i);

    const commentActorLock = commentBody.indexOf("FOR KEY SHARE;");
    const commentParentLock = commentBody.indexOf("FOR UPDATE;");
    const commentRowLock = commentBody.indexOf("FOR UPDATE;", commentParentLock + 1);
    const commentMutation = commentBody.indexOf("DELETE FROM public.community_votes");
    const commentRecount = commentBody.indexOf("SELECT pg_catalog.count(*)::integer");
    expect(commentActorLock).toBeGreaterThanOrEqual(0);
    expect(commentParentLock).toBeGreaterThan(commentActorLock);
    expect(commentRowLock).toBeGreaterThan(commentParentLock);
    expect(commentMutation).toBeGreaterThan(commentRowLock);
    expect(commentRecount).toBeGreaterThan(commentMutation);
    expect(commentBody).not.toMatch(/old_vote|upvote_count\s*=\s*upvote_count\s*[+-]/i);

    const guardBody = extractDollarQuotedBody("community_vote_target_guard");
    expect(guardBody).toContain("FOR KEY SHARE;");
    expect(guardBody).toContain("FOR UPDATE;");
    expect(guardBody).toContain("FOR UPDATE OF post, comment;");
    expect(guardBody).not.toMatch(/vote_target_not_accessible|23503/i);
    expect(guardBody.match(/community_vote_target_not_found/g)).toHaveLength(2);
    expect(guardBody.match(/ERRCODE = 'P0002'/g)).toHaveLength(2);

    const deleteSyncBody = extractDollarQuotedBody(
      "community_vote_delete_counter_sync",
    );
    expect(deleteSyncBody).toContain("IF OLD.vote_type = 1::smallint");
    expect(deleteSyncBody.match(/FOR UPDATE;/g)).toHaveLength(2);
    expect(deleteSyncBody.match(/SELECT pg_catalog.count\(\*\)::integer/g)).toHaveLength(2);
    expect(deleteSyncBody.match(/GREATEST\(COALESCE\(/g)).toHaveLength(2);
    expect(migration).toMatch(
      /CREATE CONSTRAINT TRIGGER trg_community_vote_delete_counter_sync[\s\S]*?AFTER DELETE ON public\.community_votes[\s\S]*?DEFERRABLE INITIALLY DEFERRED[\s\S]*?FOR EACH ROW EXECUTE FUNCTION public\.community_vote_delete_counter_sync\(\);/,
    );
  });

  it("keeps vote RPCs behind server-owned, rate-limited API routes", () => {
    const webPostRoute = readWorkspaceFile(
      "src/app/api/community/posts/[id]/vote/route.ts",
    );
    const webCommentRoute = readWorkspaceFile(
      "src/app/api/community/comments/[id]/vote/route.ts",
    );
    const mobilePostScreen = readWorkspaceFile(
      "../../apps/mobile/app/community/post/[id].tsx",
    );

    expect(webPostRoute).toMatch(
      /createAdminClient\(\)\.rpc\("community_vote_post",\s*\{[\s\S]*?p_user_id:\s*user\.id,[\s\S]*?p_post_id:\s*id,[\s\S]*?p_vote_type:\s*voteType,/,
    );
    expect(webCommentRoute).toMatch(
      /createAdminClient\(\)\.rpc\("community_vote_comment",\s*\{[\s\S]*?p_user_id:\s*user\.id,[\s\S]*?p_comment_id:\s*id,[\s\S]*?p_vote_type:\s*voteType,/,
    );
    expect(mobilePostScreen).toMatch(
      /apiJson<unknown>\(`\/api\/community\/posts\/\$\{postId\}\/vote`,\s*\{[\s\S]*?method:\s*"POST",[\s\S]*?JSON\.stringify\(\{ voteType: newVote \}\)/,
    );
    expect(mobilePostScreen).not.toMatch(/rpc\("community_vote_post"/);
  });
});
