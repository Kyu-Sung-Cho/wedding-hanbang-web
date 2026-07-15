import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SettingsResourceLinks from "@/components/app/settings/SettingsResourceLinks";

describe("SettingsResourceLinks", () => {
  it("opens the published terms, privacy, and support pages instead of claiming they are unfinished", () => {
    const html = renderToStaticMarkup(<SettingsResourceLinks />);

    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/support"');
    expect(html).not.toContain("준비 중");
  });
});
