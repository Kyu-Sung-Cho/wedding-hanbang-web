// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeHtmlWithInputLimit,
  sanitizeText,
  validateTextInput,
} from "../sanitize";

const ALLOWED_RENDERED_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "u", "s", "blockquote",
  "ul", "ol", "li", "a", "img", "figure", "figcaption", "h2",
  "h3", "h4", "span", "div",
]);

const ACTIVE_CONTENT_SELECTOR = [
  "script", "style", "iframe", "object", "embed", "form", "input",
  "svg", "math", "template", "noscript", "xmp", "noembed", "noframes",
  "meta", "link", "base",
].join(",");

function assertSafeAfterBrowserParsing(html: string): void {
  let candidate = html;

  // A second parse catches mutation-XSS where the first DOM serialization
  // changes namespace or raw-text boundaries into active markup.
  for (let pass = 0; pass < 2; pass += 1) {
    const document = new DOMParser().parseFromString("", "text/html");
    const root = document.createElement("div");
    root.innerHTML = candidate;
    document.body.append(root);

    expect(root.querySelector(ACTIVE_CONTENT_SELECTOR)).toBeNull();

    for (const element of root.querySelectorAll("*")) {
      const tagName = element.tagName.toLowerCase();
      expect(ALLOWED_RENDERED_TAGS.has(tagName)).toBe(true);
      expect(element.namespaceURI).toBe("http://www.w3.org/1999/xhtml");

      const allowedAttributes = tagName === "a"
        ? new Set(["href", "alt", "title", "target", "rel"])
        : tagName === "img"
          ? new Set(["src", "alt", "title"])
          : new Set(["alt", "title"]);

      for (const attributeName of element.getAttributeNames()) {
        expect(attributeName.toLowerCase()).not.toMatch(/^on/);
        expect(allowedAttributes.has(attributeName.toLowerCase())).toBe(true);
      }

      if (tagName === "a") {
        const anchor = element as HTMLAnchorElement;
        expect(anchor.rel).toBe("noopener noreferrer nofollow ugc");
        const href = anchor.getAttribute("href");
        if (href) expect(href).not.toMatch(/^(?:data|javascript|vbscript):/i);
      }

      if (tagName === "img") {
        const src = (element as HTMLImageElement).getAttribute("src");
        if (src?.startsWith("/")) {
          expect(new URL(src, "https://hanbang.ai/").origin).toBe("https://hanbang.ai");
        }
      }
    }

    candidate = root.innerHTML;
  }
}

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
          expect(sanitizeHtml(`<${tag}>`)).toBe(`<${tag} />`);
        } else {
          expect(sanitizeHtml(`<${tag}>text</${tag}>`)).toBe(`<${tag}>text</${tag}>`);
        }
      }
    );

    it("passes through <a> with safe href", () => {
      const result = sanitizeHtml('<a href="https://example.com">link</a>');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('rel="noopener noreferrer nofollow ugc"');
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
      expect(result).toContain('rel="noopener noreferrer nofollow ugc"');
    });

    it("overrides unsafe rel on target blank links", () => {
      const result = sanitizeHtml('<a href="/safe" target="_blank" rel="opener">link</a>');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('rel="noopener noreferrer nofollow ugc"');
      expect(result).not.toContain('rel="opener"');
    });

    it.each(["_parent", "_top", "named-window"])("drops unsafe target=%s", (target) => {
      const result = sanitizeHtml(`<a href="/safe" target="${target}">link</a>`);
      const document = new DOMParser().parseFromString(result, "text/html");

      expect(document.querySelector("a")?.hasAttribute("target")).toBe(false);
    });

    it.each(["_blank", "_self"])("keeps safe target=%s", (target) => {
      const result = sanitizeHtml(`<a href="/safe" target="${target}">link</a>`);
      const document = new DOMParser().parseFromString(result, "text/html");

      expect(document.querySelector("a")?.target).toBe(target);
      expect(document.querySelector("a")?.rel).toBe("noopener noreferrer nofollow ugc");
    });

    it("removes every duplicate rel before adding the trusted value", () => {
      const result = sanitizeHtml(
        '<a href="https://attacker.example" target="_blank" rel="noreferrer" rel="opener">link</a>'
      );
      const document = new DOMParser().parseFromString(result, "text/html");
      const anchor = document.querySelector("a");

      expect(result.match(/\srel=/g)).toHaveLength(1);
      expect(anchor?.rel).toBe("noopener noreferrer nofollow ugc");
      expect(anchor?.relList.contains("opener")).toBe(false);
    });

    it("canonicalizes duplicate src values to one browser-visible attribute", () => {
      const result = sanitizeHtml(
        '<img src="/images/first.png" src="/images/second.png" alt="photo">'
      );
      const document = new DOMParser().parseFromString(result, "text/html");
      const source = document.querySelector("img")?.getAttribute("src");

      expect(result.match(/\ssrc=/g)).toHaveLength(1);
      expect(["/images/first.png", "/images/second.png"]).toContain(source);
    });

    it.each([
      ["protocol-relative", "//attacker.example/collect"],
      ["backslash-normalized", "/\\attacker.example/collect"],
      ["entity-normalized", "/&#47;attacker.example/collect"],
    ])("blocks %s image tracking URLs", (_label, source) => {
      const result = sanitizeHtml(`<img src="${source}" alt="photo">`);
      const document = new DOMParser().parseFromString(result, "text/html");

      expect(document.querySelector("img")?.hasAttribute("src")).toBe(false);
      assertSafeAfterBrowserParsing(result);
    });

    it("is idempotent and preserves link URL semantics across storage and rendering", () => {
      const raw = '<a href="https://example.com/?a=1&b=2" target="_blank">link</a>';
      const stored = sanitizeHtml(raw);
      const rendered = sanitizeHtml(stored);
      const document = new DOMParser().parseFromString(rendered, "text/html");

      expect(rendered).toBe(stored);
      expect(document.querySelector("a")?.getAttribute("href")).toBe(
        "https://example.com/?a=1&b=2"
      );
      assertSafeAfterBrowserParsing(rendered);
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
    it.each([
      // DOMPurify's public browser regression corpus and GHSA-v2wj-7wpq-c8vv
      // cover these raw-text, namespace-confusion, and mutation-XSS shapes.
      '<img src=x id/=\' onerror=alert(1)//\'>',
      '<textarea>@user</textarea><!--</textarea><img src=x onerror=alert(1)>-->',
      '<b><noscript><!-- </noscript><img src=x onerror=alert(1) --></noscript>',
      '<b><noscript><a alt="</noscript><img src=x onerror=alert(1)>"></noscript>',
      '<body><template><s><template><s><img src=x onerror=alert(1)>x</s></template></s></template>',
      '<a href="\u0001java\u0003script:alert(1)">x</a>',
      '\u0001<option><style></option></select><b><img src=x onerror=alert(1)></style></option>',
      '<option><iframe></select><b><script>alert(1)</script>',
      '<b><style><style////><img src=x onerror=alert(1)></style>',
      '<svg></p><title><a id="</title><img src=x onerror=alert(1)>"></textarea></svg>',
      '<math></p><textarea><mi><style></textarea><img src=x onerror=alert(1)></mi></math>',
      '<svg></p><title><template><style></title><img src=x onerror=alert(1)>',
      '<math></br><textarea><mtext><template><style></textarea><img src=x onerror=alert(1)>',
      '<svg></p><math><title><style><img src=x onerror=alert(1)></style></title>',
      '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
      '<svg><p><style><g title="</style><img src=x onerror=alert(1)>">',
      '<svg><foreignobject><p><style><p title="</style><iframe onload&#x3d;alert(1)<!--"></style>',
      '<math><annotation-xml encoding="text/html"><p><style><p title="</style><iframe onload&#x3d;alert(1)<!--"></style>',
      '<xmp><svg><b><style><b title=\'</style><img src=# onerror=alert(1)>\'>',
      '<noembed><svg><b><style><b title=\'</style><img src=# onerror=alert(1)>\'>',
      '<noframes><a title="</noframes><img src=# onerror=alert(1)>">',
      '<form><math><mtext></form><form><mglyph><style><img src=x onerror=alert(1)>',
      '<math><mtext><table><mglyph><style><math href=javascript:alert(1)>CLICKME</math>',
      '<form><math><mtext></form><form><mglyph><svg><mtext><style><path id="</style><img onerror=alert(1) src>">',
      'a<svg><xss><desc><noscript>&lt;/noscript>&lt;/desc>&lt;s>&lt/s>&lt;style>&lt;a title="&lt;/style>&lt;img src onerror=alert(1)>">',
      '<math><mtext><option><FAKEFAKE><option></option><mglyph><svg><mtext><style><a title="</style><img src=\'#\' onerror=\'alert(1)\'>">',
    ])("does not revive active content after browser parser mutation", (input) => {
      const result = sanitizeHtml(input);

      expect(sanitizeHtml(result)).toBe(result);
      assertSafeAfterBrowserParsing(result);
    });

    it("limits raw input before parsing so truncation cannot split sanitized markup", () => {
      const input = [
        '<p title="safe & sound">hello</p>',
        '<a href="/safe?a=1&b=2" target="_blank">link</a>',
        '<img src="/images/photo.jpg" alt="photo & caption">',
        '<svg><style><img src=x onerror=alert(1)></style></svg>',
      ].join("");

      for (let limit = 0; limit <= input.length; limit += 1) {
        const result = sanitizeHtmlWithInputLimit(input, limit);
        expect(sanitizeHtml(result)).toBe(result);
        assertSafeAfterBrowserParsing(result);
      }

      expect(sanitizeHtmlWithInputLimit(input, -1)).toBe("");
    });

    it("handles null/undefined input (via ?? '')", () => {
      expect(() => sanitizeHtml(null as unknown as string)).not.toThrow();
      expect(sanitizeHtmlWithInputLimit({ content: "not a string" }, 100)).toBe("");
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
