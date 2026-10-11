// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ChatBubble from "../ChatBubble";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

function render(content: string, sender_role: "ai" | "bride" = "ai") {
  act(() => root.render(createElement(ChatBubble, { isCurrentUser: false, message: {
    id: "11111111-1111-4111-8111-111111111111", content, sender_role,
    couple_id: "22222222-2222-4222-8222-222222222222", sender_id: null,
    metadata: null, visibility: "shared",
    created_at: new Date(0).toISOString(),
  } })));
}

describe("아모라의 정보 안내는 클릭 가능한 출처로 표시한다", () => {
  it("안내한 자료명을 외부 페이지로 여는 안전한 하이퍼링크로 렌더링한다", () => {
    render("자세한 내용은 [계약 체크 자료](https://example.com/guide?category=wedding#refund)를 확인하세요.");
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("계약 체크 자료");
    expect(link?.getAttribute("href")).toBe("https://example.com/guide?category=wedding#refund");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toContain("noopener");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
    expect(container.textContent).not.toContain("](");
  });

  it("기존 답변의 주소만 적힌 안내도 문장부호를 제외한 클릭 가능한 링크로 표시한다", () => {
    render("자료는 https://example.com/guide?year=2026#refund 에 있습니다.\n주소: https://example.com/price.");
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/guide?year=2026#refund", "https://example.com/price",
    ]);
    expect(container.textContent).toContain("https://example.com/price.");
  });

  it("괄호가 있는 상세 주소와 굵은 자료명도 원문 링크를 잃지 않는다", () => {
    render("- [**자료 상세**](https://example.com/guide_(wedding)?q=1)\n**[공개 가격](/price?region=seoul)**");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/guide_(wedding)?q=1", "/price?region=seoul",
    ]);
    expect(links[0].textContent).toBe("자료 상세");
    expect(links[0].querySelector("strong")?.textContent).toBe("자료 상세");
    expect(links[1].getAttribute("target")).toBeNull();
  });

  it("표·인용·체크 항목 안의 자료 안내도 모두 클릭 가능하며 사용자 원문은 바꾸지 않는다", () => {
    const content = "| 자료 | 주소 |\n|---|---|\n| 확인 자료 | [원문](https://example.com/guide) |\n\n> [추가 정보](https://example.com/info)\n- [ ] [공개 가격](/price)";
    render(content);
    expect(container.querySelectorAll("a")).toHaveLength(3);
    expect(container.querySelector("table a")?.textContent).toBe("원문");
    render(content, "bride");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("[원문](https://example.com/guide)");
  });

  it.each([
    "[클릭](javascript:alert(1))", "[클릭](data:text/html,hi)", "[클릭](//example.com)",
    "[클릭](https://owner:secret@example.com/info)", "[클릭](https://example.com/%0Aevil)",
    "[클릭](/api/auth/logout)", "[클릭](/price/../admin)", "![사진](https://example.com/track.png)",
    "![자료 [사진]](https://example.com/track.png)", "[[자료]](https://example.com/info)",
    "`[자료](https://example.com/info)`", "```\nhttps://example.com/info\n```",
  ])("위험한 주소·이미지·코드 예시는 실행 링크로 만들지 않는다: %s", (content) => {
    render(content);
    expect(container.querySelectorAll("a, img, iframe, script")).toHaveLength(0);
  });

  it.each(["[자료](https://example.com/source", "![사진](https://example.com/track.png", "[   ](https://example.com/info)"])("닫히지 않은 링크·이미지에는 부분 주소를 활성화하지 않고 빈 링크 이름도 만들지 않는다: %s", (content) => {
    render(content);
    if (content.startsWith("[   ]")) expect(container.querySelector("a")?.textContent).toBe("https://example.com/info");
    else expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it.each(["~~~\nhttps://example.com/info\n~~~", "````\n```\nhttps://example.com/info\n````"])("코드 펜스 안의 링크는 예시로만 남는다: %s", (content) => {
    render(content);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelector("pre")?.textContent).toContain("https://example.com/info");
  });

  it("여러 줄의 잘못된 링크에서 주소 일부를 실행 링크로 만들지 않는다", () => {
    render("[자료](\nhttps://example.com/info\n)\n\n다음 안내: [자료](https://example.com/next)");
    const links = [...container.querySelectorAll("a")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["https://example.com/next"]);
    expect(container.textContent).toContain("https://example.com/info");
  });

  it("정상 링크 뒤에 여러 줄 불완전 링크가 있어도 정상 링크만 실행 가능하다", () => {
    render("[정상](https://example.com/ok) [다음](\nhttps://example.com/partial\n)");
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/ok"]);
  });

  it("인용문 첫 안내 뒤의 여러 줄 불완전 링크는 부분 주소를 활성화하지 않는다", () => {
    render("> 첫 안내\n> [자료](\n> https://example.com/partial\n> )\n\n[다음 자료](https://example.com/next)");
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/next"]);
    expect(container.textContent).toContain("[자료](https://example.com/partial)");
  });

  it("같은 인용문 안에서 이어지는 불완전 링크도 닫힐 때까지 실행하지 않는다", () => {
    render("> 첫 안내\n> [첫](\n> ) [다음](\n> - https://example.com/second\n> )\n\n[정상](https://example.com/next)");
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/next"]);
    expect(container.textContent).toContain("[첫]() [다음](- https://example.com/second)");
  });

  it.each(["", "!"])("지원 범위를 넘는 자료명은 원문으로 남기되 앞뒤의 정상 링크는 유지한다: %s", (prefix) => {
    const source = `${prefix}[${"a".repeat(2100)}](https://example.com/image.png)`;
    render(`[앞](https://example.com/before) ${source} [뒤](https://example.com/next)`);
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/before", "https://example.com/next",
    ]);
    expect(container.textContent).toContain(source);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("인용문 안의 코드 펜스는 주소 예시를 활성화하지 않고 뒤의 정상 자료는 유지한다", () => {
    render("> 코드 예시\n> ```\n> https://example.com/only-example\n> ```\n> [실제 자료](https://example.com/source)");
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/source"]);
    expect(container.textContent).toContain("```https://example.com/only-example```");
  });

  it("표 행의 불완전 링크가 다음 목록으로 이어져도 부분 주소를 활성화하지 않는다", () => {
    render("| 자료 | 내용 |\n|---|---|\n| [자료]( | 메모 |\n- https://example.com/partial\n)\n\n[다음 자료](https://example.com/next)");
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/next"]);
    expect(container.textContent).toContain("| [자료]( | 메모 |- https://example.com/partial)");
  });

  it.each(["", "> 첫 안내\n> "])("불완전 링크를 닫은 줄에서 새 불완전 링크가 시작되어도 부분 주소를 활성화하지 않는다: %s", (introduction) => {
    const malformed = "[첫](\n) [다음](\n- https://example.com/second\n)";
    render(`${introduction}${malformed}\n\n[정상](https://example.com/next)`);
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/next"]);
    expect(container.textContent).toContain(malformed.replaceAll("\n", ""));
  });

  it.each([
    "[자료](\n\nhttps://example.com/partial\n)",
    "> 첫 안내\n> [자료](\n>\n> https://example.com/partial\n> )",
  ])("불완전 링크 중간의 빈 줄은 부분 주소를 다시 활성화하지 않는다: %s", (malformed) => {
    render(`${malformed}\n\n[정상](https://example.com/next)`);
    expect([...container.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["https://example.com/next"]);
    expect(container.textContent).toContain("[자료](https://example.com/partial)");
  });

  it("표 안의 출처 URL 구분 문자는 열로 잘라 주소를 바꾸지 않는다", () => {
    render("| 자료 | 내용 |\n|---|---|\n| [원문](https://example.com/info?q=a|b) | 설명 |");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/info?q=a|b");
    expect(container.querySelectorAll("tbody td")).toHaveLength(2);
  });

  it.each([
    "![사진|설명](https://example.com/image.png)",
    "![자료 [사진]|설명](https://example.com/image.png)",
  ])("표 안의 이미지 자료명 구분 문자는 원문을 잘라 부분 주소를 활성화하지 않는다: %s", (source) => {
    render(`| 자료 | 내용 |\n|---|---|\n| ${source} | 메모 |`);
    expect(container.querySelectorAll("a, img")).toHaveLength(0);
    expect(container.querySelectorAll("tbody td")).toHaveLength(2);
    expect(container.textContent).toContain(source);
  });
});
