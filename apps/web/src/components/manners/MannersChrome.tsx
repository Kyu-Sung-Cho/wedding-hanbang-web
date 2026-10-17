"use client";

import { Component, lazy, Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { SIDEBAR_OFFSET_CLASS } from "@/components/app/sidebarStyles";
import { isPreviewStubMode } from "@/lib/previewStub";
import { loadSignedInAside, loadSignedInTopBar } from "./mannersChromeChunks";

// 로그인한 사람에게만 필요한 부분(사이드바·상단 바·auth 스토어)은 따로 떼어 두었다.
// 로그인 없이 읽는 방문자는 이 파일의 몇 줄만 받는다.
const SignedInAside = lazy(loadSignedInAside);
const SignedInTopBar = lazy(loadSignedInTopBar);

/**
 * 로그인 세션이 있다는 **힌트**. 서버가 아니라 브라우저가 쿠키 이름만 보고 판단한다.
 *
 * 힌트일 뿐이라 틀릴 수 있다. 만료된 쿠키가 남았거나 로그인 중간 쿠키(`-code-verifier`)가
 * 걸려도 되고, 그때는 스토어가 로그인 사용자 없음으로 끝나 공개 모양이 그대로 남는다.
 * 쿠키 값은 읽지 않는다. 이 힌트로 하는 일은 무거운 코드를 불러올지 말지뿐이다.
 */
const SESSION_COOKIE_HINT = /(?:^|;\s*)(?:sb-[^=;]*-auth-token[^=;]*=|demo_mode=true)/;

function subscribeNothing() {
  return () => {};
}

function readSessionHint() {
  // 미리보기 배포는 Supabase 값이 없다. 체험 쿠키가 있어도 로그인 클라이언트를 만들지 않는다
  // (`CommunityAuthInitializer` 도 같은 이유로 이 검사를 한다).
  if (isPreviewStubMode()) return false;
  return SESSION_COOKIE_HINT.test(document.cookie);
}

/**
 * 따로 받는 조각이 실패했을 때(오프라인·배포 직후 옛 조각) 본문까지 오류 화면이 되지 않게 한다.
 * 조각 없이도 공개 모양으로 읽을 수 있으므로 그 모양으로 돌아간다.
 */
class ChromeBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * 예절 가이드의 왼쪽 사이드바 자리와 오른쪽 열의 맨 위 자리.
 *
 * 이 화면은 로그인 없이 읽는 공개 페이지이고, 정적으로 미리 만들어 검색에 노출한다. 그래서
 * 서버 렌더와 첫 hydration 은 **언제나 공개 모양**이다(`useSyncExternalStore` 의 서버 값이
 * 항상 `false`). 로그인한 사람이 열면 hydration 직후에 같은 자리가 앱 사이드바와 상단 바로
 * 바뀐다. 이름·로그아웃·결혼식 D-day·알림이 다른 화면과 똑같이 따라온다.
 *
 * 로그인 세션 쿠키가 없는 방문자에게는 요청도 개인 정보도 없다. 쿠키가 있는 브라우저에서만
 * 조각을 받고 `/api/auth/me` 로 로그인 여부를 확인한다.
 *
 * 예전에는 이 화면만 앱 틀 밖에 따로 그려져, 로그인한 사람이 메뉴에서 예절 가이드를 누르면
 * 사이드바 항목이 바뀌고(웨딩코드가 빠지고 숨겨 둔 커뮤니티가 나옴) 아래쪽 이름·로그아웃과
 * 위쪽 D-day·알림이 사라졌다.
 *
 * 본문(`children`)은 두 모양에서 같은 자리에 있어서 모양이 바뀌어도 다시 그려지지 않는다.
 */
export default function MannersChrome({
  publicAside,
  children,
}: {
  /** 서버가 그린 공개용 사이드바. 로그인 전·로그인 확인 중·로그인 아님일 때 쓴다. */
  publicAside: ReactNode;
  children: ReactNode;
}) {
  const hasSessionHint = useSyncExternalStore(subscribeNothing, readSessionHint, () => false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      {hasSessionHint ? (
        <ChromeBoundary fallback={publicAside}>
          <Suspense fallback={publicAside}>
            <SignedInAside publicAside={publicAside} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          </Suspense>
        </ChromeBoundary>
      ) : publicAside}
      <div className={`group/manners flex min-h-screen min-w-0 flex-col ${SIDEBAR_OFFSET_CLASS}`}>
        {hasSessionHint && (
          <ChromeBoundary fallback={null}>
            <Suspense fallback={null}>
              <SignedInTopBar onMenuToggle={() => setSidebarOpen(true)} />
            </Suspense>
          </ChromeBoundary>
        )}
        {children}
      </div>
    </>
  );
}
