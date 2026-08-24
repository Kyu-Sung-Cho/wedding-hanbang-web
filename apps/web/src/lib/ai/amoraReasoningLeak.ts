/**
 * 모델의 **사고 서두**가 사용자에게 나가는 것을 막는다.
 *
 * 2026-08-24 운영 실측 — "방금 추가한 드레스 피팅 일정 취소해줘" 에 이렇게 답했다:
 *
 *     We need respond current request.
 *
 *     User prefix [신부] not direct partner only [신부→상대방] ignored.
 *
 *     Need query scheduled events first to get ID expected.
 *
 *     Must get schedule events planned perhaps exact dates.
 *
 *     Use tool.
 *
 *     실제 실행 결과가 확인되지 않아 이 변경은 아직 반영되지 않았어요. …
 *
 * 영어 사고가 **내부 표식(`[신부→상대방]`)까지 그대로** 사용자 화면에 나가고 DB 에
 * 저장됐다. 서버 파이프라인은 제안 표식·중재 블록·확인문은 걸러내는데 이 서두만
 * 통과시켰다.
 *
 * 아모라는 사용자에게 **한국어로만** 말한다(시스템 프롬프트가 못 박고 있다).
 * 그래서 규칙은 단순하다 — 한글이 하나도 없는 앞쪽 문단들은 답이 아니다.
 *
 * 뒤에 한글 문단이 실제로 있을 때만 걷어낸다. 전부 비한글이면 손대지 않는다
 * (그건 다른 문제이고, 빈 응답을 만드는 것이 더 나쁘다).
 */

const HANGUL = /[가-힣]/;

/** 문단을 가르는 빈 줄. */
const PARAGRAPH_SPLIT = /\n\s*\n/;

/**
 * 대괄호 안의 내부 표식은 한국어 답변으로 세지 않는다.
 *
 * 실제 누출문에 `[신부]`·`[신부→상대방]` 이 들어 있었다. 그 한글 때문에 영어
 * 사고 문단이 "한국어 답" 으로 잘못 판정됐다.
 */
function looksKorean(paragraph: string): boolean {
  return HANGUL.test(paragraph.replace(/\[[^\]]*\]/g, " "));
}

export function stripAmoraReasoningPreamble(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  const paragraphs = text.split(PARAGRAPH_SPLIT);
  if (looksKorean(paragraphs[0] ?? "")) return text;

  const firstKorean = paragraphs.findIndex(looksKorean);
  // 한글 문단이 아예 없으면 그대로 둔다 — 빈 응답을 만들지 않는다.
  if (firstKorean <= 0) return text;

  return paragraphs.slice(firstKorean).join("\n\n").trimStart();
}
