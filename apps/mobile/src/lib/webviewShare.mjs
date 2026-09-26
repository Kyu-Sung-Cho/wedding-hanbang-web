/* global URL */
/**
 * 웹뷰 머리의 「현재 페이지 공유」가 내보낼 주소.
 *
 * 이 사이트는 **서버에 보내면 안 되는 것을 주소의 `#` 뒤에 싣는다.** 웨딩코드 답
 * (`/wedding-code#v=…&a=…`), 두 사람 결과 방의 접근 키(`/wedding-code/together#room=…&access=…`),
 * 커플 초대 코드(`/invite#…`), 로그인 링크의 세션 값(`/login#access_token=…`)이 그렇다.
 * 웹뷰는 지금 보는 주소를 `#` 까지 그대로 기억하므로, 예전 공유 버튼은 그 값을 그대로 보냈다.
 *
 * 실제로 일어나던 일(2026-09-26 감사에서 찾음): 앱에서 웨딩코드 상대 초대를 만들면 웹이
 * 초대자 본인용 주소 `#room=…&access=<초대자 키>` 로 옮겨 간다. 그 화면에서 머리의 공유
 * 버튼을 누르면 초대 링크가 아니라 이 주소가 나갔고, 받은 사람은 참여자가 아니라 초대자
 * 권한으로 7일 동안 두 사람 답을 보고 연결을 끝낼 수 있었다.
 *
 * 그래서 공유 주소는 이렇게 만든다.
 * - `#` 뒤는 어떤 화면에서도 보내지 않는다. 문단 앵커 정도를 잃지만, 새는 것보다 낫다.
 * - 웨딩코드는 `?` 뒤도 보내지 않는다. 옛 판 링크는 답을 `?v=…&a=…` 에 실었다.
 * - 두 사람 결과 화면(`/wedding-code/together`)은 `#` 없이는 "잘못된 링크" 화면이라
 *   웨딩코드 첫 화면을 보낸다. 상대 초대는 웹 화면 안의 초대 버튼이 따로 한다.
 * - 이 사이트가 아닌 주소, 로그인 정보가 붙은 주소, `/api/` 주소는 보내지 않는다(`null`).
 *
 * **왜 화면 파일이 아니라 여기 있나.** `webviewUnsavedWork.mjs` 와 같은 이유다. 함수로
 * 떼어 두어야 테스트가 "어떤 주소가 나가는가"를 직접 물을 수 있다.
 *
 * @param {string} url 웹뷰가 지금 보고 있는 주소
 * @param {string} siteOrigin 앱이 여는 사이트의 origin
 * @returns {string | null} 공유해도 되는 주소, 없으면 null
 */
export function shareableWebViewUrl(url, siteOrigin) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== siteOrigin || parsed.username !== "" || parsed.password !== "") return null;

  const { pathname } = parsed;
  if (/^\/api(\/|$)/.test(pathname)) return null;
  if (/^\/wedding-code\/together(\/|$)/.test(pathname)) return `${siteOrigin}/wedding-code`;
  if (/^\/wedding-code(\/|$)/.test(pathname)) return `${siteOrigin}${pathname}`;
  return `${siteOrigin}${pathname}${parsed.search}`;
}
