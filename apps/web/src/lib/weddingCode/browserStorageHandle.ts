/**
 * 웨딩코드가 이 브라우저의 저장소(window.localStorage)를 받는 유일한 자리(v3.1 과 v4 가 함께 쓴다).
 *
 * 저장소가 막힌 브라우저(쿠키와 사이트 데이터 차단, 일부 앱 안 브라우저)에서는 루트 레이아웃의 대체 스니펫(lib/browserStorageFallback.ts)이
 * window.localStorage 를 메모리 객체로 갈아 끼운다. 그 객체는 쓰고 읽어도 탭을 닫으면 사라지므로 진짜 저장소가 아니다.
 * 그걸 그대로 쓰면 「이 브라우저에 저장됐어요」라고 말하고도 새로고침에 답을 잃는다(쓰고 바로 읽는 확인으로는 잡히지 않는다).
 * 그래서 브라우저가 만든 진짜 Storage 만 돌려주고(Object.prototype.toString 이 [object Storage]), 아니면 저장할 수 없다고 알린다.
 *
 * - realLocalStorage(): 던지지 않고 진짜 저장소가 아니면 null. v4 의 browserStorage() 가 이것을 그대로 돌려준다.
 * - requireRealLocalStorage(): 진짜 저장소가 아니면 던진다. v3.1 은 저장소가 안 닿을 때 던짐을 잡아 상태를 unavailable 로 두므로(기존 catch),
 *   막힌 브라우저가 같은 길로 「저장할 수 없어요」를 말하게 된다.
 *
 * 저장소 이름(window.localStorage)은 이 파일의 realLocalStorage 한 함수 안에만 있다. 소스 가드(scripts/tests/wedding-code-v40-source-guards.test.mjs 규칙 5)가
 * 이름이 이 함수 밖이나 v4 의 다른 파일에 나오는 것을 막는다. 이 파일은 저장소에 쓰거나 읽지 않고 핸들만 건넨다.
 */
export function realLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const handle = window.localStorage;
    if (handle === null || handle === undefined) return null;
    return Object.prototype.toString.call(handle) === "[object Storage]" ? handle : null;
  } catch {
    return null;
  }
}

export function requireRealLocalStorage(): Storage {
  const handle = realLocalStorage();
  if (handle === null) throw new Error("이 브라우저에는 저장할 수 있는 저장소가 없어요.");
  return handle;
}
