// 청첩장 홈 맨 아래 "서비스 메뉴" 줄. 2026-11-20 파운더 결정 4(부모 세션 질문 "앱 업데이트 전 결정 둘(서비스 메뉴 줄,
// 뒤로 가기)을 권하는 대로 할까요?"에 파운더 답 "권하는 대로"). 들어갈 것은 웨딩코드·견적 확인·예산·체크리스트·예절
// 가이드 다섯이고, 커뮤니티는 웹처럼 넣지 않으며, 웹 줄의 일정·설정은 파운더께 여쭌 목록에 없어 넣지 않는다.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { HOME_SERVICE_MENU, HOME_SERVICE_MENU_LABEL } from "../lib/homeServiceMenu.mjs";

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
const WEB_ROUTES = "../../../web/src/components/invitation/live/liveRoutes.ts";

/** 앱 주소 → 같은 화면을 여는 웹 주소. */
const WEB_PATH_FOR = Object.freeze({
  "/budget": "/budget",
  "/checklist": "/checklist",
  "/wedding-code": "/preparation-style",
  "/quote-check": "/community/quote-check",
  "/etiquette": "/manners",
});

function webMoreLinks() {
  const source = read(WEB_ROUTES);
  const start = source.indexOf("export const LIVE_MORE_LINKS");
  const block = source.slice(start, source.indexOf("];", start));
  return [...block.matchAll(/\{ path: "([^"]+)", label: "([^"]+)" \}/gu)].map(([, path, label]) => ({ path, label }));
}

test("다섯 칸뿐이다. 일정·설정·커뮤니티는 없다", () => {
  assert.deepEqual(HOME_SERVICE_MENU.map((item) => item.href), Object.keys(WEB_PATH_FOR));
  for (const item of HOME_SERVICE_MENU) {
    for (const absent of ["일정", "설정", "커뮤니티"]) assert.equal(item.label.includes(absent), false, `${item.label}: ${absent}`);
  }
});

test("이름과 순서, 줄 이름이 웹 청첩장 홈 맨 아래 줄과 같다", () => {
  const web = webMoreLinks();
  assert.ok(web.length >= 7, "웹 줄을 읽지 못했다");
  const shared = new Set(Object.values(WEB_PATH_FOR));
  assert.deepEqual(
    HOME_SERVICE_MENU.map((item) => ({ path: WEB_PATH_FOR[item.href], label: item.label })),
    web.filter((link) => shared.has(link.path)),
  );
  assert.equal(HOME_SERVICE_MENU_LABEL, read(WEB_ROUTES).match(/LIVE_MORE_LINKS_LABEL = "([^"]+)"/u)?.[1]);
});

test("다섯 주소는 앱에 있는 화면이다", () => {
  for (const { href } of HOME_SERVICE_MENU) {
    assert.ok(existsSync(new URL(`../../app${href}/index.tsx`, import.meta.url)), href);
  }
});

test("로그인한 커플의 홈(라운지)만 맨 아래에 이 줄을 달고, 예시 커플은 달지 않는다", () => {
  assert.match(
    code("../../app/(tabs)/lounge.tsx"),
    // 앞의 \s 는 data-footer= 같은 다른 이름을 걸러 낸다(prove-guard 로 깨뜨려 보다 찾은 구멍).
    /\sfooter=\{\s*<InvitationServiceMenu\s+label=\{HOME_SERVICE_MENU_LABEL\}\s+items=\{HOME_SERVICE_MENU\}\s+onOpen=\{\(href\) => router\.push\(href\)\}/u,
  );
  const home = code("../components/invitation/InvitationHome.tsx");
  const decisionsAt = home.indexOf("HOME_COPY.decisionsHeading");
  const footerAt = home.indexOf("{footer}");
  assert.ok(decisionsAt > -1 && footerAt > decisionsAt, "홈의 맨 아래(두 분이 정할 것 뒤)에 온다");
  assert.ok(footerAt < home.indexOf("</ScrollView>"), "스크롤 안에 있다");
  // 예시 커플 홈은 app/example/index.tsx 가 그린다(예시 스택의 나머지 화면은 ExampleCouple.tsx).
  for (const example of ["../../app/example/index.tsx", "../components/invitation/ExampleCouple.tsx"]) {
    assert.match(code(example), /InvitationHome|Invitation[A-Z]/u, `${example}: 예시 화면을 읽지 못했다`);
    assert.doesNotMatch(code(example), /InvitationServiceMenu|footer=/u, example);
  }
});

test("한 칸은 높이 44px 링크이고, 줄은 이름이 있는 길잡이다", () => {
  const menu = code("../components/invitation/InvitationServiceMenu.tsx");
  assert.match(menu, /accessibilityRole="link"/u);
  assert.match(menu, /minHeight: 44/u);
  assert.match(menu, /role="navigation" aria-label=\{label\}/u);
  assert.match(menu, /flexWrap: "wrap"/u);
});
