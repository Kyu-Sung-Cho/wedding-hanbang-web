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
 * `validateMarker`가 스키마에 선언되지 않은
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

  it("단위가 있는 필드는 단위를 함께 알려준다", () => {
    // 2026-08-22 라이브: 사용자가 "총 예산을 5000만원으로 바꿔줘" 라고 했는데 카드에
    // **5,000원**이 찍혔다. 모델이 `total_budget: 5000` 을 보낸 것이다.
    //
    // 스키마 설명은 정확했다 — "새로운 총 예산 금액 (원 단위). 예: 30000000 = 3000만원".
    // 그런데 **변경 도구는 provider `tools` 배열에 없어서** 모델이 그 설명을 볼 길이
    // 없다. 모델이 보는 것은 이 계약문뿐인데, 처음 만들 때 이름과 타입만 넣고 설명을
    // 버렸다. 이름을 알려준 대가로 의미를 잃은 것이고, 그 결과가 자릿수 사고다.
    const budgetTool = MUTATING_TOOLS.find((tool) => tool.name === "update_budget")!;
    const prompt = buildAmoraPendingActionPrompt([budgetTool]);
    expect(prompt).toContain("원 단위");
    expect(prompt).toContain("30000000");
  });

  it("일괄 배분의 배열 안에도 필드 이름·필수값·허용 카테고리·원 단위가 보인다", () => {
    const tool = MUTATING_TOOLS.find((candidate) => candidate.name === "apply_budget_plan")!;
    const prompt = buildAmoraPendingActionPrompt([tool]);
    const allocations = prompt.slice(prompt.indexOf("allocations*"), prompt.indexOf("intake_summary*"));
    expect(allocations).toContain("category*");
    expect(allocations).toContain("budget*");
    expect(allocations).toContain("rationale(");
    expect(allocations).not.toContain("rationale*");
    expect(allocations).toContain("원 단위");
    const schema = tool.input_schema.properties as Record<string, {
      items: { properties: { category: { enum: string[] } } };
    }>;
    for (const category of schema.allocations.items.properties.category.enum) {
      expect(allocations).toContain(category);
    }
  });

  it("설명이 있는 필드는 설명을 싣는다", () => {
    const withDescription = MUTATING_TOOLS.filter((tool) =>
      Object.values(declaredProperties(tool)).some((schema) =>
        typeof (schema as { description?: unknown }).description === "string"
      ),
    );
    expect(withDescription.length).toBeGreaterThan(0);
    for (const tool of withDescription) {
      const prompt = buildAmoraPendingActionPrompt([tool]);
      for (const [field, schema] of Object.entries(declaredProperties(tool))) {
        const description = (schema as { description?: unknown }).description;
        if (typeof description !== "string" || description.length === 0) continue;
        // 설명은 길 수 있으니 앞부분이 실려 있으면 된다. 통째로 요구하면
        // 계약문이 프롬프트 예산을 잡아먹는다.
        const head = description.slice(0, 12);
        expect(prompt, `${tool.name}.${field} 설명이 없다`).toContain(head);
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
    {
      tool: "apply_budget_plan",
      input: {
        total_budget: 50_000_000,
        allocations: [
          { category: "venue", budget: 20_000_000, rationale: "사용자가 확인한 예식장 상한" },
          { category: "studio", budget: 3_000_000 },
        ],
        intake_summary: "예식장과 스튜디오 상한만 확정함",
      },
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
    expect(result.pendingAction?.input).toEqual(testCase.tool === "apply_budget_plan"
      ? { ...testCase.input, allocation_mode: "explicit" }
      : testCase.input);
  });
});

describe("지어낸 키는 실행 경로에 닿지 않는다", () => {
  // 2026-08-22 에 실제로 관측된 페이로드 그대로.
  //
  // 2026-09-04 이전에는 지어낸 키 하나에 **표식이 통째로** 버려졌다. 그 규칙이
  // 스테이징 X7 을 만들었다 — 모델이 표식을 냈는데 사용자에게는 카드가 없었다.
  // 지금은 그 키만 버린다. 지키는 것은 그대로다: **지어낸 값은 실행 경로에 없다.**
  function extractMarker(toolName: string, input: Record<string, unknown>) {
    const tool = MUTATING_TOOLS.find((candidate) => candidate.name === toolName)!;
    const text = `저장할까요?\n[pending_action]${JSON.stringify({
      tool: toolName,
      input,
    })}[/pending_action]`;
    return extractAmoraPendingAction({
      text,
      allowedTools: [tool],
      now: Date.now(),
      createActionId: randomUUID,
    });
  }

  it("일정: start_time·end_time·location 은 버리고 남은 값으로 카드를 낸다", () => {
    const result = extractMarker("add_schedule_event", {
      title: "웨딩 사진 촬영",
      date: "2026-12-05",
      start_time: "15:00",
      end_time: "17:00",
      location: "압구정 A스튜디오",
    });

    // 필수값(date·title)이 멀쩡하므로 카드는 나간다.
    expect(result.pendingAction?.input).toEqual({
      title: "웨딩 사진 촬영",
      date: "2026-12-05",
    });
    // 지어낸 값은 카드 본문에도, 저장될 입력에도 없다. 사용자는 저장될 것만 읽는다.
    for (const invented of ["15:00", "17:00", "압구정"]) {
      expect(result.cleanText).not.toContain(invented);
    }
  });

  it("예산: budget 대신 amount 를 쓰면 여전히 카드가 나오지 않는다", () => {
    // `update_category_budget` 의 required 는 `category` 하나뿐이라 `amount` 만
    // 버리면 스키마는 통과한다. 그런데 그렇게 나간 카드는 눌러도 실행기가
    // `invalid_category_budget` 으로 거절한다 — 그래서 카드를 내지 않는다.
    const result = extractMarker("update_category_budget", {
      category: "studio",
      amount: 3_000_000,
    });
    expect(result.pendingAction).toBeNull();
  });

  it("일괄 배분: 배열 안의 category_key·amount를 실제 금액으로 추측하지 않는다", () => {
    for (const allocation of [
      { category_key: "venue", budget: 20_000_000 },
      { category: "venue", amount: 20_000_000 },
    ]) {
      expect(extractMarker("apply_budget_plan", {
        total_budget: 50_000_000,
        allocations: [allocation],
        intake_summary: "사용자가 확인한 예식장 상한",
      }).pendingAction).toBeNull();
    }
  });

  it("계약문이 지어낸 이름을 정답처럼 싣지 않는다", () => {
    const prompt = buildAmoraPendingActionPrompt(MUTATING_TOOLS);
    // 렌더된 텍스트를 파싱해 "광고된 필드"를 뽑는 방식은 **버렸다.** 필드 설명에도
    // 괄호와 쉼표가 들어가서(`sanggyeonrye(양쪽 부모님이 함께 만나는 자리)`)
    // 설명 속 낱말이 필드로 잡힌다. 실제로 `reserve`·`sanggyeonrye` 가 그렇게 잡혔다.
    // 파서를 더 정교하게 만들 수는 있지만, 그건 계약이 아니라 서식을 고정하는 것이고
    // 다음 서식 변경에서 또 깨진다.
    //
    // 계약문은 `describeToolInputFields` 가 **스키마에서** 만들므로 "광고 ⊆ 선언"은
    // 구조적으로 참이다. 여기서 지킬 값이 있는 것은 **지어낸 이름이 스키마에 슬쩍
    // 들어오지 않는 것**이고, 그건 데이터로 확인한다.
    const declaredEverywhere = new Set(
      MUTATING_TOOLS.flatMap((tool) => Object.keys(declaredProperties(tool))),
    );
    for (const invented of ["start_time", "end_time", "location", "amount"]) {
      expect(declaredEverywhere.has(invented), `${invented} 가 실제 스키마에 생겼다`).toBe(false);
    }
    // 그리고 계약문이 스키마에서 나왔다는 것 자체는 위의 "선언 필드가 전부 계약문에
    // 나온다" 검사들이 도구마다 확인한다.
    expect(prompt.length).toBeGreaterThan(0);
  });
});
