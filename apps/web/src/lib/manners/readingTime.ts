/**
 * 이 글을 읽는 데 실제로 걸리는 시간.
 *
 * 예전에는 `JSON.stringify(part.sections).length / 1800` 이었는데 두 곳에서 틀렸다.
 *
 *   1. **JSON 길이를 셌다.** 따옴표·중괄호·`"kind"` 같은 키 이름까지 글자로 세어
 *      실제 본문보다 1.36배 부풀었다(25편 실측).
 *   2. **분당 1,800자를 가정했다.** 한국어 묵독은 그 3분의 1 수준이고, 이 글에는 표와
 *      목록이 섞여 있어 더 느리다.
 *
 * 둘이 곱해져 **화면이 실제의 절반을 표시했다.** 「축의금」은 8분이라고 적혀 있었지만
 * 실제로는 10,377자짜리다. 8분인 줄 알고 연 사람이 17분을 쓰게 되고, 그 사람은 다음에
 * 이 가이드를 안 연다. 예상 시간은 장식이 아니라 **읽을지 말지를 정하는 숫자**다.
 */
export const KOREAN_CHARS_PER_MINUTE = 600;

/** 사람이 읽는 글자만 센다 — 블록 종류나 근거 번호는 화면에 글로 나오지 않는다. */
export function readableCharCount(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + readableCharCount(item), 0);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).reduce<number>(
      (sum, [key, item]) =>
        key === "kind" || key === "sourceRefs" || key === "unsourced"
          ? sum
          : sum + readableCharCount(item),
      0,
    );
  }
  return 0;
}

/** 편 하나의 예상 읽기 시간(분). 목록 카드와 본문이 **같은 값**을 말해야 한다. */
export function readingMinutesOf(sections: unknown): number {
  return Math.max(1, Math.round(readableCharCount(sections) / KOREAN_CHARS_PER_MINUTE));
}
