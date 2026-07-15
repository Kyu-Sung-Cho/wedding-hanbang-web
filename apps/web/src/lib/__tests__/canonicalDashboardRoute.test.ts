import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("canonical wedding dashboard route", () => {
  it("keeps the legacy dashboard as a minimal redirect to the lounge", () => {
    const source = read("apps/web/src/app/(app)/dashboard/page.tsx");

    expect(source).toContain('redirect(weddingPath("/lounge"))');
    expect(source).not.toContain("D-270 권장");
    expect(source).not.toContain("CHECKLIST_MAP");
  });
});
