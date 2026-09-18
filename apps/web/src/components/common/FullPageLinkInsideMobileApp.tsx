"use client";

import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";
import { useInsideMobileApp } from "@/hooks/useInsideMobileApp";
import { weddingLinkProps, weddingPath } from "@/lib/weddingPaths";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  /** `weddingLinkProps` 에 넘기던 그 경로(`/checklist?category=venue`, `/lounge` …). */
  path: string;
};

/**
 * 로그인이 필요한 앱 화면으로 가는 링크. 브라우저에서는 지금과 같은 `next/link` 이고,
 * **앱 안 웹뷰에서는 문서를 새로 여는 평범한 `<a href>`** 다.
 *
 * 앱 웹뷰(`apps/mobile/app/webview.tsx`)는 이런 주소를 네이티브 화면으로 넘긴다 —
 * `/wedding/checklist?category=venue` 는 그 분야를 연 체크리스트로, `/wedding/lounge` 는
 * 라운지 탭으로, `/wedding/chat?amoraSource=…` 는 아모라 채팅으로. 그 판단은
 * `onShouldStartLoadWithRequest` 에서만 하고, 그 콜백은 **문서 이동에서만** 불린다.
 *
 * `next/link` 는 누르면 `preventDefault` 하고 클라이언트에서 옮긴 뒤 주소를 `pushState` 로
 * 바꾼다. react-native-webview 는 `pushState` 를 그 콜백에 보내지 않는다. 게다가 웹뷰에는
 * 앱의 세션이 없어서, 클라이언트 라우터가 프록시의 307 을 따라가 `/login?redirect=…` 를
 * 그린다. 앱에 로그인한 사람이 웹 로그인 화면을 만났고, 앱은 어디로 가려 했는지 보지 못했다.
 *
 * 서버 렌더와 첫 hydration 은 언제나 `next/link` 다(`useInsideMobileApp` 이 그때 false).
 * 둘 다 같은 `<a href>` 를 그리므로 hydration 이 어긋나지 않고, 브라우저 방문자에게는
 * 아무것도 달라지지 않는다.
 *
 * 공개 화면끼리만 오가는 링크(예절 안내의 이전·다음 편)는 여기로 옮기지 않는다 — 웹뷰
 * 안에서 그대로 클라이언트 이동하는 편이 빠르고, 앱이 넘길 곳도 없다.
 */
export default function FullPageLinkInsideMobileApp({ path, children, ...anchor }: Props) {
  const insideApp = useInsideMobileApp();
  if (insideApp) return <a href={weddingPath(path)} {...anchor}>{children}</a>;
  return <Link {...weddingLinkProps(path)} {...anchor}>{children}</Link>;
}
