import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

import {
  AMORA_PUSH_COPY,
  AMORA_PUSH_DAILY_CAP,
  buildAmoraPushMessage,
  isWithinAmoraPushWindow,
  parseAmoraPushData,
} from "@hanbang/shared/amora-push";
import { amoraPushHref, createAmoraPushTapGuard, isAmoraPushData } from "../lib/amoraPushNavigation.mjs";

// 결정 D-86 아모라 앱 알림의 앱 쪽 계약. 알림에는 내용이 없고, 모양이 정확히 맞을 때만 보이고 연다.

const DELIVERY = "40000000-0000-4000-8000-000000000001";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("알림 자료는 type·deliveryId·route 세 칸만 받는다", () => {
  assert.deepEqual(parseAmoraPushData({ type: "amora", deliveryId: DELIVERY, route: "home" }), { deliveryId: DELIVERY, route: "home" });
  for (const bad of [
    null,
    { type: "amora", deliveryId: DELIVERY },
    { type: "amora", deliveryId: DELIVERY, route: "settings" },
    { type: "amora", deliveryId: "not-a-uuid", route: "home" },
    { type: "community_reply", deliveryId: DELIVERY, route: "home" },
    { type: "amora", deliveryId: DELIVERY, route: "home", title: "상견례" },
  ]) {
    assert.equal(parseAmoraPushData(bad), null, JSON.stringify(bad));
    assert.equal(isAmoraPushData(bad), false);
  }
});

test("보내는 알림에는 고정 문장 하나와 열 화면 이름만 든다", () => {
  const message = buildAmoraPushMessage({ to: "ExponentPushToken[abc]", deliveryId: DELIVERY, route: "chat" });
  assert.equal(message.title, "웨딩한방");
  assert.equal(message.body, "아모라가 정리한 게 있어요.");
  assert.deepEqual(message.data, { type: "amora", deliveryId: DELIVERY, route: "chat" });
  assert.deepEqual(Object.keys(message).sort(), ["body", "collapseId", "data", "priority", "sound", "tag", "title", "to", "ttl"]);
  assert.equal(AMORA_PUSH_DAILY_CAP, 2);
  for (const sentence of Object.values(AMORA_PUSH_COPY)) assert.doesNotMatch(sentence, /—|–|플래너|파트너/);
});

test("보내는 시간은 한국 시각 09:00 이상 20:00 미만이다", () => {
  assert.equal(isWithinAmoraPushWindow(new Date("2026-11-19T23:59:59Z")), false); // 08:59
  assert.equal(isWithinAmoraPushWindow(new Date("2026-11-20T00:00:00Z")), true); // 09:00
  assert.equal(isWithinAmoraPushWindow(new Date("2026-11-20T10:59:59Z")), true); // 19:59
  assert.equal(isWithinAmoraPushWindow(new Date("2026-11-20T11:00:00Z")), false); // 20:00
});

test("누르면 홈이나 대화 탭을 한 번만 연다", () => {
  assert.equal(amoraPushHref({ type: "amora", deliveryId: DELIVERY, route: "home" }), "/(tabs)/lounge");
  assert.equal(amoraPushHref({ type: "amora", deliveryId: DELIVERY, route: "chat" }), "/(tabs)/chat");
  assert.equal(amoraPushHref({ type: "amora", deliveryId: DELIVERY, route: "/settings" }), null);
  const opened = [];
  const guard = createAmoraPushTapGuard({ navigate: (href) => opened.push(href) });
  const data = { type: "amora", deliveryId: DELIVERY, route: "home" };
  assert.equal(guard.handleTap(data), true);
  assert.equal(guard.handleTap(data), false);
  assert.equal(guard.handleTap({ type: "community_reply" }), false);
  assert.deepEqual(opened, ["/(tabs)/lounge"]);
});

test("알림 처리기는 아모라 알림을 먼저 알아보고 커뮤니티 알림 처리는 그대로 둔다", () => {
  const notifications = source("../lib/notifications.ts");
  assert.match(notifications, /const allowed = isAmoraPushData\(data\)\s*\|\| await communityPushNavigation\.validate\(data\);/);
  assert.match(notifications, /if \(amoraPushTaps\.handleTap\(response\.notification\.request\.content\.data\)\) \{/);
  assert.match(notifications, /if \(isAmoraPushData\(notification\.request\.content\.data\)\) return;/);
  assert.match(notifications, /const handled = await communityPushNavigation\.handleTap\(/);
});

test("설정 칸은 서버가 보낼 수 있을 때만 보이고, 이미 켠 사람은 끌 수 있다", () => {
  const control = source("../components/settings/AmoraPushPreferenceControl.tsx");
  const settings = source("../../app/settings/index.tsx");
  assert.match(settings, /<AmoraPushPreferenceControl \/>/);
  assert.match(control, /const ROUTE = "\/api\/amora\/push-preference";/);
  assert.match(control, /if \(!response\.ok \|\| !payload \|\| \(!payload\.available && !payload\.enabled\)\) \{\s*setView\(\{ kind: "hidden" \}\);/);
  assert.match(control, /if \(nextEnabled && !await registerForPushNotifications\(\)\) \{/);
  assert.match(control, /if \(await currentVerifiedUserId\(\) !== ownerUserId\) return;/);
  const copy = [...control.matchAll(/"([^"]*[가-힣][^"]*)"/g)].map((match) => match[1]);
  assert.ok(copy.length >= 5);
  for (const sentence of copy) assert.doesNotMatch(sentence, /—|–|플래너|파트너|베타/, sentence);
});
