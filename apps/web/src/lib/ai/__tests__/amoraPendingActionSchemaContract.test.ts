import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  buildAmoraPendingActionPrompt,
  extractAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

/**
 * 2026-08-22 스테이징 실측: 아모라 12턴 · 확인 카드 0건 · 저장 0건.
 *
 * 원인은 모델이 표식을 안 내는 것이 아니었다. **정확히 내는데 서버가 버렸다.**
 * `validateMarker`의 `hasOnlyDeclaredTopLevelKeys`가 스키마에 선언되지 않은
 * 최상위 키를 하나라도 발견하면 표식 전체를 `null`로 만든다. 조용히.
 *
 * 그런데 계약문은 **도구 이름만** 알려줬다. 변경 도구는 provider `tools` 배열에서도
 * 빠지므로(`filter(t => !isMutatingTool(t.name))`) 모델은 필드 이름을 한 번도 본 적
 * 없이 지어내야 했다. 실측 표식 10개 중 10개가 지어낸 키 때문에 탈락했다:
 *
 *     add_schedule_event     모델 start_time·end_time·location  / 선언 date·time·title·memo·…
 *     update_category_budget 모델 amount                        / 선언 category·budget·spent
 *
 * 이 파일은 **계약문이 실제 스키마와 갈라지는 것**을 막는다. 검증은 그대로 엄격하게
 * 두고, 모델에게 답을 알려주는 쪽으로 고쳤기 때문에 둘이 어긋나면 다시 0건이 된다.
 */

const MUTATING_TOOLS = BETA_SAFE_TOOLS.filter((tool) => isMutatingTool(tool.name));

function declaredProperties(tool: AiToolDefinition): Record<string, { type?: string; enum?: unknown[] }> {
  const properties = tool.input_schema.properties;
  return (properties && typeof properties === "object" ? properties : {}) as Record<
    string,
    { type?: string; enum?: unknown[] }
  >;
}

function requiredNames(tool: AiToolDefinition): string[] {
  const required = tool.input_schema.required;
  return Array.isArray(required) ? (required as string[]) : [];
}

describe("계약문이 입력 필드 이름을 알려준다", () => {
  it.each(MUTATING_TOOLS.map((tool) => [tool.name, tool] as const))(
    "%s 의 선언 필드가 전부 계약문에 나온다",
    (_name, tool) => {
      const prompt = buildAmoraPendingActionPrompt([tool]);
      for (const field of Object.keys(declaredProperties(tool))) {
        expect(prompt, `${tool.name}.${field} 가 계약문에 없다`).toContain(field);
      }
    },
  );

  it.each(
    MUTATING_TOOLS.filter((tool) => requiredNames(tool).length > 0).map(
      (tool) => [tool.name, tool] as const,
    ),
  )("%s 의 필수 필드가 필수로 표시된다", (_name, tool) => {
    const prompt = buildAmoraPendingActionPrompt([tool]);
    for (const field of requiredNames(tool)) {
      // 필수 표시는 필드 이름 바로 뒤에 붙는다. 표기를 바꾸면 이 줄을 같이 고칠 것.
      expect(prompt, `${tool.name}.${field} 가 필수로 표시되지 않았다`).toContain(`${field}*`);
    }
  });

  it("값이 정해진 필드는 고를 수 있는 값도 알려준다", () => {
    // enum 을 안 알려주면 모델이 값을 지어내고 AJV 가 조용히 떨어뜨린다 —
    // 키 이름과 똑같은 함정이 값에서 반복된다.
    const withEnum = MUTATING_TOOLS.filter((tool) =>
      Object.values(declaredProperties(tool)).some((schema) => Array.isArray(schema.enum)),
    );
    expect(withEnum.length).toBeGreaterThan(0);
    for (const tool of withEnum) {
      const prompt = buildAmoraPendingActionPrompt([tool]);
      for (const [field, schema] of Object.entries(declaredProperties(tool))) {
        if (!Array.isArray(schema.enum)) continue;
        for (const value of schema.enum) {
          expect(prompt, `${tool.name}.${field} 의 값 ${String(value)} 가 없다`).toContain(
            String(value),
          );
        }
      }
    }
  });

  it("식별자 필드는 지어내지 말라고 함께 말한다", () => {
    // 필드 이름을 알려주는 순간 모델은 그 자리를 채우려 한다. 그런데 `event_id`는
    // 프롬프트 문맥에 없다 — 일정 문맥은 날짜·제목·메모뿐이다. 이 경고가 없으면
    // 예전엔 다른 지어낸 키에 걸려 버려지던 표식이 이제 스키마를 통과해
    // **지어낸 id로 카드가 나간다.**
    const idTools = MUTATING_TOOLS.filter((tool) =>
      Object.keys(declaredProperties(tool)).some((field) => field.endsWith("_id")),
    );
    expect(idTools.length).toBeGreaterThan(0);
    const prompt = buildAmoraPendingActionPrompt(idTools);
    expect(prompt).toContain("_id");
    expect(prompt).toContain("지어내지");
  });

  it("여러 도구를 한 번에 줘도 각 도구가 자기 필드를 갖는다", () => {
    const prompt = buildAmoraPendingActionPrompt(MUTATING_TOOLS);
    for (const tool of MUTATING_TOOLS) {
      expect(prompt).toContain(tool.name);
    }
    expect(prompt).toContain("[pending_action]");
    // 기존 계약 문장은 그대로 남는다.
    expect(prompt).toContain("정확한 action_id");
    expect(prompt).not.toContain('"confirmation"');
  });
});

