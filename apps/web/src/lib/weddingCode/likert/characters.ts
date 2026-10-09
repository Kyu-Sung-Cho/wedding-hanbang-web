import type { Character } from "./types";

/**
 * Fixed editorial illustrations for likert-letters-alpha.3.
 * Names come from the public v4.4 nickname catalogue; old codes are not reused.
 * Source: components/wedding-code/v40/nicknameV44.ts, V44_NICKNAMES.
 * Adjectives and animals are playful names, never measured traits or abilities.
 */
export const CHARACTERS: readonly Character[] = [
  {
    code: "CJOL", name: "세심한 수달", adjective: "세심한", animal: "수달", color: "rose",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 직접 자료 비교 · 가족의 생각 확인 · 내 이야기 경청.",
  },
  {
    code: "CJOA", name: "든든한 비버", adjective: "든든한", animal: "비버", color: "sage",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 직접 자료 비교 · 가족의 생각 확인 · 구체적인 정리 도움.",
  },
  {
    code: "CJUL", name: "다정한 사슴", adjective: "다정한", animal: "사슴", color: "gold",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 직접 자료 비교 · 둘의 기준 정리 · 내 이야기 경청.",
  },
  {
    code: "CJUA", name: "포근한 기러기", adjective: "포근한", animal: "기러기", color: "blue",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 직접 자료 비교 · 둘의 기준 정리 · 구체적인 정리 도움.",
  },
  {
    code: "CTOL", name: "차분한 고슴도치", adjective: "차분한", animal: "고슴도치", color: "gold",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 가족의 생각 확인 · 내 이야기 경청.",
  },
  {
    code: "CTOA", name: "단정한 다람쥐", adjective: "단정한", animal: "다람쥐", color: "rose",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 가족의 생각 확인 · 구체적인 정리 도움.",
  },
  {
    code: "CTUL", name: "온화한 곰", adjective: "온화한", animal: "곰", color: "sage",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 둘의 기준 정리 · 내 이야기 경청.",
  },
  {
    code: "CTUA", name: "담담한 펭귄", adjective: "담담한", animal: "펭귄", color: "blue",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 기본 구성 보강 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 둘의 기준 정리 · 구체적인 정리 도움.",
  },
  {
    code: "EJOL", name: "산뜻한 토끼", adjective: "산뜻한", animal: "토끼", color: "rose",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 직접 자료 비교 · 가족의 생각 확인 · 내 이야기 경청.",
  },
  {
    code: "EJOA", name: "경쾌한 돌고래", adjective: "경쾌한", animal: "돌고래", color: "blue",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 직접 자료 비교 · 가족의 생각 확인 · 구체적인 정리 도움.",
  },
  {
    code: "EJUL", name: "따뜻한 부엉이", adjective: "따뜻한", animal: "부엉이", color: "gold",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 직접 자료 비교 · 둘의 기준 정리 · 내 이야기 경청.",
  },
  {
    code: "EJUA", name: "명랑한 제비", adjective: "명랑한", animal: "제비", color: "sage",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 직접 자료 비교 · 둘의 기준 정리 · 구체적인 정리 도움.",
  },
  {
    code: "ETOL", name: "느긋한 고양이", adjective: "느긋한", animal: "고양이", color: "sage",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 가족의 생각 확인 · 내 이야기 경청.",
  },
  {
    code: "ETOA", name: "가뿐한 여우", adjective: "가뿐한", animal: "여우", color: "gold",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 가족의 생각 확인 · 구체적인 정리 도움.",
  },
  {
    code: "ETUL", name: "아늑한 판다", adjective: "아늑한", animal: "판다", color: "rose",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 둘의 기준 정리 · 내 이야기 경청.",
  },
  {
    code: "ETUA", name: "편안한 코알라", adjective: "편안한", animal: "코알라", color: "blue",
    tagline: "이번 응답에서 대표 표가 더 많았던 방향: 원하는 경험 추가 · 합의한 기준 아래 한 사람이 초기 후보를 추려 공유하는 방식의 수용 · 둘의 기준 정리 · 구체적인 정리 도움.",
  },
];

const charactersByCode = new Map(CHARACTERS.map(character => [character.code, character]));

/** Exact lookup in this expression version; no answer hashing, random choice or fallback. */
export function getCharacter(code: string): Character | undefined {
  return charactersByCode.get(code);
}
