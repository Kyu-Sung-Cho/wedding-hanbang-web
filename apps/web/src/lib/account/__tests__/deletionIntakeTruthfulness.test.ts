import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE,
  parseAccountDeletionIntakeCapability,
} from "../deletionIntake";

/**
 * 탈퇴 화면이 **거부할 것을 미리 말하는가.**
 *
 * ## 무엇이 있었나
 *
 * `/api/auth/delete` 는 `ACCOUNT_DELETION_INTAKE_ENABLED` 가 "true" 가 아니면
 * **인증보다 먼저** 503 을 돌려준다. 그런데 설정 화면에는 그 판정이 닿지 않아서,
 * 사용자는 탈퇴 사유를 고르고 "탈퇴합니다" 를 손으로 친 **다음에야** 거부당했다.
 *
 * 확인 문구까지 타이핑시킨 뒤 거부하는 것은 다크패턴으로 읽힌다. 게다가 탈퇴는
 * 약관 제10조가 약속한 권리다.
 *
 * ## 왜 소스를 글자로 읽나
 *
 * 이 화면은 상태가 많은 큰 클라이언트 컴포넌트라 렌더 테스트로 이 갈래까지 몰고 가려면
 * 목이 화면 자체보다 커진다. 지키려는 것은 **배선이 살아 있는가** 한 가지이므로,
 * 판정을 읽어 화면 갈래에 쓰는지만 본다.
 *
 * 단, 창을 넓게 잡으면 주변 코드를 집는다(이 저장소에서 실제로 당했다). 그래서
 * 문자열 존재가 아니라 **서로 맞물리는 이름 네 개**가 다 있는지를 본다.
 */
describe("탈퇴가 거부될 것을 미리 말한다", () => {
  const webRoot = process.cwd();
  const read = (relative: string) =>
    readFileSync(resolve(webRoot, relative), "utf8");

  const SETTINGS = "src/app/(app)/settings/page.tsx";
  const ME_ROUTE = "src/app/api/auth/me/route.ts";
  const DELETE_ROUTE = "src/app/api/auth/delete/route.ts";

  it("측정기가 살아 있다", () => {
    // 파일을 못 읽으면 아래 단언들이 조용히 통과할 수 있다. 그쪽을 먼저 막는다.
    for (const f of [SETTINGS, ME_ROUTE, DELETE_ROUTE]) {
      expect(read(f).length, `${f} 를 못 읽었습니다`).toBeGreaterThan(500);
    }
  });

  it("서버가 판정을 내려보낸다 — 화면이 자기 env 를 보지 않는다", () => {
    const me = read(ME_ROUTE);
    expect(
      me,
      "`/api/auth/me` 가 자동 탈퇴 접수 여부를 capabilities 로 내려줘야 합니다",
    ).toMatch(/ACCOUNT_DELETION_INTAKE_ENABLED/u);
    // 이름이 파일 어딘가에 있기만 하면 통과하던 판은 **잡지 못했다.**
    // 값을 만들어놓고 capabilities 에 안 넣어도 초록이었다. 반환 객체 안을 본다.
    // main 이 `capabilities` 를 `baseCapabilities` 로 쪼갠 뒤 이 검사가 정확히
    // 걸렸다 — 이름이 바뀌면 값이 안 실려도 통과하는 것을 막으려던 검사이므로
    // 그게 제 역할이다. 이름은 둘 다 받되 **객체 리터럴 안**인지는 계속 본다.
    const literal = /const (?:base)?[Cc]apabilities = \{[^}]*accountDeletionIntake[^}]*\}/u;
    expect(
      me,
      "`accountDeletionIntake` 가 capabilities 객체 안에 들어 있어야 합니다 — "
        + "변수만 만들고 안 실으면 화면은 영영 판정을 못 받습니다.",
    ).toMatch(literal);

    // 화면이 직접 env 를 읽으면 판정 주체가 둘이 되어 어긋난다.
    expect(
      read(SETTINGS),
      "화면이 ACCOUNT_DELETION_INTAKE_ENABLED 를 직접 읽고 있습니다",
    ).not.toMatch(/ACCOUNT_DELETION_INTAKE_ENABLED/u);
  });

  it("화면이 그 판정을 실제로 쓴다", () => {
    const settings = read(SETTINGS);
    for (const [what, pattern] of [
      ["판정을 읽는다", /parseAccountDeletionIntakeCapability/u],
      ["닫혔을 때 안내를 그린다", /ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE/u],
      ["열렸는지에 따라 갈라진다", /deletionIntakeOpen/u],
    ] as const) {
      expect(settings, `탈퇴 화면이 ${what} — 배선이 끊겼습니다`).toMatch(pattern);
    }
  });

  // 확인 입력과 실제 요청의 경계는 settings/page.account-deletion.test.tsx에서
  // 렌더·클릭으로 검증한다. 문자열 배선만 보던 검사는 닫힘 안내도 DELETE를
  // 전송하는 결함을 놓쳤다. 닫힘/모름은 요청 0회, 열림은 명시 확인 후만 허용한다.

  it("서버는 여전히 인증보다 먼저 막는다", () => {
    // 화면 안내는 편의일 뿐이고 진짜 경계는 서버다. 순서가 뒤집히면 안내가
    // 없는 클라이언트(앱·직접 호출)가 인증을 통과한 뒤에야 막힌다.
    const route = read(DELETE_ROUTE);
    const flagAt = route.indexOf("ACCOUNT_DELETION_INTAKE_ENABLED");
    const authAt = route.indexOf("auth.getUser()");
    expect(flagAt, "플래그 검사를 못 찾았습니다").toBeGreaterThan(-1);
    expect(authAt, "인증 호출을 못 찾았습니다").toBeGreaterThan(-1);
    expect(
      flagAt,
      "플래그 검사가 인증보다 뒤에 있습니다 — 화면의 사전 안내 전제가 깨집니다",
    ).toBeLessThan(authAt);
  });

  it("판정을 모르면 닫힌 것으로 읽는다", () => {
    // 열려 있다고 잘못 말하면 사용자가 다시 헛수고한다. 닫혔다고 잘못 말하면
    // 안내가 한 번 더 뜰 뿐이다. 이 방향의 실패가 싸다.
    expect(parseAccountDeletionIntakeCapability(undefined)).toBe(false);
    expect(parseAccountDeletionIntakeCapability(null)).toBe(false);
    expect(parseAccountDeletionIntakeCapability({})).toBe(false);
    expect(parseAccountDeletionIntakeCapability([])).toBe(false);
    expect(parseAccountDeletionIntakeCapability({ accountDeletionIntake: "true" })).toBe(false);

    expect(parseAccountDeletionIntakeCapability({ accountDeletionIntake: true })).toBe(true);
  });

  it("안내 문구가 살아 있지 않은 연락처를 단정하지 않는다", () => {
    // 안내문에 주소를 중복하지 않는다. 실제 문의 링크는 공통 CONTACT 값을 쓴다.
    expect(ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE).not.toMatch(/@/u);
    expect(ACCOUNT_DELETION_INTAKE_CLOSED_NOTICE.length).toBeGreaterThan(10);
  });
});
