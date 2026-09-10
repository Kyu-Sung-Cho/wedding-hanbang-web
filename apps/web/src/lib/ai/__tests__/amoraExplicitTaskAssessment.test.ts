import { describe, expect, it } from "vitest";
import { assessExplicitTaskRequest, parseExplicitTaskRequest } from "../amoraExplicitTaskRequest";

const BASE = "공유 할 일 한 개를 추가해줘. 1) 제목은 식장 포함 항목 확인, 설명은 식대·대관료·주류 포함 여부를 서면으로 확인, 예정일은 2026년 9월 12일. 저장 전 확인 카드를 보여줘.";
const INPUT = { title: "식장 포함 항목 확인", description: "식대·대관료·주류 포함 여부를 서면으로 확인", due_date: "2026-09-12" };
const MODEL = `[pending_action]${JSON.stringify({ tool: "add_amora_action", input: INPUT })}[/pending_action]`;
const inDescription = (text: string) => BASE.replace(", 예정일은", `, ${text}, 예정일은`);

describe("explicit task assessment preserves unsupported conditions as clarification", () => {
  it.each([
    "담당자를 신부로 지정해줘", "담당은 신랑", "담당자: 두 사람",
    "마감일은 2026-09-11", "기한은 2026년 9월 11일",
    "마감은 9월 11일", "9월 11일까지 끝내줘", "2026-09-11까지 완료해줘",
    "오후 7시 30분까지 완료해야 해", "19:30까지 해줘",
    "이 할 일은 추가하지 말아줘", "실제로 저장하지 마",
    "이 할 일은 저장하면 안 돼", "이번 할 일은 제외해줘",
    "지금은 추가하지 않고 보류해줘",
    "상대에게는 숨기고 나만 보게 해줘", "비공개로 저장해줘",
    "상대에게 안 보이게 해줘",
    "확인 카드도 만들지 마",
  ])("does not absorb an unsupported directive into description: %s", directive => {
    const result = assessExplicitTaskRequest(inDescription(directive));
    expect(result).toMatchObject({ kind: "needs_clarification" });
    expect(result).not.toHaveProperty("actions");
    expect(parseExplicitTaskRequest(inDescription(directive))).toBeNull();
  });

  it.each([
    "확인 카드도 만들지 마.", "담당자는 신부로 해줘.", "마감일은 2026-09-11로 바꿔줘.",
    "상대에게는 숨기고 나만 보게 해줘.", "실제로 추가하는 건 금지야.",
  ])("does not return ordinary-fallback null when the model ignores a suffix: %s", suffix => {
    expect(assessExplicitTaskRequest(`${BASE} ${suffix}`, MODEL)).toMatchObject({ kind: "needs_clarification" });
  });

  it.each([
    BASE.replace("한 개", "두 개"),
    BASE.replace("한 개", "11개"),
    BASE.replace("예정일은 2026년 9월 12일", "예정일은 내일"),
    BASE.replace("2026년 9월 12일", "2026-02-30"),
    BASE.replace("설명은", "메모는"),
    BASE.replace("추가해줘.", "추가해줘"),
  ])("identifies an incomplete structured request without handing it to ordinary fallback: %s", text => {
    expect(assessExplicitTaskRequest(text, MODEL)).toMatchObject({ kind: "needs_clarification" });
  });

  it("clarifies a provider's unsupported owner field instead of pruning it into a different proposal", () => {
    const model = `[pending_action]${JSON.stringify({ tool: "add_amora_action", input: { ...INPUT, assignee: "bride" } })}[/pending_action]`;
    expect(assessExplicitTaskRequest(BASE, model)).toMatchObject({ kind: "needs_clarification" });
  });

  it.each([
    "누락하지 말고 식대 확인",
    "불필요한 항목은 추가하지 말고 식대를 확인",
    "업체 담당자를 확인하고 서면 견적을 요청",
    "부모님께 ‘저장하지 마’라는 말을 왜 하셨는지 확인",
    '문구 "담당자는 신부"가 맞는지 두 사람이 확인',
    "업체가 말한 ‘19:30까지’가 맞는지 확인",
    "9월 11일 견적서 내용 확인",
    "9월 11일까지 유효한 견적서 내용 확인",
    "업체의 ‘9월 11일까지 끝내줘’라는 요청을 두 사람이 확인",
  ])("preserves ordinary task content and quoted speech: %s", description => {
    const text = BASE.replace(INPUT.description, description);
    expect(assessExplicitTaskRequest(text)).toEqual({ kind: "ready", actions: [{ tool: "add_amora_action", input: { ...INPUT, description } }] });
  });

  it("does not let a quote hide an actual trailing directive", () => {
    const text = BASE.replace(INPUT.description, "‘담당자를 확인’이라고 쓰고, 이 할 일은 추가하지 말아줘");
    expect(assessExplicitTaskRequest(text)).toMatchObject({ kind: "needs_clarification" });
  });

  it("does not absorb an owner instruction into a title", () => {
    const text = BASE.replace(INPUT.title, `${INPUT.title}, 담당자를 신부로 지정해줘`);
    expect(assessExplicitTaskRequest(text)).toMatchObject({ kind: "needs_clarification" });
  });

  it("does not treat an unclosed quote as permission to ignore a directive", () => {
    expect(assessExplicitTaskRequest(inDescription("‘담당은 신부"))).toMatchObject({ kind: "needs_clarification" });
  });

  it.each([
    "식대 확인을 할 일로 추가해줘.",
    "공유 할 일에는 어떤 내용을 넣으면 돼?",
    `예시: ${BASE}`,
    `“${BASE}”라는 문장을 평가해줘.`,
  ])("leaves unrelated or ordinary free-form requests outside this recovery path: %s", text => {
    expect(assessExplicitTaskRequest(text)).toBeNull();
  });

  it("still recovers the complete explicit list when the model omits one of its matching tags", () => {
    const text = BASE.replace("한 개", "두 개").replace("저장 전 확인", "2) 제목은 예식장 동선 확인, 설명은 부모님 이동 동선을 확인, 예정일은 2026-09-13. 저장 전 확인");
    const result = assessExplicitTaskRequest(text, MODEL);
    expect(result?.kind).toBe("ready");
    if (result?.kind !== "ready") throw new Error("Expected ready list");
    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].input).toEqual(INPUT);
    expect(result.actions[1].input).toEqual({ title: "예식장 동선 확인", description: "부모님 이동 동선을 확인", due_date: "2026-09-13" });
  });
});
