import { describe, expect, it } from "vitest";
import { AMORA_SYSTEM_PROMPT_MAX_CHARS, buildAmoraSystemPrompt } from "@/lib/ai/amoraPromptComposer";
import { AMORA_CARE_VOICE } from "@/lib/ai/amoraVoice";
import { buildAmoraPendingActionPrompt } from "@/lib/ai/amoraPendingAction";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import { classifyAmoraQuestionScope, filterAmoraToolsByQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { selectAmoraPendingProposalTools, selectAmoraTools } from "@/lib/ai/amoraToolPolicy";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import { getAvailableChatTools } from "@/lib/ai/placeSearchRouting";
import { determineStage, matchedSpecialistByKeyword, routeSpecialist } from "@/lib/ai/stage-router";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";

type Context = Parameters<typeof buildAmoraSystemPrompt>[0];
type Options = Parameters<typeof buildAmoraSystemPrompt>[1];
const BASE: Context = { weddingDate:null, budget:0, venue:null, progress:{}, preparationStatus:null,
  brideName:null, groomName:null, senderName:"합성 QA", bookings:[], scheduleEvents:[], chatSummaries:[], pastDecisions:[], pastConflicts:[] };
const CASES = [
  ["a9 T1 기존 기준", "서울이나 경기에서 180명 정도 일반 웨딩을 생각 중이야. 내년 가을이고 정확한 날짜와 총예산은 미정이야. 신혼집이 최우선이고 사진은 중요해. 예단과 폐백은 두 사람이 생략하기로 했어."],
  ["a9 T2 새 규모·형식", "생각이 바뀌었어. 180명 일반웨딩 말고 그냥 40명만 부르는 가족식으로 할래."],
  ["a9 T3 변경 이유와 작은 월 선호", "비용도 부담되고 준비 과정도 너무 복잡하게 느껴져서 그래. 큰 결혼식이 우리 취향도 아닌 것 같아. 날짜 후보는 9월보다 10월이 더 좋아. 이건 그냥 선호가 바뀐 거야."],
  ["다른 지역 변경 이유", "결혼식 지역을 부산에서 강릉으로 바꾸려 해. 부모님이 멀리 이동하기 어려워서야."],
  ["동시에 바꾼 사진 중요도", "가족식으로 바꾼 건 결혼식 준비 부담 때문이야. 사진은 이제 중요하지 않아. 신혼집 우선은 그대로야."],
  ["이유 거부와 경청", "결혼식을 가족식으로 바꾼 이유는 더 말하기 싫어. 지금은 그냥 들어줘."],
  ["이유 정리 후 월만 변경", "결혼식을 줄인 이유는 앞에서 다 말했어. 이번에는 날짜 후보만 9월에서 10월로 바꿀래."],
  ["순차 A 의견 접수", "두 사람의 결혼식 의견을 차례로 전달할게. A는 가까운 곳에서 80명 정도를 원해."],
  ["순차 B 의견 접수", "다음 사람의 의견도 전할게. B는 결혼식에 친척 140명을 초대하고 예산은 4천만 원을 지키고 싶대."],
];
// a9 baseline: these three selected-tool/proposal combinations were already 48,974 chars
// before bounding. Their no-tool variants and all other fixtures were untruncated.
const BASELINE_SELECTED_TRUNCATED = new Set([CASES[0][0], CASES[2][0], CASES[8][0]]);
function options(userText: string): Options {
  const questionScope=classifyAmoraQuestionScope({userText});
  const specialist=routeSpecialist(userText,determineStage(null));
  const selection={availableTools:getAvailableChatTools({requestKind:"chat",isDurableUserMessageBound:true,tools:BETA_SAFE_TOOLS}),
    userText,specialistType:specialist,specialistMatchedByKeyword:matchedSpecialistByKeyword(userText),attachmentKind:"none" as const,checklistLabels:[]};
  const reads=filterAmoraToolsByQuestionScope(selectAmoraTools(selection).filter(tool=>!isMutatingTool(tool.name)),questionScope);
  const proposals=filterAmoraToolsByQuestionScope(selectAmoraPendingProposalTools({...selection,availableTools:BETA_SAFE_TOOLS.filter(tool=>isMutatingTool(tool.name))})
    .filter(tool=>getAmoraActionApprovalPolicy(tool.name)!=="blocked"),questionScope);
  return {requestKind:"chat",persistenceMode:"durable",specialist,questionScope,enabledToolNames:reads.map(tool=>tool.name),
    actionContract:proposals.length?{kind:"proposal",text:buildAmoraPendingActionPrompt(proposals)}:undefined,maxChars:AMORA_SYSTEM_PROMPT_MAX_CHARS};
}
function protectedLine(prompt: string, heading: string): string {
  const lines=prompt.split("\n"),index=lines.indexOf(heading);
  expect(index).toBeGreaterThan(-1);return lines[index+1];
}
// These are delivery/priority contracts, not a simulation of model answers or a paid-model quality PASS.
describe("바뀐 대상의 이유와 이유 답변 후속을 같은 보호 지침으로 전달한다",()=>{
  it.each(CASES)("%s: 선택된 도구 및 no-tool 포화 답변에도 목적·예외가 사라지지 않는다",(_label,userText)=>{
    const selected=options(userText);expect(selected.questionScope?.scope).toBe("W0_wedding_core");
    for(const saturated of [false,true]) for(const noTools of [false,true]) {
      const context=saturated?{...BASE,chatSummaries:Array.from({length:30},()=>"합성 과거 설명과 이전 AI의 신혼집 예산 질문. ".repeat(100))}:BASE;
      const prompt=buildAmoraSystemPrompt(context,noTools?{...selected,enabledToolNames:[]}:selected);
      const pivot=protectedLine(prompt,"[준비 방향 변경]");
      expect(pivot).toContain("바꾼 대상의 이유만 한 번");
      expect(pivot).toContain("기존 우선순위·AI 제안의 이유로 바꾸지 마세요");
      expect(pivot).toContain("이유 답변에는 미변경 선호·우선순위·생략·시기의 유지와 영향받는 규모·식사·견적의 재검토를 함께");
      expect(pivot).toContain("미변경 선호·우선순위·생략·시기의 유지");
      expect(pivot).toContain("영향받는 규모·식사·견적의 재검토");
      expect(pivot).toContain("작은 월 선호는 되묻지");
      expect(pivot.length).toBeLessThanOrEqual(233);
      const turn=protectedLine(prompt,"[준비 의견의 근거 확인]");
      expect(turn).toContain("큰 전환 이유 답변·요청된 비교는 이어가고");
      expect(turn.indexOf("큰 전환 이유 답변")).toBeLessThan(turn.indexOf("의견 전달만이면"));
      expect(turn).toContain("경청·안전·이유 거부가 우선");
      expect(turn).toContain("발화자의 말·이유·조건으로 짧게 받고 비교·중재·다음 행동은 붙이지 마세요");
      expect(turn).toContain("명시 실행은 승인 규칙을 따르세요");
      expect(turn).toContain("상대의 미확인을 반대·차이·쟁점·충돌로 만들지 마세요");
      expect(prompt).toContain("사용자가 바꾼 부분만 대화 기준");
      expect(prompt).toContain("이유를 이미 말했으면 다시 묻지");
      expect(prompt).toContain("그냥 들어달라거나 연기·취소 또는 위기 안전 상황이면 이유 확인보다 경청·안전");
      expect(prompt).toContain("저장 요청이 없는 턴에 저장 약속·실패 안내를 만들지");
      expect(prompt.split("[준비 방향 변경]")).toHaveLength(2);
      expect(prompt).toContain("[서버 확정 요청 계약]");
      expect(prompt.length).toBeLessThanOrEqual(48000);
      if(saturated)expect(prompt).toContain("길이 제한으로 생략됨");
      else expect(prompt.includes("길이 제한으로 생략됨")).toBe(!noTools && BASELINE_SELECTED_TRUNCATED.has(_label));
    }
  });
  it("voice와 보호 규칙의 합계는 a9의 5,680자 예산을 넘지 않는다",()=>{
    const prompt=buildAmoraSystemPrompt(BASE,options(CASES[1][1]));
    expect(AMORA_CARE_VOICE.length+protectedLine(prompt,"[준비 방향 변경]").length+protectedLine(prompt,"[준비 의견의 근거 확인]").length).toBeLessThanOrEqual(5680);
  });
  it.each(["paused","called_off"] as const)("준비 상태 %s의 경청·재촉 금지가 유지된다",preparationStatus=>{
    const prompt=buildAmoraSystemPrompt({...BASE,preparationStatus},options(CASES[1][1]));
    expect(prompt).toContain("이유를 캐묻지 말고, 사용자가 말한 범위 안에서만 도우세요");
    expect(prompt).toContain("다음 할 일을 재촉하지 마세요");
  });
  it.each(["죽고 싶어. 지금 나를 해치려고 해.","남편이 어제 저를 밀쳤어요"])("안전 갈래는 방향 변경 보호 지침을 받지 않는다: %s",userText=>{
    const prompt=buildAmoraSystemPrompt(BASE,options(userText));
    expect(prompt).not.toContain("[준비 방향 변경]");expect(prompt).not.toContain("[준비 의견의 근거 확인]");
  });
});
