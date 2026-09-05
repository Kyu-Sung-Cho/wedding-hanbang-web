import { describe, expect, it } from "vitest";
import {
  buildAmoraPendingActionPrompt,
  extractAmoraPendingAction,
  resolveAmoraPendingAction,
} from "@/lib/ai/amoraPendingAction";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";

const NOW = 1_789_000_000_000;
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const tools: AiToolDefinition[] = [
  {
    name: "update_budget",
    description: "test",
    input_schema: {
      type: "object",
      properties: { total_budget: { type: "number" } },
      required: ["total_budget"],
    },
  },
  {
    name: "update_venue",
    description: "test",
    input_schema: {
      type: "object",
      properties: { venue: { type: "string" } },
      required: ["venue"],
    },
  },
  {
    name: "add_schedule_event",
    description: "test",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string" },
        title: { type: "string" },
        memo: { type: "string" },
        schedule_scope: {
          type: "string",
          enum: ["confirmed_fact", "shared_commitment", "external_commitment"],
        },
      },
      required: ["date", "title"],
    },
  },
  {
    // 짧은 창(10분)을 갖는 도구. 공유 계획이 아니라 바로 눌러 끝내는 것이다.
    name: "update_task_status",
    description: "test",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string" },
        status: { type: "string" },
      },
      required: ["category", "status"],
    },
  },
  {
    name: "apply_budget_plan",
    description: "test",
    input_schema: {
      type: "object",
      properties: {
        total_budget: { type: "number" },
        allocations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string" },
              budget: { type: "number" },
            },
            required: ["category", "budget"],
          },
        },
        intake_summary: { type: "string" },
      },
      required: ["total_budget", "allocations", "intake_summary"],
    },
  },
  {
    name: "create_booking",
    description: "test",
    input_schema: {
      type: "object",
      properties: {
        vendor_id: { type: "string" },
        date: { type: "string" },
        time: { type: "string" },
      },
      required: ["vendor_id", "date", "time"],
    },
  },
  {
    name: "cancel_booking",
    description: "test",
    input_schema: {
      type: "object",
      properties: { booking_id: { type: "string" } },
      required: ["booking_id"],
    },
  },
];

function extract(text: string) {
  return extractAmoraPendingAction({
    text,
    allowedTools: tools,
    now: NOW,
    createActionId: () => ACTION_ID,
  });
}

