import { describe, expect, it } from "vitest";

import {
  buildVendorApprovalEmail,
  buildVendorRejectionEmail,
} from "@/lib/resend";

describe("vendor email output safety", () => {
  it("removes header controls and HTML-escapes an untrusted vendor name", () => {
    const payload = buildVendorApprovalEmail(
      "owner@example.com",
      'Studio\r\nBcc: victim@example.com <a href="https://evil.example">click</a>',
    );

    expect(payload.subject).not.toMatch(/[\r\n\u0000-\u001f\u007f]/);
    expect(payload.html).not.toContain('<a href="https://evil.example">');
    expect(payload.html).toContain(
      '&lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;'
    );
  });

  it("renders a rejection reason as inert text instead of executable email markup", () => {
    const payload = buildVendorRejectionEmail(
      "owner@example.com",
      "Vendor & <b>Co</b>",
      '<img src=x onerror="alert(1)"><a href="https://phish.example">verify</a>',
    );

    expect(payload.subject).not.toMatch(/[\r\n\u0000-\u001f\u007f]/);
    expect(payload.html).toContain("Vendor &amp; &lt;b&gt;Co&lt;/b&gt;");
    expect(payload.html).not.toContain('<img src=x onerror="alert(1)">');
    expect(payload.html).not.toContain('<a href="https://phish.example">');
    expect(payload.html).toContain(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
    );
    expect(payload.html).toContain(
      '&lt;a href=&quot;https://phish.example&quot;&gt;verify&lt;/a&gt;'
    );
  });
});
