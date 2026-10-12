// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacyPage from "../page";
import { AMORA_TEXT_DRAFT_RECOVERY_TTL_MS } from "@/lib/chat/textDraftRecoveryStorage";

function notice(): string {
  const markup = renderToStaticMarkup(<PrivacyPage />);
  const paragraph = markup.match(/<li>아모라 미전송 초안 복구[\s\S]*?<\/li>/u)?.[0];
  expect(paragraph, "새 임시 보관 방식이 실제 처리방침에 표시돼야 한다").toBeDefined();
  return (paragraph ?? "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ");
}

describe("아모라 초안 복구의 실제 개인정보 고지", () => {
  it("보관 항목과 같은 탭의 임시 저장소를 사용자에게 설명한다", () => {
    const text = notice();
    expect(text).toContain("미전송 텍스트와 재시도 식별자");
    expect(text).toContain("계정·커플·역할·파트너 식별정보");
    expect(text).toContain("현재 탭의 임시 저장소(sessionStorage)");
  });

  it("복구 제한을 물리적인 자동 파기 보장으로 과장하지 않는다", () => {
    const text = notice();
    expect(text).toContain(`${AMORA_TEXT_DRAFT_RECOVERY_TTL_MS / 60_000}분 이내`);
    expect(text).toContain("기한이 지난 초안은 불러오지 않지만");
    expect(text).toContain("임시 저장소에 남아 있을 수 있습니다");
    expect(text).toContain("로그아웃");
    expect(text).toContain("사이트 데이터를 지울 수 있습니다");
  });

  it("안전 분류·첨부·별도 전달 맥락 제외와 자동 공유하지 않음을 설명한다", () => {
    const text = notice();
    expect(text).toContain("안전 상담으로 분류된 글");
    expect(text).toContain("첨부 파일이나 별도 기능의 전달 맥락");
    expect(text).toContain("자동 전송·파트너 공유·서버 기억 저장은 하지 않습니다");
  });
});
