// @vitest-environment node

/**
 * 국외 이전 고지가 실제로 화면에 있는가.
 *
 * ## 무엇이 있었나 (2026-08-28 감사)
 *
 * 처리방침 제5조 말미에 이렇게 적혀 있었다:
 *
 *     "…국외 이전 고지는 준비 중이며 확정되는 대로 이 방침에 반영합니다."
 *
 * 그런데 **이전은 이미 일어나고 있었다.** 운영 응답의 CSP 에
 * `us.i.posthog.com`·`ingest.us.sentry.io` 가 그대로 있고, 운영 데이터베이스는
 * 인도 리전(`ap-south-1`)이다. 준비 중이라고 적어 둔 채 이전하는 것은
 * 개인정보보호법 제28조의8 이 요구하는 **사전** 고지가 아니다.
 *
 * ## 이 검사가 무엇을 지키나
 *
 * 화면에 나가는 문구만 본다 — 주석은 "무엇을 지웠는지" 설명해야 하므로 옛 문장을
 * 인용할 수 있어야 한다. 이 저장소에서 주석을 UI 문구로 세어 잘못된 빨간불이 난
 * 이력이 있다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/app/privacy/page.tsx"),
  "utf8",
);

/**
 * 주석을 걷어낸 소스. JSX 주석(`{/* … *\/}`)과 블록 주석 둘 다 지운다.
 * 덜 지우면 잘못된 빨간불이고, 더 지우면 잘못된 초록불이다.
 */
const visible = source
  .replace(/\{\/\*[\s\S]*?\*\/\}/gu, "")
  .replace(/\/\*[\s\S]*?\*\//gu, "");

describe("국외 이전 고지", () => {
  it("'준비 중'이라고 말하지 않는다", () => {
    // 이전하면서 고지를 준비 중이라고 적는 것은 그 자체로 위반 상태의 자백이다.
    expect(visible).not.toContain("준비 중이며");
    expect(visible).not.toContain("고지는 준비");
  });

  it("법이 요구하는 항목을 갖는다", () => {
    // 개인정보보호법 제28조의8: 항목·국가·시기와 방법·이전받는 자·목적·
    // 보유기간·거부 방법.
    for (const required of [
      "이전받는 자",
      "이전되는 국가",
      "이전 항목",
      "이전 목적",
      "보유·이용 기간",
      "국외 이전을 원하지 않으시면",
    ]) {
      expect(visible, `필수 항목이 없습니다: ${required}`).toContain(required);
    }
  });

  it("이전 시기와 방법을 밝힌다", () => {
    expect(visible).toMatch(/서비스를 이용하는 시점/u);
    expect(visible).toMatch(/HTTPS/u);
  });

  it("수탁사를 하나도 빠뜨리지 않는다", () => {
    // 위탁표에 있는데 국외 이전표에 없으면, 그 회사로 가는 이전은 고지되지 않은
    // 것이 된다. 두 표가 갈라지는 것을 여기서 막는다.
    for (const processor of [
      "Supabase, Inc.",
      "Vercel Inc.",
      "OpenAI",
      "Resend, Inc.",
      "PostHog, Inc.",
      "Functional Software, Inc. (Sentry)",
    ]) {
      const count = visible.split(processor).length - 1;
      expect(count, `${processor} 가 두 표에 모두 있어야 합니다`).toBeGreaterThanOrEqual(2);
    }
  });

  it("데이터베이스 리전을 실제 값으로 밝힌다", () => {
    // 운영 실측(2026-08-28): 프로젝트 slrtobkksjmxgzatjyqb 의 리전은 ap-south-1.
    // 미국만 적으면 사실이 아니다.
    expect(visible).toContain("인도");
  });
});