describe("Amora pending actions", () => {
  it("labels booking confirmations as Amora-internal record changes", () => {
    const created = extract(
      '[pending_action]{"tool":"create_booking","input":{"vendor_id":"vendor-1","date":"2027-03-20","time":"10:00"}}[/pending_action]',
    );
    const cancelled = extract(
      '[pending_action]{"tool":"cancel_booking","input":{"booking_id":"11111111-1111-4111-8111-111111111111"}}[/pending_action]',
    );

    expect(created.cleanText).toContain("변경: 아모라 방문·상담 요청 기록");
    expect(cancelled.cleanText).toContain("변경: 아모라 예약 요청 기록 취소 표시");
    expect(cancelled.cleanText).toContain('대상 예약 요청 기록: "…11111111"');
    expect(created.cleanText).not.toContain("변경: 업체 예약 요청");
    expect(cancelled.cleanText).not.toContain("변경: 업체 예약 취소");
  });

  it("replaces a model-authored misleading proposal with a server-owned truthful summary", () => {
    const result = extract(
      '일정만 가볍게 확인해볼게요.\n[pending_action]{"tool":"update_budget","input":{"total_budget":30000000},"confirmation":"일정만 확인할까요?"}[/pending_action]',
    );

    expect(result.cleanText).toBe(
      "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
    );
    expect(result.pendingAction).toMatchObject({
      tool: "update_budget",
      input: { total_budget: 30_000_000 },
      confirmation:
        "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
    });
  });

  it("does not round a schema-valid numeric value in the confirmation", () => {
    const result = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000.12345678}}[/pending_action]',
    );

    expect(result.cleanText).toContain("30,000,000.12345678원");
  });

  it("strips and stores one schema-valid action with a canonical confirmation", () => {
    const confirmation =
      "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원";
    const result = extract(
      '모델이 작성한 제안\n[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    );

    expect(result.cleanText).toBe(confirmation);
    const identity = getAmoraToolOperationIdentity(
      "update_budget",
      { total_budget: 30_000_000 },
    );
    expect(result.pendingAction).toMatchObject({
      version: 2,
      actionId: ACTION_ID,
      tool: "update_budget",
      input: { total_budget: 30_000_000 },
      inputDigest: identity.inputDigest,
      operationKey: identity.operationKey,
      confirmation,
      issuedAt: NOW,
      expiresAt: NOW + 24 * 60 * 60 * 1_000,
    });
  });

  // 2026-08-23: 두 사람 승인이 없어졌지만 긴 창은 남긴다. 이유가 "상대가 볼
  // 시간"에서 "금액을 한 번 더 생각할 시간"으로 바뀐 것뿐이다. 값을 줄였다면
  // 이미 발급된 카드가 전부 만료로 죽었을 것이다.
  it("공유 계획 변경에는 넉넉한 창을, 즉시 누르는 것에는 짧은 창을 준다", () => {
    const sharedPlanAction = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    ).pendingAction;
    const quickAction = extract(
      '[pending_action]{"tool":"update_task_status","input":{"category":"invitation","status":"completed"}}[/pending_action]',
    ).pendingAction;

    expect(sharedPlanAction?.expiresAt).toBe(NOW + 24 * 60 * 60 * 1_000);
    expect(quickAction?.expiresAt).toBe(NOW + 10 * 60 * 1_000);
  });

  it.each([
    '[pending_action]{"tool":"update_budget","input":{}}[/pending_action]',
    '[pending_action]{"tool":"delete_everything","input":{}}[/pending_action]',
  ])("strips but never stores an invalid marker: %s", (marker) => {
    const result = extract(`총예산을 3,000만 원으로 바꿀까요?\n${marker}`);
    expect(result.cleanText).toBe("총예산을 3,000만 원으로 바꿀까요?");
    expect(result.pendingAction).toBeNull();
  });

  it("선언 안 된 키는 그 키만 버리고 필수값이 멀쩡하면 카드가 난다", () => {
    // 2026-09-04 이전에는 `extra` 하나에 표식이 통째로 버려졌다. 그 규칙이
    // 스테이징 X7 을 만들었다 — 모델이 표식을 냈는데 카드가 없었다.
    const result = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000,"extra":true}}[/pending_action]',
    );

    expect(result.pendingAction?.input).toEqual({ total_budget: 30_000_000 });
    // 버린 키는 확인문에도 없다 — 카드는 저장될 것만 말한다.
    expect(result.cleanText).not.toContain("extra");
  });

  it.each(["\u0085", "\u061c", "\u200b", "\u200c", "\u200d", "\u200e", "\u200f", "\u202e", "\u2066"])(
    "rejects a proposal value containing an invisible Unicode control or format character %#",
    (formatCharacter) => {
      const payload = JSON.stringify({
        tool: "update_venue",
        input: { venue: `안전한 예식장${formatCharacter}거짓` },
      });
      const result = extract(
        `[pending_action]${payload}[/pending_action]`,
      );

      expect(result.pendingAction).toBeNull();
    },
  );

  it("rejects an invisible format character in a nested object key", () => {
    const payload = JSON.stringify({
      tool: "apply_budget_plan",
      input: {
        total_budget: 30_000_000,
        allocations: [{
          category: "venue",
          budget: 10_000_000,
          ["숨은\u200b키"]: true,
        }],
        intake_summary: "예식장 우선",
      },
    });

    const result = extract(`[pending_action]${payload}[/pending_action]`);
    expect(result.pendingAction).toBeNull();
  });

  it("does not reinterpret ordinary text that happens to match an enum token", () => {
    const result = extract(
      '[pending_action]{"tool":"update_venue","input":{"venue":"completed"}}[/pending_action]',
    );

    expect(result.cleanText).toContain('- 결혼식장: "completed"');
    expect(result.cleanText).not.toContain("- 결혼식장: 완료");
  });

  it("preserves meaningful whitespace in a text value instead of summarizing a different value", () => {
    const result = extract(
      '[pending_action]{"tool":"update_venue","input":{"venue":"A  B"}}[/pending_action]',
    );

    expect(result.cleanText).toContain('- 결혼식장: "A  B"');
  });

  it("keeps normal memo line breaks as an exact escaped representation", () => {
    const payload = JSON.stringify({
      tool: "add_schedule_event",
      input: {
        date: "2026-08-01",
        title: "드레스 피팅",
        memo: "첫 줄\n둘째 줄",
      },
    });
    const result = extract(`[pending_action]${payload}[/pending_action]`);

    expect(result.cleanText).toContain('- 메모: "첫 줄\\n둘째 줄"');
    expect(result.pendingAction?.input.memo).toBe("첫 줄\n둘째 줄");
  });

  it("fails closed when a newly allowed mutation has no server-owned display contract", () => {
    const result = extractAmoraPendingAction({
      text: '[pending_action]{"tool":"future_mutation","input":{"value":"x"}}[/pending_action]',
      allowedTools: [{
        name: "future_mutation",
        description: "test",
        input_schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      }],
      now: NOW,
      createActionId: () => ACTION_ID,
    });

    expect(result.pendingAction).toBeNull();
  });

  // 2026-09-04: 여기는 "표식이 둘이면 둘 다 버린다" 를 고정하고 있었다. 똑같은
  // 표식을 두 번 쓴 것은 요청이 둘인 것이 아니라 모델이 제 말을 반복한 것인데,
  // 그때도 카드가 0개가 됐다 — 사용자는 한 가지만 부탁하고 아무것도 못 받았다.
  it("issues one card when the same marker is repeated", () => {
    const marker = '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]';
    const multiple = extract(`총예산을 3,000만 원으로 바꿀까요?\n${marker}\n${marker}`);
    expect(multiple.pendingAction?.tool).toBe("update_budget");
    expect(multiple.cleanText).toContain("총 예산: 3,000만 원");
    // 요청은 하나였으므로 "나머지" 안내를 붙이지 않는다.
    expect(multiple.cleanText).not.toContain("나머지");
  });

  it("keeps the first valid marker and says what happens to the rest", () => {
    // 서로 다른 두 건. 예전에는 둘 다 버려 카드가 0개였다 — 라이브에서 일정 3건을
    // 한 번에 부탁한 턴이 정확히 그 모양이었다.
    const budget = '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]';
    const venue = '[pending_action]{"tool":"update_venue","input":{"venue":"그랜드힐"}}[/pending_action]';
    const multiple = extract(`알겠어요.\n${budget}\n${venue}`);

    expect(multiple.pendingAction?.tool).toBe("update_budget");
    // 카드가 되는 것은 첫 건 하나뿐이다. 두 번째 표식은 실행 경로에 남지 않는다.
    expect(multiple.pendingAction?.input).toEqual({ total_budget: 30_000_000 });
    expect(multiple.cleanText).toContain("총 예산: 3,000만 원");
    expect(multiple.cleanText).toContain("나머지 1건은 이 확인이 끝나면 이어서 제안할게요.");
  });

  it("still refuses when none of several markers can be validated", () => {
    const brokenBudget = '[pending_action]{"tool":"update_budget","input":{"total_budget":"삼천만"}}[/pending_action]';
    const brokenVenue = '[pending_action]{"tool":"update_venue","input":{"venue_name":"그랜드힐"}}[/pending_action]';
    const multiple = extract(`알겠어요.\n${brokenBudget}\n${brokenVenue}`);

    expect(multiple.pendingAction).toBeNull();
    expect(multiple.cleanText).toContain("먼저 바꾸고 싶은 것 한 가지만");
  });

  it("resolves only the exact unexpired server-issued action id", () => {
    const pending = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    ).pendingAction;
    expect(pending).not.toBeNull();
    expect(resolveAmoraPendingAction({
      value: pending,
      confirmedActionId: ACTION_ID,
      allowedTools: tools,
      now: NOW + 1,
    })).toEqual(pending);
    expect(resolveAmoraPendingAction({
      value: pending,
      confirmedActionId: ACTION_ID,
      allowedTools: tools,
      now: NOW + 24 * 60 * 60 * 1_000,
    })).toBeNull();
  });

  it("rejects a tampered lifetime even when the action has not expired yet", () => {
    const pending = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    ).pendingAction;

    expect(resolveAmoraPendingAction({
      value: pending && { ...pending, expiresAt: NOW + 10 * 60 * 1_000 },
      confirmedActionId: ACTION_ID,
      allowedTools: tools,
      now: NOW + 1,
    })).toBeNull();
  });

  it("rejects legacy or tampered tool identities instead of approving a different input", () => {
    const pending = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    ).pendingAction;
    expect(pending).not.toBeNull();

    for (const value of [
      pending && { ...pending, version: 1 },
      pending && { ...pending, inputDigest: "a".repeat(64) },
      pending && { ...pending, operationKey: "b".repeat(64) },
      pending && {
        ...pending,
        input: { total_budget: 60_000_000 },
      },
    ]) {
      expect(resolveAmoraPendingAction({
        value,
        confirmedActionId: ACTION_ID,
        allowedTools: tools,
        now: NOW + 1,
      })).toBeNull();
    }
  });

  it("never treats generic reply text or a wrong or foreign id as authority", () => {
    const pending = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    ).pendingAction;

    expect(resolveAmoraPendingAction({
      value: pending,
      confirmedActionId: undefined,
      allowedTools: tools,
      now: NOW + 1,
    })).toBeNull();
    expect(resolveAmoraPendingAction({
      value: pending,
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
      allowedTools: tools,
      now: NOW + 1,
    })).toBeNull();
  });

  it("rejects a stored action whose visible confirmation was tampered with", () => {
    const pending = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    ).pendingAction;
    expect(resolveAmoraPendingAction({
      value: pending && { ...pending, confirmation: "아무 변경도 하지 않을까요?" },
      confirmedActionId: ACTION_ID,
      allowedTools: tools,
      now: NOW + 1,
    })).toBeNull();
  });

  it("documents the exact server-only marker contract", () => {
    const prompt = buildAmoraPendingActionPrompt(tools.filter((tool) => tool.name === "update_budget"));
    expect(prompt).toContain("update_budget");
    expect(prompt).toContain("[pending_action]");
    expect(prompt).toContain("정확한 action_id");
    expect(prompt).not.toContain('"confirmation"');
  });

  // 2026-09-04 스테이징: 날짜·제목이 다 적힌 일정 3건 요청에 표식이 0개였다.
  // 행동 카드는 도구를 지목한 계약 줄을 넣고 나서 카드가 나오기 시작했는데,
  // 일정에는 그 줄이 없었다 — 이름이 나오는 곳이 필드 목록 한 줄뿐이었다.
  it("tells the model to issue an add_schedule_event marker in this same reply", () => {
    const prompt = buildAmoraPendingActionPrompt(
      tools.filter((tool) => tool.name === "add_schedule_event"),
    );
    expect(prompt).toContain("일정 등록 요청에는 `add_schedule_event` 표식을 이번 답변에 내세요");
    // 연도를 확인받으려고 표식을 미루는 모양이 실측됐다.
    expect(prompt).toContain("연도가 없으면 가장 가까운 미래로 넣습니다");
    expect(prompt).toContain("여러 건이면 첫 건만 냅니다");
  });

  // 2026-09-04 라이브 4/4: 값(날짜·제목)이 다 적혀 있는데도 표식이 0개였고 답변은
  // "먼저 9월 10일 일정부터 등록할까요?" 뿐이었다. 위 줄은 "표식을 내세요" 라고만
  // 하고, 형식 줄은 값이 비어 있는 자리표시자였다 — 모델이 **채워진 것을** 본 적이
  // 없었다. 자리는 같은 계약문에서 만들었으므로(아래 대조군과 길이 핀 참고) 이
  // 줄이 사라지면 그 상쇄도 함께 무너진다.
  it("shows one filled marker the model can copy, values swapped", () => {
    const prompt = buildAmoraPendingActionPrompt(
      tools.filter((tool) => tool.name === "add_schedule_event"),
    );
    expect(prompt).toContain("이 모양 그대로, 값만 바꿔");
    // 자리표시자가 아니라 **실제로 통과하는 값**이어야 한다. 예시를 그대로 낸
    // 답변이 카드가 되는지로 판정한다 — 문자열 비교로는 오타를 못 잡는다.
    const open = "[pending_action]";
    const close = "[/pending_action]";
    const from = prompt.indexOf(open);
    const to = prompt.indexOf(close, from);
    const example = from === -1 || to === -1
      ? null
      : prompt.slice(from, to + close.length);
    expect(example, "채워진 표식 예시가 계약문에 없다").toBeTruthy();
    expect(example).toContain("add_schedule_event");
    const parsed = extractAmoraPendingAction({
      text: ["등록해 드릴게요.", example].join(String.fromCharCode(10)),
      allowedTools: tools,
      now: NOW,
      createActionId: () => ACTION_ID,
    });
    expect(parsed.pendingAction?.tool).toBe("add_schedule_event");
    expect(parsed.pendingAction?.input).toMatchObject({ title: expect.any(String) });
  });

  it("does not carry the schedule bullet when that tool is not proposable", () => {
    // 대조군. 없으면 위 검사는 "문자열이 어딘가 있다"는 말밖에 안 된다.
    const prompt = buildAmoraPendingActionPrompt(
      tools.filter((tool) => tool.name === "update_budget"),
    );
    expect(prompt).not.toContain("add_schedule_event");
  });

  // 같은 확정 발화도 첫 턴이면 표식을 내고, 앞 턴에서 다른 도구가 빈 결과를
  // 냈거나 이미 표식을 낸 뒤면 "도구가 없다"며 거절하는 일이 운영에서 관측됐다
  // (2026-07-25 실계정 E2E). 사용자는 이를 제품이 원래 못 하는 것으로 읽는다.
  it("forbids declaring the product incapable while proposals are available", () => {
    const prompt = buildAmoraPendingActionPrompt(tools.filter((tool) => tool.name === "update_budget"));
    expect(prompt).toContain("기능이 없다고 말하지 마세요");
    expect(prompt).toContain("앞선 턴에서 다른 도구가 빈 결과를 냈거나");
  });
});

