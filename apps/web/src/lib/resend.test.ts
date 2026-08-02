import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: mocks.send };
  },
}));

import {
  sendPreregistrationConfirmationEmail,
  sendVendorApprovalEmail,
  sendVendorRejectionEmail,
} from "./resend";

describe("transactional email content safety", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hanbang.ai");
    vi.stubEnv("NODE_ENV", "production");
    mocks.send.mockReset().mockResolvedValue({ id: "mail-id" });
  });

  it("sends a scanner-safe preregistration confirmation link only after validating its origin", async () => {
    mocks.send.mockResolvedValue({ data: { id: "mail-id" }, error: null });
    const token = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
    expect(token).toHaveLength(43);
    const link = `https://hanbang.ai/preregister/confirm#token=${token}`;

    await expect(sendPreregistrationConfirmationEmail(
      "person@example.com",
      link,
    )).resolves.toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com",
      html: expect.stringContaining(`href="${link}"`),
    }));

    await expect(sendPreregistrationConfirmationEmail(
      "person@example.com",
      `https://attacker.example/preregister/confirm#token=${token}`,
    )).resolves.toBe(false);
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("treats provider ambiguity as a failed delivery", async () => {
    const token = "Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE";
    mocks.send.mockResolvedValue({ data: null, error: null });
    await expect(sendPreregistrationConfirmationEmail(
      "person@example.com",
      `https://hanbang.ai/preregister/confirm#token=${token}`,
    )).resolves.toBe(false);
  });

  it("escapes untrusted values before placing them in HTML", async () => {
    await sendVendorApprovalEmail(
      "vendor@example.com",
      'Bad Vendor<img src="https://evil.invalid/pixel">',
    );
    await sendVendorRejectionEmail(
      "vendor@example.com",
      'Bad Vendor<a href="https://evil.invalid">click</a>',
      '<a href="https://evil.invalid/phish">open</a>\nnext',
    );

    const sentHtml = mocks.send.mock.calls.map(([message]) => String(message.html));
    expect(sentHtml).toHaveLength(2);
    expect(sentHtml.join("\n")).not.toContain('<img src="https://evil.invalid');
    expect(sentHtml.join("\n")).not.toContain('<a href="https://evil.invalid');
    expect(sentHtml.join("\n")).toContain("&lt;img");
    expect(sentHtml.join("\n")).toContain("&lt;a href=&quot;https://evil.invalid");
    expect(sentHtml[1]).toContain("&lt;/a&gt;<br>next");
  });

  it("removes header controls from vendor names used in subjects", async () => {
    await sendVendorApprovalEmail(
      "vendor@example.com",
      "Vendor\r\nBcc: victim@example.com\u0000",
    );

    const subject = String(mocks.send.mock.calls[0]?.[0]?.subject);
    expect(subject).not.toMatch(/[\r\n\u0000-\u001f\u007f]/);
    expect(subject).toContain("Vendor Bcc: victim@example.com");
  });
});
