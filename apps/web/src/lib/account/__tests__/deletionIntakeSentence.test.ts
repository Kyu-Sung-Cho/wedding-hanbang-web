import { afterEach, describe, expect, it } from "vitest";

import {
  accountDeletionIntakeSentence,
  isAccountDeletionIntakeOpenOnServer,
} from "@/lib/account/deletionIntake";
import { CONTACT } from "@/lib/constants/contact";

/**
 * **문장이 두 상태에서 각각 참인가.**
 *
 * 처리방침 제6조와 약관 제10조는 이제 이 함수에서 문장을 받는다(2026-09-02).
 * 그 배선은 `legalProductBoundary` 와 `accountDeletionPolicyCopy` 가 지킨다 —
 * 그런데 **배선만 보면 함수가 틀려도 초록불이다.** 여기서 함수 자체를 본다.
 *
 * 왜 이렇게 바꿨나: 접수 스위치를 켜는 순간 "현재는 고객센터로 접수받고 있으며"
 * 가 거짓 문장이 된다. 문서에 문장을 박아 두면 스위치와 고지가 따로 움직이고,
 * 어긋나는 쪽이 법적 고지라 대가가 크다.
 */
const ORIGINAL = process.env.ACCOUNT_DELETION_INTAKE_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ACCOUNT_DELETION_INTAKE_ENABLED;
  else process.env.ACCOUNT_DELETION_INTAKE_ENABLED = ORIGINAL;
});

// 주소를 여기 적으면 `contactAddressIsSingleSourced` 가 잡는다 — 연락처는
// 한 곳에서만 나와야 하고, 그 규칙은 테스트에도 똑같이 적용된다.
const SUPPORT = CONTACT.email;

describe("탈퇴 접수 문장", () => {
  it("접수가 열려 있으면 설정 페이지를 가리킨다", () => {
    process.env.ACCOUNT_DELETION_INTAKE_ENABLED = "true";
    const sentence = accountDeletionIntakeSentence(SUPPORT);
    expect(sentence).toContain("설정 페이지");
    // 열려 있는데 고객센터로 보내면 사용자가 헛수고를 한다.
    expect(sentence).not.toContain(SUPPORT);
  });

  it("접수가 닫혀 있으면 고객센터를 가리킨다", () => {
    process.env.ACCOUNT_DELETION_INTAKE_ENABLED = "false";
    const sentence = accountDeletionIntakeSentence(SUPPORT);
    expect(sentence).toContain(SUPPORT);
    // 닫혀 있는데 설정 페이지를 가리키면 눌러도 503 이 나오는 버튼을 찾아다닌다.
    expect(sentence).not.toContain("설정 페이지");
  });

  it("값이 없거나 이상하면 닫힌 것으로 본다", () => {
    // **모르면 닫힌 쪽이 싸다.** 열렸다고 잘못 말하면 헛수고를 시키고,
    // 닫혔다고 잘못 말하면 안내가 한 번 더 뜰 뿐이다.
    for (const value of [undefined, "", "TRUE", "1", "yes"]) {
      if (value === undefined) delete process.env.ACCOUNT_DELETION_INTAKE_ENABLED;
      else process.env.ACCOUNT_DELETION_INTAKE_ENABLED = value;
      expect(isAccountDeletionIntakeOpenOnServer(), `값=${String(value)}`).toBe(false);
      expect(accountDeletionIntakeSentence(SUPPORT)).toContain(SUPPORT);
    }
  });

  it("정확히 \"true\" 일 때만 열린다 — 라우트 판정과 같은 규칙", () => {
    // `/api/auth/delete` 도 `!== "true"` 로 막는다. 두 곳이 같은 규칙이어야
    // 문서와 동작이 어긋나지 않는다.
    process.env.ACCOUNT_DELETION_INTAKE_ENABLED = "true";
    expect(isAccountDeletionIntakeOpenOnServer()).toBe(true);
  });
});
