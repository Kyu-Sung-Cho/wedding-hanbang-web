/**
 * 보이지 않는 문자(제어 문자, 줄 구분자, 폭 없는 문자, 글 방향 바꾸기 문자, BOM)를 다룬다.
 *
 * 범위를 **코드 포인트 숫자**로 적고 실행할 때 정규식을 만든다. 소스에 역슬래시-u 이스케이프를 쓰면
 * 편집 도구가 그것을 실제 문자로 바꿔 넣는 일이 있었다(2026-11-20, 이 파일을 만든 이유). 그러면
 * 정규식 한가운데 실제 줄 구분자가 박혀 문법이 깨진다. 숫자는 그렇게 바뀌지 않는다.
 *
 * 범위는 `prompts.ts` 의 `promptData` 가 지우는 것과 같다(그보다 조금 넓다).
 */

const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x7f],
  [0x61c, 0x61c],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

const INVISIBLE_CLASS = INVISIBLE_RANGES
  .map(([from, to]) => (from === to
    ? String.fromCodePoint(from)
    : `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`))
  .join("");

/** 줄바꿈(0x0a)·캐리지 리턴(0x0d)·탭(0x09)은 남긴다. 그건 글의 줄 구조다. */
export function stripInvisibleChars(text: string): string {
  return text.replace(new RegExp(`[${INVISIBLE_CLASS}]`, "gu"), " ");
}

/** 앞뒤의 공백과 보이지 않는 문자만 벗긴다(열쇠·한 줄 값). 가운데는 건드리지 않는다. */
export function trimInvisibleEdges(text: string): string {
  return text
    .replace(new RegExp(`^[\\s${INVISIBLE_CLASS}]+`, "u"), "")
    .replace(new RegExp(`[\\s${INVISIBLE_CLASS}]+$`, "u"), "");
}

/** 글 맨 앞의 BOM 하나를 뗀다. */
export function stripLeadingBom(text: string): string {
  return text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
}
