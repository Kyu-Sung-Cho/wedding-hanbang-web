/**
 * 브라우저 저장소가 막힌 환경에서도 화면이 열리게 한다.
 *
 * 무엇이 문제였나: `sessionStorage` 접근이 던지는 브라우저(사파리 프라이빗 모드,
 * 사이트 데이터 차단 설정, 일부 기업 정책)에서 `(community)` 그룹 화면이 통째로
 * 에러 화면으로 바뀌었다. 사용자에게는 "잠시 문제가 생겼어요"만 보인다.
 *
 * 원인은 인증이 아니라 Realtime 소켓이다. 실제 스택:
 *   createClient → createBrowserClient(@supabase/ssr) → new SupabaseClient
 *     → _initRealtimeClient → new RealtimeClient → new SocketAdapter → new Socket
 *   Socket 생성자: `this.sessionStore = opts.sessionStorage || global && global.sessionStorage`
 *
 * 왜 라이브러리 옵션으로 못 고치나: phoenix Socket은 `opts.sessionStorage`를 받지만,
 * `RealtimeClient._initializeOptions`가 허용 목록 방식이라(timeout·transport·params·
 * logger 등만 골라 넘긴다) supabase-js를 통해 그 값을 소켓까지 보낼 경로가 없다.
 *
 * 그래서 번들이 돌기 전에 저장소 자체를 안전하게 만든다. 정상 브라우저에서는
 * 아무 일도 하지 않는다 — 탐침이 통과하면 원본을 그대로 둔다.
 *
 * 감수하는 것: 폴백이 켜진 환경에서는 세션이 탭·새로고침을 넘어 유지되지 않는다.
 * 지금은 화면 자체가 열리지 않으므로 명백한 개선이다.
 */

/**
 * 루트 레이아웃이 hydration 이전에 실행하는 스니펫.
 *
 * 번들보다 먼저 돌아야 하므로 모듈 import가 아니라 인라인 문자열이다. 문법은
 * 트랜스파일 없이 그대로 실행되는 수준으로 유지한다.
 */
export const BROWSER_STORAGE_FALLBACK_SNIPPET = `(function(){
  function memoryStorage(){
    var data = Object.create(null);
    return {
      getItem: function(key){ var k = String(key); return k in data ? data[k] : null; },
      setItem: function(key, value){ data[String(key)] = String(value); },
      removeItem: function(key){ delete data[String(key)]; },
      clear: function(){ data = Object.create(null); },
      key: function(index){ var keys = Object.keys(data); return index < keys.length ? keys[index] : null; },
      get length(){ return Object.keys(data).length; }
    };
  }
  var names = ["sessionStorage", "localStorage"];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var usable = false;
    try {
      var probeKey = "__hanbang_storage_probe__";
      var store = window[name];
      store.setItem(probeKey, "1");
      store.removeItem(probeKey);
      usable = true;
    } catch (error) {
      usable = false;
    }
    if (!usable) {
      try {
        Object.defineProperty(window, name, { configurable: true, value: memoryStorage() });
      } catch (error) {
        // 속성을 갈아끼울 수 없는 브라우저까지는 손쓸 수 없다. 여기서 조용히 포기한다 —
        // 이 스니펫이 던지면 그 자체가 첫 화면을 깨뜨린다.
      }
    }
  }
})();`;

/**
 * 화면 조각(자바스크립트 파일) 하나가 못 내려와서 화면이 영영 안 열리는 경우를 사용자에게 알린다(감사 A17, A59).
 *
 * 무엇이 문제였나: 하이드레이션에 필요한 파일이 일부만 실패하면(느리거나 끊기는 망, 인앱 브라우저, 확장 프로그램이
 * 막은 경우) 서버가 그린 시작 단추가 계속 누를 수 없는 채로 남고, 새로고침하라는 말은 어디에도 없었다. 모든 파일을
 * 20초 늦추기만 하면 정상으로 열린다. 갇히는 조건은 "느림"이 아니라 "일부 실패"다.
 *
 * 왜 리액트 타이머로 못 푸나: 실패한 바로 그 파일이 타이머를 돌리는 번들이다. 그래서 번들보다 먼저 도는 인라인 스크립트가
 * capture 단계에서 `error` 이벤트를 듣는다(파일 로딩 실패 이벤트는 위로 올라가지 않아서 capture 로만 잡힌다).
 *
 * 오탐을 줄이는 법: 대상이 `/_next/static/` 아래의 SCRIPT 일 때만, 그리고 한 번만 안내한다. 스크립트 실행 중 던진 오류는
 * 대상이 window 라서 여기 걸리지 않는다. 안내는 닫을 수 있다(광고 차단 확장처럼 앱이 멀쩡히 열리는데 선택 파일만 막힌 경우).
 *
 * 문법은 트랜스파일 없이 그대로 실행되는 수준(ES5)으로 유지하고, 던지지 않게 try 로 감싼다. 이 스니펫이 던지면 그 자체가
 * 첫 화면을 깨뜨린다. 템플릿 문자열이라 스니펫 안에서는 백슬래시, 백틱, 달러 중괄호를 쓰지 않는다.
 */
