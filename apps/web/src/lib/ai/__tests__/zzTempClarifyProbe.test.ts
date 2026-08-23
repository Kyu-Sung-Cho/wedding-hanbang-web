import { describe, it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
const OUT = "C:/Users/kcho1/AppData/Local/Temp/claude/C--Users-kcho1-Desktop-workspace-hanbang/b30d0a8c-5b92-4862-bc05-260b9db4fed9/scratchpad/probe.txt";
writeFileSync(OUT, "");
const log = (m: string) => appendFileSync(OUT, `${m}\n`);
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { isMutatingTool } from "@/lib/ai/mutationTools";
import {
  selectAmoraTools,
  selectAmoraPendingProposalTools,
} from "@/lib/ai/amoraToolPolicy";
import {
  classifyAmoraQuestionScope,
  filterAmoraToolsByQuestionScope,
} from "@/lib/ai/amoraQuestionScope";
import { getAmoraActionApprovalPolicy } from "@/lib/ai/amoraActionApprovalPolicy";
import { isPlaceSearchCandidate, getPlaceSearchToolChoice } from "@/lib/ai/placeSearchRouting";
import { isAmoraClarificationAnswerShaped } from "@/lib/ai/amoraClarificationContinuity";
import { canAttemptAmoraBoundedContinuity } from "@/lib/ai/amoraBoundedContinuity";

const PENDING_ACTION_TOOLS = BETA_SAFE_TOOLS.filter((t) => isMutatingTool(t.name));

const CORPUS = [
  "우리 결혼식 총예산을 6천만원으로 올리고 싶어",
  "스드메 계약금 200만원 냈어",
  "드레스 투어 다음 주 토요일 오후 2시로 잡아줘",
  "신혼여행 항공권 결제했는데 여기 기록해둘 수 있어?",
  "예식장 계약금 넣은 거 지워줘, 잘못 적었어",
  "이번 주 금요일 상견례 못 가게 됐어",
  "양가 부모님 상견례 장소 공덕 근처로 추천해줘",
  "청첩장은 언제쯤 돌리는 게 맞아?",
  "신부 어머니 한복은 우리가 해드리는 거야?",
  "축의금은 어느 쪽이 관리하는 게 보통이야?",
  "남편이 예산 얘기만 하면 짜증내서 답답해",
  "본식 스냅 추가할지 말지 고민이야",
  "웨딩홀 계약서에 식대 보증인원이 250명이라고 돼 있어",
  "사진 촬영 일정을 한 주 미루고 싶어",
  "예단은 얼마 정도가 요즘 평균이야?",
  "폐백 안 하기로 했어",
  "우리 예산에서 신혼집 가구는 빼줘",
  "부케 값도 예산에 넣어줘",
  "결혼식 3주 남았는데 뭐부터 해야 해?",
  "시부모님께 첫인사 드리러 이번 달 말에 가기로 했어",
  "메이크업 리허설 예약한 거 취소됐대",
  "예식장 투어 세 군데 돌았는데 어디가 나을지 모르겠어",
  "그날 사회자 섭외 아직 안 했어",
  "혼주 메이크업 비용도 스드메에 포함되는 거야?",
  "신혼여행 예산 500만원으로 잡아놨어",
  "답례품 주문 완료했어",
  "결혼식 날짜를 내년 4월 18일로 바꿨어",
  "아버지가 축의금 절반은 본인이 가져가신다는데 이게 맞나",
  "웨딩홀에 식대 1인당 얼마인지 물어봐야 하는데 뭘 물어봐야 해?",
  "다음 달 스튜디오 촬영 시간 오전으로 바꿔줄래?",
];

const ANSWERS = [
  "응 그렇게 해줘",
  "네 맞아요",
  "2027년으로 해줘",
  "두 번째로 할게",
  "신혼집은 빼고 나머지 다 포함해서",
  "응 그럼 그렇게 해줄래?",
  "오후 2시로",
  "둘 다 해줘",
  "맞아 그거야",
  "그럼 오전으로",
];

// 이 커플의 체크리스트 항목 이름(실제 상수에서 뽑아온다)
import { CHECKLIST_MAP } from "@/constants/checklists";
const checklistLabels = Object.values(CHECKLIST_MAP)
  .flatMap((c: { items?: { label: string }[] }) => (c?.items ?? []).map((i) => i.label))
  .slice(0, 120);

function runOne(text: string, opts: { specialist?: string } = {}) {
  const specialistType = (opts.specialist ?? "general") as never;
  const scope = classifyAmoraQuestionScope({ userText: text, requestKind: "chat" });
  const candidateTools = BETA_SAFE_TOOLS; // isDurableUserMessageBound = true
  const policySelected = selectAmoraTools({
    availableTools: candidateTools,
    userText: text,
    specialistType,
    checklistLabels,
    attachmentKind: "none",
  });
  const offersPlaceSearch =
    getPlaceSearchToolChoice({ userText: text, round: 0, tools: candidateTools }) !== undefined
    || isPlaceSearchCandidate(text);
  const selected = offersPlaceSearch
    ? candidateTools.filter(
        (t) => t.name === "search_nearby_places" || policySelected.includes(t),
      )
    : policySelected;
  // shared 대화 가정 + 장소검색 자격증명 있음 가정
  const runnable = selected;
  const available = filterAmoraToolsByQuestionScope(
    runnable.filter((t) => !isMutatingTool(t.name)),
    scope,
  );
  const pendingProposal = filterAmoraToolsByQuestionScope(
    selectAmoraPendingProposalTools({
      availableTools: PENDING_ACTION_TOOLS,
      userText: text,
      specialistType,
      checklistLabels,
      attachmentKind: "none",
    }).filter((t) => getAmoraActionApprovalPolicy(t.name) !== "blocked"),
    scope,
  );
  return {
    scope: scope.scope,
    conf: scope.confidence,
    read: available.map((t) => t.name),
    card: pendingProposal.map((t) => t.name),
  };
}

describe("temp probe", () => {
  it("corpus", () => {
    let zeroRead = 0;
    let zeroCard = 0;
    for (const [i, text] of CORPUS.entries()) {
      const r = runOne(text);
      if (r.read.length === 0) zeroRead += 1;
      if (r.card.length === 0) zeroCard += 1;
      log(
        `${String(i + 1).padStart(2, "0")} | ${r.scope}/${r.conf} | read=${r.read.length} card=${r.card.length} | ${text}\n     read: ${r.read.join(",") || "-"}\n     card: ${r.card.join(",") || "-"}`,
      );
    }
    log(`\n== 도구 0개(조회): ${zeroRead}/30, 확인카드 0개: ${zeroCard}/30`);
  });

  it("answers", () => {
    for (const [i, text] of ANSWERS.entries()) {
      const scope = classifyAmoraQuestionScope({ userText: text });
      log(
        `A${i + 1} | shaped=${isAmoraClarificationAnswerShaped(text)} bounded=${canAttemptAmoraBoundedContinuity(text)} scope=${scope.scope}/${scope.confidence} | ${text}`,
      );
    }
  });

  it("answers with continuity granted (prior W0 text prepended)", () => {
    const prior = "총 예산 5000만원으로 바꿔줘";
    for (const [i, text] of ANSWERS.entries()) {
      const shaped = isAmoraClarificationAnswerShaped(text);
      const intent = shaped ? `${prior}\n${text}` : text;
      const scope = classifyAmoraQuestionScope({
        userText: text,
        hasWeddingClarificationContinuity: shaped,
      });
      const card = filterAmoraToolsByQuestionScope(
        selectAmoraPendingProposalTools({
          availableTools: PENDING_ACTION_TOOLS,
          userText: intent,
          specialistType: "general" as never,
          checklistLabels,
        }).filter((t) => getAmoraActionApprovalPolicy(t.name) !== "blocked"),
        scope,
      );
      log(`A${i + 1} | shaped=${shaped} scope=${scope.scope} card=${card.length} | ${text}`);
    }
  });
});
