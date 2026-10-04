import {
  LATE_RELOAD_HINT_TEXT,
  LATE_RELOAD_LINK_TEXT,
  NO_SCRIPT_HINT_TEXT,
} from "@/lib/browserStorageFallback";

/**
 * 서버 HTML 의 "저장 상태를 확인하는 중" 구간 곁에 두는 보강 안내(감사 A17, A59).
 *
 * 화면 조각 하나가 못 내려오면 시작 단추가 영영 누를 수 없는 채로 남는다. 그때 리액트 코드는 도울 수 없으므로(실패한 번들이 그 코드다)
 * 서버가 그린 HTML 안에서 CSS 지연 애니메이션이 12초 뒤에 새로고침 한 줄을 보인다(`hb-late-hint`, 규칙은 루트 layout 의 head 에 있다).
 * 줄 끝에는 「다시 불러오기」 링크가 있다. 오류 이벤트가 안 오는 실패(응답이 멈춤, 깨지거나 잘린 파일, HTML 응답)에는 위쪽 안내 막대가 안 뜨고,
 * 앱 웹뷰는 이 경로에서 당겨서 새로고침이 막혀 있어서 줄만으로는 새로고침할 길이 없었다. 링크는 `href=""` 라서 스크립트가 없어도 현재 문서를 다시 연다.
 * head 의 인라인 스크립트가 있으면 눌림을 `location.reload()` 로 바꿔 주소의 # 뒤(링크로 받은 답)를 잃지 않는다.
 * `noscript` 는 자바스크립트가 꺼진 브라우저를 위한 줄이다.
 *
 * "확인 중" 구간 안에서만 그려야 한다: 하이드레이션이 끝나 그 구간이 사라지면 이 안내도 함께 사라진다.
 * 상태도 효과도 없어서 서버 HTML 과 첫 클라이언트 그림이 같다.
 *
 * 자바스크립트가 꺼진 브라우저에서는 페이지 본문이 Suspense 스트리밍 컨테이너(`div[hidden]`) 안에 갇혀 이 구간 자체가 안 보인다.
 * 그래서 로딩 화면(`app/wedding-code/loading.tsx`)에도 이 컴포넌트를 둔다. 로딩 화면은 스트리밍 컨테이너 밖에 그려진다.
 */
export default function LoadStallHint({ className = "" }: { className?: string }) {
  return (
    <>
      <p data-late-reload-hint="" className={`hb-late-hint ${className}`.trim()}>
        {LATE_RELOAD_HINT_TEXT}{" "}
        <a
          href=""
          data-late-reload-link=""
          className="inline-flex min-h-11 items-center px-1 font-semibold underline underline-offset-2"
        >
          {LATE_RELOAD_LINK_TEXT}
        </a>
      </p>
      <noscript>
        <p data-no-script-hint="" className={className}>
          {NO_SCRIPT_HINT_TEXT}
        </p>
      </noscript>
    </>
  );
}
