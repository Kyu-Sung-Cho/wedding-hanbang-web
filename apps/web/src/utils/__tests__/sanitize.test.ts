import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import parse from "html-react-parser";
import { renderToStaticMarkup } from "react-dom/server";
import { validateCommunityHtmlImageSources } from "@/lib/community/mediaUrls";
import { sanitizeHtml, sanitizeText, validateTextInput } from "../sanitize";

const SAFE_TAG_NAMES = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "blockquote", "ul", "ol", "li",
  "a", "img", "figure", "figcaption", "h2", "h3", "h4", "span", "div",
]);
const SAFE_ATTRIBUTE_NAMES = new Set(["href", "src", "alt", "title", "target", "rel"]);
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function parseBrowserHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function expectSafeBrowserHtml(html: string): Document {
  const parsed = parseBrowserHtml(html);
  for (const element of Array.from(parsed.querySelectorAll("*"))) {
    if (["html", "head", "body"].includes(element.localName)) continue;
    expect(element.namespaceURI).toBe("http://www.w3.org/1999/xhtml");
    expect(SAFE_TAG_NAMES.has(element.localName), `Unexpected ${element.localName} element`).toBe(true);
    for (const attribute of Array.from(element.attributes)) {
      expect(attribute.name.startsWith("on"), `Executable ${attribute.name} attribute`).toBe(false);
      expect(SAFE_ATTRIBUTE_NAMES.has(attribute.name), `Unexpected ${attribute.name} attribute`).toBe(true);
      if (attribute.name === "href" || attribute.name === "src") {
        const resolved = new URL(attribute.value, "https://hanbang.example.test/");
        expect(SAFE_PROTOCOLS.has(resolved.protocol), `Executable ${resolved.protocol} URL`).toBe(true);
      }
    }
  }
  return parsed;
}

const XSS_VARIANTS: ReadonlyArray<readonly [name: string, input: string]> = [
  ["deeper nested malformed image tag", "<<<<b2>foo>bar>img src=x onerror=alert(1)>"],
  ["nested script tag fragments", "<scr<script>ipt>alert(1)</scr</script>ipt>"],
  ["mixed-case image and event attribute", '<ImG SrC="/image.png" OnErRoR="alert(1)">'],
  ["mixed-case script element", "<ScRiPt>alert(1)</ScRiPt>"],
  ["javascript link attribute", '<a href="javascript:alert(1)">열기</a>'],
  ["hexadecimal entity in javascript scheme", '<a href="java&#x73;cript&#x3a;alert(1)">열기</a>'],
  ["decimal entities in javascript scheme", '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">열기</a>'],
  ["named entity in javascript scheme", '<a href="javascript&colon;alert(1)">열기</a>'],
  ["entity-encoded tab in URL", '<a href="java&#x09;script:alert(1)">열기</a>'],
  ["entity-encoded newline in URL", '<a href="java&#10;script:alert(1)">열기</a>'],
  ["literal control characters in URL", '<a href="java\r\t\nscript:alert(1)">열기</a>'],
  ["leading whitespace before javascript scheme", '<a href="  javascript:alert(1)">열기</a>'],
  ["vbscript link attribute", '<a href="vbscript:msgbox(1)">열기</a>'],
  ["data HTML link attribute", '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">열기</a>'],
  ["data SVG image source", '<img src="data:image/svg+xml,%3Csvg%20onload=alert(1)%3E">'],
  ["SVG foreignObject image handler", '<svg><foreignObject><img src=x onerror="alert(1)"></foreignObject></svg>'],
  ["SVG xlink javascript URL", '<svg><a xlink:href="javascript:alert(1)"><text>열기</text></a></svg>'],
  ["MathML image handler", '<math><mtext><img src=x onerror="alert(1)"></mtext></math>'],
  ["MathML namespace mutation", '<math><mtext><mglyph><style><!--</style><img title="--><img src=1 onerror=alert(1)>">'],
  ["image error handler", '<img src="/missing.png" onerror="alert(1)">'],
  ["pointer and focus handlers", '<p onpointerover="alert(1)"><span autofocus onfocus="alert(1)">본문</span></p>'],
  ["greater-than sign inside quoted attribute", '<img title="> <img src=x onerror=alert(1)>" src="/image.png">'],
  ["duplicate image source and event attributes", '<img src="/image.png" src="javascript:alert(1)" onerror="alert(1)">'],
  ["malformed HTML comment before image handler", '<!--><img src=x onerror="alert(1)">-->'],
];

