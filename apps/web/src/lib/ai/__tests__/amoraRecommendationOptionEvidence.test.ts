import { describe, expect, it } from "vitest";
import { alignAmoraRecommendationLabels } from "../amoraRecommendationConsistency";
import { applyAmoraOutputHygiene } from "../amoraOutputHygiene";
import { createAmoraProviderPreviewGate } from "../amoraProviderPreviewGate";

const heading = "**절충안 7 — 가까운 지역에서 정식 예식**";
const unknown = "- 2,800만 원 안에서 가능한지는 실제 견적 확인 필요";
const rank = "**추천 1순위는 절충안 7**이에요. 두 사람의 이동 조건을 유지할 수 있기 때문이에요.";
const option = `${heading}\n- 하객 140명, 식대·대관료 비교\n${unknown}`;
const sample = `${option}\n\n${rank}`;
const alternate = "**절충안 8 — 다른 지역**\n- 160명, 총액 3,000만 원은 제공한 견적에서 확인했어요.";
const unchanged = [
  ["선택한 안은 확인됨", sample.replace(unknown, "- 총액 2,800만 원과 140명 수용은 제공한 가상 서면 견적에서 확인했어요.") + "\n\n**절충안 8 — 다른 지역**\n- 총예산 안에서 가능한지는 실제 견적 확인 필요"],
  ["미확인은 다른 안", `${option}\n\n${alternate}\n\n${rank.replaceAll("절충안 7", "절충안 8")}`],
  ["중복 번호 제목", `${option}\n\n${option}\n\n${rank}`],
  ["동일 번호 별칭의 갱신 제목", `${option}\n\n**7안 — 갱신 조건**\n- 새 서면 견적에서 상한 이내로 확인했어요.\n\n${rank}`],
  ["과거 설명", `지난 답변의 제안을 다시 옮겼어요.\n\n${sample}`],
  ["지난번 답변의 인용 소개", `아래는 지난번 답변입니다.\n\n${sample}`],
  ["다른 절에서 선택한 안의 새 사실 확인", `${option}\n\n**절충안 8 — 다른 지역**\n- 절충안 7의 새 서면 견적은 상한 이내로 확인했어요.\n\n${rank}`],
  ["이전 제목", sample.replace(heading, "**이전 제안: 절충안 7 — 가까운 지역**")],
  ["같은 절 후행 확인", `${option}\n- 이후 서면 견적에서 상한 이내로 확인했어요.\n\n${rank}`],
  ["별도 문단 후행 확인", `${option}\n\n새 서면 견적으로 절충안 7의 상한 이내 가능 여부를 확인했어요.\n\n${rank}`],
  ["추천 문단 후행 확인", `${sample} 새 서면 견적에서 상한 이내로 확인했어요.`],
  ["추천 뒤 정정", `${sample}\n\n방금 미확인이라고 한 내용은 취소하고 최종 견적 기준으로 추천해요.`],
  ["인용 블록", sample.split("\n").map(line => `> ${line}`).join("\n")],
  ["코드 블록", `\`\`\`text\n${sample}\n\`\`\``],
  ["물결 코드 블록", `~~~text\n${sample}\n~~~`],
  ["인라인 사용자 인용", `사용자 원문: “${sample}”`],
  ["표", `| 안 | 조건 |\n|---|---|\n| ${heading} | ${unknown} |\n\n${rank}`],
  ["추천 대상의 다른 분야", sample.replace("절충안 7**이에요", "절충안 7의 촬영 패키지**예요")],
  ["복수 추천 대상", sample.replace("절충안 7**이에요", "절충안 7 또는 절충안 8**이에요")],
  ["다른 분야 미확인", sample.replace(unknown, "- 촬영 패키지가 2,800만 원 안에서 가능한지는 실제 견적 확인 필요")],
  ["부차적 주차 조건", sample.replace(unknown, "- 후보 업체의 주차 비용은 실제 견적 확인 필요")],
  ["부차적 주류 조건", sample.replace(unknown, "- 주류 포함 여부는 아직 확인되지 않아 추가 문의 필요")],
  ["가정", sample.replace(unknown, "- 만약 총예산 안에서 가능하다면 실제 견적 확인 필요")],
  ["상태 질문", sample.replace(unknown, `${unknown}?!`)],
  ["추천 질문", sample.replace("**이에요.", "**이에요?!")],
  ["필요 부정", sample.replace(unknown, `${unknown}는 아니에요.`)],
  ["간접 인용", sample.replace(unknown, `${unknown}라고 말했어요.`)],
  ["누락 제목", sample.replace(heading, "가까운 지역에서 정식 예식")],
  ["다른 대상 참조", sample.replace("절충안 7**이에요", "절충안 8**이에요")],
  ["일반 준비 순서", "**1. 하객 명단 정리**\n- 예산을 정하기 전에 실제 견적 확인 필요\n\n추천 1순위는 하객 명단 정리예요."],
  ["부정 추천", sample.replace("**이에요.", "**이 아니에요.")],
  ["다른 순위 함께 제시", `${sample} 추천 2순위는 절충안 8이에요.`],
] as const;

describe("선택한 번호 안의 명시적 예산 가능성 미확인", () => {
  it.each([
    sample,
    `${option}\n\n${alternate}\n\n${rank}`,
    sample.replace(unknown, "- 총예산 안에서 가능한지는 실제 견적 확인 필요"),
    sample.replace("추천 1순위", "현재 추천 1순위"),
    sample.replace("하객 140명", "하객 140~160명"),
  ])("선택지·금액·줄바꿈은 보존하고 순위 라벨만 맞춘다: %s", text => {
    expect(alignAmoraRecommendationLabels(text)).toEqual({ text: text.replace("추천 1순위", "우선 검토 후보"), count: 1 });
  });

  it.each(unchanged)("%s는 그대로 보존한다", (_name, text) => {
    expect(alignAmoraRecommendationLabels(text)).toEqual({ text, count: 0 });
  });

  it("한 번 정합화한 답변은 다시 변경하거나 중복 집계하지 않는다", () => {
    const expected = sample.replace("추천 1순위", "우선 검토 후보");
    expect(alignAmoraRecommendationLabels(expected)).toEqual({ text: expected, count: 0 });
  });

  it("공통 terminal hygiene에도 같은 보정과 집계가 전달된다", () => {
    const terminal = applyAmoraOutputHygiene(sample, {});
    expect(terminal.text).toBe(sample.replace("추천 1순위", "우선 검토 후보"));
    expect(terminal.actions).toContainEqual({ kind: "recommendation_label_aligned", count: 1 });
  });

  it("문자마다 들어온 추천은 terminal 판정 전에 노출되지 않는다", () => {
    let preview = "";
    const gate = createAmoraProviderPreviewGate(delta => { preview += delta; });
    for (const character of sample) gate.push(character);
    expect(preview).not.toContain("추천 1순위");
    expect(alignAmoraRecommendationLabels(sample).text).toContain("우선 검토 후보");
  });
});
