// 아모라 앱 알림(결정 D-86)을 받았을 때와 눌렀을 때. 알림에는 내용이 없고(고정 문장 하나), 자료에는 보낸 기록 id 와
// 열 화면 이름만 든다(`@hanbang/shared/amora-push`). 그 모양이 정확히 맞을 때만 보이고 연다.
//
// 여는 화면은 홈과 아모라 대화뿐이고 둘 다 지금 로그인한 사람의 자료만 읽으므로, 커뮤니티 알림처럼 서버에 주인을
// 다시 묻지 않는다. 계정을 바꾸면 기기 토큰이 먼저 풀리므로(`pushSessionLifecycle.mjs`) 남의 알림이 오지 않는다.
import { parseAmoraPushData } from "@hanbang/shared/amora-push";

import { INVITATION_LIVE_ROUTES } from "./invitationRoutes.mjs";

const AMORA_PUSH_ROUTE_HREFS = Object.freeze({
  home: INVITATION_LIVE_ROUTES.home,
  chat: INVITATION_LIVE_ROUTES.chat,
});

export function isAmoraPushData(data) {
  return parseAmoraPushData(data) !== null;
}

/** 눌렀을 때 열 앱 주소. 모양이 틀리면 null(아무 데도 가지 않는다). */
export function amoraPushHref(data) {
  const parsed = parseAmoraPushData(data);
  return parsed ? AMORA_PUSH_ROUTE_HREFS[parsed.route] : null;
}

/** 같은 알림을 두 번 눌러도 한 번만 연다(콜드 스타트에서 마지막 응답을 다시 읽을 때). */
export function createAmoraPushTapGuard({ navigate, limit = 50 }) {
  const consumed = [];
  return {
    handleTap(data) {
      const parsed = parseAmoraPushData(data);
      if (!parsed || consumed.includes(parsed.deliveryId)) return false;
      consumed.push(parsed.deliveryId);
      if (consumed.length > limit) consumed.shift();
      navigate(AMORA_PUSH_ROUTE_HREFS[parsed.route]);
      return true;
    },
  };
}
