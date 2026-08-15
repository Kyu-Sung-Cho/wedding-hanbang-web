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

  it("gives two-person decisions time to reach a partner but keeps reversible actions short-lived", () => {
    const coupleAction = extract(
      '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
    ).pendingAction;
    const singleAction = extract(
      '[pending_action]{"tool":"add_schedule_event","input":{"date":"2026-08-01","title":"드레스 피팅","schedule_scope":"confirmed_fact"}}[/pending_action]',
    ).pendingAction;

    expect(coupleAction?.expiresAt).toBe(NOW + 24 * 60 * 60 * 1_000);
    expect(singleAction?.expiresAt).toBe(NOW + 10 * 60 * 1_000);
  });

  it.each([
    '[pending_action]{"tool":"update_budget","input":{}}[/pending_action]',
    '[pending_action]{"tool":"delete_everything","input":{}}[/pending_action]',
    '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000,"extra":true}}[/pending_action]',
  ])("strips but never stores an invalid marker: %s", (marker) => {
    const result = extract(`총예산을 3,000만 원으로 바꿀까요?\n${marker}`);
    expect(result.cleanText).toBe("총예산을 3,000만 원으로 바꿀까요?");
    expect(result.pendingAction).toBeNull();
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

  it("rejects multiple markers instead of choosing one", () => {
    const marker = '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]';
    const multiple = extract(`총예산을 3,000만 원으로 바꿀까요?\n${marker}\n${marker}`);
    expect(multiple.pendingAction).toBeNull();
    expect(multiple.cleanText).toBe("총예산을 3,000만 원으로 바꿀까요?");
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
    const prompt = buildAmoraPendingActionPrompt(["update_budget"]);
    expect(prompt).toContain("update_budget");
    expect(prompt).toContain("[pending_action]");
    expect(prompt).toContain("정확한 action_id");
    expect(prompt).not.toContain('"confirmation"');
  });

  it("tells the provider not to reopen a fully server-bound first action", () => {
    const prompt = buildAmoraPendingActionPrompt(
      ["add_amora_action"],
      ["add_amora_action"],
    );

    expect(prompt).toContain("서버가 입력값을 모두 고정한 도구: add_amora_action");
    expect(prompt).toContain("추가 값을 묻거나 만들지 말고");
    expect(prompt).toContain("pending_action 표식 하나만");
  });

  it("does not describe a partially bound proposal as fully fixed", () => {
    const prompt = buildAmoraPendingActionPrompt(
      ["add_schedule_event"],
      [],
    );

    expect(prompt).not.toContain("서버가 입력값을 모두 고정한 도구");
  });

  // 같은 확정 발화도 첫 턴이면 표식을 내고, 앞 턴에서 다른 도구가 빈 결과를
  // 냈거나 이미 표식을 낸 뒤면 "도구가 없다"며 거절하는 일이 운영에서 관측됐다
  // (2026-07-25 실계정 E2E). 사용자는 이를 제품이 원래 못 하는 것으로 읽는다.
  it("forbids declaring the product incapable while proposals are available", () => {
    const prompt = buildAmoraPendingActionPrompt(["update_budget"]);
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
