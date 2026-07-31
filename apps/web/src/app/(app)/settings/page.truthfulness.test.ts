import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("settings demo persistence copy", () => {
  it("does not promise immediate persistence while demo mode is active", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/(app)/settings/page.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'isDemo\n                  ? "체험에서는 저장되지 않아요"',
    );
    expect(source).toContain(': "선택하면 바로 저장돼요"');
  });
});
