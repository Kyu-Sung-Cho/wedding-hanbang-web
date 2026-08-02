import { describe, expect, it } from "vitest";
import {
  buildCareEmailSubject,
  buildCareEmailHtml,
  getCareEmailSiteOrigin,
} from "../careEmail";

describe("care email security boundary", () => {
  it("removes header controls from user-derived subject text", () => {
    const subject = buildCareEmailSubject({
      momentLabel: "상담\r\nBcc: attacker@example.com",
      cellKind: "d1",
    });

    expect(subject).not.toMatch(/[\r\n]/u);
    expect(subject).toContain("상담 Bcc: attacker@example.com");
  });

  it("uses only approved production origins in email HTML", () => {
    expect(getCareEmailSiteOrigin("https://www.hanbang.ai")).toBe("https://www.hanbang.ai");
    expect(getCareEmailSiteOrigin("https://evil.test/\" onerror=\"alert(1)")).toBe("https://hanbang.ai");
    expect(getCareEmailSiteOrigin("http://hanbang.ai")).toBe("https://hanbang.ai");
  });
});

describe("케어 이메일 빌더 (친언니 아웃바운드)", () => {
  it("셀 종류별 제목 — 카톡 첫 줄 톤", () => {
    expect(buildCareEmailSubject({ momentLabel: "청첩장 모임", cellKind: "d3" })).toBe(
      "청첩장 모임 3일 전이에요 — 아모라가 미리 챙겨왔어요"
    );
    expect(buildCareEmailSubject({ momentLabel: "상견례", cellKind: "d1" })).toBe(
      "내일 상견례! 나가기 전 30초 체크"
    );
    expect(buildCareEmailSubject({ momentLabel: "청첩장 모임", cellKind: "dAfter" })).toBe(
      "청첩장 모임 어땠어요? 아모라가 궁금해서요"
    );
  });

  it("본문에 셀 메시지가 그대로 담기고 HTML은 이스케이프된다", () => {
    const html = buildCareEmailHtml({
      recipientName: "지은 <script>",
      cell: {
        momentLabel: "상견례",
        cellKind: "dAfter",
        message: "상견례 어땠어?\n혹시 <메뉴> 얘기 나왔어?",
      },
    });
    expect(html).toContain("상견례 어땠어?");
    expect(html).toContain("&lt;메뉴&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("지은 &lt;script&gt;님,");
    // 수신 거부 안내 필수 (신뢰 원칙)
    expect(html).toContain("설정 &gt; 알림");
    // 채팅 딥링크 CTA
    expect(html).toContain("/chat");
  });

  it("이름 없으면 일반 인사", () => {
    const html = buildCareEmailHtml({
      recipientName: null,
      cell: { momentLabel: "본식", cellKind: "d3", message: "메시지" },
    });
    expect(html).toContain("안녕하세요,");
  });
});
