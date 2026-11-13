import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

const feedSource = readFileSync(
  new URL("../../app/community/index.tsx", import.meta.url),
  "utf8",
);
const detailSource = readFileSync(
  new URL("../../app/community/post/[id].tsx", import.meta.url),
  "utf8",
);
const profileSource = readFileSync(
  new URL("../../app/profile.tsx", import.meta.url),
  "utf8",
);
const cohortSource = readFileSync(
  new URL("../../app/community/cohort/[id].tsx", import.meta.url),
  "utf8",
);

const CORE_POLICY_TABLES = [
  "community_posts",
  "community_comments",
  "community_profiles",
  "cohort_members",
  "cohort_rooms",
];

test("mobile community feed reads the server policy projection only", () => {
  assert.match(feedSource, /fetchPostsFromApi\(cat\)/);
  assert.match(feedSource, /\/api\/community\/posts\?sort=new/);
  assert.match(
    feedSource,
    /optionalAuthGetJson<[\s\S]{0,300}>\([\s\S]{0,100}\/api\/community\/posts\?sort=new/,
  );
  assert.match(
    feedSource,
    /apiJson<[\s\S]{0,300}>\("\/api\/community\/cohort"\)/,
  );
  assert.doesNotMatch(feedSource, /fetchPostsFromSupabase/);
  for (const table of CORE_POLICY_TABLES) {
    assert.doesNotMatch(
      feedSource,
      new RegExp(`\\.from\\(["']${table}["']\\)`),
    );
  }
});

test("mobile post detail and comments fail closed through server viewer policy", () => {
  assert.match(detailSource, /fetchPostFromApi\(postId, ownerId\)/);
  assert.match(detailSource, /fetchCommentsFromApi\(postId, ownerId\)/);
  assert.doesNotMatch(detailSource, /fetchPostFromSupabase/);
  assert.doesNotMatch(detailSource, /fetchCommentsFromSupabase/);
  for (const table of CORE_POLICY_TABLES) {
    assert.doesNotMatch(
      detailSource,
      new RegExp(`\\.from\\(["']${table}["']\\)`),
    );
  }
});

test("mobile profile reads private community counters through the authenticated API", () => {
  assert.match(profileSource, /apiJson<[\s\S]*?>\("\/api\/community\/profile"\)/);
  assert.doesNotMatch(
    profileSource,
    /\.from\(["']community_profiles["']\)/,
  );
});

test("mobile cohort member identities stay behind the authenticated server projection", () => {
  assert.match(cohortSource, /fetchCohortMembers\(\{/);
  assert.doesNotMatch(
    cohortSource,
    /\.from\(["']community_profiles["']\)/,
  );
  assert.doesNotMatch(
    cohortSource,
    /\.from\(["']community_public_profiles["']\)/,
  );
});
