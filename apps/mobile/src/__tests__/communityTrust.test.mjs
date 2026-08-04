import test from "node:test";
import assert from "node:assert/strict";

import {
  communityContentOriginLabel,
  communityPostLoadFailure,
  parseCommunityCommentOrigin,
  parseCommunityPostTrust,
} from "../lib/communityTrust.mjs";

test("post trust metadata is accepted only when every public trust field is explicit", () => {
  assert.deepEqual(parseCommunityPostTrust({
    content_origin: "member",
    ad_disclosure: "general",
    sponsorship_detail: null,
    is_resolved: false,
    under_review: false,
  }), {
    contentOrigin: "member",
    adDisclosure: "general",
    sponsorshipDetail: null,
    isResolved: false,
    underReview: false,
  });

  for (const missing of [
    "content_origin",
    "ad_disclosure",
    "sponsorship_detail",
    "is_resolved",
    "under_review",
  ]) {
    const value = {
      content_origin: "member",
      ad_disclosure: "general",
      sponsorship_detail: null,
      is_resolved: false,
      under_review: false,
    };
    delete value[missing];
    assert.equal(parseCommunityPostTrust(value), null);
  }
});

test("sponsored posts require a meaningful disclosure and unknown origins fail closed", () => {
  assert.equal(parseCommunityPostTrust({
    content_origin: "member",
    ad_disclosure: "sponsored",
    sponsorship_detail: "gift",
    is_resolved: true,
    under_review: false,
  }), null);
  assert.equal(parseCommunityPostTrust({
    content_origin: "human",
    ad_disclosure: "general",
    sponsorship_detail: null,
    is_resolved: false,
    under_review: false,
  }), null);
  assert.equal(parseCommunityCommentOrigin({ content_origin: "ai" }), "ai");
  assert.equal(parseCommunityCommentOrigin({ content_origin: "unknown" }), null);
});

test("trust labels and load failures are semantic rather than color-only", () => {
  assert.equal(communityContentOriginLabel("member"), "일반 회원 · 경험 미인증");
  assert.equal(communityContentOriginLabel("operator"), "운영자");
  assert.equal(communityContentOriginLabel("ai"), "AI");
  assert.equal(communityPostLoadFailure(401), "auth_required");
  assert.equal(communityPostLoadFailure(404), "unavailable");
  assert.equal(communityPostLoadFailure(503), "load_failed");
});
