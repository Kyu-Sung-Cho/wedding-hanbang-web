// 릴리스 매니페스트가 모르게 바뀌지 않았는지 잰다. 2026-09-27 전에는 매니페스트를
// 고치면 Vercel 서명도 함께 고쳐야 한다는 것을 잊지 못하게 하는 검사였다.
//
// ## 2026-09-27: 운영 빌드 펜스 은퇴 뒤의 뜻
//
// 파운더 승인으로 next.config.ts 가 펜스를 더 이상 부르지 않는다. 그래서 아래 2번
// (Vercel 서명 교체)은 이제 필요 없고, 서명 값 자체도 운영 배포 확인 뒤 Vercel 에서
// 지운다. 이 검사는 매니페스트 파일이 모르게 바뀌지 않았는지만 잰다(출시 도구가 이
// 파일을 읽는다). 아래 기록은 은퇴 전 사정이다.
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
import { require as tsxRequire } from "tsx/cjs/api";

// CI의 Node 22에서도 제품 함수를 그대로 실행하도록 명시적으로 TS 로더를 쓴다.
const { expectedProductionAuthorizationSha256 } = tsxRequire(
  "../../apps/web/vendorDisclosureProductionBuildFence.ts",
  import.meta.url,
);

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

/**
 * 지금 매니페스트의 sha256. **Vercel Production 환경변수와 같은 값이어야 한다.**
 *
 * 이 값을 바꾸는 커밋은 반드시 Vercel 서명 교체와 짝이다. 짝 없이 바꾸면 그 순간부터
 * 프로덕션 배포가 전부 막히고, 사이트는 직전 빌드를 계속 서비스해서 멀쩡해 보인다.
 *
 * 2026-09-07 후속 로컬 수정안: 검토한 이름별 예산 배분 SQL 1개를 추가 등록한 기대값이다.
 * 기존 8개 실행 매니페스트는 그대로이며, 이번 SQL은 별도 214→215 경로로 검증한다.
 * 새 서명의 운영 환경변수 교체는 아직 미완료다. 교체·후보 빌드와 별도 DB 적용 검증을
 * 구분해서 기록하며, 전역 deployment_blocked 및 누락 증거 5종은 그대로 유지한다.
 *
 * 2026-09-02: `20260902120000_leaving_does_not_erase_the_partner_memory.sql` 을
 * 등록하면서 다시 바뀌었다(한 사람이 떠나도 배우자 기억이 남게 하는 트리거).
 * 2026-08-27: `20260827090000_move_card_can_name_what_it_moves.sql` 을 등록하면서
 * 바뀌었다. Vercel Production 의 `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 도
 * 같은 값으로 함께 바꿨다.
 *
 * 2026-08-26: `20260826120000_anon_sees_only_public_authors.sql` 을 등록하면서
 * 바뀌었다. Vercel Production 의 `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 도
 * 같은 값으로 함께 바꿨다.
 *
 * 2026-08-23: `20260823120000_couple_approval_becomes_notification.sql` 을 등록하면서
 * 바뀌었다. Vercel Production 의 `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 도
 * 같은 값으로 **함께** 바꿨다(값을 되읽을 수 없으므로 덮어쓰기 한 번이 전부다).
 * 이 커밋을 포함한 프로덕션 배포가 Ready 가 되면 두 값이 같다는 것이 증명된다 —
 * 펜스는 next build 앞에서 정확히 일치할 때만 통과하기 때문이다.
 */
const EXPECTED_SIGNATURE =
  "9fdf97e91ca6e53ac19394443d452061f635d1f05cfceff50483fa3d3cc5f3e7";

test("측정기가 살아 있다", () => {
  const actual = expectedProductionAuthorizationSha256(repoRoot);
  assert.match(actual, /^[0-9a-f]{64}$/, `sha256 모양이 아닙니다: ${actual}`);
});

test("매니페스트 서명이 핀과 같다", () => {
  const actual = expectedProductionAuthorizationSha256(repoRoot);

  assert.equal(
    actual,
    EXPECTED_SIGNATURE,
    [
      "",
      "릴리스 매니페스트가 바뀌었습니다. 의도한 변경이면",
      "",
      `  이 파일의 EXPECTED_SIGNATURE 를 ${actual} 로 바꾼다`,
      "",
      "2026-09-27 에 운영 빌드 펜스를 은퇴시켰으므로 Vercel 서명 교체는 더 이상 필요 없습니다.",
      "",
    ].join("\n"),
  );
});