export const LOAD_FAILURE_NOTICE_TEXT = "화면을 불러오지 못했어요. 새로고침해 주세요.";

/**
 * 안내 막대와 하이드레이션 표시의 이름. 막대는 하이드레이션이 실패했을 때만 맞는 안내다. 하이드레이션이 끝나 화면이 살아 있으면(막힌 파일이 화면에 꼭 필요하지 않았거나,
 * 처음 한 번 실패한 파일을 다시 받아 풀렸거나, 하이드레이션 뒤에 따로 받는 파일 하나가 일시적으로 실패한 경우) 막대가 거짓말이 된다.
 * 그래서 하이드레이션이 끝났을 때 `html` 에 표시를 남기고 막대를 걷는다(`markHydratedAndClearLoadFailureNotice`). 스니펫은 표시가 있으면 새로 띄우지 않는다.
 *
 * 루트 레이아웃이 마운트됐다고 해서 화면이 하이드레이션된 것은 아니다. 레이아웃의 컴포넌트는 화면 본문과 따로 하이드레이션되어서, 화면에 필요한 파일 하나가 막힌 채여도
 * 레이아웃은 먼저 마운트된다(개발 서버에서 파일을 하나씩 막아 본 실측). 그래서 "확인 중" 구간(`LoadStallHint`)이 문서에 남아 있는 동안에는 기다린다. 그 구간은 서버 HTML 에만 있고
 * 하이드레이션이 끝나 화면이 저장 상태를 읽으면 사라지므로, 사라졌다는 것이 곧 화면이 살아났다는 뜻이다(`clearLoadFailureNoticeWhenHydrated`). 화면이 영영 못 살아나면
 * 구간도 남고 막대도 남는다. 그런 구간이 서버 HTML 에 처음부터 없는 화면(취향, 개인정보 처리방침 등)은 사라질 것이 없으므로 신호가 없다. 그 화면들에서
 * 레이아웃이 마운트된 때를 하이드레이션으로 보면 화면 본문 파일 하나가 막힌 채여도 막대가 거짓으로 걷혀 아무 안내 없이 멈추므로, 막대를 걷지 않는다.
 * 오류 화면은 같은 안내를 하므로 막대를 바로 걷는다.
 */
export const LOAD_FAILURE_NOTICE_SELECTOR = "[data-load-failure-notice]";
export const LOAD_FAILURE_HYDRATED_ATTRIBUTE = "data-hb-hydrated";
/** 12초 줄의 "다시 불러오기" 링크 표시. 스니펫이 눌림을 받아 `location.reload()` 로 바꾼다(주소의 # 뒤를 잃지 않으려고). */
export const LATE_RELOAD_LINK_ATTRIBUTE = "data-late-reload-link";
/** "확인 중" 구간의 12초 줄. 서버 HTML 에만 있고 화면이 하이드레이션돼 저장 상태를 읽으면 사라진다. */
export const HYDRATION_PENDING_SELECTOR = "[data-late-reload-hint]";

/** 하이드레이션이 끝났음을 표시하고 로딩 실패 안내 막대를 걷는다. 클라이언트에서만 부른다. 던지지 않는다. */
export function markHydratedAndClearLoadFailureNotice(): void {
  try {
    document.documentElement.setAttribute(LOAD_FAILURE_HYDRATED_ATTRIBUTE, "");
    for (const bar of Array.from(document.querySelectorAll(LOAD_FAILURE_NOTICE_SELECTOR))) bar.remove();
  } catch {
    // 표시를 못 남겨도 화면이 깨지면 안 된다.
  }
}

/**
 * 서버 HTML 의 "확인 중" 구간이 문서에 있는 화면에서, 그 구간이 사라지면(= 화면 본문이 하이드레이션돼 저장 상태를 읽음) 하이드레이션 표시를 남기고 막대를 걷는다.
 * 돌려받은 함수로 기다림을 멈춘다. 구간이 영영 안 사라지면 아무것도 하지 않는다(막대가 남는다).
 * 구간이 처음부터 없는 화면에서도 아무것도 하지 않는다. 레이아웃은 화면 본문과 따로 하이드레이션되므로 마운트됐다는 것은 본문이 살아났다는 증거가 아니다.
 * 이 함수는 레이아웃이 마운트될 때 한 번 부른다. 그때 구간이 보이지 않으면 서버 HTML 에 없던 화면으로 본다
 * (구간이 있는 화면에서 본문이 레이아웃보다 먼저 살아나는 일은 없다. 본문은 레이아웃 안에 있다).
 */
