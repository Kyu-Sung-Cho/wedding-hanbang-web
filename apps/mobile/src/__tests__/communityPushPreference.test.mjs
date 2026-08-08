import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

test("community reply push is a separate explicit default-off preference", async () => {
  const [control, settings] = await Promise.all([
    readFile(
      new URL("../components/settings/CommunityReplyPushPreferenceControl.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../app/settings/index.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(settings, /CommunityReplyPushPreferenceControl/u);
  assert.match(control, /직접 켜기 전에는 보내지 않아요/u);
  assert.match(control, /앱 안 알림은 이 설정과 별개예요/u);
  assert.match(control, /글 제목·본문·작성자·업체·금액·날짜를 넣지 않아요/u);
  assert.match(
    control,
    /registerForPushNotifications\(\)[\s\S]*community_set_reply_push_preference/u,
  );
});

test("receive and tap paths fail closed and clear stale logout state", async () => {
  const notifications = await readFile(
    new URL("../lib/notifications.ts", import.meta.url),
    "utf8",
  );

  assert.match(notifications, /setNotificationHandler[\s\S]*communityPushNavigation\.validate/u);
  assert.match(notifications, /addNotificationReceivedListener/u);
  assert.match(notifications, /addNotificationResponseReceivedListener/u);
  assert.match(notifications, /getLastNotificationResponseAsync/u);
  assert.match(notifications, /communityPushNavigation\.handleTap/u);
  assert.match(notifications, /cancelAllScheduledNotificationsAsync/u);
  assert.match(notifications, /clearLastNotificationResponseAsync/u);
  assert.doesNotMatch(notifications, /\.update\(\{\s*read_at|notifications[^\n]*method:\s*"POST"/iu);
});