describe("sanitizeHtml", () => {
  describe("stored community XSS regression", () => {
    it("does not execute the reported payload after storage and display sanitization even when the image gate accepts it", () => {
      const payload = "<<<b2>foo>img src=x onerror=alert(1)>";
      const stored = sanitizeHtml(payload);
      const gate = validateCommunityHtmlImageSources(stored, {
        ownerIds: "11111111-1111-1111-1111-111111111111",
        supabaseUrl: "https://project.supabase.co",
      });
      expect(gate).toEqual({ ok: true });

      const rendered = sanitizeHtml(stored);
      // Vitest 전역 프록시와 분리된 문서에서 실제 인라인 이벤트 실행까지 확인한다.
      const browser = new JSDOM("<!doctype html><body></body>", { runScripts: "dangerously" });
      const alertSpy = vi.spyOn(browser.window, "alert").mockImplementation(() => undefined);
      const container = browser.window.document.createElement("div");
      browser.window.document.body.append(container);
      try {
        container.innerHTML = rendered;
        for (const image of Array.from(container.querySelectorAll("img"))) {
          image.dispatchEvent(new browser.window.Event("error"));
        }
        expect(alertSpy).not.toHaveBeenCalled();
        expectSafeBrowserHtml(rendered);
      } finally {
        container.remove();
        alertSpy.mockRestore();
        browser.window.close();
      }
    });

    it.each(XSS_VARIANTS)("keeps %s safe and stable after one, two, and three passes", (_name, input) => {
      const once = sanitizeHtml(input);
      const twice = sanitizeHtml(once);
      const threeTimes = sanitizeHtml(twice);
      expectSafeBrowserHtml(once);
      expectSafeBrowserHtml(twice);
      expectSafeBrowserHtml(threeTimes);
      expect(twice).toBe(once);
      expect(threeTimes).toBe(twice);
    });
  });

  describe("normal community content", () => {
    it("flattens excessive tag nesting without losing text or crashing React rendering", () => {
      const input = "<b>".repeat(7000) + "normal text" + "</b>".repeat(7000);
      expect(input.length).toBeLessThan(50000);
      const cleaned = sanitizeHtml(input);
      expect(() => renderToStaticMarkup(parse(cleaned))).not.toThrow();
      expect(parseBrowserHtml(cleaned).body.textContent).toBe("normal text");
      expect(sanitizeHtml(cleaned)).toBe(cleaned);
    });

    it("preserves multiline Korean text and literal escaped markup", () => {
      const input = "첫 번째 준비 기록\n\n예산 &amp; 일정은 1 &lt; 2처럼 비교했어요.\n&lt;img src=x onerror=alert(1)&gt;";
      const cleaned = sanitizeHtml(input);
      const parsed = expectSafeBrowserHtml(cleaned);
      expect(parsed.body.textContent).toBe(
        "첫 번째 준비 기록\n\n예산 & 일정은 1 < 2처럼 비교했어요.\n<img src=x onerror=alert(1)>",
      );
      expect(parsed.body.querySelector("img")).toBeNull();
      expect(sanitizeHtml(cleaned)).toBe(cleaned);
    });

    it("preserves headings, emphasis, lists, quotes, figures, owned images, and safe links", () => {
      const imageUrl = "https://project.supabase.co/storage/v1/object/public/community-images/11111111-1111-1111-1111-111111111111/33333333-3333-4333-8333-333333333333.png";
      const input = [
        '<div><h2>결혼 준비 기록</h2><h3>이번 주</h3><h4>먼저 확인한 것</h4>',
        '<p><strong>예산</strong>과 <b>일정</b>, <em>여유</em>와 <i>휴식</i><br><u>확인</u> 뒤 <s>지난 일정</s>을 정리했어요.</p>',
        '<blockquote>둘이 먼저 이야기했어요.</blockquote>',
        '<ul><li>예식장 방문</li><li>식사 확인</li></ul><ol><li>질문 모으기</li></ol>',
        `<figure><img src="${imageUrl}" alt="방문한 공간 &amp; 동선" title="예식장 기록"><figcaption>직접 본 공간</figcaption></figure>`,
        '<p><span>메모</span> <a href="https://example.com/guide?one=1&amp;two=2" target="_blank">확인한 안내</a> <a href="/community?sort=new">커뮤니티</a> <a href="#memo">메모로</a></p></div>',
      ].join("\n");
      const cleaned = sanitizeHtml(input);
      const parsed = expectSafeBrowserHtml(cleaned);
      for (const tagName of SAFE_TAG_NAMES) {
        expect(parsed.body.querySelector(tagName), `Missing ${tagName} formatting`).not.toBeNull();
      }
      expect(parsed.body.querySelector("h2")?.textContent).toBe("결혼 준비 기록");
      expect(Array.from(parsed.body.querySelectorAll("li"), (item) => item.textContent)).toEqual([
        "예식장 방문", "식사 확인", "질문 모으기",
      ]);
      expect(parsed.body.querySelector("figcaption")?.textContent).toBe("직접 본 공간");
      expect(parsed.body.querySelector("img")?.getAttribute("src")).toBe(imageUrl);
      expect(parsed.body.querySelector("img")?.getAttribute("alt")).toBe("방문한 공간 & 동선");
      const externalLink = parsed.body.querySelector("a");
      expect(externalLink?.getAttribute("href")).toBe("https://example.com/guide?one=1&two=2");
      expect(externalLink?.getAttribute("target")).toBe("_blank");
      expect(externalLink?.getAttribute("rel")?.split(/\s+/)).toEqual(expect.arrayContaining(["noopener", "noreferrer"]));
      expect(validateCommunityHtmlImageSources(cleaned, {
        ownerIds: "11111111-1111-1111-1111-111111111111",
        supabaseUrl: "https://project.supabase.co",
      })).toEqual({ ok: true });
      expect(sanitizeHtml(cleaned)).toBe(cleaned);
    });
  });

  // ─── Dangerous tag removal ───
  describe("strips dangerous tags", () => {
    it("removes <script> blocks", () => {
      expect(sanitizeHtml('<script>alert("xss")</script>')).toBe("");
    });

    it("removes self-closing <script>", () => {
      expect(sanitizeHtml('<script src="evil.js"/>')).toBe("");
    });

    it("removes <style> blocks", () => {
      expect(sanitizeHtml("<style>body{display:none}</style>")).toBe("");
    });

    it("removes <iframe> blocks", () => {
      expect(sanitizeHtml('<iframe src="http://evil.com"></iframe>')).toBe("");
    });

    it("removes <form> and <input>", () => {
      expect(sanitizeHtml('<form action="/steal"><input name="pwd"/></form>')).toBe("");
    });

    it("removes HTML comments", () => {
      expect(sanitizeHtml("<!-- sensitive comment -->")).toBe("");
    });

    it("removes nested dangerous tags inside allowed tags", () => {
      const input = '<p>Hello<script>steal()</script>World</p>';
      expect(sanitizeHtml(input)).toBe("<p>HelloWorld</p>");
    });
  });

  // ─── Allowed tags pass through ───
  describe("allows safe tags", () => {
    it.each(["p", "br", "strong", "b", "em", "i", "u", "s", "blockquote", "ul", "ol", "li", "h2", "h3", "h4", "span", "div"])(
      "passes through <%s>",
      (tag) => {
        if (tag === "br") {
          const body = parseBrowserHtml(sanitizeHtml(`<${tag}>`)).body;
          expect(body.children).toHaveLength(1);
          expect(body.firstElementChild?.localName).toBe("br");
        } else {
          expect(sanitizeHtml(`<${tag}>text</${tag}>`)).toBe(`<${tag}>text</${tag}>`);
        }
      }
    );

    it("passes through <a> with safe href", () => {
      const result = sanitizeHtml('<a href="https://example.com">link</a>');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('rel="noopener noreferrer"');
    });

    it("passes through <img> with safe src", () => {
      const result = sanitizeHtml('<img src="/images/photo.jpg" alt="photo">');
      expect(result).toContain('src="/images/photo.jpg"');
      expect(result).toContain('alt="photo"');
    });
  });

  // ─── Attribute security ───
  describe("sanitizes attributes", () => {
    it("blocks javascript: href", () => {
      const result = sanitizeHtml('<a href="javascript:alert(1)">click</a>');
      expect(result).not.toContain("javascript:");
    });

    it("blocks data: href", () => {
      const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>');
      expect(result).not.toContain("data:");
    });

    it("strips event handlers (onclick)", () => {
      const result = sanitizeHtml('<p onclick="steal()">text</p>');
      expect(result).not.toContain("onclick");
    });

    it("strips disallowed attributes (class, id, style)", () => {
      const result = sanitizeHtml('<p class="evil" id="x" style="display:none">text</p>');
      expect(result).not.toMatch(/class|id|style/);
    });

    it("escapes attribute values with quotes", () => {
      const result = sanitizeHtml('<a href="/path?a=1&b=2">link</a>');
      expect(result).toContain("&amp;");
    });

    it("adds rel=noopener noreferrer to <a> if missing", () => {
      const result = sanitizeHtml('<a href="/safe">link</a>');
      expect(result).toContain('rel="noopener noreferrer"');
    });

    it("overrides unsafe rel on target blank links", () => {
      const result = sanitizeHtml('<a href="/safe" target="_blank" rel="opener">link</a>');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('rel="noopener noreferrer"');
      expect(result).not.toContain('rel="opener"');
    });

    it("does not add href/target to non-<a> tags", () => {
      const result = sanitizeHtml('<p href="/evil">text</p>');
      expect(result).not.toContain("href");
    });
  });

  // ─── Unknown/disallowed tags ───
  describe("removes unknown tags", () => {
    it("removes <marquee>", () => {
      expect(sanitizeHtml("<marquee>text</marquee>")).toBe("text");
    });

    it("removes <table> (not in allowed list)", () => {
      expect(sanitizeHtml("<table><tr><td>data</td></tr></table>")).toBe("data");
    });
  });

  // ─── Edge cases ───
  describe("edge cases", () => {
    it("handles null/undefined input (via ?? '')", () => {
      expect(() => sanitizeHtml(null as unknown as string)).not.toThrow();
    });

    it("returns empty string for empty input", () => {
      expect(sanitizeHtml("")).toBe("");
    });

    it("preserves plain text without tags", () => {
      expect(sanitizeHtml("Hello World")).toBe("Hello World");
    });

    it("handles deeply nested allowed tags", () => {
      const input = "<div><p><strong><em>text</em></strong></p></div>";
      expect(sanitizeHtml(input)).toBe(input);
    });
  });
});

