import type { DomainProfile, ItemResponse } from "./model";
import { SCALE, type Domain } from "./types";

function responseName(entry: ItemResponse, profile: DomainProfile): string {
  if (entry.item.facet === "T") return "합의한 기준 안에서 한 사람이 초기 후보를 추려 공유하는 방식 수용";
  if (entry.item.facet === "A") {
    const tasks: Record<string, string> = {
      "likert.support.tour.v1": "홀 투어 메모 정리",
      "likert.support.compare.v1": "후보 비교표 정리",
      "likert.support.contact.v1": "업체 답변 메모 정리",
    };
    return tasks[entry.item.sceneId] ?? "구체적인 정리 도움";
  }
  return profile.facets.find(facet => facet.facet === entry.item.facet)?.label ?? entry.item.construct;
}

function valueLabel(entry: ItemResponse): string {
  const answer = entry.answer;
  if (answer?.status === "rated") return `${answer.value}(${SCALE.find(option => option.value === answer.value)?.label})`;
  if (answer?.status === "unknown") return "아직 모르겠어요";
  if (answer?.status === "not_applicable") return "해당하지 않아요";
  if (answer?.status === "skipped") return "건너뜀";
  return "미응답";
}

function signature(entries: ItemResponse[]): string {
  return entries.map(entry => entry.answer?.status === "rated" ? entry.answer.value : entry.answer?.status ?? "unanswered").join("|");
}

const questions: Record<Domain, string> = {
  money: "실제 옵션과 추가 비용이 달라져도 같은 답일까요?",
  process: "직접 볼 자료와 공유 방법은 무엇인가요? 누가 초기 후보를 추릴지는 별도로 정해 볼까요?",
  family: "가족에게 확인할 내용과 우리 둘의 기준을 한 가지씩 말해 볼까요?",
  support: "지금 부탁하고 싶은 도움과 쉬는 방법은 무엇인가요?",
};

// 같은 글자나 비율이 아니라 장면별 원답을 읽는다. 휴식 두 문항도 그대로 포함한다.
export function buildDomainInsights(profile: DomainProfile): string[] {
  const entries = profile.facets.flatMap(facet => facet.items);
  const scenes = profile.scenes.map(scene => ({
    title: scene.title,
    entries: entries.filter(entry => entry.item.sceneId === scene.sceneId),
  }));
  const rated = entries.filter(entry => entry.answer?.status === "rated");
  const incomplete = scenes.filter(scene => scene.entries.some(entry => entry.answer?.status !== "rated"));
  const complete = scenes.filter(scene => scene.entries.every(entry => entry.answer?.status === "rated"));
  const fact = (scene: (typeof scenes)[number]) => `${scene.title} — ${scene.entries.map(entry => `${responseName(entry, profile)} ${valueLabel(entry)}`).join(" · ")}`;
  const scope = incomplete.length > 0 ? ` 모든 문장에 1~5로 답하지 않은 장면 ${incomplete.length}개는 장면 간 비교에 넣지 않았어요.` : "";
  let observation: string;
  let question = questions[profile.domain];

  if (rated.length === 0) {
    const count = (status: "unknown" | "not_applicable" | "skipped" | "unanswered") => entries.filter(entry => status === "unanswered" ? entry.answer === null : entry.answer?.status === status).length;
    observation = `1~5로 남긴 답이 없어 장면별 동의를 비교하지 않았어요. 모름 ${count("unknown")}개 · 비해당 ${count("not_applicable")}개 · 건너뜀 ${count("skipped")}개 · 미응답 ${count("unanswered")}개.`;
    question = "이 장면들을 떠올리려면 어떤 내용이 더 필요하나요? 해당하지 않는 장면은 그대로 남겨도 괜찮아요.";
  } else {
    const first = complete[0];
    const different = first ? complete.find(scene => signature(scene.entries) !== signature(first.entries)) : undefined;
    if (first && different) {
      observation = `장면마다 답이 달랐어요. ${fact(first)} / ${fact(different)}.${scope}`;
    } else if (first && complete.length === scenes.length) {
      observation = `${complete.length}개 장면에서 응답 조합이 같았어요. ${fact(first)}.`;
      question = "같은 칸을 골랐어도 장면마다 떠올린 이유가 같았나요?";
      if (profile.domain === "process") question += " 누가 초기 후보를 추릴지는 별도로 상의해요.";
    } else {
      const partial = incomplete.find(scene => scene.entries.some(entry => entry.answer?.status === "rated"));
      observation = `${partial ? fact(partial) : first ? fact(first) : "남긴 원답을 확인해 주세요"}.${scope}`;
    }
    if (rated.every(entry => entry.answer?.status === "rated" && entry.answer.value <= 2)) {
      question = "답한 문장은 모두 1·2였어요. 제시된 방법 밖에서 원하거나 받아들일 수 있는 것은 무엇인가요?";
    } else if (rated.every(entry => entry.answer?.status === "rated" && entry.answer.value === 3)) {
      question = "‘보통이다’에는 어떤 뜻을 담았나요? 장면마다 그 뜻도 같았나요?";
    }
  }
  return [`이번 답 · ${profile.title}: ${observation}`, `나에게 한 질문 · ${profile.title}: ${question}`];
}
