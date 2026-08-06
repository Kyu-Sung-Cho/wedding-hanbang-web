// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 헤드라인 카피 이중 사본 방지.
 *
 * `landingContent.ts`는 카피 정본이지만, 컴포넌트는 줄바꿈·색 강조를 위해 헤드라인을
 * 여러 `<span>`으로 쪼개 하드코딩한다. 두 사본이 갈리면 정본만 읽고 인계받는 사람이
 * 화면에 없는 문장을 현재 카피로 오인한다. 실제로 `continuity.title`은
 * "…기준으로 이어져요."인데 화면은 "…기준으로."로 이미 어긋나 있었다.
 *
 * 여기서는 컴포넌트 소스의 h1/h2에서 태그를 걷어내고 공백을 정규화한 뒤 정본과
 * 글자 단위로 비교한다.
 */

const appRoot = resolve(process.cwd());
const DIR = resolve(appRoot, "src/components/landing/redesign");

function source(file: string): string {
  return readFileSync(resolve(DIR, `${file}.tsx`), "utf8");
}

/** 컴포넌트 소스의 첫 h1 또는 h2 블록 원문. */
function headlineBlock(file: string): string {
  return source(file).match(/<(h1|h2)\b[\s\S]*?<\/\1>/u)?.[0] ?? "";
}

/** 블록에서 사람이 읽는 텍스트만 뽑는다(하드코딩된 span 조합용). */
function renderedHeadline(file: string): string {
  return headlineBlock(file)
    .replace(/<[^>]*>/gu, "")       // 태그 제거
    .replace(/\{[^{}]*\}/gu, "")    // JSX 표현식 제거
    .replace(/\s+/gu, " ")
    .trim();
}

const content = readFileSync(resolve(DIR, "landingContent.ts"), "utf8");

/** landingContent의 `key: { ... title: "..." }` 값을 읽는다. */
function canonicalTitle(section: string): string {
  const block = content.match(
    new RegExp(`^  ${section}: \\{([\\s\\S]*?)^  \\},`, "mu"),
  )?.[1] ?? "";
  return block.match(/^\s*title:\s*"([^"]*)"/mu)?.[1] ?? "";
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["ProblemMirrorSection", "problem"],
  ["PreparationResult", "outcome"],
  ["ContinuitySection", "continuity"],
  ["SharedPrivateSection", "privacy"],
  ["TrustEvidenceSection", "trust"],
  ["ClosingAction", "closing"],
];

describe("landing headline parity", () => {
  for (const [file, section] of PAIRS) {
    it(`${file}의 화면 헤드라인이 landingContent.${section}.title과 같다`, () => {
      const canonical = canonicalTitle(section);
      expect(canonical, `landingContent.${section}.title을 찾지 못함`).not.toBe("");

      const block = headlineBlock(file);
      expect(block, `${file}에서 h1/h2를 찾지 못함`).not.toBe("");

      // 정본 상수를 직접 렌더하면 드리프트가 생길 수 없다.
      if (block.includes(`landingContent.${section}.title`)) return;

      // 하드코딩된 span 조합이면 사람이 읽는 결과가 정본과 같아야 한다.
      const rendered = renderedHeadline(file);
      expect(rendered, `${file} 헤드라인이 비어 있다`).not.toBe("");
      expect(rendered).toBe(canonical);
    });
  }

  it("히어로 H1도 정본과 같고, hero.title은 죽은 상수가 아니다", () => {
    const rendered = renderedHeadline("TransformationHero");
    expect(rendered).toBe(canonicalTitle("hero"));
  });
});
