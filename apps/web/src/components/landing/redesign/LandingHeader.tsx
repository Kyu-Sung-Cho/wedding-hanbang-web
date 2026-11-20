import LandingAccountActions from "./LandingAccountActions";
import LandingSession from "./LandingSession";

/**
 * 머리줄.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)의 시작 화면에는 머리줄이
 * 없다. 그래서 띠를 그리지 않고, 첫 화면 사진 위 오른쪽 위에 로그인 알약 하나만 얹는다.
 * 페이지 맨 위에 붙어 있을 뿐 따라 내려오지 않는다(첫 화면 아래는 고지 바닥글뿐이다).
 *
 * 로그인 상태는 브라우저에서만 확인한다(`LandingSession`). 랜딩은 정적 응답이다.
 */
export default function LandingHeader() {
  return (
    <LandingSession>
      <header className="absolute inset-x-0 top-0 z-10 flex justify-end px-3 pt-[calc(env(safe-area-inset-top)_+_12px)]">
        <LandingAccountActions />
      </header>
    </LandingSession>
  );
}
