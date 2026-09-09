/** 서버 입력용 표식만 걷는다. 안쪽 문장·일반 대괄호·구조화 출력 블록은 보존한다. */
export function stripAmoraRequestMarkers(text: string): string {
  return text.replace(/\[\/?(?:INITIAL_GREETING|MEDIATION_REQUEST)\]/giu, "");
}

/** 닫는 대괄호가 다음 토큰에 와도 예약 표식부터는 최종 본문까지 미리보기를 보류한다. */
export function hasAmoraRequestMarkerPrefix(text: string): boolean {
  return /\[\/?(?:INITIAL_GREETING|MEDIATION_REQUEST)(?:\]|$)/iu.test(text);
}
