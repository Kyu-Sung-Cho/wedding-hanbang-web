import type { V31Draft } from "@/constants/weddingCodeV31";
import { buildV31StyleSummary, type V31StyleDimension, type V31StyleKey } from "./v31StyleSummary";

/** Independent v3.1 display vocabulary. These codes are never translated into v4 axes. */
export const V31_CHARACTERS = [
  ["KTFL", "다정한", "사슴"], ["KTFA", "든든한", "곰"],
  ["KTCL", "차분한", "고양이"], ["KTCA", "포근한", "강아지"],
  ["KDFL", "온화한", "토끼"], ["KDFA", "담담한", "비버"],
  ["KDCL", "조용한", "판다"], ["KDCA", "단정한", "거북이"],
  ["RTFL", "산뜻한", "여우"], ["RTFA", "경쾌한", "돌고래"],
  ["RTCL", "느긋한", "코알라"], ["RTCA", "명랑한", "펭귄"],
  ["RDFL", "부드러운", "알파카"], ["RDFA", "따뜻한", "다람쥐"],
  ["RDCL", "아늑한", "부엉이"], ["RDCA", "편안한", "코끼리"],
] as const;

const GUIDES: Record<string, { strength: string; caution: string; action: string; say: string }> = {
  K: { strength: "처음 정한 전체 예산을 선택의 기준으로 삼아볼 수 있어요.", caution: "추가 비용이 생길 때 무엇을 줄일지도 함께 정해두면 좋아요.", action: "계약 전에 추가 비용을 포함한 총액이 정한 예산 안인지 확인해 보세요.", say: "처음 정한 전체 예산 안에서 고르고 싶어. 추가 비용이 생기면 무엇을 줄일지 같이 보자." },
  R: { strength: "전체 예산을 늘릴지 다시 이야기할 여지를 남겨둘 수 있어요.", caution: "늘릴 때마다 누가 얼마를 부담할지도 다시 확인해 보세요.", action: "예산을 늘려도 되는 이유와 새 상한선을 함께 적어보세요.", say: "전체 예산을 늘릴지 다시 이야기하고 싶어. 이유와 부담할 금액부터 같이 확인하자." },
  T: { strength: "시간을 맞춰 함께 업체를 찾아보는 과정을 만들 수 있어요.", caution: "둘의 시간이 안 맞는 날에는 같이 할 일과 따로 할 일을 다시 정해보세요.", action: "함께 업체를 살펴볼 시간을 한 번 정해보세요.", say: "같이 업체를 찾아보고 싶어. 이번 주에 둘 다 가능한 시간이 언제일까?" },
  D: { strength: "계약이나 추가 결제가 없는 작은 선택은 맡은 사람이 정할 수 있어요.", caution: "이 답은 계약이나 추가 결제까지 혼자 결정해도 된다는 뜻은 아니에요.", action: "혼자 정해도 되는 작은 선택과 함께 확인할 계약을 나눠 적어보세요.", say: "작은 선택은 맡은 사람이 정하되, 계약이나 추가 결제는 같이 확인하자." },
  F: { strength: "가족의 바람을 준비 초반에 들어볼 수 있어요.", caution: "가족의 바람을 듣는 것과 마지막 선택을 맡기는 것은 달라요.", action: "가족에게 먼저 물어볼 것과 둘이 정할 것을 구분해 보세요.", say: "가족의 바람을 먼저 듣고 싶어. 마지막에 우리가 정할 부분도 같이 적어볼까?" },
  C: { strength: "마지막 선택을 둘이 확인하는 기준을 만들 수 있어요.", caution: "둘이 결정하더라도 다른 사람에게 언제 어떻게 설명할지는 함께 정해보세요.", action: "최종 결정 전에 둘 다 확인할 항목을 하나 정해보세요.", say: "마지막 선택은 우리가 같이 하고 싶어. 가족에게는 어떤 부분부터 설명하면 좋을까?" },
  L: { strength: "해결책보다 먼저 이야기를 들어주는 도움을 요청할 수 있어요.", caution: "언제부터 해결 방법을 함께 찾아도 되는지 말해주면 좋아요.", action: "지친 날에는 먼저 들어줄 시간이 필요한지 알려보세요.", say: "지금은 먼저 내 이야기를 들어주면 좋겠어. 방법을 찾고 싶어지면 말할게." },
  A: { strength: "몰린 일의 일부를 맡아주는 구체적인 도움을 요청할 수 있어요.", caution: "대신 해줄 일의 범위와 마무리 기준을 함께 확인해 보세요.", action: "도움을 받고 싶은 일 하나와 필요한 시점을 말해보세요.", say: "지금은 이 일의 일부를 맡아주면 도움이 될 것 같아. 여기까지 해줄 수 있을까?" },
};

