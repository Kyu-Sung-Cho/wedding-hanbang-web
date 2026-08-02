// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/(app)/bookings/page.tsx"),
  "utf8",
);

describe("booking request record copy", () => {
  it("does not present Amora internal records as confirmed vendor bookings", () => {
    expect(source).toContain("예약 요청 기록");
    expect(source).toContain("아모라 안에 남긴 방문·상담 후보 기록");
    expect(source).toContain("업체 전달·확정·취소와 환불은 업체에 별도로 확인");
    expect(source).toContain("요청 견적");
    expect(source).not.toContain(">내 예약<");
    expect(source).not.toContain("업체 방문·상담 예약 현황");
    expect(source).not.toContain("아직 예약이 없습니다");
    expect(source).toContain("확정 상태 기록(근거 미확인)");
    expect(source).not.toContain("내부 확인됨");
  });
});
