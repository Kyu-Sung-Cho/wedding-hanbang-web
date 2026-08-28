// @vitest-environment node

/**
 * 아모라 문맥에 실리는 날짜가 한국 시각인가.
 *
 * ## 무엇이 있었나 (2026-08-28 감사)
 *
 * `prompts.ts` 는 "오늘" 을 이미 `ymdInKst`·`koreanDateInKst` 로 짓는데, 과거
 * 결정·갈등 기록의 날짜만 `toISOString().slice(0, 10)` 이었다. Vercel 서버는
 * UTC 라 **한국 0시~9시(하루 9시간)에 확정한 결정이 하루 전 날짜로** 프롬프트에
 * 실렸다.
 *
 * 프롬프트가 모델에게 *"컨텍스트의 결정 row 의 `createdAt` 날짜로 age 판단"* 이라고
 * 명시하므로, 회상 톤의 7일·30일 경계도 그만큼 어긋난다. "우리 예산 언제 정했지?"
 * 에 실제보다 하루 이른 날짜를 말할 수 있다.
 *
 * `kstDate.ts` 가 이미 규칙을 적어 두었다 — *"모든 사용자-노출 날짜 계산은 이
 * 헬퍼를 통과시켜 KST 기준으로 일관되게 처리"*. 세 줄만 그 규칙 밖에 있었다.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ymdInKst } from "@/lib/utils/kstDate";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/ai/prompts.ts"),
  "utf8",
);

describe("프롬프트 날짜는 KST 로 짓는다", () => {
  it("toISOString 으로 날짜를 자르지 않는다", () => {
    // 이 한 줄이 UTC 를 프롬프트에 실어 보낸다.
    expect(
      source.includes("toISOString().slice(0, 10)"),
      "UTC 날짜가 남아 있습니다 — 한국 새벽에는 어제가 됩니다",
    ).toBe(false);
  });

  it("결정·갈등 기록의 날짜를 헬퍼로 짓는다", () => {
    const kstCalls = source.match(/ymdInKst\(new Date\([a-z]\.createdAt\)\)/gu) ?? [];
    expect(kstCalls.length, "createdAt 을 KST 로 바꾸는 자리가 줄었습니다").toBe(3);
  });

  it("헬퍼가 실제로 한국 시각을 준다", () => {
    // 규칙만 지키고 헬퍼가 틀리면 소용이 없다. UTC 로 어제인 시각을 넣어 본다.
    // 2026-08-28T00:30:00Z 는 한국 시각으로 같은 날 09:30 이다.
    expect(ymdInKst(new Date("2026-08-28T00:30:00.000Z"))).toBe("2026-08-28");
    // 2026-08-27T15:30:00Z 는 한국 시각으로 08-28 00:30 — UTC 로는 어제다.
    expect(ymdInKst(new Date("2026-08-27T15:30:00.000Z"))).toBe("2026-08-28");
  });
});
