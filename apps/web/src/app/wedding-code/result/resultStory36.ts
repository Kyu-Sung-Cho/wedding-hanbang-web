import reviewedCopy from "@/lib/weddingCode36/data/type-cards.json";
import type { IndividualPresentation, ProfileCard } from "@/lib/weddingCode36";

export type ResultAnimal36 = "beaver" | "penguin" | "cat" | "peacock" | "otter";

export interface ResultStory36 {
  stateHeading: string;
  tags: string[];
  action: string | null;
  animal: ResultAnimal36;
}

const criterionLabels: Record<string, string> = {
  B: "예산 한도 유지",
  M: "둘의 추억 담기",
  V: "전체 분위기 맞추기",
  G: "하객 경험에 추가로 쓰기",
  S: "시선이 모일 때의 편안함",
  P: "준비 날짜 미리 정하기",
  J: "확정 전에 함께 살펴보기",
  D: "합의한 세부 선택 맡기기",
  F: "가족과 다를 때 둘의 선택",
};

const animals: Record<string, ResultAnimal36> = {
  P: "beaver", J: "penguin", D: "cat", S: "peacock",
};

export function buildResultStory36(result: IndividualPresentation): ResultStory36 {
  const alias = result.assessment.alias;
  const selected = [alias.adjective.criterion, alias.animal.criterion].filter((id): id is string => id !== null);
  const base: ResultStory36 = {
    stateHeading: "이름 하나보다 장면별 답을 함께 봐요",
    tags: selected.map(id => criterionLabels[id]).filter((label): label is string => Boolean(label)),
    action: "답한 장면 중 파트너에게 먼저 설명하고 싶은 것을 하나 골라, 그 답을 고른 이유를 이야기해 보세요.",
    animal: "otter",
  };

  if (alias.status === "full") {
    const card = reviewedCopy.cards.find(entry => entry.id === alias.id);
    return {
      ...base,
      stateHeading: "내 답에서 함께 드러난 두 가지 준비 기준",
      action: card?.action ?? null,
      animal: animals[alias.animal.criterion ?? ""] ?? "otter",
    };
  }

  if (result.answered_count === 0) return { ...base, stateHeading: "아직 답한 장면이 없어요", action: null };

  const profile = Object.values(result.assessment.profile);
  const ratings = profile.flatMap(card => card.ratings);
  const states = profile.map(card => card.state);
  if (ratings.length > 0 && ratings.every(value => value === 3)) return {
    ...base,
    stateHeading: "모든 준비 기준에서 중간 응답을 골랐어요",
    action: "예식장 후보를 떠올리며, 원하는 조건과 아직 정하지 않은 조건을 하나씩 이야기해 보세요.",
  };
  if (states.length > 0 && states.every(state => state === "H")) return {
    ...base,
    stateHeading: "여러 준비 기준에 모두 동의했어요",
    action: "실제로 함께 고를 후보 하나를 떠올리고, 여러 기준을 한꺼번에 반영하기 어려울 때 무엇부터 볼지 이야기해 보세요.",
  };
  if (states.length > 0 && states.every(state => state === "L")) return {
    ...base,
    stateHeading: "제시된 준비 방식에는 동의하지 않았어요",
    action: "동의하지 않았던 문항 하나를 고르고, 대신 원하는 준비 방식이 있는지 이야기해 보세요.",
  };
  if (states.includes("M")) return {
    ...base,
    stateHeading: "답한 장면부터 살펴볼게요",
    action: "답한 장면 중 파트너에게 먼저 설명하고 싶은 것을 하나 골라 보세요. 빈 답은 그대로 두어도 괜찮아요.",
  };
  if (states.includes("X")) return {
    ...base,
    stateHeading: "장면에 따라 답이 달랐어요",
    action: "같은 기준에서 답이 달랐던 두 장면을 골라, 각각 어떤 조건을 보고 답했는지 이야기해 보세요.",
  };
  if (alias.status === "partial") return {
    ...base,
    stateHeading: "반복해서 동의한 준비 기준이 있어요",
    action: "표시된 준비 기준의 세 장면을 보고, 실제 준비에서도 그렇게 하고 싶은지 파트너와 이야기해 보세요.",
  };
  const reasons = [alias.adjective.reason, alias.animal.reason];
  if (reasons.includes("all_supported")) return {
    ...base,
    stateHeading: "함께 드러난 준비 기준이 여러 개예요",
    action: "함께 동의한 기준들을 적고, 실제 선택에서 모두 반영하기 어려울 때 무엇부터 볼지 이야기해 보세요.",
  };
  if (reasons.includes("top_tie")) return {
    ...base,
    stateHeading: "같은 정도로 답한 준비 기준이 있어요",
    action: "비슷하게 답한 기준을 나란히 보고, 실제 선택에서는 각각 언제 먼저 보고 싶은지 이야기해 보세요.",
  };
  if (reasons.includes("small_gap")) return {
    ...base,
    stateHeading: "대표 기준 하나를 고르기에는 답이 비슷했어요",
    action: "비슷하게 답한 기준을 나란히 보고, 실제 선택에서는 각각 언제 먼저 보고 싶은지 이야기해 보세요.",
  };
  return base;
}

export function criterionReading36(card: ProfileCard): { label: string; status: string } {
  let status: string;
  if (card.state === "H") status = "세 장면 모두 동의";
  else if (card.state === "L") status = "세 장면 모두 동의하지 않음";
  else if (card.state === "M") status = "답하지 않은 장면 포함";
  else if (card.state === "X") status = "장면에 따라 동의·비동의";
  else if (card.evidence.every(entry => entry.value === 3)) status = "세 장면 모두 중간 응답";
  else status = "중간 응답이 섞여 있음";
  return { label: criterionLabels[card.id] ?? card.label, status };
}
