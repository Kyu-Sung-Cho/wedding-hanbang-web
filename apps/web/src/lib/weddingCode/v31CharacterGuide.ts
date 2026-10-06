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

export function v31CoupleGuide(first: V31Draft, second: V31Draft) {
  const a = buildV31StyleSummary(first); const b = buildV31StyleSummary(second);
  return a.dimensions.map((axis, index) => {
    const other = b.dimensions[index];
    const supported = axis.items.every(item => item.rating !== null) && other.items.every(item => item.rating !== null);
    return { key: axis.key, title: axis.title, first: axis, second: other, supported,
      observation: !supported ? "아직 비교할 답이 부족해 한쪽 방식으로 해석하지 않아요."
        : axis.items.every((item, position) => item.response === other.items[position].response)
          ? "두 문장에 같은 답을 골랐어요. 실제 상황에서도 같은 뜻인지 확인해 보세요."
          : "같은 문장에 다르게 답한 부분이 있어요. 이유를 하나씩 확인해 보세요.",
      ...(supported ? COUPLE[axis.key] : { action: null, say: null }),
    };
  });
}
