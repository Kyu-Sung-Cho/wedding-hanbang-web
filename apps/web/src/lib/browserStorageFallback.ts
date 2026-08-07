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
