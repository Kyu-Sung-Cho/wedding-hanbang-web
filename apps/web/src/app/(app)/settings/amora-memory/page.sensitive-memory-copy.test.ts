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

  it("offers a scoped Amora-memory JSON download without presenting it as a full account export", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(app)/settings/amora-memory/page.tsx"),
      "utf8",
    );

    expect(source).toContain('fetch("/api/amora/memory?export=memory"');
    expect(source).toContain("response.blob()");
    expect(source).toContain("URL.createObjectURL(blob)");
    expect(source).toContain('anchor.download = `amora-memory-${');
    expect(source).toContain("URL.revokeObjectURL(url)");
    expect(source).toContain("현재 계정에서 볼 수 있는 아모라 기억만 JSON으로 내려받아요.");
    expect(source).toContain("채팅 원문·일정·예산은 포함하지 않아요.");
    expect(source).not.toContain("전체 계정 데이터 내보내기");
  });
});