describe("sanitizeText", () => {
  it("strips all HTML tags", () => {
    expect(sanitizeText("<p>Hello <strong>World</strong></p>")).toBe("Hello World");
  });

  it("removes script tags", () => {
    expect(sanitizeText('<script>alert("x")</script>text')).toBe("text");
  });

  it("collapses whitespace", () => {
    expect(sanitizeText("Hello   World")).toBe("Hello World");
  });

  it("trims leading/trailing whitespace", () => {
    expect(sanitizeText("  hello  ")).toBe("hello");
  });

  it("handles empty input", () => {
    expect(sanitizeText("")).toBe("");
  });

  it("handles null/undefined gracefully", () => {
    expect(() => sanitizeText(null as unknown as string)).not.toThrow();
  });
});

describe("validateTextInput", () => {
  it("trims whitespace", () => {
    expect(validateTextInput("  hello  ", 100)).toBe("hello");
  });

  it("truncates to maxLength after trimming", () => {
    expect(validateTextInput("abcdef", 3)).toBe("abc");
  });

  it("returns full string when under maxLength", () => {
    expect(validateTextInput("abc", 10)).toBe("abc");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(validateTextInput("   ", 100)).toBe("");
  });

  it("handles maxLength of 0", () => {
    expect(validateTextInput("hello", 0)).toBe("");
  });
});
