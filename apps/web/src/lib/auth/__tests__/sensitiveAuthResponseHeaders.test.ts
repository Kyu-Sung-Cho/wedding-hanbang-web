// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const nextConfig = readFileSync(resolve(process.cwd(), "next.config.ts"), "utf8");

function routeHeaderBlock(route: string): string {
  const marker = `source: "${route}"`;
  const start = nextConfig.indexOf(marker);
  if (start < 0) return "";
  const nextBlock = nextConfig.indexOf("\n      {", start + marker.length);
  return nextConfig.slice(start, nextBlock < 0 ? undefined : nextBlock);
}

describe("sensitive auth callback document headers", () => {
  it.each(["/reset-password", "/auth/mobile-callback", "/login", "/demo/login"])(
    "does not cache or forward callback secrets from %s",
    (route) => {
      const block = routeHeaderBlock(route);
      expect(block).toContain(
        '{ key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" }',
      );
      expect(block).toContain('{ key: "Pragma", value: "no-cache" }');
      expect(block).toContain('{ key: "Referrer-Policy", value: "no-referrer" }');
      expect(block).toContain(
        '{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" }',
      );
    },
  );
});
