import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("retired congratulatory-money trust boundary", () => {
  it("explains why the product no longer collects third-party ledger data", () => {
    const unavailable = read("src/components/app/PublicBetaUnavailable.tsx");

    expect(unavailable).toContain("제3자의 실명·관계·금액");
    expect(unavailable).toContain("새 기록을 받지 않습니다");
    expect(unavailable).not.toMatch(/적정 축의금|축의금 권장|예절 평균|보통 이 정도/);
  });

  it("keeps the privacy policy truthful about legacy data while removing CSV promises", () => {
    const privacy = read("src/app/privacy/page.tsx");

    expect(privacy).toContain("축의금 관리 기능은 종료되어 새 정보를 수집하지 않습니다");
    expect(privacy).not.toContain("축의금 CSV 내보내기");
  });

  it("does not invite third-party ledger photos or identities into Amora memory", () => {
    const moments = read("src/constants/moments.ts");

    expect(moments).toContain("아모라는 제3자의 이름·관계·금액이나 장부 사진을 받지 않아");
    expect(moments).not.toContain("축의금 장부 사진만 찍어둬");
    expect(moments).not.toContain("감사 인사 대상으로 기억해둘게");
    expect(moments).not.toMatch(/"thanks_list"|"settlement_note"/);
  });
});