export function v31Character(draft: V31Draft) {
  const summary = buildV31StyleSummary(draft);
  if (summary.dimensions.some(axis => axis.pending !== null || axis.borderline || !GUIDES[axis.letter])) return null;
  const row = V31_CHARACTERS.find(character => character[0] === summary.code);
  return row ? { code: row[0], adjective: row[1], animal: row[2] } : null;
}

export function v31PersonalGuide(axis: V31StyleDimension) {
  if (axis.pending !== null || axis.borderline) return null;
  return GUIDES[axis.letter] ?? null;
}

export function v31ExploreQuestion(axis: V31StyleDimension) {
  if (axis.pending === "not_in_plan") return "이번 준비에 해당하지 않으면 그대로 두어도 괜찮아요. 상황이 바뀔 때만 다시 살펴보세요.";
  if (axis.key === "support" && axis.letter === "N") return "이야기를 먼저 들어주기와 일 일부 맡아주기에 모두 낮게 답했어요. 다른 도움이 필요한지, 지금은 도움 없이 쉬고 싶은지 떠오르는 상황에서만 확인해 보세요. 둘 중 하나를 고를 필요는 없어요.";
  if (axis.key === "support" && axis.letter === "B") return "두 도움에 모두 동의했어요. 하나만 필요한 사람으로 정하지 않아요. 지친 날 먼저 이야기를 나눈 뒤 일을 나누는 것이 좋을지, 반대 순서가 좋을지 확인해 보세요.";
  const questions: Record<V31StyleKey, string> = {
    budget: "원하는 선택의 총액이 처음 예산보다 커진다면, 다른 항목을 줄일지 전체 예산을 다시 이야기할지 어느 쪽부터 해보고 싶나요?",
    teamwork: "업체 세 곳을 알아봐야 하는 주를 떠올려보세요. 같이 찾아볼 시간과 혼자 정해도 되는 작은 선택을 어떻게 나누고 싶나요?",
    family: "가족의 바람을 듣고 둘이 마지막 선택을 해야 하는 상황이라면, 무엇을 먼저 물어보고 어떤 결정은 둘이 하고 싶나요?",
    support: "준비 일이 몰려 지친 날을 떠올려보세요. 이야기를 먼저 들어주기, 일 일부 맡아주기, 둘 다 중 지금은 무엇이 도움이 될까요?",
  };
  return `${questions[axis.key]} 아직 모르거나 상황마다 달라도 괜찮아요. 떠오른 사례가 있을 때만 기존 답을 다시 살펴보세요.`;
}

const COUPLE: Record<V31StyleKey, { action: string; say: string }> = {
  budget: { action: "정한 전체 예산을 지킬지, 어떤 경우에 다시 이야기할지와 새 상한선을 함께 정해보세요.", say: "전체 예산을 지키고 싶은 부분과 다시 논의할 수 있는 경우를 하나씩 말해볼까?" },
  teamwork: { action: "같이 업체를 찾아볼 시간과 혼자 맡아도 되는 작은 선택을 구분해 보세요. 계약·추가 결제는 별도로 함께 확인해요.", say: "같이 찾아볼 일과 각자 정해도 되는 작은 일을 나눠볼까? 계약과 추가 결제는 같이 확인하자." },
  family: { action: "가족의 바람을 듣는 시점과 둘이 최종 선택할 항목을 따로 적어보세요. 두 방식은 함께 할 수도 있어요.", say: "가족의 바람은 언제 듣고, 마지막에 우리가 고를 부분은 무엇인지 같이 적어볼까?" },
  support: { action: "지친 날 원하는 도움을 그때 다시 물어보세요. 먼저 들어주기와 일 일부 맡아주기는 함께 필요할 수도 있어요.", say: "지금은 먼저 들어주는 게 좋을까, 몰린 일을 조금 맡아주는 게 좋을까? 둘 다 필요해도 괜찮아." },
};

type CoordinationState = "same-direction" | "different-directions" | "both" | "neither" | "mixed" | "pending";
export type V31Coordination = {
  state: CoordinationState; situation: string; firstSay: string; secondSay: string; agreement: string; notice: string;
};

