// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(process.cwd());
const startHerePage = readFileSync(
  resolve(appRoot, "src/app/start-here/page.tsx"),
  "utf8",
);

describe("start-here focused public shell", () => {
  it("lives outside the community layout and owns one clear main landmark", () => {
    expect(
      existsSync(resolve(appRoot, "src/app/(community)/start-here/page.tsx")),
    ).toBe(false);
    expect(startHerePage).not.toContain("CommunityNav");
    expect(startHerePage).not.toContain("CommunityAuthInitializer");
    expect(startHerePage).not.toContain("CommunityAmoraLauncher");
    expect(startHerePage.match(/<main\b/g)).toHaveLength(1);
    expect(startHerePage).toContain('id="start-here-main"');
  });

  it("states the local date boundary without an unbounded free claim", () => {
    expect(startHerePage).toContain("날짜는 이 화면에서 서버로 보내지 않습니다");
    expect(startHerePage).not.toContain("모든 기능 무료");
    expect(startHerePage).not.toContain("평생 무료");
  });
});
