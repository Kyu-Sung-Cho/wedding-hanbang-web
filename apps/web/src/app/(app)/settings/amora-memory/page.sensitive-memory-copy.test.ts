import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Amora memory sensitive-data copy", () => {
  it("states what is not kept as long-term memory", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(app)/settings/amora-memory/page.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "건강·임신·난임·성생활처럼 민감한 내용은 장기 기억에 저장하지",
    );
    expect(source).toContain(
      "주민번호·계좌번호·정확한 주소·계약·예약번호는 입력하지",
    );
  });
});
