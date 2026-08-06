import { describe, expect, it } from "vitest";
import { BETA_DISABLED_TOOL_NAMES, BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";

// 도구를 끄면서 프롬프트를 안 지웠다. 그래서 아모라는 매 턴, 자기가 부를 수 없는
// 도구 7개(예약 생성·취소, 업체 검색·추천, 빈 시간 조회, 장소 검색)의 사용법을
// 안내받았다 — 총 27회. 프롬프트는 "즉시 이 도구를 호출하세요"라고 시켰고, 도구는
// 없었다. 모델이 할 수 있는 일은 약속하고 안 하는 것뿐이다.
//
// 이 제품에서 "안 한 일을 하겠다고 말하는 것"은 가장 나쁜 실패다. 그런데 개별 문장을
// 지우는 것으로는 다음에 또 생긴다 — 도구를 하나 더 끌 때 프롬프트를 같이 볼 사람이
// 없기 때문이다. 그래서 여기서 **연결 자체**를 검사한다.

const CONTEXT = {
  weddingDate: "2027-05-15",
  budget: 30_000_000,
  venue: null,
  progress: {},
  brideName: null,
  groomName: null,
  senderName: "테스트",
  bookings: [],
  scheduleEvents: [],
  chatSummaries: [],
};

/** 프롬프트는 갈래가 많다. 한 갈래만 보면 다른 갈래에 남은 안내를 놓친다. */
const VARIANTS = [
  { requestKind: "chat" as const, persistenceMode: "durable" as const },
  { requestKind: "chat" as const, persistenceMode: "demo" as const },
  { requestKind: "mediation" as const, persistenceMode: "durable" as const },
  {
    requestKind: "chat" as const,
    persistenceMode: "durable" as const,
    specialist: "budget_optimizer" as const,
  },
  {
    requestKind: "chat" as const,
    persistenceMode: "durable" as const,
    specialist: "schedule_manager" as const,
  },
];

function prompts(): { label: string; text: string }[] {
  return VARIANTS.map((options) => ({
    label: `${options.requestKind}/${options.persistenceMode}/${options.specialist ?? "none"}`,
    text: buildAmoraSystemPrompt(CONTEXT as never, options as never),
  }));
}

describe("프롬프트와 도구 목록이 어긋나지 않는다", () => {
  it("모델에게 주지 않는 도구를 프롬프트가 설명하지 않는다", () => {
    const enabled = new Set(BETA_SAFE_TOOLS.map((tool) => tool.name));
    const disabled = [...BETA_DISABLED_TOOL_NAMES].filter((name) => !enabled.has(name));
    expect(disabled.length).toBeGreaterThan(0);

    for (const { label, text } of prompts()) {
      for (const name of disabled) {
        // 실패하면 둘 중 하나를 골라야 한다 — 도구를 다시 켜거나, 안내를 지우거나.
        // 그대로 두면 아모라가 할 수 없는 일을 하겠다고 말한다.
        expect(text, `${label} 프롬프트가 비활성 도구 ${name}를 설명한다`)
          .not.toContain(name);
      }
    }
  });

  it("할 수 없다는 것을 말하고, 대신 할 수 있는 것으로 잇는다", () => {
    // 안내만 지우면 모델은 빈자리를 상상으로 채운다. 없다는 사실과 대안을 함께 준다.
    for (const { label, text } of prompts()) {
      expect(text, label).toContain("업체 추천·예약은 지금 제공하지 않습니다");
      expect(text, label).toContain("찾아볼게요");
      expect(text, label).toContain("예약해 드릴게요");
      // 도구가 없을수록 더 중요해지는 규칙 — 지우면 안 된다.
      expect(text, label).toContain("업체명을 먼저 꺼내지 마세요");
    }
  });

  it("살아 있는 도구는 계속 설명한다", () => {
    // 위 두 단언만 있으면 프롬프트에서 도구 안내를 전부 지워도 통과한다.
    // 실제로 쓰는 도구가 여전히 안내되는지 함께 고정한다.
    const [{ text }] = prompts();
    for (const name of ["analyze_quote", "add_amora_action", "update_amora_action"]) {
      expect(text, name).toContain(name);
    }
  });
});
