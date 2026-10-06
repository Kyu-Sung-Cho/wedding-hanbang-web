"use client";

import { createContext, useContext, type ReactNode } from "react";
import { WEDDING_CODE_V40_VERSION, facetInfo, letterInfo, type FacetInfo, type FacetKey, type Letter, type LetterInfo } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";

const ResultEdition = createContext<string>(WEDDING_CODE_V40_VERSION);

export const BASE_FACET_TALK: Readonly<Record<FacetKey, string>> = {
  limit: "먼저 정할 금액의 선과, 그 선을 바꿀 만한 장면을 각각 말해 볼까요?",
  check: "문서로 확인할 조건과 현장에서 직접 느껴 볼 것을 나눠 볼까요?",
  worth: "결혼식 뒤의 생활과 그날의 경험 중 각자 지키고 싶은 것을 말해 볼까요?",
  moment: "결정 직전에 다시 보게 되는 조건과 그날의 장면을 각자 말해 볼까요?",
  search: "둘이 같이 볼 후보와 한 사람이 추려 와도 되는 후보를 나눠 볼까요?",
  detail: "작은 결정 중 꼭 함께 고를 것과 맡겨도 편한 것을 나눠 볼까요?",
  report: "준비 중간에 언제 알려 주면 서로 안심할지 정해 볼까요?",
  owner: "맡은 일이 막힐 때 언제 함께 풀지 미리 정해 볼까요?",
  timing: "가족이나 가까운 어른에게 어느 단계에서 알리고 싶은지 말해 볼까요?",
  circle: "명단과 자리를 정할 때 둘이 먼저 정할 것과 가족 의견을 들을 것을 나눠 볼까요?",
  final: "의견이 다를 때 누구의 의견을 언제까지 듣고 둘이 결정할지 맞춰 볼까요?",
  form: "익숙한 방식에서 남길 것과 둘에게 맞게 바꿀 것을 골라 볼까요?",
  vent: "힘든 이야기를 꺼냈을 때 처음 듣고 싶은 말이나 도움을 말해 볼까요?",
  fight: "다툰 뒤 마음을 확인할 때와 다음 방법을 정할 때의 순서를 맞춰 볼까요?",
  give: "상대가 지쳤을 때 듣기와 일을 덜어 주기 중 무엇부터 바라는지 물어볼까요?",
  recover: "지친 날 각자 혼자 회복할 시간과 함께할 일을 말해 볼까요?",
};

const V42_FACET_TALK = {
  ...BASE_FACET_TALK,
  check: "기본 조건을 확인한 뒤, 비용 자료와 그날의 경험 중 무엇을 더 보고 싶은지 말해 볼까요?",
  worth: "같은 추가안을 보고 더 낼 만하다고 느끼는 이유를 각자 말해 볼까요?",
  form: "둘의 초안을 먼저 만들지, 가족 의견부터 모을지 준비 하나를 골라 맞춰 볼까요?",
  recover: "지친 날 마음을 먼저 돌아볼지, 남은 일의 부담부터 덜지 각자 편한 순서를 말해 볼까요?",
};

/** 새 문항이 바뀐 범위만 새 판의 설명에 적용한다. 구판의 설명은 유지한다. */
const V42_FACETS: Partial<Record<FacetKey, Pick<FacetInfo, "name" | "probes">>> = {
  check: { name: "비교할 근거", probes: "기본 조건을 확인한 뒤 비용 자료와 현장의 경험 중 무엇을 더 살펴보는지" },
  worth: { name: "더 낼 만한 이유", probes: "같은 추가안을 판단할 때 추가금·남길 여유와 그날 얻을 경험 중 무엇을 판단 근거로 먼저 두는지" },
  form: { name: "가족과 안을 만들 때", probes: "같은 준비 방식의 초안을 둘이 먼저 만들거나 가족 의견부터 함께 모으는지" },
  recover: { name: "지친 날을 마무리할 때", probes: "지친 날의 마음을 정리하거나 남은 일의 부담을 덜 방법을 먼저 찾는지" },
};

