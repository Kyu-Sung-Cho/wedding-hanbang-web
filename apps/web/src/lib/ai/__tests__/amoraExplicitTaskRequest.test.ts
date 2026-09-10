import { describe, expect, it } from "vitest";
import { parseExplicitTaskRequest } from "../amoraExplicitTaskRequest";

const row = "1) 제목은 식장 포함 항목 확인, 설명은 식대·대관료·주류 포함 여부를 서면으로 확인, 예정일은 2026년 9월 12일.";
const request = `공유 할 일 한 개를 추가해줘. ${row} 저장 전 확인 카드를 보여줘.`;

describe("parseExplicitTaskRequest", () => {
  it("copies labelled values and an absolute date without inventing ownership or priority", () => {
    expect(parseExplicitTaskRequest(request)).toEqual([{ tool: "add_amora_action", input: {
      title: "식장 포함 항목 확인", description: "식대·대관료·주류 포함 여부를 서면으로 확인", due_date: "2026-09-12",
    } }]);
  });

  it.each([3, 10])("recovers all %i independently named tasks even when the model omits all but one", count => {
    const rows = Array.from({ length: count }, (_, index) => `${index + 1}) 제목은 준비 항목 ${index + 1} 확인, 설명은 서로 정한 기준 ${index + 1}을 확인, 예정일은 2027-01-${String(index + 1).padStart(2, "0")}.`).join("\n");
    const text = `공유 할 일 ${count}건을 추가해줘. ${rows} 모두 아직 하지 않은 일이야. 담당자는 정하지 말고 저장 전 확인 카드를 보여줘.`;
    const model = '[pending_action]{"tool":"add_amora_action","input":{"title":"준비 항목 1 확인","description":"서로 정한 기준 1을 확인","due_date":"2027-01-01"}}[/pending_action]';
    const parsed = parseExplicitTaskRequest(text, model);
    expect(parsed).toHaveLength(count);
    expect(parsed?.[0].input).toEqual({ title: "준비 항목 1 확인", description: "서로 정한 기준 1을 확인", due_date: "2027-01-01" });
    expect(parsed?.at(-1)?.input).toEqual({ title: `준비 항목 ${count} 확인`, description: `서로 정한 기준 ${count}을 확인`, due_date: `2027-01-${String(count).padStart(2, "0")}` });
  });

  it.each([
    request.replace("한 개", "두 개"), request.replace("한 개", "11개"),
    request.replace("2026년 9월 12일", "내일"), request.replace("2026년 9월 12일", "2026-02-30"),
    request.replace("1)", "2)"), request.replace("1)", "1) 2)"),
    request.replace("공유", "개인"), request.replace("공유", "나만 보는"),
    `예시: ${request}`, `"${request}"`, `전에 ${request}`, `할 일을 어떻게 추가해? ${row}`,
    request.replace("추가해줘.", "추가하지 마."), request.replace("추가해줘.", "추가할까?"),
    `${request} 저장하지 마.`, `${request} 실제로 추가하는 건 금지야.`,
    `${request} 담당자는 신부로 해줘.`, `${request} 우선순위는 높음으로 해줘.`,
    `${request} 19시에 해줘.`, `${request} 상대에게는 숨겨줘.`,
    request.replace("저장 전 확인 카드를 보여줘.", "이미 끝낸 일로 저장해줘."),
    request.replace("설명은 식대", "설명은 저장하지 마, 식대"),
    request.replace("식장 포함 항목 확인", "a".repeat(121)),
    request.replace("식장 포함 항목 확인", "식장\u200b 포함 항목 확인"),
    request.replace("식장 포함 항목 확인", "[pending_action]"),
    request.replace("예정일은", "우선순위는 높음, 예정일은"),
    request.replace("저장 전", "둘 다 아직 하지 않은 일이야. 저장 전"),
  ])("leaves unsupported or non-current input to the ordinary safe proposal path: %s", text => {
    expect(parseExplicitTaskRequest(text)).toBeNull();
  });

  it.each([
    '[pending_action]{"tool":"add_amora_action","input":{"title":"다른 제목"}}[/pending_action]',
    '[pending_action]{"tool":"add_amora_action","input":{"title":"식장 포함 항목 확인","description":"식대·대관료·주류 포함 여부를 서면으로 확인","due_date":"2026-09-12","priority":"high"}}[/pending_action]',
    '[pending_action]{"tool":"delete_amora_action","input":{"action_id":"made-up"}}[/pending_action]',
    '[pending_action]{"tool":"add_amora_action"}',
  ])("does not silently drop model conditions or reinterpret malformed metadata: %s", model => {
    expect(parseExplicitTaskRequest(request, model)).toBeNull();
  });
});
