import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { URL } from "node:url";

/**
 * 주석을 걷어낸 소스.
 *
 * 이 파일의 검사는 **사용자가 읽는 문구**에 대한 것인데, 소스 문자열을 그대로
 * 보면 "왜 이 문구를 쓰지 않는가"를 설명하는 주석이 금지어에 걸린다. 실제로
 * 2026-08-23 에 그렇게 잘못 빨간불이 났다. 블록 주석만 걷어낸다 — 덜 지우면
 * 잘못된 빨간불이고, 더 지우면 잘못된 초록불이다.
 */
function withoutBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "");
}

test("community reply push is a separate explicit default-off preference", async () => {
  const [control, settings] = await Promise.all([
    readFile(
      new URL("../components/settings/CommunityReplyPushPreferenceControl.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../../app/settings/index.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(settings, /CommunityReplyPushPreferenceControl/u);
  // 동의 보장은 그대로다 — 켠 사람에게만 보낸다.
  assert.match(control, /켜 두신 분에게만 보내드려요/u);
  assert.match(control, /앱 안 알림은 이 설정과 별개예요/u);

  // 오늘 못 하는 것을 약속하지 않는다.
  //
  // 예전 문구는 "앱을 닫아도 … 알려드려요" 였는데, OS 푸시를 보내는 경로가
  // 저장소에 없다 — 발송 크론이 apps/web/vercel.json 크론 목록에 없고 그
  // 부재를 community-notification-push/route.test.ts:52 가 롤아웃 승인 전까지
  // 잠가 두었다. 권한을 허용한 실기기에서는 토글이 오류 없이 켜지므로 사용자는
  // 약속만 받고 알림은 영영 못 받았다. 계약(§5 P5)이 금지하는 문장이다.
  assert.match(control, /휴대폰 알림은 아직 보내지 않고/u);
  const visible = withoutBlockComments(control);
  assert.ok(
    !/앱을 닫아도/u.test(visible),
    "발송 경로가 없는데 '앱을 닫아도' 를 약속하고 있다",
  );
  // 앱 안 알림 목록으로 대신 안내하지도 않는다 — 모바일에 그 화면이 없다.
  assert.ok(
    !/앱 안 알림 목록/u.test(visible),
    "모바일에 없는 커뮤니티 알림 목록 화면을 가리키고 있다",
  );
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
