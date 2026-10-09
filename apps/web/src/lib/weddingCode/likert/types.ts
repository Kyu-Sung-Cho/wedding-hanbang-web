export const MEASUREMENT_VERSION = "likert-preferences-alpha.1" as const;
export const BANK_REVISION = "preferences-20261008-r2" as const;
export const EXPRESSION_VERSION = "likert-letters-alpha.4" as const;
export const STORAGE_KEY = "hanbang:wedding-code:likert-alpha.1:draft" as const;

export type Domain = "money" | "process" | "family" | "support";
export type Letter = "C" | "E" | "J" | "T" | "O" | "U" | "L" | "A";
export type Facet = Letter | "together_rest" | "alone_rest";
export type Rating = 1 | 2 | 3 | 4 | 5;
export type Answer =
  | { status: "rated"; value: Rating }
  | { status: "unknown" | "not_applicable" | "skipped" };
export type Answers = Record<string, Answer>;

export interface Item {
  id: string;
  domain: Domain;
  facet: Facet;
  sceneId: string;
  sceneTitle: string;
  context: string;
  text: string;
  construct: string;
  resultUse: string;
}

export type Screen = "intro" | "questions" | "result" | "compare";
export interface Draft {
  version: typeof MEASUREMENT_VERSION;
  revision: typeof BANK_REVISION;
  expressionVersion: typeof EXPRESSION_VERSION;
  answers: Answers;
  cursor: number;
  screen: Screen;
  updatedAt: string;
}

export interface Snapshot {
  version: typeof MEASUREMENT_VERSION;
  revision: typeof BANK_REVISION;
  expressionVersion: typeof EXPRESSION_VERSION;
  answers: Answers;
  createdAt: string;
}

export interface Character {
  code: string;
  name: string;
  animal: string;
  adjective: string;
  tagline: string;
  color: "rose" | "sage" | "gold" | "blue";
}

export interface LetterDefinition {
  letter: Letter;
  english: string;
  name: string;
  definition: string;
}

export interface DomainDefinition {
  id: Domain;
  name: string;
  question: string;
  letters: readonly [Letter, Letter];
}

export const DOMAIN_DEFINITIONS: readonly DomainDefinition[] = [
  { id: "money", name: "지출의 우선순위", question: "추가 예산을 어디에 먼저 쓰고 싶은가", letters: ["C", "E"] },
  { id: "process", name: "준비 작업의 출발점", question: "후보를 살펴보고 추리는 일을 어떻게 하고 싶은가", letters: ["J", "T"] },
  { id: "family", name: "가족과 협의할 기준", question: "가족의 생각과 둘의 기준을 어떻게 준비하고 싶은가", letters: ["O", "U"] },
  { id: "support", name: "대화와 실무 도움", question: "경청과 정리 도움 중 무엇에 더 높게 답했는가", letters: ["L", "A"] },
];

export const LETTER_DEFINITIONS: Record<Letter, LetterDefinition> = {
  C: { letter: "C", english: "Core", name: "기본 구성 보강", definition: "추가 예산을 이미 정한 기본 구성의 내용이나 편의에 우선 배정하고 싶은 방향" },
  E: { letter: "E", english: "Experience", name: "원하는 경험 추가", definition: "추가 예산을 본인이 원하는 기념 장면이나 연출에 우선 배정하고 싶은 방향" },
  J: { letter: "J", english: "Join", name: "직접 자료 비교", definition: "후보를 추리는 과정에서 나도 자료와 차이를 직접 살펴보고 싶은 마음" },
  T: { letter: "T", english: "Team shortlisting", name: "기준 안의 후보 분담 수용", definition: "함께 정한 기준 안에서 한 사람이 초기 후보를 추려 공유하는 방식을 받아들일 수 있다는 응답" },
  O: { letter: "O", english: "Others' input", name: "가족의 생각 확인", definition: "초안을 준비할 때 가족이 중요하게 여기는 점을 확인하고 싶은 마음" },
  U: { letter: "U", english: "Us", name: "둘의 기준 정리", definition: "가족 의견을 검토할 때 우리 둘이 원하는 조건을 명확히 정리해 두고 싶은 마음" },
  L: { letter: "L", english: "Listen", name: "내 이야기 경청", definition: "준비 직후 상대가 내 이야기를 들어주는 도움을 받고 싶은 마음" },
  A: { letter: "A", english: "Assist", name: "구체적인 정리 도움", definition: "준비 직후 메모나 비교표처럼 구체적인 자료를 정리하는 도움을 받고 싶은 마음" },
};

export const SCALE: readonly { value: Rating; label: string }[] = [
  { value: 1, label: "전혀 그렇지 않다" },
  { value: 2, label: "그렇지 않다" },
  { value: 3, label: "보통이다" },
  { value: 4, label: "그렇다" },
  { value: 5, label: "매우 그렇다" },
];
