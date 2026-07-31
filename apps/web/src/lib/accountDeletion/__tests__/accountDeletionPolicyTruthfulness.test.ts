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
      expect(source).toMatch(/커뮤니티 새 파일 업로드(?:가 제한|를 막)/);
      expect(source).toContain("임시 파일 접근 링크");
      expect(source).toContain("파일 소유권");
      expect(source).toContain("지체 없이 파기");
      expect(source).toMatch(/(처리|적용) 범위(?:와|·) ?기간/);
    }
  });

  it("does not present an unimplemented legal-retention boundary as complete", () => {
    expect(privacy).not.toContain("운영 적용 전");
    expect(privacy).toContain("전용 보관 경계가 검증된 뒤");
    expect(privacy).toContain(
      "이 경계가 준비되지 않은 상태에서는 해당 보관 의무를 만드는 거래 기능을 운영하지 않습니다",
    );
  });
});
