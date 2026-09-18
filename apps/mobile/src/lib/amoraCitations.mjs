/**
 * 아모라가 결혼 예절 안내를 **더 읽을 곳**으로 가리킬 때 본문에 `[etiquette:N]` 을 붙인다.
 * 표식은 근거 인용이 아니다 — 아모라는 편 제목만 받고 본문은 받지 않는다(프롬프트와 웹 테스트
 * 「아모라가 안내를 링크하되 근거로 인용하지는 않는다」가 못 박았다).
 *
 * 웹은 이 태그를 파싱해 편 카드 링크로 바꾼다(`ChatBubble.tsx`). 모바일은 처음에 태그를 글자 그대로
 * 그렸고(2026-08-22 스테이징: "축의금 보통 얼마 내?" 답 끝에 `[etiquette:9]`), 그 뒤에는 태그를 걷고
 * 예절 안내를 근거로 삼았다는 한 줄만 그렸다 — 누를 수도 없고 사실도 아닌 말이었다.
 *
 * 2026-09-18(wave 2 · 2.7): 번호 → 편 표를 `@hanbang/shared/manners-part-links` 로 옮겨(정본
 * `parts.json` 과 대조되는 사본), 앱도 웹처럼 편 카드를 붙인다(`AmoraMannersLinks`).
 */
import { mannersPartForCitation } from "@hanbang/shared/manners-part-links";

/** 안내는 25편이다. 범위를 벗어난 번호는 링크가 아니라 오탈자로 본다. */
const MIN_PART = 1;
const MAX_PART = 25;

/**
 * 번호 뒤에 **제목이 붙어서 온다.** 프롬프트는 `[etiquette:번호]` 만 쓰라고 하지만
 * 모델은 지키지 않는다 — 운영 실측(2026-08-26): 표식이 든 assistant 메시지 23건 중
 * **6건**이 제목 형태였고, 네 가지가 나왔다.
 *
 *     [etiquette:2:상견례]  [etiquette:4:청첩장]
 *     [etiquette:8:혼수]    [etiquette:3:예물예단함]
 *
 * 웹(`ChatBubble.tsx:370`)은 이 형태를 받도록 이미 고쳐져 있었는데 모바일은 아니었다.
 * 그래서 걷어내려고 만든 이 파일을 통과해서 사용자 화면에 그대로 남았다.
 * 모바일이 소비자의 주 제품이므로 이쪽이 더 나쁘다.
 */
const CITATION_RE = /\[\s*etiquette\s*:\s*(\d{1,3})\s*(?::[^\]]*)?\]/gi;

/**
 * @param {unknown} content
 * @returns {{ text: string, parts: number[] }}
 */
export function parseAmoraCitations(content) {
  if (typeof content !== "string" || content.length === 0) {
    return { text: typeof content === "string" ? content : "", parts: [] };
  }
  /** @type {number[]} */
  const parts = [];
  // 태그는 모양이 조금 달라도 지운다. 공백이 들어갔다는 이유로 원문이 새면
  // 고치려던 문제가 그대로 남는다.
  const stripped = content.replace(CITATION_RE, (_match, raw) => {
    const value = Number.parseInt(raw, 10);
    if (
      Number.isInteger(value)
      && value >= MIN_PART
      && value <= MAX_PART
      && !parts.includes(value)
    ) {
      parts.push(value);
    }
    return "";
  });
  // 태그가 있던 자리에 생긴 이중 공백·빈 줄을 정리한다. 문단 구분은 유지한다.
  const text = stripped
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, parts };
}

/**
 * 편 번호를 편 카드에 쓸 행으로. 처음 나온 순서를 지키고, 표에 없는 번호는 뺀다.
 * @param {unknown} parts
 * @returns {{ number: number, slug: string, title: string, subtitle: string }[]}
 */
export function resolveAmoraMannersLinks(parts) {
  if (!Array.isArray(parts)) return [];
  const seen = new Set();
  const links = [];
  for (const value of parts) {
    const part = mannersPartForCitation(value);
    if (!part || seen.has(part.slug)) continue;
    seen.add(part.slug);
    links.push({ number: /** @type {number} */ (value), slug: part.slug, title: part.title, subtitle: part.subtitle });
  }
  return links;
}
