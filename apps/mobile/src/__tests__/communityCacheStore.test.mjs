import assert from "node:assert/strict";
import test from "node:test";

import { createCommunityCacheStore } from "../lib/communityCacheStore.mjs";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";

test("feed entries expire instead of surviving indefinitely", () => {
  let now = 1_000;
  const cache = createCommunityCacheStore({ now: () => now, feedTtlMs: 100 });
  cache.setViewer(USER_A);
  cache.putFeed("all", [{ id: "post-a" }]);

  assert.deepEqual(cache.getFeed("all"), [{ id: "post-a" }]);
  now += 101;
  assert.equal(cache.getFeed("all"), null);
});

test("changing accounts clears feed, detail, comments, and cohort data", () => {
  const cache = createCommunityCacheStore();
  cache.setViewer(USER_A);
  cache.putFeed("all", [{ id: "feed-a" }]);
  cache.putPost({ id: "post-a" });
  cache.putComments("post-a", [{ id: "comment-a" }]);
  cache.putCohort({ myCohort: { room_id: "room-a" }, cohortRooms: [] });

  cache.setViewer(USER_B);

  assert.equal(cache.getFeed("all"), null);
  assert.equal(cache.getPost("post-a"), null);
  assert.equal(cache.getComments("post-a"), null);
  assert.equal(cache.getCohort(), null);
});

test("an account A response cannot write after the viewer changes to B", () => {
  const cache = createCommunityCacheStore();
  cache.setViewer(USER_A);
  const accountAToken = cache.capture();
  cache.setViewer(USER_B);

  assert.equal(cache.putFeed("all", [{ id: "late-a" }], accountAToken), false);
  assert.equal(cache.putCohort({ myCohort: { room_id: "room-a" }, cohortRooms: [] }, accountAToken), false);
  assert.equal(cache.getFeed("all"), null);
  assert.equal(cache.getCohort(), null);
});

test("cohort data has its own finite lifetime", () => {
  let now = 10_000;
  const cache = createCommunityCacheStore({ now: () => now, cohortTtlMs: 50 });
  cache.setViewer(USER_A);
  cache.putCohort({ myCohort: null, cohortRooms: [{ id: "room-a" }] });

  now += 51;
  assert.equal(cache.getCohort(), null);
});
