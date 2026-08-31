/**
 * 체크리스트 구제와 연결 문맥이 같은 문장에 걸려도 예외가 나지 않는다.
 *
 * 적대적 검토가 라우트 하네스로 재현한 것:
 *
 *     직전: "예식장 후보 두 곳을 비교해줘"                  (W0)
 *     현재: "만날 장소 정하고 예약 다 했는데 다음은 뭐야?"
 *           (커플의 체크리스트 항목 이름이라 `shouldRescueChecklistScope` 가 W0 으로 살린다)
 *
 * 그 문장은 물음표가 있어 되묻기 연속성(`amoraClarificationContinuity`)에는 안 걸리고,
 * 넓어진 `canAttemptAmoraBoundedContinuity` 에는 걸린다. 그러면 라우트가
 * `linkedContextMode: "linked_context_only"`(도구 금지)를 붙인 채 되살아난 도구를
 * 함께 넘겨서 프롬프트 조립이 던진다:
 *
 *     Error: linked_context_only cannot include tools or an action contract
 *
 * 그 지점을 감싸는 try 가 없어 **POST 가 500 이 되고 요청 클레임도 안 풀린다.**
 *
 * 라우트에서 **범위가 W0/W1 로 살아난 경우를 전부** 연결 문맥에서 빼서 고쳤다.
 * 여기서는 그 두 조건이 실제로 같은 문장에 겹친다는 사실과, 조립부가 그 조합을
 * 거부한다는 사실을 고정한다.
 */
import { describe, expect, it } from "vitest";

import { buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { canAttemptAmoraBoundedContinuity } from "@/lib/ai/amoraBoundedContinuity";
import { shouldRescueChecklistScope } from "@/lib/ai/amoraChecklistScopeRescue";
import { collectAmoraChecklistLabels } from "@/lib/ai/amoraToolPolicy";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";

const TEXT = "만날 장소 정하고 예약 다 했는데 다음은 뭐야?";

function promptContext() {
  return {
    weddingDate: "2027-06-20", budget: 50_000_000, venue: null,
    progress: { meeting: { category: "meeting", status: "in_progress" } },
    preparationStatus: null, brideName: "신부", groomName: "신랑", senderName: "신부",
    bookings: [], scheduleEvents: [], chatSummaries: [], pastConflicts: [], pastDecisions: [],
  } as never;
}

describe("두 구제가 같은 문장에 겹친다", () => {
  it("체크리스트 구제와 연결 문맥 관문이 둘 다 걸린다", () => {
    const labels = collectAmoraChecklistLabels({ meeting: { items: [] } });
    expect(labels.length, "체크리스트 이름을 못 모았다").toBeGreaterThan(0);

    const classification = classifyAmoraQuestionScope({ userText: TEXT });
    expect(classification.scope).toBe("W4_out_of_scope");
    expect(canAttemptAmoraBoundedContinuity(TEXT)).toBe(true);
    expect(shouldRescueChecklistScope({
      userText: TEXT,
      checklistLabels: labels,
      // 라우트가 넘기는 값. W4-low 는 결혼 핵심 후보로 본다.
      isWeddingCoreCandidate: true,
    })).toBe(true);
  });
});

describe("조립부는 그 조합을 거부한다", () => {
  it("도구가 있는 채로 linked_context_only 를 넘기면 던진다", () => {
    // 라우트가 이 조합을 만들지 않는 것이 고침이고, 여기서는 조립부가 여전히
    // 방어하고 있다는 사실을 고정한다. 이 검사가 사라지면 라우트의 실수가
    // 조용히 통과한다.
    expect(() => buildAmoraSystemPrompt(promptContext(), {
      enabledToolNames: ["get_wedding_info"],
      requestKind: "chat",
      persistenceMode: "durable",
      linkedContextMode: "linked_context_only",
      questionScope: {
        scope: "W4_out_of_scope",
        allowsLongTermMemory: false,
        confidence: "low",
        needsClarification: true,
      },
    } as never)).toThrow(/linked_context_only cannot include tools/u);
  });

  it("도구가 없으면 정상 조립된다", () => {
    expect(() => buildAmoraSystemPrompt(promptContext(), {
      enabledToolNames: [],
      requestKind: "chat",
      persistenceMode: "durable",
      linkedContextMode: "linked_context_only",
      questionScope: {
        scope: "W4_out_of_scope",
        allowsLongTermMemory: false,
        confidence: "low",
        needsClarification: true,
      },
    } as never)).not.toThrow();
  });
});

describe("라우트가 그 조합을 만들지 않는다", () => {
  it("범위가 살아난 경우를 연결 문맥에서 뺀다", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/app/api/chat/route.ts", "utf8");
    const start = source.indexOf("const boundedContinuity =");
    const end = source.indexOf("? buildAmoraBoundedContinuity(", start);
    expect(start, "boundedContinuity 조립부를 못 찾았다").toBeGreaterThan(-1);
    const condition = source.slice(start, end);
    expect(condition).toContain('questionScope.scope !== "W0_wedding_core"');
    expect(condition).toContain('questionScope.scope !== "W1_wedding_adjacent"');
  });
});
