import { describe, expect, it } from "vitest";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { getPlaceSearchToolChoice, isExplicitPlaceSearchIntent, isPlaceSearchCandidate } from "@/lib/ai/placeSearchRouting";

const K02 = "첫인사 자리에서 결혼 계획을 어디까지 말할지 두 사람이 미리 맞춰보려고 해. 아직 예식일은 못 정했고 우리 총예산은 예산 탭에 저장돼 있어. 부모님께 아직 정하지 않은 내용을 확정한 것처럼 말하지 않으면서, 둘이 먼저 나눌 질문 세 가지만 짧게 알려줘. 어떤 기록도 새로 저장하거나 수정하지 마.";
const FB397 = "다시 설명해줘. 결혼 준비에서 상견례와 결혼식이 각각 어떤 자리인지 두 문장으로 알려줘. 일반 개념만 설명해줘. (출시 점검 FB397-20260913)";
const choice = (userText: string) => getPlaceSearchToolChoice({ userText, round: 0, tools: BETA_SAFE_TOOLS });

describe("place context in a conversation is not a request to find a place", () => {
  it.each([
    FB397,
    "다시 설명해줘. 결혼 준비에서 상견례와 결혼식이 각각 어떤 자리인지 두 문장으로 알려줘. 일반 개념만 설명해줘.",
    "상견례와 결혼식은 각각 어떤 자리인가요? 두 문장으로 알려주세요.",
    "결혼 준비에서 상견례는 어떤 자리야? 짧게 알려줘.",
    "결혼 준비에서 상견례는 어떤 자리인 건가요? 개념만 알려줘.",
    "상견례 자리의 의미만 알려줘.",
    "상견례 자리는 무슨 의미인지 알려줘.",
    "상견례 자리가 무슨 뜻인지 알려줘.",
    "상견례와 결혼식 자리의 차이를 알려줘.",
    "상견례와 결혼식의 차이를 두 문장으로 알려줘.",
  ])("does not offer or force search when explaining a ceremony's meaning: %s", text => {
    expect(isPlaceSearchCandidate(text)).toBe(false);
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
    expect(choice(text)).toBeUndefined();
  });

  it.each([
    K02,
    "첫인사 자리에서 부모님께 드릴 말과 둘이 나눌 질문 세 가지만 알려줘.",
    "상견례 식당에서 부모님과 나눌 질문 세 가지만 짧게 알려줘.",
    "강남 한정식집에서 부모님께 어디까지 결혼 계획을 말할지 질문 세 가지만 알려줘.",
    "카페에서 부모님을 만나는데 결혼 이야기를 어떻게 꺼낼지 알려줘.",
  ])("does not offer or force place search for advice: %s", text => {
    expect(isPlaceSearchCandidate(text)).toBe(false);
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
    expect(choice(text)).toBeUndefined();
  });

  it.each([
    "첫인사 자리에서 부모님 모실 식당 찾아줘",
    "그 장소에서 부모님 모실 식당 찾아줘",
  ])("does not treat a generic location noun as a known district: %s", text => {
    expect(isPlaceSearchCandidate(text)).toBe(true);
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
    expect(choice(text)).toBeUndefined();
  });

  it.each([
    "공덕에 상견례 한정식집 찾아줘",
    "마포에서 부모님 모시고 식사할 만한 곳 알려줘",
    "질문 세 개는 알겠어. 공덕에 부모님 모실 식당 찾아줘.",
    "상견례 자리에서 할 말도 알려주고, 공덕에 한정식집도 찾아줘.",
    "공덕에 상견례 하기 좋은 자리 알려줘.",
    "상견례 자리의 의미도 알려주고, 공덕에 부모님 모실 식당 찾아줘.",
    "상견례가 어떤 자리인지 알려주고, 공덕에서 상견례 할 만한 곳도 찾아줘.",
    "상견례는 어떤 자리야? 짧게 알려주고 공덕에 상견례 식당 찾아줘.",
    "상견례는 어떤 자리인 건가요? 개념도 알려주고 공덕에 상견례 식당 찾아줘.",
    "공덕에서 부모님 모실 자리는 뜻깊게 골라줘.",
    "공덕에 상견례 자리는 의미 있게 골라줘.",
  ])("preserves an actual request to find a place with a region: %s", text => {
    expect(isPlaceSearchCandidate(text)).toBe(true);
    expect(isExplicitPlaceSearchIntent(text)).toBe(true);
    expect(choice(text)).toEqual({ type: "function", name: "search_nearby_places" });
  });

  it.each([
    "부모님 모시고 식사할 만한 곳 알려줘",
    "부모님 모실만한데 알려줘",
    "상견례 식당 추천해줘",
    "한정식집에 자리 있는지 추천해줘",
  ])("keeps search available but lets the assistant ask for a missing region: %s", text => {
    expect(isPlaceSearchCandidate(text)).toBe(true);
    expect(isExplicitPlaceSearchIntent(text)).toBe(false);
    expect(choice(text)).toBeUndefined();
  });
});
