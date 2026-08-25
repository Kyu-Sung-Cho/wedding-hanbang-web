/**
 * 아모라가 예절 안내를 근거로 답할 때 본문에 `[etiquette:N]` 을 붙인다.
 *
 * 웹은 이 태그를 파싱해 안내 카드 링크로 바꾼다(`ChatBubble.tsx`). **모바일은 안 했다.**
 * 그래서 사용자가 보는 화면에 `[etiquette:9]` 가 글자 그대로 남았다 — 근거를 대라고
 * 만든 표식이 오히려 깨진 텍스트로 보인다. 모바일이 소비자의 주 제품이므로 이쪽이
 * 더 나쁘다(2026-08-22 스테이징 실측: "축의금 보통 얼마 내?" 답 끝에 `[etiquette:9]`).
 *
 * 여기서는 **본문에서 태그를 걷어내고 몇 편을 근거로 했는지만** 돌려준다. 번호를
 * 주제 링크로 바꾸려면 `MANNERS_PARTS`(번호→슬러그) 가 필요한데 그 자료는 지금
 * `apps/web` 안에만 있고 1,800줄짜리 본문과 한 파일이다. 옮기는 건 따로 판단할 일이고,
 * 그 사이에 사용자가 깨진 태그를 보는 상태로 두지 않는다.
 */

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
 * 근거 칩에 쓸 문구. 편 수를 세어 말한다 — 무엇을 근거로 했는지 사용자가 알아야
 * 한다는 것이 이 표식의 목적이다.
 * @param {number[]} parts
 * @returns {string | null}
 */
export function describeAmoraCitations(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  return parts.length === 1
    ? "결혼 예절 안내를 근거로 했어요"
    : `결혼 예절 안내 ${parts.length}편을 근거로 했어요`;
}
