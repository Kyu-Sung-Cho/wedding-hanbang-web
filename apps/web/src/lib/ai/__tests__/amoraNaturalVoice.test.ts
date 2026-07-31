import { describe, expect, it } from "vitest";

import { AMORA_CARE_VOICE } from "@/lib/ai/amoraVoice";
import {
  AMORA_DEMO_SUGGESTIONS,
  AMORA_DEMO_WELCOME,
} from "@/lib/chat/amoraDemoCopy";

describe("Amora natural voice contract", () => {
  it("reduces the user's actual burden instead of opening with reusable comfort phrases", () => {
    expect(AMORA_CARE_VOICE).toContain("사용자가 방금 말한 구체적인 상황");
    expect(AMORA_CARE_VOICE).toContain("부담을 실제로 하나 줄이거나");
    expect(AMORA_CARE_VOICE).toContain("어디에나 붙일 수 있는 문장");
    expect(AMORA_CARE_VOICE).toContain("실무 질문에는 의례적인 공감을 붙이지 말고");
    expect(AMORA_CARE_VOICE).toContain("감정 표현에는 의례적인 계획이나 체크리스트를 붙이지 마세요");
  });

  it("opens the demo with one concrete invitation and an honest save boundary", () => {
    expect(AMORA_DEMO_WELCOME).toContain("지금 막막한 한 가지만");
    expect(AMORA_DEMO_WELCOME).toContain("실제 일정·예산에 저장되지 않");
    expect(AMORA_DEMO_WELCOME).toContain("받은 견적이나 고민");
    expect(AMORA_DEMO_WELCOME).not.toContain("결혼 준비하다 보면");
    expect(AMORA_DEMO_WELCOME).not.toContain("마음이 복잡해질 때가 있잖아요");
    expect(AMORA_DEMO_SUGGESTIONS).toHaveLength(3);
  });
});
