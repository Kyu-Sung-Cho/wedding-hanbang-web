import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const chatSource = readFileSync(
  join(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
  "utf8",
);
const privacySource = readFileSync(
  join(process.cwd(), "src/app/privacy/page.tsx"),
  "utf8",
);

describe("private chat deletion copy", () => {
  it("describes the implemented deletion boundary without promising universal erasure", () => {
    expect(chatSource).not.toContain("DB에서 완전히 삭제");
    expect(chatSource).toContain("비공개 대화·아모라 기억 삭제");
    expect(chatSource).toContain("아모라가 만든 요약·기억을 삭제");
    expect(chatSource).toContain("법적/보안 로그·백업");

    expect(privacySource).toContain("비공개 대화 삭제를 선택하면");
    expect(privacySource).toContain("아모라가 자동 생성한 요약·기억을 삭제");
    expect(privacySource).toContain("법적·보안 목적의 운영 기록과 백업");
  });
});
