import { EXAMPLE_PHOTO_KEYS, type InvitationRouteKey } from "@hanbang/shared/invitation";

import { weddingPath } from "@/lib/weddingPaths";

import { defaultInvitationPhotoSrc } from "../invitationScreen";

/**
 * 실제 커플 화면의 주소(2026-11-17 파운더 디자인 아티팩트). 화면은 이름(`InvitationRouteKey`)으로만
 * 이동하고 여기서 앱 주소가 된다. 예시 커플은 `app/example/exampleRoutes.ts` 가 같은 일을 한다.
 */
export const LIVE_PATHS: Readonly<Record<InvitationRouteKey, string>> = {
  home: "/lounge",
  chat: "/chat",
  journey: "/journey",
  compare: "/halls",
  letter: "/halls/letter",
  status: "/halls/consultation",
};

/**
 * 하단 메뉴의 "일정" 칸. 예시 커플은 상담 확정 화면을 열지만(아티팩트 흐름) 실제 커플은 일정 화면을 연다.
 * 상담 확정 화면은 소식과 할 일의 링크가 연다.
 */
export const LIVE_SCHEDULE_PATH = "/schedule";

/** 앱 안 링크 주소(`/wedding/...`). 다른 앱 화면의 링크와 같은 꼴이다. */
export function liveRoute(key: InvitationRouteKey): string {
  return weddingPath(LIVE_PATHS[key]);
}

/**
 * 첫 대화(조건 묻기)를 다시 여는 표시. 홈의 "희망 시기와 지역 알려 주기"와 웨딩홀 비교의 "조건 알려 주기"가
 * 붙여 보낸다. 첫 대화를 "나중에 할게요"로 건너뛰었어도 이 표시가 있으면 연다(앱의 `?conditions=1` 과 같다).
 */
export const LIVE_CONDITIONS_PARAM = "conditions";

/** 첫 대화를 다시 여는 주소(`/wedding/lounge?conditions=1`). */
export function liveConditionsHref(): string {
  return weddingPath(`${LIVE_PATHS.home}?${LIVE_CONDITIONS_PARAM}=1`);
}

const SURFACES: ReadonlySet<string> = new Set(Object.values(LIVE_PATHS));

/** 앱 틀이 새 디자인으로 그리는 화면인가. `pathname` 은 `/wedding` 을 뗀 앱 주소다. */
export function isInvitationSurfacePath(appPathname: string): boolean {
  const normalized = appPathname.length > 1 ? appPathname.replace(/\/+$/, "") : appPathname;
  return SURFACES.has(normalized);
}

const EXAMPLE_KEYS: ReadonlySet<string> = new Set(EXAMPLE_PHOTO_KEYS);

/**
 * 사진 값을 그릴 주소로 바꾼다. 실제 웨딩홀 사진은 https 주소이고, 예시 커플(체험)은 사진 이름이다.
 * 둘 다 아니면 그리지 않는다.
 */
export function livePhotoSrc(photo: string): string | null {
  if (EXAMPLE_KEYS.has(photo)) return `/images/amora/${photo}.webp`;
  return defaultInvitationPhotoSrc(photo);
}

/**
 * 새 화면에서 옛 화면(예산·체크리스트·일정·웨딩코드·견적 확인·예절 가이드·설정)으로 가는 링크. 옛 사이드바·
 * 상단 바와 옛 라운지의 바로가기를 걷어 낸 자리라, 이 화면들은 여기서 연다. 이름은 각 화면 제목이고, 견적 확인은
 * 옛 라운지 링크("견적 확인 도구 열기")의 이름 부분이다.
 */
export const LIVE_MORE_LINKS: readonly { path: string; label: string }[] = [
  { path: "/schedule", label: "일정" },
  { path: "/budget", label: "예산" },
  { path: "/checklist", label: "웨딩 체크리스트" },
  // 2026-11-22: '웨딩코드'(→ 준비 스타일)를 뺐고(2026-11-21 파운더 결정), 견적 확인은 커뮤니티 밖 새 주소로 옮겼다.
  // 앱 홈 서비스 메뉴(`apps/mobile/src/lib/homeServiceMenu.mjs`)도 같은 커밋에서 맞춘다.
  { path: "/quote-check", label: "견적 확인 도구" },
  { path: "/manners", label: "예절 가이드" },
  { path: "/settings", label: "설정" },
];

/** 옛 사이드바의 메뉴 이름. 같은 일을 하는 링크 묶음이라 같은 이름을 쓴다. */
export const LIVE_MORE_LINKS_LABEL = "서비스 메뉴";
