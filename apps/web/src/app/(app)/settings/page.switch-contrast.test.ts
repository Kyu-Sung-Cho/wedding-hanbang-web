import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 설정의 스위치(role="switch") 꺼짐 트랙은 컨트롤 경계라 WCAG 1.4.11 의 3:1 이 적용된다.
 * 흰 카드 위에서 옛 색은 #B5ADA3/30 이 1.24:1, #D8D1CC 가 1.51:1 이라 꺼짐이 거의 안 보였다.
 * 그 용도의 토큰이 `--color-paper-outline`(#8E8377, 흰 바탕 3.71:1)이고 클래스는 bg-paper-outline 이다.
 */
const FILES = [
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/settings/amora-memory/page.tsx",
] as const;

function switchBlocks(source: string): string[] {
  return source.match(/role="switch"[\s\S]*?<\/button>/g) ?? [];
}

describe("settings switch off-track contrast", () => {
  for (const file of FILES) {
    const source = readFileSync(resolve(process.cwd(), file), "utf8");

    it(`${file}: 스위치 블록을 정확히 하나 찾는다 (측정기가 살아 있다)`, () => {
      expect(switchBlocks(source)).toHaveLength(1);
    });

    it(`${file}: 꺼짐 트랙이 옅은 색이 아니라 bg-paper-outline 이다`, () => {
      const [block] = switchBlocks(source);
      expect(block).not.toMatch(/B5ADA3|D8D1CC/);
      expect(block).toContain("bg-paper-outline");
    });
  }
});
