import { describe, expect, it } from "vitest";
import { buildAmoraMemoryCompilerInstructions } from "@/lib/ai/amoraMemoryCompiler";

/**
 * 2026-08-22 스테이징 라이브. 기억을 켜고 개인 대화로 값을 바꿔 봤더니:
 *
 *   guest_count:expected  "200명 정도"   ← 옛 값
 *   guest_count:total     "300명"        ← 새 값     **둘 다 활성**
 *   ceremony:venue_type   "실내"         ← 옛 값
 *   venue:format          "야외"         ← 새 값     **둘 다 활성, 서로 모순**
 *
 * DB 는 제 몫을 했다 — `decision_nodes` 의 부분 유니크 색인이 같은 `memory_key` 에
 * 활성 행을 하나만 허용한다. 그런데 **모델이 같은 주제에 다른 키를 지어냈다.**
 * 프롬프트에는 "사용자가 바꾼 값은 같은 memory_key를 사용합니다" 가 있었지만,
 * **모델은 그 커플이 이미 어떤 키를 쓰고 있는지 본 적이 없다.** 본 적 없는 키를
 * 재사용할 수는 없다.
 *
 * 오늘 pending_action 표식에서 고친 것과 똑같은 형태다: 지시만 있고 자료가 없으면
 * 모델은 지어낸다. 그래서 기존 키를 지시문에 실어 준다.
 *
 * 파운더가 말한 "3000만원이 계속 나오는" 문제의 기억 층 판본이 이것이다.
 */

describe("컴파일러가 이미 쓰는 키를 모델에게 보여준다", () => {
  it("기존 키가 없으면 기본 지시문 그대로다", () => {
    const base = buildAmoraMemoryCompilerInstructions([]);
    expect(base).toContain("memory_key");
    expect(base).not.toContain("이미 쓰고 있는");
  });

  it("기존 키를 그대로 실어 준다", () => {
    const instructions = buildAmoraMemoryCompilerInstructions([
      "guest_count:expected",
      "ceremony:venue_type",
      "budget:total",
    ]);
    for (const key of ["guest_count:expected", "ceremony:venue_type", "budget:total"]) {
      expect(instructions, `${key} 가 지시문에 없다`).toContain(key);
    }
    // 같은 주제면 **그 키를 그대로 쓰라**고 말해야 한다. 목록만 주면 참고 자료일 뿐이다.
    expect(instructions).toMatch(/같은 주제[\s\S]{0,80}그대로/u);
  });

  it("중복과 잡값은 걸러서 싣는다", () => {
    const instructions = buildAmoraMemoryCompilerInstructions([
      "budget:total",
      "budget:total",
      "",
      "  ",
      "NOT A KEY",
      "budget:total ",
    ]);
    expect(instructions).toContain("budget:total");
    expect(instructions).not.toContain("NOT A KEY");
    // 같은 키가 두 번 실리면 프롬프트만 길어진다.
    //
    // 낱말 등장 횟수로 세면 안 된다 — 기본 지시문이 `budget:total` 을 **예시로**
    // 이미 쓰고 있어서 2가 나온다. 목록 항목(`· 키`) 형태만 센다.
    const bullets = [...instructions.matchAll(/^ {2}· (\S+)$/gmu)].map((m) => m[1]);
    expect(bullets).toEqual(["budget:total"]);
  });

  it("키가 아주 많아도 지시문이 폭주하지 않는다", () => {
    const many = Array.from({ length: 500 }, (_, index) => `topic${index}:value`);
    const instructions = buildAmoraMemoryCompilerInstructions(many);
    // 상한이 없으면 기억이 쌓일수록 지시문이 대화를 밀어낸다.
    expect(instructions.length).toBeLessThan(8_000);
    expect(instructions).toContain("topic0:value");
  });

  it("사용자 발화만 근거로 삼는다는 기존 규칙은 그대로다", () => {
    const instructions = buildAmoraMemoryCompilerInstructions(["budget:total"]);
    expect(instructions).toContain("사용자 발화");
    expect(instructions).toContain("민감정보");
    expect(instructions).toContain("confidence");
  });
});
