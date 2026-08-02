import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { URL } from "node:url";

const screenSource = readFileSync(
  new URL("../../app/community/post/[id].tsx", import.meta.url),
  "utf8",
);

function bookmarkHandlerSource() {
  const start = screenSource.indexOf("async function handleBookmark()");
  const end = screenSource.indexOf("async function handleComment()", start);
  assert.notEqual(start, -1, "bookmark handler must exist");
  assert.notEqual(end, -1, "comment handler must follow bookmark handler");
  return screenSource.slice(start, end);
}

test("mobile bookmark mutations use the canonical fail-closed API boundary", () => {
  const handler = bookmarkHandlerSource();

  assert.match(
    handler,
    /apiJson<unknown>\(`\/api\/community\/posts\/\$\{postId\}\/bookmark`,\s*\{\s*method:\s*"POST"/,
  );
  assert.doesNotMatch(handler, /\.from\("community_bookmarks"\)/);
  assert.match(handler, /typeof\s+result\.bookmarked\s*!==\s*"boolean"/);
  assert.match(handler, /typeof\s+result\.bookmark_count\s*!==\s*"number"/);
});
