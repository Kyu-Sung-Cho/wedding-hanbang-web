import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("PriceAmoraBridge login boundary", () => {
  it("explains the demo and signed-in destinations without a blanket no-save promise", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/components/price/PriceAmoraBridge.tsx"),
      "utf8",
    );

    expect(source).toContain("로그인 전에는");
    expect(source).toContain("체험 대화와 변경은 계정 기록에 남지 않아요");
    expect(source).toContain("이미 로그인했다면 계정 채팅에서 이어져요");
    expect(source).toContain('label="아모라에게 물어보기"');
    expect(source).not.toContain("나눈 이야기는 저장되지 않아요");
    expect(source).not.toContain('label="가입 없이 아모라 체험하기"');
  });
});
