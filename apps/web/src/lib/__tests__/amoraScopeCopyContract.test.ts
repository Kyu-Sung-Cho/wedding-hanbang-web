import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Amora public capability copy", () => {
  it("does not promise arbitrary search, recommendation, or booking", () => {
    const web = read("src/components/app/chat/ChatContent.tsx");
    const mobile = read("../mobile/app/(tabs)/chat.tsx");

    expect(web).not.toContain("무엇이든 물어보세요");
    expect(web).toContain("계약서·공식 시세·일정 정리");
    expect(mobile).not.toContain("결혼 준비를 무엇이든");
    expect(mobile).not.toContain("스드메 평균 가격이 얼마야?");
    expect(mobile).toContain("공식 조사 스드메 가격의 조사월과 범위");
    expect(mobile).toContain("실시간 업체·장소 검색이나 예약은 제공하지 않아요");
  });
});
