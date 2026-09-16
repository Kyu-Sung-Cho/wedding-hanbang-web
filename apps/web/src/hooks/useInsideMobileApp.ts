"use client";

import { useSyncExternalStore } from "react";
import { MOBILE_WEB_API_NONCE_PROPERTY } from "@/lib/mobile/mobileAuthenticatedFetch";

/**
 * 이 페이지가 **앱 안 웹뷰**에서 열렸는가.
 *
 * 앱은 문서가 뜨기 전에 `window.__HANBANG_MOBILE_API_NONCE__` 를 심는다
 * (`apps/mobile/app/webview.tsx` 의 `injectedJavaScriptBeforeContentLoaded`).
 * 브라우저에는 그 값이 없다. UA 문자열로 재지 않는 이유는 UA 는 흉내낼 수 있고
 * 기기·OS 버전마다 갈리는데, 이 표식은 앱이 직접 심은 것이라 정확하기 때문이다.
 *
 * 세 가지를 모두 만족해야 앱이다.
 *
 *   1. 최상위 문서일 것 — 표식은 최상위에만 들어온다. 남의 iframe 이 값을 흉내내
 *      우리 화면을 깎아내지 못하게 한다(`mobileAuthenticatedFetch` 와 같은 규칙).
 *   2. 웹뷰 다리가 있을 것.
 *   3. **앱이 심은 nonce 가 있을 것** — 다리만으로는 부족하다. `ReactNativeWebView`
 *      는 우리 앱이 아닌 다른 앱의 웹뷰에도 있고, 그쪽에서는 브라우저처럼 다룬다.
 */
function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  if (window.top !== window.self) return false;
  if (!window.ReactNativeWebView) return false;
  return typeof window[MOBILE_WEB_API_NONCE_PROPERTY] === "string";
}

/** 서버 렌더와 hydration 때의 값. 서버에는 `window` 가 없으니 늘 "브라우저"다. */
function getServerSnapshot(): boolean {
  return false;
}

/** 표식은 문서가 뜨기 전에 한 번 심기고 그 뒤 바뀌지 않는다. 구독할 것이 없다. */
function subscribe(): () => void {
  return () => {};
}

/**
 * `useEffect` + `setState` 대신 `useSyncExternalStore` 를 쓴다. 서버 렌더와 첫
 * hydration 은 `getServerSnapshot`(= false) 으로 맞추고, 그 뒤에 실제 값으로
 * 넘어간다 — hydration 이 어긋나지 않으면서 이펙트 안에서 상태를 바꾸지도 않는다.
 * 브라우저 사용자에게는 두 값이 같으므로 아무 일도 일어나지 않는다.
 */
export function useInsideMobileApp(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