describe("계약문이 알려준 이름만으로 만든 표식은 서버를 통과한다", () => {
  const cases: Array<{ tool: string; input: Record<string, unknown> }> = [
    // 2026-08-22 에 모델이 시도했던 것과 같은 의도. 키만 선언된 것으로 맞췄다.
    {
      tool: "add_schedule_event",
      input: {
        date: "2026-12-05",
        time: "15:00",
        title: "웨딩 사진 촬영",
        memo: "압구정 A스튜디오",
      },
    },
    {
      tool: "update_category_budget",
      input: { category: "studio", budget: 3_000_000 },
    },
  ];

  it.each(cases.map((c) => [c.tool, c] as const))("%s", (_name, testCase) => {
    const tool = MUTATING_TOOLS.find((candidate) => candidate.name === testCase.tool);
    expect(tool, `${testCase.tool} 이(가) 변경 도구 목록에 없다`).toBeDefined();

    const prompt = buildAmoraPendingActionPrompt([tool!]);
    for (const key of Object.keys(testCase.input)) {
      expect(prompt, `계약문이 ${key} 를 안 알려준다`).toContain(key);
    }

    const text = `저장할까요?\n[pending_action]${JSON.stringify({
      tool: testCase.tool,
      input: testCase.input,
    })}[/pending_action]`;
    const result = extractAmoraPendingAction({
      text,
      allowedTools: [tool!],
      now: Date.now(),
      createActionId: randomUUID,
    });
    expect(result.hadPendingActionTag).toBe(true);
    expect(result.pendingAction, "카드가 발급되지 않았다").not.toBeNull();
    expect(result.pendingAction?.tool).toBe(testCase.tool);
  });
});

describe("검증은 느슨해지지 않았다", () => {
  // 계약문을 고친 것이지 관문을 연 것이 아니다. 2026-08-22 에 실제로 관측된
  // 페이로드 그대로 — 지어낸 키가 있으면 여전히 카드가 나오면 안 된다.
  const observed: Array<{ label: string; tool: string; input: Record<string, unknown> }> = [
    {
      label: "일정: start_time·end_time·location 을 지어냈다",
      tool: "add_schedule_event",
      input: {
        title: "웨딩 사진 촬영",
        date: "2026-12-05",
        start_time: "15:00",
        end_time: "17:00",
        location: "압구정 A스튜디오",
      },
    },
    {
      label: "예산: budget 대신 amount 를 썼다",
      tool: "update_category_budget",
      input: { category: "studio", amount: 3_000_000 },
    },
  ];

  it.each(observed.map((o) => [o.label, o] as const))("%s", (_label, sample) => {
    const tool = MUTATING_TOOLS.find((candidate) => candidate.name === sample.tool)!;
    const text = `저장할까요?\n[pending_action]${JSON.stringify({
      tool: sample.tool,
      input: sample.input,
    })}[/pending_action]`;
    const result = extractAmoraPendingAction({
      text,
      allowedTools: [tool],
      now: Date.now(),
      createActionId: randomUUID,
    });
    expect(result.pendingAction).toBeNull();
  });

  it("계약문이 지어낸 이름을 정답처럼 싣지 않는다", () => {
    const prompt = buildAmoraPendingActionPrompt(MUTATING_TOOLS);
    // 부분 문자열로 재면 안 된다 — `apply_budget_plan.allocations` 안에 `location`이
    // 들어 있어서 멀쩡한 필드가 위반으로 잡힌다. 필드 단위로 잘라서 본다.
    const advertised = new Set(
      [...prompt.matchAll(/(?:^|[\s,])([a-z_][a-z0-9_]*)\*?\(/gm)].map((match) => match[1]),
    );
    const declaredEverywhere = new Set(
      MUTATING_TOOLS.flatMap((tool) => Object.keys(declaredProperties(tool))),
    );
    expect(advertised.size).toBeGreaterThan(0);
    for (const invented of ["start_time", "end_time", "location", "amount"]) {
      expect(declaredEverywhere.has(invented), `${invented} 가 실제 스키마에 생겼다`).toBe(false);
      expect(advertised.has(invented), `계약문이 ${invented} 를 필드로 광고한다`).toBe(false);
    }
    // 계약문이 광고하는 이름은 전부 실제 선언 필드여야 한다.
    for (const name of advertised) {
      expect(declaredEverywhere.has(name), `계약문에만 있는 필드: ${name}`).toBe(true);
    }
  });
});
