// @vitest-environment node

/**
 * 온보딩 진행 표시가 **한 벌만** 그려지는가.
 *
 * ## 무엇이 있었나 (2026-08-28 감사)
 *
 * `<StepIndicator>` 가 형제로 두 벌 있었다. 하나는 조건 없이 `coupleAction` 을
 * 받고(합류 시 2칸), 다른 하나는 플래그 뒤에서 `coupleAction` 없이 그려져 항상
 * 5칸이었다. 초대 코드로 합류하는 사람은 **"2단계 중 2번째" 와 "5단계 중 2번째"
 * 를 동시에** 보게 된다 — 제품에서 처음 보는 화면에서 남은 단계가 몇 개인지 알 수
 * 없고, 실제로는 2단계에서 끝나므로 세 단계를 더 기다리다 갑자기 끝난 것처럼
 * 느낀다.
 *
 * git 이력상 의도가 아니라 병합 잔재였다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/(auth)/onboarding/page.tsx"),
  "utf8",
);

/** 주석을 걷어낸 소스. 설명 주석이 렌더로 세어지면 잘못된 빨간불이 난다. */
const rendered = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "");

describe("진행 표시", () => {
  it("한 번만 그린다", () => {
    const uses = rendered.match(/<StepIndicator\b/gu) ?? [];
    expect(uses.length, "진행 표시가 두 벌 그려집니다").toBe(1);
  });

  it("합류 흐름의 단계 수를 아는 판을 남긴다", () => {
    // coupleAction 을 안 받으면 합류하는 사람에게도 5칸을 보여준다.
    expect(rendered).toMatch(/<StepIndicator[^>]*coupleAction=\{store\.coupleAction\}/u);
  });
});
