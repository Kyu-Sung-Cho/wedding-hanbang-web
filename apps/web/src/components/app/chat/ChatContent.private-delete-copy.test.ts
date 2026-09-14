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

  it("warns that personal to-dos saved from the private lane are deleted with it", () => {
    // `hard_delete_current_user_private_chat` 은 비공개 레인의 chat_messages 를 지우고,
    // amora_personal_actions.source_message_id 가 그 행을 ON DELETE CASCADE 로 참조한다
    // (supabase/migrations/20260906151956_amora_personal_actions_owner_boundary.sql).
    // 즉 이 버튼은 그 대화에서 저장한 개인 할 일도 함께 지운다 — 2026-09-14 까지 화면이
    // 그 사실을 말하지 않았다. 파일 어딘가가 아니라 **그 선택지의 설명 안에** 있어야 한다.
    const optionStart = chatSource.indexOf('performClear("delete_private")');
    expect(optionStart).toBeGreaterThan(-1);
    const optionEnd = chatSource.indexOf("</button>", optionStart);
    expect(optionEnd).toBeGreaterThan(optionStart);
    const option = chatSource.slice(optionStart, optionEnd);

    expect(option).toContain("아모라가 만든 요약·기억을 삭제");
    expect(option).toContain("이 비공개 대화에서 저장한 개인 할 일도 함께 삭제됩니다.");
  });
});
