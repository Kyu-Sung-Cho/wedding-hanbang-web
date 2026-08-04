import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "../..");
const feed = readFileSync(resolve(appRoot, "app/(tabs)/community.tsx"), "utf8");
const detail = readFileSync(resolve(appRoot, "app/community/post/[id].tsx"), "utf8");
const badges = readFileSync(
  resolve(appRoot, "src/components/community/CommunityTrustBadges.tsx"),
  "utf8",
);

test("feed and detail fail closed on missing trust metadata and render the same trust badges", () => {
  for (const source of [feed, detail]) {
    assert.match(source, /parseCommunityPostTrust/);
    assert.match(source, /<CommunityTrustBadges/);
  }

  for (const field of [
    "content_origin",
    "ad_disclosure",
    "sponsorship_detail",
    "is_resolved",
    "under_review",
  ]) {
    assert.match(feed, new RegExp(field));
    assert.match(detail, new RegExp(field));
  }

  assert.match(badges, /작성 출처/);
  assert.match(badges, /경제적 관계/);
  assert.match(badges, /운영 검토 중/);
  assert.match(badges, /해결됨/);
});

test("detail never presents a failed comment request as a genuine zero-comment state", () => {
  assert.match(detail, /commentsLoadFailed/);
  assert.match(detail, /댓글을 불러오지 못했어요/);
  assert.match(detail, /아직 댓글이 없다는 뜻은 아니에요/);
  assert.match(detail, /!commentsLoadFailed && comments\.length === 0/);
  assert.match(detail, /postLoadFailure === "load_failed"/);
  assert.match(detail, /communityPostLoadFailure\(response\.status\)/);
});
