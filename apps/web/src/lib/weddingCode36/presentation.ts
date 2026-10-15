import { CRITERIA, FALLBACK_NAME, ITEM_BY_ID, NOTES, QUESTIONNAIRE_VERSION, SCORING_VERSION } from "@/constants/weddingCode36";
import contract from "./data/design-contract.json";
import copy from "./data/type-cards.json";
import { evaluate, validateSubmission } from "./score";
import type { CriterionStats, IndividualPresentation, ProfileCard, Submission } from "./types";

const cardCopy = Object.fromEntries(copy.cards.map(card => [card.id, card]));
const meanings = Object.fromEntries([...copy.adjective_components, ...copy.animal_components].map(component => [component.criterion, component.meaning]));
const conversationOverrides: Record<string, string> = {
  B: "둘이 정한 전체 예산 한도에는 어떤 비용까지 포함할까요? 바꿔야 할 때는 어떻게 다시 정할까요?",
  S: "입장할 때, 이름을 소개할 때, 하객 테이블에서 인사할 때 각각 어떤 방식이면 편할까요?",
};

function criterionCard(id: string, stats: CriterionStats): ProfileCard {
  const criterion = CRITERIA.find(entry => entry.id === id)!;
  let summary: string;
  if (stats.state === "H") summary = "세 장면 모두 ‘그렇다’ 또는 ‘매우 그렇다’로 답했어요.";
  else if (stats.state === "L") summary = "세 장면 모두 ‘그렇지 않다’ 또는 ‘전혀 그렇지 않다’로 답했어요. 원하는 대안까지 정해진 것은 아니에요.";
  else if (stats.state === "M") summary = "답하지 않은 문항이 있어 이 기준의 세 장면 전체 평균은 표시하지 않았어요.";
  else if (stats.state === "X") summary = "같은 기준에서도 장면에 따라 동의와 반대가 함께 나왔어요. 각 장면의 답부터 확인해 봐요.";
  else if (stats.ratings.every(value => value === 3)) summary = "세 장면 모두 ‘동의도 반대도 하지 않는다’로 답했어요. 이 답에서 한 방향의 선호를 정하지 않았어요.";
  else summary = "중간 응답이 포함돼 있어요. 평균 하나로 묶기보다 장면별 동의 정도를 함께 확인해 봐요.";
  return {
    id, label: criterion.label, summary, state: stats.state, mean: stats.display_mean,
    evidence: criterion.item_ids.map((itemId, index) => ({ id: itemId, number: ITEM_BY_ID[itemId].display_number, context: ITEM_BY_ID[itemId].context, statement: ITEM_BY_ID[itemId].statement, value: stats.ratings[index] })),
  };
}