function direction(axis: V31StyleDimension) {
  return axis.pending !== null ? "?" : axis.borderline ? "M" : axis.letter;
}
function responseVoice(axis: V31StyleDimension): string {
  if (axis.pending === "not_in_plan") return "이번 준비에는 해당하지 않아. 필요한 상황이 생길 때 다시 이야기하자.";
  const letter = direction(axis);
  if (axis.key === "budget") {
    const voices: Record<string, string> = {
      K: "먼저 정한 예산 안의 선택을 보고 싶어. 추가 비용까지 포함해 비교하자.",
      R: "더 쓰고 싶은 이유를 이야기하고 싶어. 금액 차이와 부담할 범위를 같이 보자.",
      B: "예산 안에서 고르고 싶고, 필요하면 다시 논의할 길도 두고 싶어. 예외 조건을 같이 정하자.",
      N: "두 문장 외에 내가 중요하게 보는 기준부터 이야기해볼게. 예산 유지나 증액으로 먼저 정하지 말자.",
      M: "상황에 따라 답이 달라질 수 있어. 견적 하나를 보면서 어떤 정보가 필요한지 말해볼게.",
      "?": "아직 이 부분을 정하지 않았어. 답을 서두르기보다 필요한 정보를 같이 확인하자.",
    };
    return voices[letter];
  }
  const voices: Record<string, string> = {
    L: "지금 내가 지쳤다면 먼저 이야기를 들어줄래? 방법을 찾고 싶어지면 말할게.",
    A: "지금 내가 지쳤다면 맡아줄 수 있는 일 하나를 같이 고를래? 범위와 시점도 확인하자.",
    B: "두 도움 모두 필요할 수 있어. 먼저 들어준 뒤 일을 나눌지, 지금은 순서를 바꿀지 물어봐 줘.",
    N: "이 두 도움 말고 다른 도움이 필요한지, 지금은 쉬고 싶은지부터 말해볼게. 둘 중 하나를 고르라고 하지 않아도 돼.",
    M: "지금 필요한 도움은 상황을 떠올려야 알 것 같아. 한 방식으로 정하지 말고 그때 물어봐 줘.",
    "?": "아직 어떤 도움이 필요한지 정하지 않았어. 지금 답을 고르기보다 필요할 때 다시 물어봐 줘.",
  };
  return voices[letter];
}

