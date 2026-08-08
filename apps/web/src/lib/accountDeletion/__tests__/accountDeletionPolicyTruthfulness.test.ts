import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readWebSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("account-deletion public policy truthfulness", () => {
  const terms = readWebSource("src/app/terms/page.tsx");
  const privacy = readWebSource("src/app/privacy/page.tsx");

  it("does not promise synchronous deletion or invent a five-year AI-log rule", () => {
    expect(terms).not.toMatch(/탈퇴[^<]{0,80}즉시\s*(삭제|파기)/);
    expect(privacy).not.toMatch(/탈퇴[^<]{0,80}즉시\s*(삭제|파기)/);
    expect(terms).not.toContain("모든 상호작용 기록은 관련 법령에 따라 5년간 보관");
  });

  it("discloses the implemented staged deletion boundary consistently", () => {
    for (const source of [terms, privacy]) {
      expect(source).toContain("커뮤니티 새 파일 업로드가 제한");
      expect(source).toContain("임시 접근 링크");
      expect(source).toContain("파일 소유권");
      expect(source).toContain("지체 없이 파기");
      expect(source).toMatch(/적용 범위.{0,5}기간/);
    }
  });

  it("does not present an unimplemented legal-retention boundary as complete", () => {
    expect(terms).not.toContain("다른 개인정보와 분리하여 보관합니다");
    expect(privacy).not.toContain("다른 개인정보와 분리하여 보관합니다");
    expect(privacy).not.toContain("운영 적용 전");
    expect(privacy).toContain("전용 보관 경계가 검증된 뒤");
  });

  it("describes the deletion route users actually get while intake is gated", () => {
    // 방침은 "탈퇴는 설정 페이지에서 직접 처리할 수 있습니다"라고 적고 있었는데,
    // 운영에서 DELETE /api/auth/delete는 503 ACCOUNT_DELETION_INTAKE_DISABLED를
    // 돌려준다(실측). 방침이 약속한 권리 행사 방법이 동작하지 않는 상태였다.
    const route = readWebSource("src/app/api/auth/delete/route.ts");
    const gated = route.includes('process.env.ACCOUNT_DELETION_INTAKE_ENABLED !== "true"');

    if (gated) {
      // 게이트가 살아 있는 동안에는 "직접 처리된다"고 말하지 않는다. 설정에서
      // 신청하는 흐름 자체는 끝까지 있으므로 "신청할 수 있다"는 그대로 둔다.
      expect(privacy, "게이트가 켜져 있는데 방침이 직접 처리를 약속한다")
        .not.toContain("탈퇴는 설정 페이지에서 직접 처리할 수 있습니다");
      expect(privacy, "막힌 경로만 안내하고 실제로 되는 경로를 알려주지 않는다")
        .toMatch(/탈퇴[\s\S]{0,200}support@hanbang\.ai/u);
    } else {
      // 게이트가 사라지면 자동 접수가 열린 것이다 — 그때는 "준비 중" 서술이
      // 거짓이 되므로 이 테스트가 먼저 깨져서 방침을 되돌리게 한다.
      expect(privacy, "자동 접수가 열렸는데 방침이 아직 준비 중이라고 말한다")
        .not.toContain("자동 접수는 준비 중");
    }
  });

  it("discloses the phone number it actually stores", () => {
    // 저장하면서 고지하지 않고 있었다. 같은 문서 제4조는 이미 "연락처"를 파트너에
    // 제공한다고 적어 두어, 수집 고지 없이 제공만 고지된 상태였다.
    const profileRoute = readWebSource("src/app/api/profile/route.ts");
    const storesPhone = profileRoute.includes("p_phone");

    if (storesPhone) {
      expect(privacy, "휴대폰 번호를 저장하는데 수집 항목에 없다")
        .toContain("휴대폰 번호");
    }
  });
});
