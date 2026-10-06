/**
 * 네 글자에 붙이는 놀이 이름. 문항이 동물이나 형용사를 측정한 것은 아니다.
 * 이번 코드의 준비 행동을 장난스럽게 묶었다. 정확한 뜻은 주제별 설명과 실제 응답에서 읽는다.
 */
export const V40_NICKNAMES = {
  VWUH: "함께 살피는 수달",
  VWUA: "함께 챙기는 비버",
  VWFH: "다 같이 살피는 사슴",
  VWFA: "다 같이 챙기는 기러기",
  VDUH: "나눠 살피는 고슴도치",
  VDUA: "나눠 챙기는 다람쥐",
  VDFH: "여럿이 살피는 곰",
  VDFA: "여럿이 챙기는 펭귄",
  SWUH: "함께 그리는 토끼",
  SWUA: "함께 펼치는 돌고래",
  SWFH: "다 같이 그리는 부엉이",
  SWFA: "다 같이 펼치는 제비",
  SDUH: "나눠 그리는 고양이",
  SDUA: "나눠 펼치는 여우",
  SDFH: "여럿이 그리는 판다",
  SDFA: "여럿이 펼치는 코알라",
} as const;

export function nicknameForCode(code: string | null): string | null {
  if (code === null) return null;
  const normalized = code.toUpperCase();
  if (!/^[VS][WD][UF][HA]$/.test(normalized)) return null;
  return V40_NICKNAMES[normalized as keyof typeof V40_NICKNAMES];
}
