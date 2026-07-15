import { describe, it, expect } from "vitest";
import { sanitizeHtml, sanitizeText, validateTextInput } from "../sanitize";

describe("sanitizeHtml", () => {
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
          expect(sanitizeHtml(`<${tag}>`)).toBe(`<${tag}>`);
        } else {
          expect(sanitizeHtml(`<${tag}>text</${tag}>`)).toBe(`<${tag}>text</${tag}>`);
        }
      }
    );

    it("keeps link text but removes legacy links", () => {
      expect(sanitizeHtml('<a href="https://example.com">link</a>')).toBe("link");
    });

    it("removes legacy images instead of loading their URL", () => {
      expect(sanitizeHtml('<img src="/images/photo.jpg" alt="photo">')).toBe("");
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

    it("removes every URL-bearing attribute even when the URL is local", () => {
      const result = sanitizeHtml('<a href="/path?a=1&b=2">link</a>');
      expect(result).toBe("link");
    });

    it("removes target and rel together with legacy links", () => {
      const result = sanitizeHtml('<a href="/safe" target="_blank" rel="opener">link</a>');
      expect(result).toBe("link");
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
