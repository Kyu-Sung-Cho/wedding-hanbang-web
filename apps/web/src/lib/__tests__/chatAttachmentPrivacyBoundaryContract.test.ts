import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Amora attachment privacy boundary", () => {
  it("wires sanitized image bytes and their real MIME into provider attachments", () => {
    const route = read("src/app/api/chat/route.ts");

    expect(route).toMatch(
      /import \{\s*sanitizeProviderImage,\s*type ChatImageMediaType,\s*\} from "@\/lib\/chat\/providerImageSanitization"/,
    );
    expect(route).toContain("const sanitizedImage = await sanitizeProviderImage({");
    expect(route).toContain('base64: sanitizedImage.buffer.toString("base64")');
    expect(route).toContain("mediaType: sanitizedImage.mediaType");
    expect(route).toContain("totalAttachmentBytes += sanitizedImage.byteLength");
    expect(route).not.toMatch(/visionAttachments\.push\(\{\s*base64,\s*mediaType: item\.mediaType/);
  });

  it("tells users exactly when files leave the service boundary and how images are sanitized", () => {
    const notice = read("src/components/app/chat/AttachmentPrivacyNotice.tsx");
    const privacy = read("src/app/privacy/page.tsx");

    expect(notice).toContain("첨부 파일은 답변 생성을 위해 OpenAI로 전송됩니다.");
    expect(notice).toContain("현재 첨부는 이미지와 PDF만 지원합니다.");
    expect(notice).toContain("주민번호·계좌·연락처는 가리고 올려주세요.");
    expect(notice).toContain("이미지 위치정보 등 메타데이터는 서버에서 제거합니다.");
    expect(privacy).toContain("첨부 이미지는 OpenAI 전송 전에 서버에서 방향을 적용해 재인코딩하며 EXIF·GPS 등");
    expect(privacy).toContain("PDF는 이미지 재인코딩 대상이 아니므로");
    expect(privacy).toContain("각 첨부 상담에서 현재 전송 안내의 체크박스를 직접 확인한 경우에만 OpenAI 요청을");
  });

  it("requires the same explicit privacy confirmation in both chat composers", () => {
    const mainChat = read("src/components/app/chat/ChatContent.tsx");
    const sideChat = read("src/components/app/chat/ChatSidePanel.tsx");
    const notice = read("src/components/app/chat/AttachmentPrivacyNotice.tsx");

    expect(mainChat).toContain("<AttachmentPrivacyNotice");
    expect(sideChat).toContain("<AttachmentPrivacyNotice");
    expect(notice).toContain("첨부 파일은 답변 생성을 위해 OpenAI로 전송됩니다.");
    expect(notice).toContain("PDF의 내용과 속성은 자동 제거되지 않습니다.");
    expect(notice).toContain("민감정보를 가렸고 OpenAI 전송 범위를 확인했습니다.");

    for (const chat of [mainChat, sideChat]) {
      expect(chat).toContain('import { attachmentProviderConsentVersion } from "@hanbang/shared";');
      expect(chat).toContain("attachmentProviderConsentVersion: attachmentPrivacyConfirmed");
      expect(chat).toContain("attachments.length > 0 && !attachmentPrivacyConfirmed");
      expect(chat).toContain("이 문서에서 확인할 항목과 업체에 물어볼 질문을 뽑아주세요.");
      expect(chat).toContain("이 이미지에서 읽을 수 있는 내용만 바탕으로 확인할 항목과 질문을 뽑아주세요.");
      expect(chat).not.toContain("이 문서를 분석해주세요.");
      expect(chat).not.toContain("이 이미지를 분석해주세요.");
      expect(chat).toContain('if (isDemo || messageTarget !== "ai") return;');
      expect(chat).not.toContain("DOCX");
      expect(chat).not.toContain(".docx");
      expect(chat).not.toContain("FileSpreadsheet");
    }

    expect(sideChat).toContain('if (messageTarget !== "ai") return;');
    expect(sideChat).toContain("disabled={attachments.length > 0}");
    expect(sideChat).toContain("if (isDemo) return;");
  });

  it("physically removes DOCX parsing from the attachment surface", () => {
    const route = read("src/app/api/chat/route.ts");
    const mainChat = read("src/components/app/chat/ChatContent.tsx");
    const sideChat = read("src/components/app/chat/ChatSidePanel.tsx");
    const packageJson = read("package.json");

    for (const source of [route, mainChat, sideChat, packageJson]) {
      expect(source).not.toMatch(/DOCX|\.docx|mammoth|jszip/i);
    }
  });

  it("keeps the side-panel promise within implemented planning support", () => {
    const sideChat = read("src/components/app/chat/ChatSidePanel.tsx");

    expect(sideChat).toContain("계약서·일정·예산 정리 질문…");
    expect(sideChat).toContain("실시간 업체·장소 검색이나 예약은 제공하지 않아요.");
    expect(sideChat).not.toContain("무엇이든 물어보세요");
  });
});
