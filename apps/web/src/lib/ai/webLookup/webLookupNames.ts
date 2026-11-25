/**
 * 찾아보기 도구 이름. 가져오는 것이 없는 파일이다 — 브라우저 번들(`stores/chatStore.ts` 가 부르는
 * `placeSearchResultPolicy.ts`)도 이 이름을 쓰므로, 서버 전용 모듈(`node:net` 등)을 끌어오지 않게
 * 여기 따로 둔다.
 */
export const SEARCH_WEB_TOOL_NAME = "search_web";
export const READ_PAGE_TOOL_NAME = "read_page";
export const AMORA_WEB_LOOKUP_TOOL_NAMES: ReadonlySet<string> = new Set([SEARCH_WEB_TOOL_NAME, READ_PAGE_TOOL_NAME]);

export function isAmoraWebLookupToolName(name: string): boolean {
  return AMORA_WEB_LOOKUP_TOOL_NAMES.has(name);
}