const V42_APPEARANCES: Partial<Record<Letter, LetterInfo["appearances"]>> = {
  V: [
    "후보를 보기 전에 쓸 수 있는 비용의 범위를 먼저 적어 볼 수 있어요.",
    "기본 조건을 확인한 뒤 최종 금액과 추가금을 다시 비교할 수 있어요.",
    "추가안의 가치를 판단할 때 비용과 식 뒤의 여유를 먼저 살펴볼 수 있어요.",
    "마지막 선택 전에 남길 금액과 조건을 다시 확인할 수 있어요.",
  ],
  S: [
    "후보를 볼 때 남기고 싶은 하루의 모습부터 그려 볼 수 있어요.",
    "기본 조건을 확인한 뒤 현장의 동선과 분위기를 다시 살펴볼 수 있어요.",
    "추가안의 가치를 판단할 때 그날 얻을 경험부터 떠올릴 수 있어요.",
    "마지막 선택 전에 두 후보에서 보낼 하루를 다시 그려 볼 수 있어요.",
  ],
  U: [
    "둘의 안을 먼저 만들고 가족에게 전하는 방식이 편할 수 있어요.",
    "초대 명단의 초안을 둘이 먼저 만들 수 있어요.",
    "의견이 다르면 둘의 기준을 먼저 맞춘 뒤 가족에게 설명할 수 있어요.",
    "식순이나 안내문 초안은 둘이 먼저 작성할 수 있어요.",
  ],
  F: [
    "둘의 안을 정하기 전에 가족 의견을 들어 보는 방식이 편할 수 있어요.",
    "초대 명단의 초안부터 가족 의견을 함께 모을 수 있어요.",
    "의견이 다르면 가족의 이유를 다시 듣고 둘의 선택을 정할 수 있어요.",
    "식순이나 안내문 초안에 가족 의견을 먼저 모을 수 있어요.",
  ],
  H: [
    "힘들다고 말할 때 해결 방법을 정하기 전에 이야기를 더 들어 주길 바랄 수 있어요.",
    "다툰 뒤 일정을 맞추기 전에 각자 서운했던 점부터 말할 수 있어요.",
    "상대가 벅차다고 하면 연락을 맡기 전에 부담스러운 이유부터 들을 수 있어요.",
    "지친 날 남은 메시지에 답하기 전에 무엇이 버거웠는지 먼저 돌아볼 수 있어요.",
  ],
  A: [
    "힘들다고 말할 때 먼저 덜어 낼 일이나 가능한 방법부터 같이 정하고 싶을 수 있어요.",
    "다툰 뒤 다음에 엇갈리지 않을 방법부터 먼저 살펴볼 수 있어요.",
    "상대가 벅차다고 하면 괜찮은지 물어보고 남은 연락 하나를 맡을 수 있어요.",
    "지친 날 남은 답장 한 통을 마친 뒤 마음을 돌아볼 수 있어요.",
  ],
};

const BASE_METADATA = { facetInfo, letterInfo, facetTalk: BASE_FACET_TALK };
const V42_METADATA = {
  facetInfo: (key: FacetKey): FacetInfo => ({ ...facetInfo(key), ...V42_FACETS[key] }),
  letterInfo: (key: Letter): LetterInfo => {
    const appearances = V42_APPEARANCES[key];
    return { ...letterInfo(key), ...(appearances ? { appearances } : {}) };
  },
  facetTalk: V42_FACET_TALK,
};

export function WeddingCodeResultEditionProvider({ version, children }: { readonly version: string; readonly children: ReactNode }) {
  return <ResultEdition.Provider value={version}>{children}</ResultEdition.Provider>;
}

export function useWeddingCodeResultMetadata() {
  return useContext(ResultEdition) === WEDDING_CODE_V42_VERSION ? V42_METADATA : BASE_METADATA;
}
