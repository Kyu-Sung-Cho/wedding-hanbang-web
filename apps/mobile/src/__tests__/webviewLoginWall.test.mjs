import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";

/**
 * 웹뷰가 앱 사용자를 로그인 벽으로 데려가지 않는가.
 *
 * 웹뷰에는 앱의 세션이 없다 — 쿠키를 넘기지 않는다. 그래서 웹 페이지 안의 링크를 따라
 * 로그인 필요 경로로 들어가면 **이미 로그인한 앱 사용자가 웹 로그인 폼을 만난다.**
 * 실측으로 확인한 자리: 예절 안내 첫 화면의 주 CTA가 `/wedding/checklist`이고,
 * 그 주소는 `/login?redirect=…`으로 튕긴다(2026-08-20 프로덕션).
 *
 * 같은 화면이 앱에 네이티브로 있으므로 거기로 넘긴다.
 */
const source = readFileSync(
  fileURLToPath(new URL("../../app/webview.tsx", import.meta.url)),
  "utf8",
);

test("로그인 필요한 웹 경로를 네이티브 화면으로 넘긴다", () => {
  assert.match(source, /nativeRouteForWebPath/);
  // 넘기기로 한 곳은 앱에 실제 화면이 있어야 한다.
  for (const route of ["checklist", "budget", "schedule", "settings", "bookings", "vendors", "chat"]) {
    assert.match(source, new RegExp(`${route}: "/`), `${route} 대응이 없다`);
  }
});

test("공개 페이지는 가로채지 않는다", () => {
  // /price·/start-here·/demo·/manners는 로그인이 필요 없다. 막으면 읽을 것을 못 읽는다.
  for (const publicPath of ["price", "start-here", "demo", "manners"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`"${publicPath}": "/`),
      `${publicPath}는 웹뷰에서 그대로 열려야 한다`,
    );
  }
});

test("예절 안내는 편 안으로 들어가도 제목이 나온다", () => {
  // 제목 map은 경로의 마지막 조각으로 찾는다. /wedding/manners/cost-saving은
  // 조각이 cost-saving이라 안 걸리므로 prefix로 봐야 한다.
  assert.match(source, /manners\(/);
  assert.match(source, /결혼 예절 안내/);
});

test("불러오지 못하면 다시 시도할 자리를 준다", () => {
  assert.match(source, /onError=/);
  assert.match(source, /onHttpError=/);
  assert.match(source, /다시 시도/);
  // 실패했는데 스피너만 꺼지고 끝나면 플랫폼 기본 에러 화면이 남는다.
  assert.match(source, /setLoadFailed\(true\)/);
});