export function presentIndividual(input: Submission): IndividualPresentation {
  const submission = validateSubmission(input);
  const result = evaluate(submission);
  const answers = submission.answers;
  const answered = Object.values(answers).filter(value => value !== null).length;
  const profile = result.profile;
  const states = Object.values(profile).map(stats => stats.state);
  const repeated = CRITERIA.flatMap(criterion => criterion.item_ids.map(id => answers[id]));
  const full = result.alias.status === "full";
  const name = full ? result.alias.name! : FALLBACK_NAME;
  const selected = [result.alias.adjective.criterion, result.alias.animal.criterion].filter((id): id is string => id !== null);
  let summary: string;
  let good: string[];
  let cautions: string[];
  let questions: string[];
  if (!answered) {
    summary = "아직 답한 문항이 없어요. 답을 남기면 해당 장면의 결과를 볼 수 있어요.";
    good = [];
    cautions = ["아직 준비 선호를 설명할 응답이 없어요. 비워둔 답은 중간 점수로 채우지 않아요."];
    questions = [];
  } else if (full) {
    const card = cardCopy[result.alias.id!];
    summary = card.summary;
    good = [card.good_point];
    cautions = [card.caution];
    questions = selected.map(id => conversationOverrides[id] ?? ITEM_BY_ID[CRITERIA.find(criterion => criterion.id === id)!.item_ids[0]].couple_prompt);
  } else {
    if (repeated.every(value => value === 3)) {
      summary = "준비 기준을 묻는 27개 문항 모두 ‘동의도 반대도 하지 않는다’로 답했어요. 이번 답은 한 가지 준비 별명으로 묶지 않았어요.";
      good = ["원하는 방식이 따로 있는지, 아직 생각해보지 않은 장면인지부터 이야기할 수 있어요."];
      cautions = ["중간 응답만으로 균형 감각·유연함·차분한 성격을 판단하지 않아요. 중간 응답이 나온 이유도 사람마다 다를 수 있어요."];
    } else if (states.every(state => state === "H")) {
      summary = "준비 기준을 묻는 모든 장면에서 동의했어요. 여러 기준 중 하나만 대표로 고르지 않았어요.";
      good = ["함께 지키고 싶은 기준들을 적어두고, 실제로 선택이 겹칠 때 무엇부터 반영할지 이야기할 수 있어요."];
      cautions = ["여러 방식에 동의한 것이 모든 일을 잘하거나 실제로 전부 해낼 수 있다는 뜻은 아니에요."];
    } else if (states.every(state => state === "L")) {
      summary = "준비 기준을 묻는 모든 문항에 ‘그렇지 않다’ 또는 ‘전혀 그렇지 않다’로 답했어요. 어떤 대안을 원하는지는 이 답만으로 정하지 않았어요.";
      good = ["제시된 방식 외에 원하는 준비 방식이 있는지 말로 덧붙여 볼 수 있어요."];
      cautions = ["낮은 동의가 무관심이나 반대 성향의 증거는 아니에요. 실제로 원하는 대안을 따로 확인해 주세요."];
    } else if (states.includes("M")) {
      summary = "답한 내용부터 볼 수 있어요. 답하지 않은 문항이 있어 대표 준비 별명은 한 가지로 정하지 않았어요.";
      good = ["답한 장면의 응답은 그대로 확인할 수 있어요. 모든 질문에 억지로 답할 필요는 없어요."];
      cautions = ["모름·비해당·답하고 싶지 않음은 3점과 달라요. 비어 있는 답을 특정 성향으로 채우지 않아요."];
    } else if (states.includes("X")) {
      summary = "같은 준비 기준에서도 장면에 따라 답이 달랐어요. 상황별 답을 함께 보도록 정리했어요.";
      good = ["어느 장면에서 원하는 방식이 달라지는지 구체적으로 이야기할 수 있어요."];
      cautions = ["장면별 답이 다르다고 일관성이 없는 사람이라는 뜻은 아니에요. 실제 상황과 선택 이유를 함께 봐주세요."];
    } else {
      summary = "비슷하게 답한 기준이 있거나, 대표 기준을 고를 만큼 반복된 동의가 뚜렷하지 않았어요. 답한 내용부터 함께 볼게요.";
      good = ["하나의 이름에 맞추지 않고, 함께 드러난 준비 기준들을 나란히 확인할 수 있어요."];
      cautions = ["동점이나 작은 점수 차이에서 특정 기준을 임의로 골라 성향으로 단정하지 않아요."];
    }
    questions = ["예식장을 고를 때 어떤 점부터 정해두면 편할까요?", "이 답을 고른 이유 중 파트너에게 먼저 알려주고 싶은 것은 무엇인가요?"];
  }
  if (selected.length && !full) cautions.push("확인된 부분: " + selected.map(id => meanings[id]).join(" / "));
  const why = full ? selected.map(id => meanings[id]) : ["이 이름은 대표 준비 별명이 한 가지로 정해지지 않은 결과를 안내하는 캐릭터 이름이에요. 성격을 판정한 이름은 아니에요."];
  return {
    name, name_kind: full ? "supported_preferences" : "response_state_character", summary, why_this_name: why,
    good_points: good, cautions, conversation: questions,
    profile: answered ? Object.entries(profile).map(([id, stats]) => criterionCard(id, stats)) : [],
    notes: answered ? NOTES.map(note => ({ id: note.id, label: note.label, number: ITEM_BY_ID[note.id].display_number, context: ITEM_BY_ID[note.id].context, statement: ITEM_BY_ID[note.id].statement, value: answers[note.id], default_share: false as const, type_input: false as const })) : [],
    display_order: [...contract.presentation_rules.display_order], answered_count: answered, technical_code_in_primary_display: false,
    questionnaire_version: QUESTIONNAIRE_VERSION, scoring_version: SCORING_VERSION,
    assessment: result, human_validation_completed: false,
  };
}

export const presentSubmission = presentIndividual;