function coordinate(first: V31StyleDimension, second: V31StyleDimension): { observation: string; coordination: V31Coordination } {
  const a = direction(first); const b = direction(second);
  const clear = first.key === "budget" ? ["K", "R"] : ["L", "A"];
  const state: CoordinationState = a === "?" || b === "?" ? "pending"
    : a === "M" || b === "M" ? "mixed"
      : a === "N" || b === "N" ? "neither"
        : a === "B" || b === "B" ? "both"
          : a === b && clear.includes(a) ? "same-direction" : "different-directions";
  let observation: string; let situation: string; let agreement: string;
  if (first.key === "budget") {
    if (state === "same-direction") {
      observation = a === "K" ? "둘 다 처음 정한 전체 예산을 기준으로 삼는 쪽에 답했어요." : "둘 다 전체 예산을 늘릴지 다시 논의하는 쪽에 답했어요.";
      situation = a === "K" ? "추가 옵션이 붙은 견적을 비교할 때, 같은 총액과 포함 항목을 생각하는지 확인해 보세요." : "더 쓰고 싶은 항목이 생길 때, 같은 이유와 부담 범위를 생각하는지 확인해 보세요.";
      agreement = a === "K" ? "견적 하나의 포함·추가 비용을 함께 확인하고, 둘 다 받아들일 수 있는 총액 기준을 적어보세요." : "더 쓰고 싶은 항목 하나의 금액 차이와 각자 부담할 수 있는 범위를 확인한 뒤, 둘이 동의한 상한선을 적어보세요.";
    } else if (state === "different-directions") {
      observation = "한 사람은 처음 예산 안에서 고르기, 다른 사람은 예산을 늘릴지 재논의하기에 답했어요. 실제 갈등이 있다는 뜻은 아니에요.";
      situation = "예산을 넘는 선택이 생길 때, 예산 안의 대안부터 볼지 증액 이유부터 이야기할지 확인해 보세요.";
      agreement = "예산 안의 대안 하나와 더 쓰고 싶은 이유 하나를 나란히 보고, 두 사람 모두 동의한 조건에서만 다시 논의하기로 해보세요.";
    } else if (state === "both") {
      observation = "적어도 한 사람은 예산 유지와 증액 재논의에 모두 동의했어요. 두 바람은 함께 성립할 수 있어요.";
      situation = "평소에는 예산을 지키되 어떤 경우에 다시 논의할지, 두 사람이 생각하는 예외가 같은지 확인해 보세요.";
      agreement = "예산을 유지할 기준 하나와 다시 논의할 수 있는 조건 하나를 적고, 둘 다 받아들일 수 있는지 확인해 보세요.";
    } else {
      observation = state === "neither" ? "적어도 한 사람은 두 예산 문장에 모두 낮게 답했어요. 반대 방식이나 무관심으로 해석하지 않아요." : state === "pending" ? "아직 정하지 않았거나 해당하지 않는 답이 있어, 한쪽 예산 방식을 추론하지 않아요." : "중간·경계 응답이 있어, 예산을 지킬 사람과 늘릴 사람으로 나누지 않아요.";
      situation = "실제 견적 하나를 떠올릴 수 있다면 어떤 기준이나 정보가 더 필요한지 먼저 확인해 보세요. 지금 정할 필요는 없어요.";
      agreement = "각자 필요한 정보나 다른 기준을 하나씩 말해보고, 지금 정하지 않은 부분은 그대로 남겨두세요. 해당하지 않으면 이 대화는 건너뛰어도 괜찮아요.";
    }
  } else {
    if (state === "same-direction") {
      observation = a === "L" ? "둘 다 지쳤을 때 먼저 이야기를 들어주는 도움을 받는 쪽에 답했어요." : "둘 다 지쳤을 때 몰린 일 일부를 맡아주는 도움을 받는 쪽에 답했어요.";
      situation = a === "L" ? "한 사람이 지친 날, 듣기만 원하는지 해결 방법도 함께 찾고 싶은지 확인해 보세요." : "한 사람이 지친 날, 같은 일을 같은 범위까지 맡아달라는 뜻인지 확인해 보세요.";
      agreement = a === "L" ? "지친 사람이 이야기하고 상대가 먼저 듣되, 해결 방법은 원할 때 함께 찾기로 동의해 보세요." : "지친 사람이 부탁할 일 하나를 고르고, 상대가 맡을 수 있는 범위와 시점에 동의한 뒤 나눠보세요.";
    } else if (state === "different-directions") {
      observation = "한 사람은 먼저 경청받기, 다른 사람은 일 일부를 맡아주는 도움 받기에 답했어요. 잘해주는 능력의 차이는 아니에요.";
      situation = "내가 원하는 도움을 그대로 상대에게 주기 전에, 이번에 지친 사람이 무엇을 원하는지 확인해 보세요.";
      agreement = "오늘 지친 사람의 말을 먼저 듣고, 상대는 듣기와 일 나누기 중 요청받은 도움을 할 수 있는지 확인해 보세요. 가능하다고 동의한 도움 하나만 해보세요.";
    } else if (state === "both") {
      observation = "적어도 한 사람은 경청과 일 분담 도움에 모두 동의했어요. 하나만 필요한 사람으로 정하지 않아요.";
      situation = "지친 날 두 도움이 함께 필요한지, 먼저 듣고 나눌지 반대 순서인지 확인해 보세요.";
      agreement = "도움을 받을 사람이 오늘의 순서를 제안하고, 상대가 할 수 있는 범위에 동의한 뒤 하나씩 해보세요.";
    } else {
      observation = state === "neither" ? "적어도 한 사람은 두 도움 모두에 낮게 답했어요. 도움을 원하지 않는 사람이라고 단정하지 않아요." : state === "pending" ? "아직 정하지 않았거나 해당하지 않는 답이 있어, 원하는 도움을 대신 정하지 않아요." : "중간·경계 응답이 있어, 경청이나 일 분담 중 하나로 정하지 않아요.";
      situation = "이 두 가지 외에 다른 도움이 필요한지, 쉬거나 지금 정하지 않는 편이 좋은지 먼저 확인해 보세요.";
      agreement = "각자 지금 원하는 것이 떠오르면 말해보고, 상대가 가능한지 확인해 보세요. 답이 없거나 쉬고 싶다면 어떤 도움도 바로 실행하지 않기로 해보세요.";
    }
  }
  if (first.pending === "not_in_plan" && second.pending === "not_in_plan") {
    observation = "두 사람 모두 이 주제에 해당하지 않는 답이 있어, 지금 필요한 방식으로 해석하지 않아요.";
    situation = "이번 준비에 이 주제가 필요한 상황이 생겼을 때만 다시 확인해 보세요.";
    agreement = "지금은 이 대화를 건너뛰고, 상황이 바뀌면 다시 이야기할지 함께 확인해 보세요.";
  }
  if (state === "same-direction") observation += " 답의 숫자가 다르더라도 갈등이나 성격의 강약으로 해석하지 않아요.";
  return { observation, coordination: { state, situation, firstSay: responseVoice(first), secondSay: responseVoice(second), agreement,
    notice: first.key === "support" ? "받고 싶은 도움에 대한 원문 답을 바탕으로 한 제안이에요. 도움을 주는 능력이나 실제 상황은 이 답만으로 알 수 없어요. 지금도 원하는지 먼저 확인해 주세요." : "원문 답을 바탕으로 한 대화 제안이에요. 실제 예산 금액이나 갈등은 이 답만으로 알 수 없어요. 두 사람 모두 원하는지 먼저 확인해 주세요." } };
}

