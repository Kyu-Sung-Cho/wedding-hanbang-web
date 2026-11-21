/**
 * 찾아보기(2026-11-20 D-85) 결과 가운데 한 말풍선에 그릴 것을 고른다. 가져오는 것이 없는 순수 함수라
 * `node --test`(`src/__tests__/webLookupResultSelection.test.mjs`)가 바로 잰다.
 *
 * 방금 끝난 턴의 말풍선에는 실시간 결과(tool_result)와 done 의 저장본이 함께 들어온다.
 * - 방금 받은 검색 결과가 있으면 같은 턴의 저장된 자리표시(`displayOnlyPlaceholder`)는 그리지 않는다.
 * - 방금 받은 페이지 읽기가 있으면 같은 턴의 저장본(`storedCopy`)은 그리지 않는다. 저장본에는 업체
 *   주소가 없어(2026-11-22 파운더 결정 4) 주소로는 같은 읽기인지 맞출 수 없다.
 * 다시 열면 저장본만 있으므로 자리표시와 저장본을 그린다.
 */
export interface WebLookupResultLike {
  toolName: string;
  toolOutput: Record<string, unknown>;
}

export function selectWebLookupResultsToRender<T extends WebLookupResultLike>(results: readonly T[]): T[] {
  const webLookup = results.filter((result) => result.toolName === "search_web" || result.toolName === "read_page");
  const hasLiveSearch = webLookup.some(
    (result) => result.toolName === "search_web" && result.toolOutput.displayOnlyPlaceholder !== true,
  );
  const hasLivePageRead = webLookup.some(
    (result) => result.toolName === "read_page" && result.toolOutput.storedCopy !== true,
  );
  return webLookup.filter((result) => (
    result.toolName === "search_web"
      ? !(hasLiveSearch && result.toolOutput.displayOnlyPlaceholder === true)
      : !(hasLivePageRead && result.toolOutput.storedCopy === true)
  ));
}
