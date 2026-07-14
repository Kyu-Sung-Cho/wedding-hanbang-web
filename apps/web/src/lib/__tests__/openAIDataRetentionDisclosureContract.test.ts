import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(join(process.cwd(), relativePath), "utf8");

const privacyPage = readSource("src/app/privacy/page.tsx");
const streamingClient = readSource("src/lib/ai/openai.ts");
const auditedClient = readSource("src/lib/ai/auditedOpenAI.ts");
const runtimeSources = readdirSync(join(process.cwd(), "src"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name))
  .map((entry) =>
    readFileSync(join(entry.parentPath, entry.name), "utf8")
  );

describe("OpenAI data-retention disclosure", () => {
  it("does not present store:false or cache settings as Zero Data Retention", () => {
    expect(privacyPage).toContain("Zero Data Retention");
    expect(privacyPage).toContain("최대 30일");
    expect(privacyPage).toContain("최대 24시간");
    expect(privacyPage).toContain("운영 조직·프로젝트 설정에서 별도로 확인");
    expect(privacyPage).not.toContain(
      "질문·첨부·대화 원문을 프롬프트 캐시에 쓰지 않도록"
    );
  });

  it("disables implicit breakpoints without silently adding explicit ones", () => {
    const explicitBreakpointKey = ["prompt", "cache", "breakpoint"].join("_");
    for (const source of [streamingClient, auditedClient]) {
      expect(source).toContain('prompt_cache_options: { mode: "explicit" }');
      expect(source).not.toContain(explicitBreakpointKey);
      expect(source).toContain("store: false");
    }
    expect(runtimeSources.every((source) => !source.includes(explicitBreakpointKey)))
      .toBe(true);
  });
});
