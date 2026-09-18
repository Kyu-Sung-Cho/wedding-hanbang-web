"use client";

import type { ReactNode } from "react";
import { useInsideMobileApp } from "@/hooks/useInsideMobileApp";

/**
 * 앱 안 웹뷰에서만 감추는 자리. 브라우저에서는 `children` 을 그대로 그린다.
 *
 * 앱은 예절 안내·공시가 같은 공개 화면을 웹뷰로 연다. 그 웹뷰에는 앱의 세션이 없어서
 * (쿠키를 넘기지 않는다) 웹의 머리·아래 메뉴·바닥글이 가리키는 곳 대부분이 **앱에 로그인한
 * 사람에게 웹 로그인 화면**이 되고, 앱의 아래 탭·머리와 두 겹으로 쌓인다. 그런 틀과
 * 가입 권유를 여기에 넣는다.
 *
 * 판정은 앱이 문서보다 먼저 심는 표식으로만 한다(`useInsideMobileApp`). 서버 렌더와 첫
 * hydration 은 언제나 브라우저 모양이라 **브라우저 방문자에게는 아무것도 달라지지 않는다.**
 *
 * 서버 컴포넌트가 `children` 으로 넘긴 마크업은 그대로 서버에서 그려진다 — 이 껍데기만
 * 클라이언트 코드다.
 */
export default function HiddenInsideMobileApp({ children }: { children: ReactNode }) {
  const insideApp = useInsideMobileApp();
  if (insideApp) return null;
  return <>{children}</>;
}
