/* global Response */

import assert from "node:assert/strict";
import test from "node:test";

import { buildCommunityRemoteReplyPushPayload } from "@hanbang/shared/community-notification";
import {
  createCommunityPushNavigationGuard,
  createCommunityPushTargetResolver,
} from "../lib/communityPushNavigation.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const COMMENT = "33333333-3333-4333-8333-333333333333";
const NOTIFICATION = "44444444-4444-4444-8444-444444444444";
const DELIVERY = "55555555-5555-4555-8555-555555555555";

const payload = buildCommunityRemoteReplyPushPayload({
  kind: "post_reply",
  postId: POST,
  commentId: COMMENT,
  notificationId: NOTIFICATION,
  deliveryId: DELIVERY,
});

test("production push target resolution makes zero requests without an exact safe origin", async () => {
  for (const configuredSiteUrl of [
    undefined,
    "",
    "http://hanbang.ai",
    "https://hanbang.ai/path",
    "https://user:password@hanbang.ai",
  ]) {
    let fetchCount = 0;
    const resolveTarget = createCommunityPushTargetResolver({
      configuredSiteUrl,
      isDevelopment: false,
      fetchImpl: async () => {
        fetchCount += 1;
        return new Response("{}", { status: 200 });
      },
    });

    assert.equal(
      await resolveTarget(payload.data, { ownerId: OWNER, accessToken: "token" }),
      null,
    );
    assert.equal(fetchCount, 0);
  }
});

test("push target resolution uses the exact configured origin without redirects", async () => {
  let requestUrl = "";
  let requestOptions;
  const resolveTarget = createCommunityPushTargetResolver({
    configuredSiteUrl: "https://preview.hanbang.ai",
    isDevelopment: false,
    fetchImpl: async (url, options) => {
      requestUrl = String(url);
      requestOptions = options;
      return new Response(JSON.stringify({
        deliveryId: DELIVERY,
        notificationId: NOTIFICATION,
        href: `/community/post/${POST}?commentId=${COMMENT}`,
      }), { status: 200 });
    },
  });

  assert.deepEqual(
    await resolveTarget(payload.data, { ownerId: OWNER, accessToken: "token" }),
    {
      deliveryId: DELIVERY,
      notificationId: NOTIFICATION,
      href: `/community/post/${POST}?commentId=${COMMENT}`,
    },
  );
  assert.equal(
    requestUrl,
    "https://preview.hanbang.ai/api/community/notifications/push-target"
      + `?deliveryId=${DELIVERY}&notificationId=${NOTIFICATION}`,
  );
  assert.equal(requestOptions?.redirect, "error");
  assert.equal(requestOptions?.headers?.Authorization, "Bearer token");
});

test("community push tap resolves against the current owner and navigates once", async () => {
  const navigations = [];
  let resolutionCount = 0;
  const guard = createCommunityPushNavigationGuard({
    getAuthContext: async () => ({ ownerId: OWNER, accessToken: "token" }),
    resolveTarget: async (target, auth) => {
      resolutionCount += 1;
      assert.equal(auth.ownerId, OWNER);
      return {
        deliveryId: target.deliveryId,
        notificationId: target.notificationId,
        href: target.href,
      };
    },
    navigate: (target) => navigations.push(target),
  });

  assert.equal(await guard.validate(payload.data), true);
  assert.equal(await guard.handleTap(payload.data), true);
  assert.equal(await guard.handleTap(payload.data), false);
  assert.equal(resolutionCount, 2);
  assert.deepEqual(navigations, [{ postId: POST, commentId: COMMENT }]);
});

test("community push data and resolver responses are exact-shape allowlists", async () => {
  let resolutionCount = 0;
  const guard = createCommunityPushNavigationGuard({
    getAuthContext: async () => ({ ownerId: OWNER, accessToken: "token" }),
    resolveTarget: async () => {
      resolutionCount += 1;
      return {
        deliveryId: DELIVERY,
        notificationId: NOTIFICATION,
        href: `/community/post/${POST}?commentId=${COMMENT}`,
        extra: "not allowed",
      };
    },
    navigate: () => assert.fail("must not navigate"),
  });

  assert.equal(await guard.validate({ ...payload.data, next: "https://evil.example" }), false);
  assert.equal(await guard.handleTap(payload.data), false);
  assert.equal(resolutionCount, 1);
});

test("logout or account switch during resolution invalidates an in-flight tap", async () => {
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let navigated = false;
  const guard = createCommunityPushNavigationGuard({
    getAuthContext: async () => ({ ownerId: OWNER, accessToken: "token" }),
    resolveTarget: async (target) => {
      await blocked;
      return {
        deliveryId: target.deliveryId,
        notificationId: target.notificationId,
        href: target.href,
      };
    },
    navigate: () => { navigated = true; },
  });

  const handling = guard.handleTap(payload.data);
  await Promise.resolve();
  guard.invalidateForAuthChange();
  release();
  assert.equal(await handling, false);
  assert.equal(navigated, false);
});

test("signed-out devices and changed target ids fail closed", async () => {
  const signedOut = createCommunityPushNavigationGuard({
    getAuthContext: async () => null,
    resolveTarget: async () => assert.fail("must not resolve"),
    navigate: () => assert.fail("must not navigate"),
  });
  assert.equal(await signedOut.handleTap(payload.data), false);

  const mismatch = createCommunityPushNavigationGuard({
    getAuthContext: async () => ({ ownerId: OWNER, accessToken: "token" }),
    resolveTarget: async (target) => ({
      deliveryId: "66666666-6666-4666-8666-666666666666",
      notificationId: target.notificationId,
      href: target.href,
    }),
    navigate: () => assert.fail("must not navigate"),
  });
  assert.equal(await mismatch.handleTap(payload.data), false);
});