describe("checklist confirmation names the item", () => {
  // 모델은 실제 항목 id를 한 번도 받지 못한다(프롬프트는 `할일: n/m완료`뿐). 그런데
  // 이 도구를 제안하려면 id를 적어야 하므로 사실상 지어낸다. 지어낸 id가 우연히 다른
  // 실제 항목과 맞으면 엉뚱한 항목이 완료로 바뀌는데, 카드가 id를 숨기고 있어서
  // 사용자가 알아챌 방법이 없었다.
  const checklistTools: AiToolDefinition[] = [
    {
      name: "toggle_checklist_item",
      description: "test",
      input_schema: {
        type: "object",
        properties: {
          category: { type: "string" },
          item_id: { type: "string" },
          done: { type: "boolean" },
        },
        required: ["category", "item_id", "done"],
      },
    },
  ];

  function extract(input: Record<string, unknown>) {
    return extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify({
        tool: "toggle_checklist_item",
        input,
      })}[/pending_action]`,
      allowedTools: checklistTools,
      now: NOW,
      createActionId: () => ACTION_ID,
    });
  }

  it("shows the item name so a wrong item can be declined", () => {
    const { pendingAction } = extract({
      category: "meeting",
      item_id: "meeting_02",
      done: true,
    });

    expect(pendingAction).not.toBeNull();
    expect(pendingAction!.confirmation).toContain("만날 장소 정하고 예약");
  });

  it("refuses to ask for confirmation when the item cannot be named", () => {
    // 실행부도 같은 표준 목록에서 찾으므로, 여기서 못 찾는 id는 승인해도 실패한다.
    // 사용자가 확인할 수 없는 변경은 승인받은 변경이 아니다.
    for (const input of [
      { category: "meeting", item_id: "meeting_99", done: true },
      { category: "no_such_category", item_id: "meeting_02", done: true },
      { category: "meeting", item_id: "venue_01", done: true },
    ]) {
      expect(extract(input).pendingAction, JSON.stringify(input)).toBeNull();
    }
  });
});

describe("닫는 표식을 잊은 카드도 살린다 (2026-09-05 페르소나 실측)", () => {
  it("여는 표식 뒤에 괄호가 맞는 JSON 이 있으면 payload 로 받는다", () => {
    const result = extract(
      '드레스 피팅을 넣을게요. [pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}',
    );
    expect(result.pendingAction?.tool).toBe("update_budget");
    expect(result.cleanText).not.toContain("pending_action");
    expect(result.cleanText).not.toContain("total_budget");
  });

  it("JSON 이 중간에서 끊기면 살리지 않고 표식이 버려진 것으로 센다", () => {
    const result = extract('[pending_action]{"tool":"update_budget","input":{"total_budget":3000');
    expect(result.pendingAction).toBeNull();
    expect(result.hadPendingActionTag).toBe(true);
  });
});