export function v31CoupleGuide(first: V31Draft, second: V31Draft) {
  const a = buildV31StyleSummary(first); const b = buildV31StyleSummary(second);
  return a.dimensions.map((axis, index) => {
    const other = b.dimensions[index];
    const supported = axis.items.every(item => item.rating !== null) && other.items.every(item => item.rating !== null);
    const tailored = axis.key === "budget" || axis.key === "support" ? coordinate(axis, other) : null;
    return { key: axis.key, title: axis.title, first: axis, second: other, supported,
      observation: tailored?.observation ?? (!supported ? "아직 비교할 답이 부족해 한쪽 방식으로 해석하지 않아요."
        : axis.items.every((item, position) => item.response === other.items[position].response)
          ? "두 문장에 같은 답을 골랐어요. 실제 상황에서도 같은 뜻인지 확인해 보세요."
          : "같은 문장에 다르게 답한 부분이 있어요. 이유를 하나씩 확인해 보세요."),
      coordination: tailored?.coordination ?? null,
      ...(supported ? tailored ? { action: tailored.coordination.agreement, say: tailored.coordination.firstSay } : COUPLE[axis.key] : { action: null, say: null }),
    };
  });
}


/** Decorative exploration name only: never a replacement score or inferred personality. */
export function v31DisplayCharacter(draft: V31Draft) {
  const summary = buildV31StyleSummary(draft); const character = v31Character(draft);
  if (character) return { ...character, mode: "summary" as const, statuses: [] };
  const statuses = summary.dimensions.filter(axis => axis.pending !== null || axis.borderline || !GUIDES[axis.letter]).map(axis => ({
    key: axis.key, title: axis.title, topicName: axis.topicName, letter: axis.letter,
    shortText: axis.pending !== null ? [...new Set(axis.items.filter(item => item.rating === null).map(item => item.responseLabel))].join(" · ")
      : axis.borderline ? "경계에 가까운 답" : axis.letter === "B" ? "두 방식 모두 원함" : axis.letter === "N" ? "두 문장 모두 낮음" : "중간으로 답함",
    text: axis.pending !== null
      ? axis.items.filter(item => item.rating === null).map(item => item.responseLabel).join(" / ")
      : axis.borderline ? "경계에 가까운 답이에요. 한쪽 문장에 4점, 다른 문장에 3점을 골랐어요."
        : axis.letter === "B" ? "두 문장 모두에 동의했어요. 두 방식을 함께 원할 수 있어요."
          : axis.letter === "N" ? "두 문장 모두 낮게 답했어요. 두 방식 밖의 바람이 있을 수 있어요."
            : "중간으로 답한 문장이 있어요. 아직 모른다는 답과는 구분해요.",
  }));
  // Single-state illustrations differ to make the state legible; mixed states retain every row below.
  const axis = statuses.length === 1 ? summary.dimensions.find(item => item.key === statuses[0].key) : null;
  const name = !axis ? ["여러 길을 살피는", "판다"]
    : axis.pending !== null ? ["천천히 알아가는", "부엉이"]
      : axis.borderline ? ["다시 살피는", "토끼"]
        : axis.letter === "B" ? ["함께 살피는", "돌고래"]
          : axis.letter === "N" ? ["새 길을 찾는", "여우"] : ["차근차근 살피는", "거북이"];
  return { code: summary.code, adjective: name[0], animal: name[1], mode: "exploration" as const, statuses };
}
