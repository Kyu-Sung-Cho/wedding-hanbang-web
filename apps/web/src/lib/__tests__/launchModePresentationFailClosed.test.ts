import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const PRESENTATION_BOUNDARIES = [
  "src/app/beta/BetaForm.tsx",
  "src/app/robots.ts",
  "src/app/sitemap.ts",
  "src/components/app/etiquette/EtiquetteClient.tsx",
  "src/components/customer-landing/CustomerNav.tsx",
  "src/components/landing/Footer.tsx",
] as const;

describe("launch-mode presentation boundary", () => {
  it.each(PRESENTATION_BOUNDARIES)(
    "%s treats every mode except explicit full as closed",
    (path) => {
      const source = read(path);

      expect(source).toContain('process.env.NEXT_PUBLIC_LAUNCH_MODE !== "full"');
      expect(source).not.toContain(
        'process.env.NEXT_PUBLIC_LAUNCH_MODE === "coming_soon"',
      );
    },
  );
});
