import type { WeddingCodeQuestionKey } from "@/constants/weddingCodeV06";
import { WEDDING_CODE_V12_NEXT_STEPS, WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";

type CoupleRoleGuide = Readonly<{ explanation: string; nextStep: string }>;

const CHOICE_PAIRS: Readonly<Record<string, string>> = {
  AA: "둘 다 함께 고르겠다고 답했어요.",
  BB: "둘 다 직접 고르겠다고 답했어요.",
  CC: "둘 다 상대에게 선택을 맡기겠다고 답했어요.",
  BC: "한 사람은 직접 고르겠다고, 다른 한 사람은 그 사람에게 맡기겠다고 답했어요.",
  AB: "함께 고르자는 답과 한 명이 정하자는 답이 나왔어요.",
  AC: "함께 고르자는 답과 한 명이 정하자는 답이 나왔어요.",
};

const CONSULTATION_PAIRS: Readonly<Record<string, string>> = {
  AA: "둘 다 두 상담에 함께 가겠다고 답했어요.",
  BB: "둘 다 상담을 하나씩 나눠 가겠다고 답했어요.",
  CC: "둘 다 두 상담을 혼자 다녀오겠다고 답했어요.",
  DD: "둘 다 두 상담을 상대에게 맡기겠다고 답했어요.",
  CD: "한 사람은 두 상담을 혼자 다녀오겠다고, 다른 한 사람은 그 사람에게 맡기겠다고 답했어요.",
  AB: "두 상담 모두 같이 가자는 답과 하나씩 나눠 가자는 답이 나왔어요.",
  AC: "두 상담 모두 같이 가자는 답과 한 명이 두 상담에 다 가자는 답이 나왔어요.",
  AD: "두 상담 모두 같이 가자는 답과 한 명이 두 상담에 다 가자는 답이 나왔어요.",
  BC: "상담을 하나씩 나눠 가자는 답과 한 명이 두 상담에 다 가자는 답이 나왔어요.",
  BD: "상담을 하나씩 나눠 가자는 답과 한 명이 두 상담에 다 가자는 답이 나왔어요.",
};

const DELEGATED_NEXT_STEPS = {
  B1: "방문할 세 곳은 누가 추리면 좋을까요? 꼭 가 보고 싶은 곳이나 빼고 싶은 곳을 먼저 말해 두세요.",
  B3: "여행지는 누가 고르면 좋을까요? 꼭 하고 싶은 일정이나 피하고 싶은 조건을 먼저 말해 두세요.",
  B4: "항공권은 누가 고르면 좋을까요? 결제 전에 서로 확인할 것도 정해 두세요.",
  B5: "점심에 연락할 때 날짜를 누가 고를지 정해 보세요. 오후 6시 전에 식장에 알릴 사람도 함께 정해 두세요.",
};

/** 보기 일치 집계와 별개로, v1.2 역할 답에서 '나/상대'가 가리키는 행동만 풀어 쓴다. */
export function buildCoupleRoleGuide(
  version: string,
  key: WeddingCodeQuestionKey,
  first: string | undefined,
  second: string | undefined,
): CoupleRoleGuide | null {
  if (version !== WEDDING_CODE_V12_VERSION || !first || !second) return null;
  if (key !== "B1" && key !== "B2" && key !== "B3" && key !== "B4" && key !== "B5") return null;
  const options = key === "B2" ? ["A", "B", "C", "D"] : ["A", "B", "C"];
  if (!options.includes(first) || !options.includes(second)) return null;
  // 설명은 응답 순서와 무관하며, 원문 인용의 먼저/나중·나/상대 순서는 호출 화면이 유지한다.
  const pair = [first, second].sort().join("");
  const explanation = (key === "B2" ? CONSULTATION_PAIRS : CHOICE_PAIRS)[pair];
  if (!explanation) return null;
  let nextStep: string = WEDDING_CODE_V12_NEXT_STEPS[key];
  if (key !== "B2" && pair === "BB") {
    nextStep = "서로 꼭 반영하고 싶은 조건을 하나씩 말해 보세요. 그다음 함께 고를지, 한 사람이 맡을지 정해 보세요.";
  } else if (key !== "B2" && pair === "CC") {
    nextStep = DELEGATED_NEXT_STEPS[key];
  }
  return { explanation, nextStep };
}
