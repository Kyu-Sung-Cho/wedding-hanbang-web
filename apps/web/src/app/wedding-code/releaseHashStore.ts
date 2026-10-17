/**
 * 판을 고를 때 읽는 주소 해시(`#…`)의 저장소. `useSyncExternalStore` 에 넘긴다.
 * 공개 입구(`WeddingCodeReleaseClient`)와 라운지(`LoungeWeddingCodeSwitch`)가 같은 규칙으로 판을 고르도록 한 곳에 둔다.
 */
export function createReleaseHashStore() {
  let held = "";
  let pathname: string | null = null;
  return {
    getSnapshot() {
      pathname ??= window.location.pathname;
      // 다른 페이지로 돌아가는 중에는 그 페이지의 목차 조각을 답으로 읽지 않는다.
      if (window.location.pathname !== pathname) return held;
      const current = window.location.hash;
      if (current) held = current;
      return current || held;
    },
    subscribe(onChange: () => void) {
      const receive = () => {
        if (window.location.pathname !== pathname) return;
        // 구판은 받은 답을 메모리로 옮긴 뒤 주소를 비운다. 그 답의 판을 계속 유지한다.
        if (!window.location.hash && held) return;
        held = window.location.hash;
        onChange();
      };
      window.addEventListener("hashchange", receive);
      window.addEventListener("popstate", receive);
      return () => {
        window.removeEventListener("hashchange", receive);
        window.removeEventListener("popstate", receive);
      };
    },
  };
}
