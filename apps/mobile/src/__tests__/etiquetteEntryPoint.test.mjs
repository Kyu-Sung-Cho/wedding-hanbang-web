import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

/**
 * 앱에서 결혼 예절 안내로 들어가는 문이 있는가, 그리고 그 문이 살아 있는 주소를 여는가.
 *
 * 이 메뉴는 2026-07-26에 지워진 적이 있다. 이유는 기능이 나빠서가 아니라 **가리키던
 * 주소가 사라져 404 웹뷰를 열고 있어서**였다. 안내 25편이 복구되면서 다시 넣었으므로,
 * 같은 방식으로 다시 죽지 않게 목적지를 여기에 못박는다.
 */
const source = (relative) =>
  readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

const screen = source("app/etiquette/index.tsx");
const profile = source("app/(tabs)/profile.tsx");

test("프로필에 예절 안내로 가는 메뉴가 있다", () => {
  assert.match(profile, /label="결혼 예절 안내"/);
  assert.match(profile, /pathname: "\/etiquette"/);
});

test("살아 있는 주소를 연다", () => {
  // `/manners`는 307로 한 번 튄다. 웹뷰에서는 바로 도착하는 주소를 쓴다.
  assert.match(screen, /\/wedding\/manners/);
  assert.doesNotMatch(
    screen,
    /hanbang\.ai\/etiquette|\$\{SITE\}\/etiquette/,
    "예전에 404였던 주소를 다시 가리키면 안 된다",
  );
});

test("주소를 인코딩해서 넘긴다", () => {
  // webview 화면은 url 쿼리로 받는다. 인코딩하지 않으면 뒤가 잘린다.
  assert.match(screen, /encodeURIComponent/);
});

test("배포 환경에 따라 주소가 갈린다", () => {
  // 개발 빌드가 프로덕션 문서를 열지 않도록 사이트 주소는 환경변수를 먼저 본다.
  assert.match(screen, /EXPO_PUBLIC_SITE_URL/);
});
