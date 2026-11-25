import { describe, expect, it } from "vitest";
import { buildCareEmailSubject, buildCareEmailHtml } from "../careEmail";

describe("케어 이메일 빌더", () => {
  it("셀 종류별 제목 — 카톡 첫 줄 톤", () => {
    // 2026-11-13 P2: 화면·메일 문장 규칙(줄표 금지, 18장 D-12)에 맞춰 바꿨다. 받침에 따라
    // 갈리는 "이에요/예요"를 피하려고 일정 이름 뒤에 쉼표를 둔다. 파운더가 문구를 정한다.
    expect(buildCareEmailSubject({ momentLabel: "청첩장 모임", cellKind: "d3" })).toBe(
      "청첩장 모임 사흘 전이에요. 아모라가 미리 챙겨 왔어요"
    );
    expect(buildCareEmailSubject({ momentLabel: "상견례", cellKind: "d1" })).toBe(
      "상견례, 내일이에요. 나가기 전에 함께 확인해요"
    );
    for (const cellKind of ["d3", "d1", "dAfter"] as const) {
      expect(buildCareEmailSubject({ momentLabel: "한쪽 가족에게 첫인사", cellKind })).not.toMatch(/—|–/);
    }
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
