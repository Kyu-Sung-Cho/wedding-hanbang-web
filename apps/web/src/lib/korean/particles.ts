// 한국어 조사 자동 선택. 하드코딩("스튜디오은", "150만원부터과")은 공개 표면·검색
// 스니펫까지 그대로 나가므로, 앞말의 받침을 보고 고른다.
// 괄호·따옴표 같은 장식 문자는 무시하고 마지막 "발음되는" 글자를 기준으로 판정한다.

const TRAILING_DECORATION = /[)\]}'"”’·.\s]+$/;

/** 숫자를 한글로 읽었을 때의 받침 유무 (0~9의 마지막 음절) */
const DIGIT_HAS_FINAL: Record<string, boolean> = {
  "0": true,  // 영
  "1": true,  // 일
  "2": false, // 이
  "3": true,  // 삼
  "4": false, // 사
  "5": true,  // 오
  "6": true,  // 육
  "7": true,  // 칠
  "8": true,  // 팔
  "9": false, // 구
};

export function hasFinalConsonant(value: string): boolean {
  const trimmed = String(value ?? "").replace(TRAILING_DECORATION, "");
  const last = [...trimmed].pop();
  if (!last) return false;
  if (last >= "0" && last <= "9") return DIGIT_HAS_FINAL[last] ?? false;
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 !== 0;
}

function pick(value: string, withFinal: string, withoutFinal: string): string {
  return hasFinalConsonant(value) ? withFinal : withoutFinal;
}

/** 은/는 */
export const topicParticle = (value: string) => pick(value, "은", "는");
/** 이/가 */
export const subjectParticle = (value: string) => pick(value, "이", "가");
/** 을/를 */
export const objectParticle = (value: string) => pick(value, "을", "를");
/** 과/와 */
export const withParticle = (value: string) => pick(value, "과", "와");
/** 으로/로 (ㄹ 받침은 '로') */
export function directionParticle(value: string): string {
  const trimmed = String(value ?? "").replace(TRAILING_DECORATION, "");
  const last = [...trimmed].pop();
  if (last) {
    const code = last.charCodeAt(0) - 0xac00;
    if (code >= 0 && code <= 11171 && code % 28 === 8) return "로"; // ㄹ 받침
  }
  return hasFinalConsonant(value) ? "으로" : "로";
}
