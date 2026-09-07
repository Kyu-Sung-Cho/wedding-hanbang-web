// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ChatBubble from "../ChatBubble";
import { composeAmoraPersistenceTerminal } from "@/lib/ai/amoraPersistenceClaims";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 아모라 답변에 마크다운 원문이 **글자 그대로** 나오면 안 된다.
 *
 * ## 무엇이 있었나
 *
 * 2026-08-26 운영 실측: 8월 아모라 답변 384건 중 **27건(7%)** 에 마크다운 원문이
 * 리터럴로 찍혔고 그중 25건이 `>` 였다. `renderAiMarkdown` 이 표·헤딩·체크박스·
 * 번호·불릿만 분기하고 나머지를 '일반 라인'으로 떨어뜨려 글자 그대로 출력했다.
 *
 * 하필 **업체에 보낼 문장을 인용문으로 주는 패턴**이라, "복사해서 보내세요" 라고
 * 준 문장 앞에 `>` 가 붙어 나갔다. 아모라가 가장 잘 보여야 하는 순간이다.
 *
 * ## 왜 프롬프트가 아니라 렌더러인가
 *
 * `prompts.ts` 에는 서식 규칙이 없고 모델이 자율적으로 쓴다. 프롬프트로 금지하는
 * 방식은 지켜지지 않으면 그대로 재발하는데, 실제로 넉 달간 재발했다(월별 리터럴
 * 비율 2026-04 77.8% → 05 28.3% → 06 46.3% → 07 10.8% → 08 7.0%). 받아 주는 쪽이
 * 결정적이다.
 *
 * ## 왜 소스가 아니라 DOM 을 보나
 *
 * 소스에 분기를 넣었는지 grep 하는 방식은 "배선은 됐는데 안 도는" 상태를 통과시킨다.
 * 실제로 그려진 글자를 본다.
 */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderAi(content: string): string {
  act(() => {
    root.render(
      createElement(ChatBubble as never, {
        // 운영 코드에서 유도한 모양이다. ChatBubble 은 `sender_role === "ai"` 로
        // 갈린다(ChatBubble.tsx:630) — 다른 키를 넘기면 사람 메시지로 그려져서
        // 이 검사가 통째로 무의미해진다(처음에 그렇게 썼다가 5개가 헛돌았다).
        message: {
          id: "11111111-1111-4111-8111-111111111111",
          content,
          sender_role: "ai",
          created_at: new Date(0).toISOString(),
        },
      } as never),
    );
  });
  return container.textContent ?? "";
}

describe("마크다운 원문이 화면에 글자로 나오지 않는다", () => {
  it("renders the decimal budget table after the server removes an unverified save claim", () => {
    const result = composeAmoraPersistenceTerminal({
      text: "저장했어요.\n\n| 항목 | 비율 |\n|---|---|\n| 결혼식장 | 31.4% |\n| 신혼여행 | 22.9% |",
      hasPendingAction: false, persistenceMode: "durable", toolResults: [],
    });
    const text = renderAi(result.text);
    expect(container.querySelectorAll("table tbody tr")).toHaveLength(2);
    expect(text).toContain("31.4%");
    expect(text).toContain("22.9%");
    expect(text).not.toContain("|---|");
    expect(text).not.toContain("저장했어요");
  });

  it("인용문 표시가 사라진다 — 운영에서 실제로 나온 문장", () => {
    const text = renderAi(
      "업체에 이렇게 물어보세요.\n\n> 2026년 10월 15일 결혼식 당일 예약 가능 여부와 대관료를 알려주세요.",
    );
    expect(text).toContain("2026년 10월 15일 결혼식 당일 예약 가능 여부와 대관료를 알려주세요.");
    expect(text).not.toContain(">");
  });

  it("여러 줄 인용문도 한 덩어리로 나온다", () => {
    const text = renderAi("> 첫 줄입니다.\n> 둘째 줄입니다.");
    expect(text).toContain("첫 줄입니다.");
    expect(text).toContain("둘째 줄입니다.");
    expect(text).not.toContain(">");
  });

  it("수평선이 사라진다", () => {
    for (const rule of ["---", "***", "___"]) {
      const text = renderAi(`위 내용\n${rule}\n아래 내용`);
      expect(text, rule).toContain("위 내용");
      expect(text, rule).toContain("아래 내용");
      expect(text, rule).not.toContain(rule);
    }
  });

  it("코드펜스 표시가 사라지고 안쪽은 남는다", () => {
    const text = renderAi("예시입니다.\n```\n안쪽 내용\n```");
    expect(text).toContain("안쪽 내용");
    expect(text).not.toContain("```");
  });

  it("불릿과 인용문이 섞여도 각각 처리된다", () => {
    const text = renderAi("- 첫 항목\n- 둘째 항목\n\n> 인용된 문장");
    expect(text).toContain("첫 항목");
    expect(text).toContain("인용된 문장");
    expect(text).not.toContain(">");
    expect(text).not.toMatch(/^-\s/m);
  });
});

describe("멀쩡한 문장은 건드리지 않는다", () => {
  it("부등호가 문장 안에 있으면 인용문으로 보지 않는다", () => {
    // 줄 **처음**의 `>` 만 인용문이다. 예산 비교 같은 문장에 흔하다.
    const text = renderAi("예산이 3000만원 > 2500만원 이면 다시 봐요.");
    expect(text).toContain("3000만원 > 2500만원");
  });

  it("빼기가 있는 문장을 수평선으로 보지 않는다", () => {
    const text = renderAi("가격은 100-200만원 사이예요.");
    expect(text).toContain("100-200만원");
  });

  it("표식이 없는 답변은 그대로 나온다", () => {
    const plain = "예식장은 두 분이 함께 보러 가시는 편이 좋아요.";
    expect(renderAi(plain)).toContain(plain);
  });
});
