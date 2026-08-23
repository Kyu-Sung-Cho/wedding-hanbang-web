// 릴리스 매니페스트를 고치면 **Vercel 서명도 함께 고쳐야 한다**는 것을 잊지 못하게 한다.
//
// ## 무엇이 있었나
//
// `vendorDisclosureProductionBuildFence` 는 `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION`
// 환경변수가 릴리스 매니페스트 파일의 sha256 과 **정확히** 같을 것을 요구한다. 다르면
// 프로덕션 빌드가 `next build` 전에 죽는다.
//
// 그런데 그 게이트는 `VERCEL_ENV === "production"` 일 때만 돈다. 로컬·CI·Preview 는
// 전부 통과한다. 그리고 빌드가 죽어도 **직전 배포가 계속 서비스되기 때문에 사이트는
// 멀쩡해 보인다.** 매니페스트만 고치고 서명을 안 바꾸면, 벤더 공시와 아무 상관 없는
// 변경까지 그때부터 아무도 배포하지 못하는데 며칠 뒤에야 안다.
//
// 2026-08-21 에 이 저장소에서 실제로 일어났다(약 2시간).
//
// ## 이 검사가 하는 일
//
// 매니페스트의 현재 sha256 을 저장소에 **핀으로 박아 둔다.** 매니페스트가 바뀌면 이
// 검사가 실패하면서 **새 값을 알려준다.** 그때 두 가지를 같이 하면 된다:
//
//   1. 아래 `EXPECTED_SIGNATURE` 를 새 값으로 바꾼다
//   2. Vercel Production 의 `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 을 같은 값으로 바꾼다
//
// 2번은 소유자만 할 수 있다(Sensitive 라 값을 되읽을 수 없다). 이 검사는 2번을 대신
// 해줄 수 없다 — **잊지 못하게** 할 뿐이고, 그게 이 실패 모양에는 충분하다.
//
// ## 왜 계산식을 여기 다시 적지 않나
//
// 펜스가 쓰는 함수를 그대로 불러 쓴다. 해시 방식(개행 정규화)을 여기 베껴 적으면
// 한쪽만 바뀌었을 때 이 검사가 **틀린 값을 알려주는** 더 나쁜 상태가 된다.

import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { expectedProductionAuthorizationSha256 } from "../../apps/web/vendorDisclosureProductionBuildFence.ts";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * 지금 매니페스트의 sha256. **Vercel Production 환경변수와 같은 값이어야 한다.**
 *
 * 이 값을 바꾸는 커밋은 반드시 Vercel 서명 교체와 짝이다. 짝 없이 바꾸면 그 순간부터
 * 프로덕션 배포가 전부 막히고, 사이트는 직전 빌드를 계속 서비스해서 멀쩡해 보인다.
 *
 * 마지막 확인: 2026-08-23 (마이그레이션 93건).
 *
 * 2026-08-23: `20260823120000_couple_approval_becomes_notification.sql` 을 등록하면서
 * 바뀌었다. Vercel Production 의 `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 도
 * 같은 값으로 **함께** 바꿨다(값을 되읽을 수 없으므로 덮어쓰기 한 번이 전부다).
 * 이 커밋을 포함한 프로덕션 배포가 Ready 가 되면 두 값이 같다는 것이 증명된다 —
 * 펜스는 next build 앞에서 정확히 일치할 때만 통과하기 때문이다.
 */
const EXPECTED_SIGNATURE =
  "313b92853c26301f61bd0890b180df575ad0177b0fe6c1eec9af93d101155ba9";

test("측정기가 살아 있다", () => {
  const actual = expectedProductionAuthorizationSha256(repoRoot);
  assert.match(actual, /^[0-9a-f]{64}$/, `sha256 모양이 아닙니다: ${actual}`);
});

test("매니페스트 서명이 핀과 같다 — 다르면 Vercel 도 함께 바꿔야 한다", () => {
  const actual = expectedProductionAuthorizationSha256(repoRoot);

  assert.equal(
    actual,
    EXPECTED_SIGNATURE,
    [
      "",
      "릴리스 매니페스트가 바뀌었습니다. 두 가지를 **같이** 해야 합니다:",
      "",
      `  1. 이 파일의 EXPECTED_SIGNATURE 를 ${actual} 로 바꾼다`,
      "  2. Vercel Production 의 VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION 을 같은 값으로 바꾼다",
      "     (소유자만 가능 — Sensitive 라 값을 되읽을 수 없다)",
      "",
      "1번만 하면 프로덕션 빌드가 next build 전에 죽습니다. 그런데 직전 배포가 계속",
      "서비스되기 때문에 사이트는 멀쩡해 보이고, 며칠 뒤에야 압니다.",
      "",
    ].join("\n"),
  );
});