export function clearLoadFailureNoticeWhenHydrated(): () => void {
  try {
    if (!document.querySelector(HYDRATION_PENDING_SELECTOR)) return () => {};
    const observer = new MutationObserver(() => {
      if (document.querySelector(HYDRATION_PENDING_SELECTOR)) return;
      observer.disconnect();
      markHydratedAndClearLoadFailureNotice();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}

export const LOAD_FAILURE_NOTICE_SNIPPET = `(function(){
  var shown = false;
  function hydrated(){
    try { return document.documentElement.hasAttribute(${JSON.stringify(LOAD_FAILURE_HYDRATED_ATTRIBUTE)}); } catch (error) { return false; }
  }
  function mount(){
    try {
      if (hydrated()) return;
      var bar = document.createElement("div");
      bar.setAttribute("role", "alert");
      bar.setAttribute("data-load-failure-notice", "");
      bar.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:2147483647;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 14px;padding:14px 16px;background:#3A2A27;color:#fff;font:600 14px/1.5 system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;text-align:center";
      var text = document.createElement("span");
      text.textContent = ${JSON.stringify(LOAD_FAILURE_NOTICE_TEXT)};
      var buttonCss = "min-height:44px;padding:0 18px;border-radius:6px;border:1px solid #fff;font:inherit;cursor:pointer";
      var reload = document.createElement("button");
      reload.type = "button";
      reload.textContent = "새로고침";
      reload.style.cssText = buttonCss + ";background:#fff;color:#3A2A27";
      reload.onclick = function(){ window.location.reload(); };
      var close = document.createElement("button");
      close.type = "button";
      close.textContent = "닫기";
      close.style.cssText = buttonCss + ";background:transparent;color:#fff";
      close.onclick = function(){ if (bar.parentNode) bar.parentNode.removeChild(bar); };
      bar.appendChild(text);
      bar.appendChild(reload);
      bar.appendChild(close);
      document.body.appendChild(bar);
    } catch (error) {}
  }
  function show(){
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);
  }
  window.addEventListener("error", function(event){
    try {
      if (shown || hydrated()) return;
      var target = event && event.target;
      if (!target || target === window || target.tagName !== "SCRIPT") return;
      var link = document.createElement("a");
      link.href = target.src || target.getAttribute("src") || "";
      if (String(link.pathname).indexOf("/_next/static/") !== 0 && String(link.pathname).indexOf("_next/static/") !== 0) return;
      shown = true;
      show();
    } catch (error) {}
  }, true);
  document.addEventListener("click", function(event){
    try {
      var node = event && event.target;
      while (node && node !== document) {
        if (node.nodeType === 1 && node.hasAttribute(${JSON.stringify(LATE_RELOAD_LINK_ATTRIBUTE)})) {
          event.preventDefault();
          window.location.reload();
          return;
        }
        node = node.parentNode;
      }
    } catch (error) {}
  }, true);
})();`;

/**
 * 서버 HTML 의 "확인 중" 구간에 넣는 보강 안내(감사 A17, A59). 자바스크립트가 아예 안 도는 경우와, 오류 이벤트조차 못 받은 경우를 위해
 * CSS 지연 애니메이션으로 12초 뒤에 보인다(스크립트가 필요 없다). 하이드레이션이 끝나 "확인 중"이 사라지면 안내도 같이 사라진다.
 * 느리기만 한 망에서는 12초 안에 풀려서 보이지 않는다. 애니메이션은 줄이기 설정과 무관하게 지연 뒤 한 번 켜지므로(길이 0초) 즉시 보이지 않는다.
 */
export const LATE_RELOAD_HINT_TEXT = "화면이 계속 열리지 않으면 새로고침해 주세요.";
/** 12초 줄 끝의 링크. 오류 이벤트가 안 오는 실패(응답 멈춤, 깨진 파일)에는 위쪽 안내 막대가 없고, 앱 웹뷰는 당겨서 새로고침이 막혀 있어 줄만으로는 새로고침할 길이 없다. */
export const LATE_RELOAD_LINK_TEXT = "다시 불러오기";
export const NO_SCRIPT_HINT_TEXT = "이 화면은 브라우저의 자바스크립트 기능이 켜져 있어야 열려요.";
export const LATE_RELOAD_HINT_DELAY_SECONDS = 12;
export const LATE_RELOAD_HINT_CSS = `@keyframes hb-late-reveal{to{visibility:visible;opacity:1}}.hb-late-hint{visibility:hidden;opacity:0;animation:hb-late-reveal 0s linear ${LATE_RELOAD_HINT_DELAY_SECONDS}s forwards}`;
