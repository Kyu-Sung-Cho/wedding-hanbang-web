import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

import {
  buildCommunityRemoteReplyPushPayload,
  buildCommunityReplyPushPayload,
  buildCommunityReplyWebHref,
  isAllowedCommunityReplyPushHref,
  isAllowedCommunityReplyWebHref,
  parseCommunityRemoteReplyPushData,
} from "@hanbang/shared/community-notification";

const POST_ID = "11111111-1111-4111-8111-111111111111";
const COMMENT_ID = "22222222-2222-4222-8222-222222222222";
const NOTIFICATION_ID = "33333333-3333-4333-8333-333333333333";
const DELIVERY_ID = "44444444-4444-4444-8444-444444444444";

test("community push copy stays generic and carries only an allowlisted target", () => {
  const privateQuestion = "우리 결혼식은 10월 3일이고 예산은 3천만원이에요";
  const payload = buildCommunityReplyPushPayload({
    kind: "post_reply",
    postId: POST_ID,
    commentId: COMMENT_ID,
    question: privateQuestion,
    body: "계약금 분쟁 상세",
  });

  assert.deepEqual(payload, {
    title: "웨딩한방 커뮤니티",
    body: "내 글에 새 답변이 도착했어요.",
    data: {
      type: "community_reply",
      href: `/community/post/${POST_ID}?commentId=${COMMENT_ID}`,
    },
  });
  assert.equal(JSON.stringify(payload).includes(privateQuestion), false);
  assert.equal(JSON.stringify(payload).includes("계약금"), false);
  assert.equal(isAllowedCommunityReplyPushHref(payload.data.href), true);
  assert.equal(Object.isFrozen(payload), true);
  assert.equal(Object.isFrozen(payload.data), true);
});

test("community notification deep links reject external and ambiguous paths", () => {
  const webHref = buildCommunityReplyWebHref(POST_ID, COMMENT_ID);
  assert.equal(isAllowedCommunityReplyWebHref(webHref), true);

  for (const href of [
    `https://evil.example/community/post/${POST_ID}?commentId=${COMMENT_ID}`,
    `//evil.example/community/post/${POST_ID}?commentId=${COMMENT_ID}`,
    `/community/post/${POST_ID}?commentId=${COMMENT_ID}&next=https://evil.example`,
    `/community/post/${POST_ID}/../settings?commentId=${COMMENT_ID}`,
    `/wedding/community/post/${POST_ID}#comment-${COMMENT_ID}?next=evil`,
  ]) {
    assert.equal(isAllowedCommunityReplyPushHref(href), false);
    assert.equal(isAllowedCommunityReplyWebHref(href), false);
  }
});

test("remote reply payload accepts only exact opaque ids and an allowlisted route", () => {
  const payload = buildCommunityRemoteReplyPushPayload({
    kind: "comment_reply",
    postId: POST_ID,
    commentId: COMMENT_ID,
    notificationId: NOTIFICATION_ID,
    deliveryId: DELIVERY_ID,
    title: "private title must be ignored",
  });

  assert.deepEqual(parseCommunityRemoteReplyPushData(payload.data), {
    type: "community_reply",
    href: `/community/post/${POST_ID}?commentId=${COMMENT_ID}`,
    notificationId: NOTIFICATION_ID,
    deliveryId: DELIVERY_ID,
    postId: POST_ID,
    commentId: COMMENT_ID,
  });
  assert.equal(JSON.stringify(payload).includes("private title"), false);
  assert.equal(parseCommunityRemoteReplyPushData({
    ...payload.data,
    next: "https://evil.example",
  }), null);
  assert.equal(parseCommunityRemoteReplyPushData({
    ...payload.data,
    href: `https://evil.example/community/post/${POST_ID}?commentId=${COMMENT_ID}`,
  }), null);
});

test("mobile notification scheduling is routed through the privacy-safe builder", async () => {
  const source = await readFile(
    new URL("../lib/notifications.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /buildCommunityReplyPushPayload/);
  assert.match(source, /scheduleCommunityReplyNotification/);
  assert.doesNotMatch(source, /scheduleLocalNotification\s*\(/);
  assert.match(source, /dismissAllNotificationsAsync\(\)/);
  assert.match(source, /setBadgeCountAsync\(0\)/);
});
