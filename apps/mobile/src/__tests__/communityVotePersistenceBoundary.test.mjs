import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const source = readFileSync(
  new URL("../../app/community/post/[id].tsx", import.meta.url),
  "utf8",
);

test("mobile optimistic votes use the server boundary and roll back on persistence failure", () => {
  assert.match(
    source,
    /const result = await apiJson<unknown>\(`\/api\/community\/posts\/\$\{postId\}\/vote`, \{/u,
  );
  assert.match(source, /body: JSON\.stringify\(\{ voteType: newVote \}\)/u);
  assert.match(source, /throw new Error\("COMMUNITY_VOTE_RESPONSE_INVALID"\)/u);
  assert.match(source, /catch \{[\s\S]*setUserVote\(prevVote\);[\s\S]*setPost\(prevPost\);/u);
  assert.doesNotMatch(source, /supabase\.rpc\("community_vote_post"/u);
});
